// Centralized model configuration. Add/remove models here.
// Set reasoning: true for models that support extended thinking.
// The UI shows a sparkle icon next to reasoning models automatically.

export type AnalysisModelPreset = {
  label: string;
  modelId: string;
  reasoning: boolean;
  providerOnly?: string;
};

export type ModelPreset = {
  label: string;
  modelId: string;
  reasoning?: boolean;
  providerOnly?: string;
  providers?: string[];
};

export type ModelProvider = "openrouter" | "bedrock" | "fireworks";

export type ProviderRoleDefaults = {
  analysisModelId: string;
  taskModelId: string;
  utilityModelId: string;
  synthesisModelId: string;
  taskProviders: string[];
};

export type ProviderConfig = {
  models: ModelPreset[];
  defaults: ProviderRoleDefaults;
};

// Provider-keyed model config. Each key holds the models and per-role defaults for that provider.
export const MODEL_CONFIG: Record<ModelProvider, ProviderConfig> = {
  openrouter: {
    defaults: {
      analysisModelId: "moonshotai/kimi-k2-0905",
      taskModelId: "openai/gpt-oss-120b",
      utilityModelId: "openai/gpt-oss-20b",
      synthesisModelId: "openai/gpt-oss-20b",
      taskProviders: ["sambanova", "groq", "cerebras"],
    },
    models: [
      {
        label: "GPT-OSS 20B",
        modelId: "openai/gpt-oss-20b",
        reasoning: true,
      },
      {
        label: "GPT-OSS 120B",
        modelId: "openai/gpt-oss-120b",
        reasoning: true,
        providers: ["sambanova", "groq", "cerebras"],
      },
      {
        label: "Minimax M2.5",
        modelId: "minimax/minimax-m2.5",
        reasoning: true,
      },
      {
        label: "Qwen 3.5 397B A17B",
        modelId: "qwen/qwen3.5-397b-a17b",
        reasoning: true,
      },
      {
        label: "Claude Sonnet 4.6",
        modelId: "anthropic/claude-sonnet-4.6",
        reasoning: false,
      },
      {
        label: "Kimi K2 0905",
        modelId: "moonshotai/kimi-k2-0905",
        reasoning: false,
      },
      {
        label: "Kimi K2.5",
        modelId: "moonshotai/kimi-k2.5",
        reasoning: true,
      },
      {
        label: "GLM 4.7",
        modelId: "z-ai/glm-4.7",
        reasoning: true,
      },
      {
        label: "GLM 5",
        modelId: "z-ai/glm-5",
        reasoning: true,
      },
    ],
  },
  fireworks: {
    defaults: {
      analysisModelId: "accounts/fireworks/models/kimi-k2p5",
      taskModelId: "accounts/fireworks/models/gpt-oss-120b",
      utilityModelId: "accounts/fireworks/models/gpt-oss-20b",
      synthesisModelId: "accounts/fireworks/models/gpt-oss-20b",
      taskProviders: [],
    },
    models: [
      {
        label: "GPT-OSS 20B",
        modelId: "accounts/fireworks/models/gpt-oss-20b",
        reasoning: true,
      },
      {
        label: "GPT-OSS 120B",
        modelId: "accounts/fireworks/models/gpt-oss-120b",
        reasoning: true,
      },
      {
        label: "Minimax M2.5",
        modelId: "accounts/fireworks/models/minimax-m2p5",
        reasoning: true,
      },
      {
        label: "Kimi K2.5",
        modelId: "accounts/fireworks/models/kimi-k2p5",
        reasoning: true,
      },
      {
        label: "GLM 5",
        modelId: "accounts/fireworks/models/glm-5",
        reasoning: true,
      },
    ],
  },
  bedrock: {
    defaults: {
      analysisModelId: "us.anthropic.claude-sonnet-4-6",
      taskModelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      utilityModelId: "openai.gpt-oss-20b-1:0",
      synthesisModelId: "us.anthropic.claude-sonnet-4-6",
      taskProviders: [],
    },
    models: [
      {
        label: "Claude Haiku 4.5",
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        reasoning: false,
      },
      {
        label: "Claude Sonnet 4.6",
        modelId: "us.anthropic.claude-sonnet-4-6",
        reasoning: false,
      },
      {
        label: "Claude Opus 4.6",
        modelId: "us.anthropic.claude-opus-4-6-v1",
        reasoning: false,
      },
      {
        label: "GPT-OSS 120B",
        modelId: "openai.gpt-oss-120b-1:0",
        reasoning: true,
      },
      {
        label: "GPT-OSS 20B",
        modelId: "openai.gpt-oss-20b-1:0",
        reasoning: true,
      },
      {
        label: "Kimi K2.5",
        modelId: "moonshotai.kimi-k2.5",
        reasoning: true,
      },
      {
        label: "DeepSeek V3.2",
        modelId: "deepseek.v3.2",
        reasoning: true,
      },
    ],
  },
};

export const DEFAULT_UTILITY_MODEL_ID = "openai/gpt-oss-20b";
export const DEFAULT_SYNTHESIS_MODEL_ID = "openai/gpt-oss-20b";

export function getAnalysisModelPreset(
  modelId: string
): AnalysisModelPreset | undefined {
  // Search across all providers since analysis can use any provider.
  for (const { models } of Object.values(MODEL_CONFIG)) {
    const match = models.find((p) => p.modelId === modelId);
    if (match) {
      return {
        label: match.label,
        modelId: match.modelId,
        reasoning: !!match.reasoning,
        providerOnly: match.providerOnly,
      };
    }
  }
  return undefined;
}
