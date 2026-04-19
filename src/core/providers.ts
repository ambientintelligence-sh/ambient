import type { LanguageModel } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { Api, Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { SessionConfig } from "./types";
import { getReasoningEffortForModel } from "./models";

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
  return createModelForProvider(config, config.utilityModelId);
}

export function createSynthesisModel(config: SessionConfig): LanguageModel {
  return createModelForProvider(config, config.synthesisModelId);
}

export function createTaskModel(config: SessionConfig): LanguageModel {
  return createModelForProvider(config, config.taskModelId, {
    reasoning: reasoningForModel(config.taskModelId, 1024),
    provider: {
      sort: "throughput" as const,
      ...(config.taskProviders?.length ? { only: config.taskProviders } : {}),
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
    maxTokens: 100_000,
  };
}

export type CreateAgentPiModelDeps = {
  /**
   * Returns a fresh OpenAI Codex OAuth access token (refreshing on expiry).
   * Required when `config.analysisProvider === "openai-codex"`.
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
    const getToken = deps.getOpenAiCodexAccessToken;
    if (!getToken) {
      throw new Error(
        "openai-codex provider selected but no OAuth token resolver was wired. Log in via Settings → ChatGPT.",
      );
    }
    return {
      model: buildOpenAiCodexModel(config.analysisModelId) as Model<Api>,
      thinkingLevel,
      getApiKey: getToken,
    };
  }

  const only = config.analysisProviderOnly ? [config.analysisProviderOnly] : undefined;
  return {
    model: buildOpenRouterModel(config.analysisModelId, only) as Model<Api>,
    thinkingLevel,
    apiKey: process.env.OPENROUTER_API_KEY,
  };
}
