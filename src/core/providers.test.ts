import { describe, expect, it } from "vitest";

import { createAgentPiModel } from "./providers";
import type { SessionConfig } from "./types";

function makeSessionConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    direction: "auto",
    sourceLang: "en",
    targetLang: "en",
    intervalMs: 8_000,
    transcriptionProvider: "openrouter",
    transcriptionModelId: "google/gemini-3-flash-preview",
    analysisProvider: "openrouter",
    analysisModelId: "z-ai/glm-5.1",
    analysisReasoning: false,
    taskModelId: "openai/gpt-oss-120b",
    taskProviders: ["sambanova", "groq", "cerebras"],
    utilityModelId: "openai/gpt-oss-20b",
    synthesisModelId: "z-ai/glm-5.1",
    vertexProject: undefined,
    vertexLocation: "global",
    bedrockRegion: "us-east-1",
    responseLength: "standard",
    taskSuggestionAggressiveness: "balanced",
    suggestionScanWordBudget: 200,
    debug: false,
    legacyAudio: false,
    translationEnabled: false,
    agentAutoApprove: false,
    localToolsFiles: true,
    localToolsBash: true,
    localToolsRunJs: false,
    codingAgent: null,
    disabledSkillIds: [],
    learningEnabled: true,
    ...overrides,
  };
}

describe("createAgentPiModel", () => {
  it("falls back to medium reasoning for unknown persisted models when reasoning is enabled", () => {
    const model = createAgentPiModel(
      makeSessionConfig({
        analysisModelId: "custom/reasoning-model",
        analysisReasoning: true,
      }),
    );

    expect(model.thinkingLevel).toBe("medium");
  });
});
