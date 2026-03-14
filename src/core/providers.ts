import type { LanguageModel } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createFireworks } from "@ai-sdk/fireworks";
import type { SessionConfig } from "./types";

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
    case "elevenlabs": {
      throw new Error(
        "ElevenLabs transcription does not use an AI SDK language model."
      );
    }
    case "fireworks": {
      throw new Error(
        "Fireworks transcription uses a REST API, not an AI SDK language model."
      );
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
          ? { max_tokens: 4096, exclude: false }
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
    case "fireworks": {
      const fireworks = createFireworks({
        apiKey: process.env.FIREWORKS_API_KEY,
      });
      return fireworks(config.analysisModelId);
    }
  }
  throw new Error(
    `Unsupported analysis provider: ${String(config.analysisProvider)}`
  );
}

function createModelForProvider(
  config: SessionConfig,
  modelId: string
): LanguageModel {
  switch (config.analysisProvider) {
    case "bedrock": {
      const bedrock = createAmazonBedrock({ region: config.bedrockRegion });
      return bedrock(modelId);
    }
    case "fireworks": {
      const fireworks = createFireworks({
        apiKey: process.env.FIREWORKS_API_KEY,
      });
      return fireworks(modelId);
    }
    default: {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      return openrouter(modelId, { provider: { sort: "throughput" as const } });
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
  if (config.analysisProvider === "bedrock") {
    const bedrock = createAmazonBedrock({ region: config.bedrockRegion });
    return bedrock(config.taskModelId);
  }
  if (config.analysisProvider === "fireworks") {
    const fireworks = createFireworks({
      apiKey: process.env.FIREWORKS_API_KEY,
    });
    return fireworks(config.taskModelId);
  }
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  const provider = {
    sort: "throughput" as const,
    ...(config.taskProviders?.length ? { only: config.taskProviders } : {}),
  };
  return openrouter(config.taskModelId, {
    reasoning: { max_tokens: 1024, exclude: false },
    provider,
  });
}
