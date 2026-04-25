import type { SessionConfig } from "./types";

export function validateEnv(config: Pick<SessionConfig, "transcriptionProvider" | "analysisProvider">) {
  const missing: string[] = [];

  const needsGoogle = config.transcriptionProvider === "google" || config.analysisProvider === "google";
  const needsOpenRouter =
    config.transcriptionProvider === "openrouter" ||
    config.analysisProvider === "openrouter" ||
    config.analysisProvider === "openai-codex";

  if (needsGoogle) {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GEMINI_API_KEY) {
      missing.push("GOOGLE_GENERATIVE_AI_API_KEY");
    }
  }

  if (needsOpenRouter) {
    if (!process.env.OPENROUTER_API_KEY) {
      missing.push("OPENROUTER_API_KEY");
    }
  }

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}
