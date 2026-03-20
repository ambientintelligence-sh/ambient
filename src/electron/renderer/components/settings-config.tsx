import type { ReactNode, ComponentType } from "react";
import {
  Laptop2Icon,
  SunIcon,
  MoonIcon,
  KeyIcon,
} from "lucide-react";
import {
  SiOpenrouter,
  SiGooglegemini,
} from "@icons-pack/react-simple-icons";
import type {
  ApiKeyDefinition,
  AppConfig,
  DarkVariant,
  FontFamily,
  FontSize,
  Language,
  LanguageCode,
  LightVariant,
  ThemeMode,
  TranscriptionProvider,
} from "@core/types";

export const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  icon: ReactNode;
}> = [
  {
    value: "system",
    label: "System",
    icon: <Laptop2Icon className="size-3.5" />,
  },
  { value: "light", label: "Light", icon: <SunIcon className="size-3.5" /> },
  { value: "dark", label: "Dark", icon: <MoonIcon className="size-3.5" /> },
];

export const LIGHT_VARIANT_OPTIONS: Array<{
  value: LightVariant;
  label: string;
  swatch: string;
}> = [
  { value: "warm", label: "Warm", swatch: "oklch(0.985 0.002 90)" },
  { value: "linen", label: "Linen", swatch: "#EEEEEE" },
  { value: "ivory", label: "Ivory", swatch: "oklch(0.968 0.004 90)" },
  { value: "petal", label: "Petal", swatch: "oklch(0.962 0.006 250)" },
];

export const DARK_VARIANT_OPTIONS: Array<{
  value: DarkVariant;
  label: string;
  swatch: string;
}> = [
  { value: "charcoal", label: "Charcoal", swatch: "oklch(0.145 0 0)" },
  { value: "steel", label: "Steel", swatch: "oklch(0.2 0.004 260)" },
  { value: "abyss", label: "Abyss", swatch: "oklch(0.185 0.02 264)" },
  { value: "pitch-black", label: "Pitch Black", swatch: "oklch(0 0 0)" },
];

export const FONT_SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
];

export const FONT_FAMILY_OPTIONS: Array<{ value: FontFamily; label: string }> = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
];

export type TranscriptionPreset = {
  modelId: string;
  label: string;
  description: string;
  defaultIntervalMs: number;
};

export type TranscriptionProviderOption = {
  value: TranscriptionProvider;
  label: string;
  description: string;
  supportsTranslation: boolean;
  models: TranscriptionPreset[];
};

export const TRANSCRIPTION_PROVIDER_OPTIONS: TranscriptionProviderOption[] = [
  {
    value: "google",
    label: "Google AI Studio",
    description: "Gemini via API key auth",
    supportsTranslation: true,
    models: [
      {
        modelId: "gemini-3-flash-preview",
        label: "Gemini 3 Flash",
        description: "Best accuracy",
        defaultIntervalMs: 8000,
      },
      {
        modelId: "gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash Lite",
        description: "Lowest Gemini cost",
        defaultIntervalMs: 8000,
      },
    ],
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    description: "Gemini routed through OpenRouter",
    supportsTranslation: true,
    models: [
      {
        modelId: "google/gemini-3-flash-preview",
        label: "Gemini 3 Flash",
        description: "Best accuracy",
        defaultIntervalMs: 8000,
      },
      {
        modelId: "google/gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash Lite",
        description: "Lowest Gemini cost",
        defaultIntervalMs: 8000,
      },
    ],
  },
];

export const TRANSCRIPTION_PROVIDER_LABELS: Partial<Record<TranscriptionProvider, string>> = {
  google: "Google AI Studio",
  openrouter: "OpenRouter",
};

export function getTranscriptionProviderOption(
  provider: TranscriptionProvider,
) {
  return (
    TRANSCRIPTION_PROVIDER_OPTIONS.find((option) => option.value === provider) ??
    TRANSCRIPTION_PROVIDER_OPTIONS[0]
  );
}

export function getTranscriptionModelOption(
  provider: TranscriptionProvider,
  modelId: string,
) {
  const providerOption = getTranscriptionProviderOption(provider);
  return (
    providerOption.models.find((option) => option.modelId === modelId) ??
    providerOption.models[0]
  );
}

export const ANALYSIS_PROVIDERS: Array<{ value: AppConfig["analysisProvider"]; label: string }> = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "bedrock", label: "AWS Bedrock" },
];

export const PROVIDER_REQUIRED_KEYS: Record<string, string[]> = {
  openrouter: ["OPENROUTER_API_KEY"],
  google: ["GEMINI_API_KEY"],
  bedrock: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
};

export function isProviderConfigured(
  provider: string,
  apiKeyStatus: Record<string, boolean>,
): boolean {
  const required = PROVIDER_REQUIRED_KEYS[provider];
  if (!required || required.length === 0) return true;
  return required.every((key) => apiKeyStatus[key]);
}

export function renderLanguageLabel(languages: Language[], code: LanguageCode) {
  const lang = languages.find((item) => item.code === code);
  return lang
    ? `${lang.native} (${lang.code.toUpperCase()})`
    : code.toUpperCase();
}

export function isKeyNeeded(def: ApiKeyDefinition, config: AppConfig): boolean {
  if (def.providers.length === 0) return true;
  if (def.envVar === "OPENROUTER_API_KEY") return true;
  return def.providers.some(
    (p) => p === config.transcriptionProvider || p === config.analysisProvider,
  );
}

export const API_KEY_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  OPENROUTER_API_KEY: SiOpenrouter,
  GEMINI_API_KEY: SiGooglegemini,
};

export function renderApiKeyIcon(envVar: string) {
  const Icon = API_KEY_ICONS[envVar];
  if (Icon) return <Icon size={14} className="shrink-0" />;
  return <KeyIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />;
}
