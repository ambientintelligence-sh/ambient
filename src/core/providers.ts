import type { LanguageModel } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
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
