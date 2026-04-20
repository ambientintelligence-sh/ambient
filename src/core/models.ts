// Centralized model configuration. Add/remove models here.
// Set reasoning: true for models that support extended thinking.
// The UI shows a sparkle icon next to reasoning models automatically.

export type ReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

export type AnalysisModelPreset = {
  label: string;
  modelId: string;
  reasoning: boolean;
  reasoningEffort?: ReasoningEffort;
  providerOnly?: string;
};

export type ModelPreset = {
  label: string;
  modelId: string;
  reasoning?: boolean;
  reasoningEffort?: ReasoningEffort;
  providerOnly?: string;
  providers?: string[];
};

export type ModelProvider = "openrouter" | "bedrock" | "openai-codex";

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
      analysisModelId: "moonshotai/kimi-k2.5",
      taskModelId: "openai/gpt-oss-120b",
      utilityModelId: "openai/gpt-oss-20b",
      synthesisModelId: "openai/gpt-oss-120b",
      taskProviders: ["sambanova", "groq", "cerebras"],
    },
    models: [
      // Anthropic
      {
        label: "Claude Opus 4.7",
        modelId: "anthropic/claude-opus-4.7",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "Claude Sonnet 4.6",
        modelId: "anthropic/claude-sonnet-4.6",
        reasoning: false,
      },
      // Google
      {
        label: "Gemini 3.1 Pro",
        modelId: "google/gemini-3.1-pro-preview",
        reasoning: true,
        reasoningEffort: "medium",
      },
      // MiniMax
      {
        label: "Minimax M2.7",
        modelId: "minimax/minimax-m2.7",
        reasoning: true,
        reasoningEffort: "medium",
      },
      // Moonshot AI
      {
        label: "Kimi K2 0905",
        modelId: "moonshotai/kimi-k2-0905",
        reasoning: false,
      },
      {
        label: "Kimi K2.5",
        modelId: "moonshotai/kimi-k2.5",
        reasoning: true,
        reasoningEffort: "medium",
      },
      // OpenAI
      {
        label: "GPT-5.4",
        modelId: "openai/gpt-5.4",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "GPT-5.4 Mini",
        modelId: "openai/gpt-5.4-mini",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "GPT-OSS 20B",
        modelId: "openai/gpt-oss-20b",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "GPT-OSS 120B",
        modelId: "openai/gpt-oss-120b",
        reasoning: true,
        reasoningEffort: "medium",
        providers: ["sambanova", "groq", "cerebras"],
      },
      // Qwen
      {
        label: "Qwen 3.5 397B A17B",
        modelId: "qwen/qwen3.5-397b-a17b",
        reasoning: true,
        reasoningEffort: "medium",
      },
      // Z.AI
      {
        label: "GLM 5.1",
        modelId: "z-ai/glm-5.1",
        reasoning: true,
        reasoningEffort: "medium",
      },
    ],
  },
  "openai-codex": {
    defaults: {
      // ChatGPT subscription-backed endpoint. These only apply to the agent
      // path — utility/synthesis/analysis for suggestions still route via
      // the original provider (OpenRouter/Bedrock) because the ChatGPT
      // backend charges against weekly/daily message caps and we don't want
      // to burn them on summarisation.
      //
      // Model list mirrors what ChatGPT Plus/Pro exposes in the web model
      // picker. ChatGPT's own UI is the source of truth for "what's
      // available on your subscription" — there's no clean API for it.
      analysisModelId: "gpt-5.4",
      taskModelId: "gpt-5.4",
      utilityModelId: "gpt-5.4",
      synthesisModelId: "gpt-5.4",
      taskProviders: [],
    },
    models: [
      {
        label: "GPT-5.4",
        modelId: "gpt-5.4",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "GPT-5.4 Mini",
        modelId: "gpt-5.4-mini",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "GPT-5.3 Codex",
        modelId: "gpt-5.3-codex",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "GPT-5.2 Codex",
        modelId: "gpt-5.2-codex",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "GPT-5.2",
        modelId: "gpt-5.2",
        reasoning: true,
        reasoningEffort: "medium",
      },
      {
        label: "GPT-5.1 Codex Max",
        modelId: "gpt-5.1-codex-max",
        reasoning: true,
        reasoningEffort: "xhigh",
      },
      {
        label: "GPT-5.1 Codex Mini",
        modelId: "gpt-5.1-codex-mini",
        reasoning: true,
        reasoningEffort: "medium",
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
        reasoningEffort: match.reasoningEffort,
        providerOnly: match.providerOnly,
      };
    }
  }
  return undefined;
}

export function getReasoningEffortForModel(modelId: string): ReasoningEffort | undefined {
  for (const { models } of Object.values(MODEL_CONFIG)) {
    const match = models.find((p) => p.modelId === modelId);
    if (match) return match.reasoningEffort;
  }
  return undefined;
}
