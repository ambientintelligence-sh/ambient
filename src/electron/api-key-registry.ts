import type { ApiKeyDefinition } from "@core/types";

export const API_KEY_DEFINITIONS: readonly ApiKeyDefinition[] = [
  {
    envVar: "OPENROUTER_API_KEY",
    label: "OpenRouter API Key",
    placeholder: "sk-or-v1-...",
    providers: ["openrouter"],
  },
  {
    envVar: "GEMINI_API_KEY",
    label: "Google AI (Gemini) API Key",
    placeholder: "AIza...",
    providers: ["google"],
  },
  {
    envVar: "AWS_ACCESS_KEY_ID",
    label: "AWS Access Key ID",
    placeholder: "AKIA...",
    providers: ["bedrock"],
  },
  {
    envVar: "AWS_SECRET_ACCESS_KEY",
    label: "AWS Secret Access Key",
    placeholder: "wJal...",
    providers: ["bedrock"],
  },
  {
    envVar: "EXA_API_KEY",
    label: "Exa API Key (for AI Agents)",
    placeholder: "exa-...",
    providers: [],
  },
];
