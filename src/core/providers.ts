import type { LanguageModel } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { Api, Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { SessionConfig } from "./types";
import { MODEL_CONFIG, getReasoningEffortForModel } from "./models";

type ReasoningOption =
  | { effort: "xhigh" | "high" | "medium" | "low" | "minimal" | "none"; exclude: boolean }
  | { max_tokens: number; exclude: boolean };

function reasoningForModel(modelId: string, fallbackMaxTokens: number): ReasoningOption {
  const effort = getReasoningEffortForModel(modelId);
  return effort
    ? { effort, exclude: false }
    : { max_tokens: fallbackMaxTokens, exclude: false };
}

export function createTranscriptionModel(config: SessionConfig): LanguageModel {
  switch (config.transcriptionProvider) {
    case "openrouter": {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      return openrouter(config.transcriptionModelId, {
        provider: { sort: "latency" as const },
      });
    }
    case "vertex": {
      const vertex = createVertex({
        project: config.vertexProject,
        location: config.vertexLocation,
      });
      return vertex(config.transcriptionModelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY,
      });
      return google(config.transcriptionModelId);
    }
  }
  throw new Error(
    `Unsupported transcription provider: ${String(config.transcriptionProvider)}`
  );
}

// ChatGPT subscription uses a custom backend and flat-rate pricing. The Vercel
// AI SDK can't target it directly, so when `openai-codex` is the selected
// provider we keep the agent on pi-ai + OAuth (see createAgentPiModel) and
// fall back to OpenRouter defaults for analysis/task/utility/synthesis to
// preserve the user's subscription quota.
const OPENROUTER_FALLBACK = MODEL_CONFIG.openrouter.defaults;

export function createAnalysisModel(config: SessionConfig): LanguageModel {
  switch (config.analysisProvider) {
    case "openrouter": {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      const provider = {
        sort: "throughput" as const,
        ...(config.analysisProviderOnly
          ? { only: [config.analysisProviderOnly] }
          : {}),
      };
      return openrouter(config.analysisModelId, {
        reasoning: config.analysisReasoning
          ? reasoningForModel(config.analysisModelId, 4096)
          : undefined,
        provider,
      });
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY,
      });
      return google(config.analysisModelId);
    }
    case "vertex": {
      const vertex = createVertex({
        project: config.vertexProject,
        location: config.vertexLocation,
      });
      return vertex(config.analysisModelId);
    }
    case "bedrock": {
      const bedrock = createAmazonBedrock({
        region: config.bedrockRegion,
      });
      return bedrock(config.analysisModelId);
    }
    case "openai-codex": {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      return openrouter(OPENROUTER_FALLBACK.analysisModelId, {
        reasoning: reasoningForModel(OPENROUTER_FALLBACK.analysisModelId, 4096),
        provider: { sort: "throughput" as const },
      });
    }
  }
  throw new Error(
    `Unsupported analysis provider: ${String(config.analysisProvider)}`
  );
}

function createModelForProvider(
  config: SessionConfig,
  modelId: string,
  openRouterOptions?: { reasoning?: ReasoningOption; provider?: Record<string, unknown> },
): LanguageModel {
  switch (config.analysisProvider) {
    case "bedrock": {
      const bedrock = createAmazonBedrock({ region: config.bedrockRegion });
      return bedrock(modelId);
    }
    default: {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      return openrouter(modelId, {
        provider: { sort: "throughput" as const },
        ...openRouterOptions,
      });
    }
  }
}

export function createUtilitiesModel(config: SessionConfig): LanguageModel {
  const modelId = config.analysisProvider === "openai-codex"
    ? OPENROUTER_FALLBACK.utilityModelId
    : config.utilityModelId;
  return createModelForProvider(config, modelId);
}

export function createSynthesisModel(config: SessionConfig): LanguageModel {
  const modelId = config.analysisProvider === "openai-codex"
    ? OPENROUTER_FALLBACK.synthesisModelId
    : config.synthesisModelId;
  return createModelForProvider(config, modelId);
}

export function createTaskModel(config: SessionConfig): LanguageModel {
  const useFallback = config.analysisProvider === "openai-codex";
  const modelId = useFallback ? OPENROUTER_FALLBACK.taskModelId : config.taskModelId;
  const providers = useFallback ? OPENROUTER_FALLBACK.taskProviders : (config.taskProviders ?? []);
  return createModelForProvider(config, modelId, {
    reasoning: reasoningForModel(modelId, 1024),
    provider: {
      sort: "throughput" as const,
      ...(providers.length ? { only: providers } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// pi-ai (pi-mono) provider factory for the agent runtime.
//
// The analysis / structured-output path stays on Vercel AI SDK (see functions
// above). Only the agent runtime migrates to pi-mono, so we build a pi-ai
// `Model<Api>` here and let pi-mono's `streamSimple` drive the conversation.
// ---------------------------------------------------------------------------

export type AgentPiModel = {
  model: Model<Api>;
  thinkingLevel: ThinkingLevel | "off";
  /** Static API key for env-backed providers (OpenRouter). */
  apiKey?: string;
  /**
   * Dynamic key resolver for OAuth-backed providers (ChatGPT subscription).
   * Called per LLM request so expired tokens can be refreshed transparently.
   */
  getApiKey?: () => Promise<string | undefined>;
};

function reasoningEffortToThinkingLevel(
  effort: ReturnType<typeof getReasoningEffortForModel>,
): ThinkingLevel | "off" {
  if (!effort || effort === "none") return "off";
  return effort;
}

function buildOpenRouterModel(modelId: string, taskProviders?: string[]): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
    compat: {
      thinkingFormat: "openrouter",
      openRouterRouting: {
        sort: "throughput",
        ...(taskProviders?.length ? { only: taskProviders } : {}),
      },
    },
  };
}

function buildBedrockModel(modelId: string): Model<"bedrock-converse-stream"> {
  return {
    id: modelId,
    name: modelId,
    api: "bedrock-converse-stream",
    provider: "amazon-bedrock",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_384,
  };
}

function buildOpenAiCodexModel(modelId: string): Model<"openai-codex-responses"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
  };
}

export type CreateAgentPiModelDeps = {
  /**
   * Resolver for the ChatGPT subscription access token. Called per LLM request
   * so the token can be refreshed transparently when it expires. Required when
   * `config.analysisProvider === "openai-codex"`; ignored otherwise.
   */
  getOpenAiCodexAccessToken?: () => Promise<string>;
};

export function createAgentPiModel(
  config: SessionConfig,
  deps: CreateAgentPiModelDeps = {},
): AgentPiModel {
  const thinkingLevel = reasoningEffortToThinkingLevel(
    getReasoningEffortForModel(config.analysisModelId),
  );

  if (config.analysisProvider === "bedrock") {
    return {
      model: buildBedrockModel(config.analysisModelId) as Model<Api>,
      thinkingLevel,
    };
  }

  if (config.analysisProvider === "openai-codex") {
    const getApiKey = deps.getOpenAiCodexAccessToken;
    if (!getApiKey) {
      throw new Error(
        "OpenAI (ChatGPT) provider is selected but no OAuth token resolver was provided. Log in again from Settings → API Keys.",
      );
    }
    return {
      model: buildOpenAiCodexModel(config.analysisModelId) as Model<Api>,
      thinkingLevel,
      getApiKey,
    };
  }

  const only = config.analysisProviderOnly ? [config.analysisProviderOnly] : undefined;
  return {
    model: buildOpenRouterModel(config.analysisModelId, only) as Model<Api>,
    thinkingLevel,
    apiKey: process.env.OPENROUTER_API_KEY,
  };
}
