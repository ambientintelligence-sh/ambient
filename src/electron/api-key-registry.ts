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
    envVar: "EXA_API_KEY",
    label: "Exa Search API Key",
    placeholder: "exa-...",
    providers: [],
  },
];
