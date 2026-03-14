import type { SessionConfig } from "./types";

export function validateEnv(config: Pick<SessionConfig, "transcriptionProvider" | "analysisProvider" | "vertexProject" | "vertexLocation">) {
  const missing: string[] = [];

  const needsGoogle = config.transcriptionProvider === "google" || config.analysisProvider === "google";
  const needsOpenRouter = config.transcriptionProvider === "openrouter" || config.analysisProvider === "openrouter";
  const needsElevenLabs = config.transcriptionProvider === "elevenlabs";
  const needsFireworks = config.transcriptionProvider === "fireworks" || config.analysisProvider === "fireworks";
  const needsBedrock = config.analysisProvider === "bedrock";

  if (needsBedrock) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      missing.push("AWS_ACCESS_KEY_ID");
    }
    if (!process.env.AWS_SECRET_ACCESS_KEY) {
      missing.push("AWS_SECRET_ACCESS_KEY");
    }
  }

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

  if (needsElevenLabs) {
    if (!process.env.ELEVENLABS_API_KEY) {
      missing.push("ELEVENLABS_API_KEY");
    }
  }

  if (needsFireworks) {
    if (!process.env.FIREWORKS_API_KEY) {
      missing.push("FIREWORKS_API_KEY");
    }
  }

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}
