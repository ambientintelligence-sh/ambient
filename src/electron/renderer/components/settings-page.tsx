import type {
  ApiKeyDefinition,
  AppConfig,
  CustomMcpStatus,
  DarkVariant,
  FontFamily,
  FontSize,
  McpIntegrationStatus,
  McpProviderToolSummary,
  McpToolInfo,
  Language,
  LanguageCode,
  LightVariant,
  ResponseLength,
  ThemeMode,
  TranscriptionProvider,
} from "@core/types";
import { MODEL_CONFIG } from "@core/models";
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircleIcon,
  CpuIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  Laptop2Icon,
  MicIcon,
  MoonIcon,
  PaletteIcon,
  PlugIcon,
  RotateCcwIcon,
  ServerIcon,
  ShieldCheckIcon,
  BookOpenIcon,
  SlidersHorizontalIcon,
  SunIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { resolveProviderIcon } from "./integration-icons";
import {
  SiOpenrouter,
  SiGooglegemini,
  SiElevenlabs,
} from "@icons-pack/react-simple-icons";

type SettingsPageProps = {
  config: AppConfig;
  languages: Language[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onSourceLangChange: (lang: LanguageCode) => void;
  onTargetLangChange: (lang: LanguageCode) => void;
  isRecording: boolean;
  onConfigChange: (next: AppConfig) => void;
  onReset: () => void;
  mcpIntegrations: McpIntegrationStatus[];
  mcpBusy?: boolean;
  onConnectProvider: (id: string) => void | Promise<void>;
  onDisconnectProvider: (id: string) => void | Promise<void>;
  customMcpServers: CustomMcpStatus[];
  onAddCustomServer: (cfg: {
    name: string;
    url: string;
    transport: "streamable" | "sse";
    bearerToken?: string;
  }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  onRemoveCustomServer: (
    id: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onConnectCustomServer: (
    id: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onDisconnectCustomServer: (
    id: string
  ) => Promise<{ ok: boolean; error?: string }>;
  mcpToolsByProvider: Record<string, McpProviderToolSummary>;
  apiKeyDefinitions: ApiKeyDefinition[];
  apiKeyStatus: Record<string, boolean>;
  onSaveApiKey: (envVar: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  onDeleteApiKey: (envVar: string) => Promise<{ ok: boolean; error?: string }>;
  initialTab?: "general" | "api-keys";
  onShowTutorial?: () => void;
};

const THEME_OPTIONS: Array<{
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

const LIGHT_VARIANT_OPTIONS: Array<{
  value: LightVariant;
  label: string;
  swatch: string;
}> = [
  { value: "warm", label: "Warm", swatch: "oklch(0.985 0.002 90)" },
  { value: "linen", label: "Linen", swatch: "#EEEEEE" },
  { value: "ivory", label: "Ivory", swatch: "oklch(0.968 0.004 90)" },
  { value: "petal", label: "Petal", swatch: "oklch(0.962 0.006 250)" },
];

const DARK_VARIANT_OPTIONS: Array<{
  value: DarkVariant;
  label: string;
  swatch: string;
}> = [
  { value: "charcoal", label: "Charcoal", swatch: "oklch(0.145 0 0)" },
  { value: "steel", label: "Steel", swatch: "oklch(0.2 0.004 260)" },
  { value: "abyss", label: "Abyss", swatch: "oklch(0.185 0.02 264)" },
  { value: "pitch-black", label: "Pitch Black", swatch: "oklch(0 0 0)" },
];

const SEGMENTED_GROUP_CLASS =
  "inline-flex flex-wrap items-center justify-end gap-1 rounded-sm border border-border/70 bg-muted/35 p-1 max-w-[28rem]";

function segmentedButtonClass(selected: boolean): string {
  return `h-7 px-2.5 text-xs inline-flex items-center gap-1.5 rounded-[6px] border transition-colors ${
    selected
      ? "border-border/85 bg-background text-foreground shadow-sm"
      : "border-transparent bg-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground"
  }`;
}

const FONT_SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
];

const FONT_FAMILY_OPTIONS: Array<{ value: FontFamily; label: string }> = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
];

type TranscriptionPreset = {
  modelId: string;
  label: string;
  description: string;
  defaultIntervalMs: number;
};

type TranscriptionProviderOption = {
  value: TranscriptionProvider;
  label: string;
  description: string;
  supportsTranslation: boolean;
  models: TranscriptionPreset[];
};

const TRANSCRIPTION_PROVIDER_OPTIONS: TranscriptionProviderOption[] = [
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
  {
    value: "elevenlabs",
    label: "ElevenLabs",
    description: "Native speech-to-text",
    supportsTranslation: false,
    models: [
      {
        modelId: "scribe_v2_realtime",
        label: "Scribe v2 Realtime",
        description: "Fastest live transcription",
        defaultIntervalMs: 2000,
      },
      {
        modelId: "scribe_v2",
        label: "Scribe v2",
        description: "Fast transcription",
        defaultIntervalMs: 2000,
      },
    ],
  },
  {
    value: "fireworks",
    label: "Fireworks AI",
    description: "Whisper transcription API",
    supportsTranslation: false,
    models: [
      {
        modelId: "whisper-v3-turbo",
        label: "Whisper v3 Turbo",
        description: "Server-side VAD, transcription only",
        defaultIntervalMs: 8000,
      },
    ],
  },
];

const TRANSCRIPTION_PROVIDER_LABELS: Partial<Record<TranscriptionProvider, string>> = {
  google: "Google AI Studio",
  openrouter: "OpenRouter",
  elevenlabs: "ElevenLabs",
  fireworks: "Fireworks AI",
};

function getTranscriptionProviderOption(
  provider: TranscriptionProvider,
) {
  return (
    TRANSCRIPTION_PROVIDER_OPTIONS.find((option) => option.value === provider) ??
    TRANSCRIPTION_PROVIDER_OPTIONS[0]
  );
}

function getTranscriptionModelOption(
  provider: TranscriptionProvider,
  modelId: string,
) {
  const providerOption = getTranscriptionProviderOption(provider);
  return (
    providerOption.models.find((option) => option.modelId === modelId) ??
    providerOption.models[0]
  );
}

const ANALYSIS_PROVIDERS: Array<{ value: AppConfig["analysisProvider"]; label: string }> = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "fireworks", label: "Fireworks AI" },
];

const PROVIDER_REQUIRED_KEYS: Record<string, string[]> = {
  openrouter: ["OPENROUTER_API_KEY"],
  google: ["GEMINI_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  bedrock: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
};

function isProviderConfigured(
  provider: string,
  apiKeyStatus: Record<string, boolean>,
): boolean {
  const required = PROVIDER_REQUIRED_KEYS[provider];
  if (!required || required.length === 0) return true;
  return required.every((key) => apiKeyStatus[key]);
}


function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <p className="text-2xs text-muted-foreground mt-0.5 leading-relaxed">
          {description}
        </p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function renderLanguageLabel(languages: Language[], code: LanguageCode) {
  const lang = languages.find((item) => item.code === code);
  return lang
    ? `${lang.native} (${lang.code.toUpperCase()})`
    : code.toUpperCase();
}

function isKeyNeeded(def: ApiKeyDefinition, config: AppConfig): boolean {
  if (def.providers.length === 0) return true;
  if (def.envVar === "OPENROUTER_API_KEY") return true;
  return def.providers.some(
    (p) => p === config.transcriptionProvider || p === config.analysisProvider,
  );
}

const API_KEY_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  OPENROUTER_API_KEY: SiOpenrouter,
  GEMINI_API_KEY: SiGooglegemini,
  ELEVENLABS_API_KEY: SiElevenlabs,
};

function renderApiKeyIcon(envVar: string) {
  const Icon = API_KEY_ICONS[envVar];
  if (Icon) return <Icon size={14} className="shrink-0" />;
  return <KeyIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />;
}

function ApiKeyRow({
  def,
  configured,
  dimmed,
  onSave,
  onDelete,
}: {
  def: ApiKeyDefinition;
  configured: boolean;
  dimmed: boolean;
  onSave: (envVar: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (envVar: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    setError("");
    const result = await onSave(def.envVar, value);
    setSaving(false);
    if (result.ok) {
      setValue("");
      setVisible(false);
    } else {
      setError(result.error ?? "Failed to save.");
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError("");
    const result = await onDelete(def.envVar);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to delete.");
    }
  };

  return (
    <div className={`border border-border/60 bg-background px-3 py-3 rounded-md transition-colors ${configured ? "border-l-2 border-l-green-500/50" : ""} ${dimmed ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          {renderApiKeyIcon(def.envVar)}
          <p className="text-xs font-semibold text-foreground">{def.label}</p>
        </div>
        {configured && (
          <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
            <CheckCircleIcon className="w-3 h-3" />
            Configured
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Input
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={configured ? "Enter new key to replace" : def.placeholder}
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              }
            }}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setVisible(!visible)}
            tabIndex={-1}
          >
            {visible ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
          </button>
        </div>
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || !value.trim()}>
          Save
        </Button>
        {configured && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleClear()}
            disabled={saving}
            className="text-muted-foreground hover:text-destructive"
          >
            <XIcon className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      {error && <p className="mt-1 text-2xs text-destructive">{error}</p>}
    </div>
  );
}

function ApiKeysSection({
  definitions,
  status,
  config,
  onConfigChange,
  onSave,
  onDelete,
}: {
  definitions: ApiKeyDefinition[];
  status: Record<string, boolean>;
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
  onSave: (envVar: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (envVar: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  if (definitions.length === 0) return null;

  const needed = definitions.filter((def) => isKeyNeeded(def, config));
  const other = definitions.filter((def) => !isKeyNeeded(def, config));

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-3.5 text-muted-foreground/70" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            API Keys
          </h2>
        </div>
        <p className="text-2xs text-muted-foreground mt-1 mb-3">
          Keys are encrypted and stored in your system keychain. They override .env values.
        </p>
        <Separator className="mb-4" />

        {needed.length > 0 && (
          <div className={other.length > 0 ? "mb-6" : ""}>
            <div className="flex items-center gap-1.5 mb-3">
              <span className="size-1.5 rounded-full bg-green-500/70" />
              <p className="text-2xs font-medium text-foreground/60 uppercase tracking-wider">
                Required for current setup
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {needed.map((def) => (
                <ApiKeyRow
                  key={def.envVar}
                  def={def}
                  configured={!!status[def.envVar]}
                  dimmed={false}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        )}

        {other.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <span className="size-1.5 rounded-full bg-muted-foreground/30" />
              <p className="text-2xs font-medium text-muted-foreground/50 uppercase tracking-wider">
                Other providers
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {other.map((def) => (
                <ApiKeyRow
                  key={def.envVar}
                  def={def}
                  configured={!!status[def.envVar]}
                  dimmed={true}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {isProviderConfigured("bedrock", status) && (
        <section className="relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
          <div className="flex items-center gap-2">
            <ServerIcon className="size-3.5 text-muted-foreground/70" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AWS Bedrock
            </h2>
          </div>
          <p className="text-2xs text-muted-foreground mt-1 mb-3">
            Configure the AWS region for Bedrock API calls.
          </p>
          <Separator className="mb-4" />
          <div className="space-y-1">
            <label className="text-2xs text-muted-foreground">
              Region
            </label>
            <Input
              value={config.bedrockRegion}
              onChange={(e) => onConfigChange({ ...config, bedrockRegion: e.target.value })}
              placeholder="us-east-1"
            />
          </div>
        </section>
      )}
    </div>
  );
}

function ToolList({ tools }: { tools: McpToolInfo[] }) {
  if (tools.length === 0) return null;
  return (
    <details className="mt-2 group">
      <summary className="text-2xs text-muted-foreground cursor-pointer select-none list-none flex items-center gap-1 hover:text-foreground transition-colors">
        <span className="inline-block transition-transform group-open:rotate-90">
          ▶
        </span>
        {tools.length} tool{tools.length !== 1 ? "s" : ""}
      </summary>
      <ul className="mt-1.5 space-y-0.5 max-h-48 overflow-y-auto">
        {tools.map((tool) => (
          <li key={tool.name} className="flex items-start gap-1.5 text-2xs">
            <span
              className={`mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full ${
                tool.isMutating ? "bg-amber-400" : "bg-green-500"
              }`}
              title={tool.isMutating ? "write" : "read-only"}
            />
            <span
              className="font-mono text-foreground/80 truncate"
              title={tool.description}
            >
              {tool.name}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SettingsPage({
  config,
  languages,
  sourceLang,
  targetLang,
  onSourceLangChange,
  onTargetLangChange,
  isRecording,
  onConfigChange,
  onReset,
  mcpIntegrations,
  mcpBusy = false,
  onConnectProvider,
  onDisconnectProvider,
  customMcpServers,
  onAddCustomServer,
  onRemoveCustomServer,
  onConnectCustomServer,
  onDisconnectCustomServer,
  mcpToolsByProvider,
  apiKeyDefinitions,
  apiKeyStatus,
  onSaveApiKey,
  onDeleteApiKey,
  initialTab,
  onShowTutorial,
}: SettingsPageProps) {
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );
  const [customServerName, setCustomServerName] = useState("");
  const [customServerUrl, setCustomServerUrl] = useState("");
  const [customServerTransport, setCustomServerTransport] = useState<
    "streamable" | "sse"
  >("streamable");
  const [customServerToken, setCustomServerToken] = useState("");
  const [customServerError, setCustomServerError] = useState("");
  const addFormRef = useRef<HTMLFormElement>(null);

  const showDarkStyle =
    config.themeMode === "dark" ||
    (config.themeMode === "system" && systemPrefersDark);
  const showLightStyle = !showDarkStyle;

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    setSystemPrefersDark(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const languagesLoading = languages.length === 0;
  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <Tabs defaultValue={initialTab ?? "general"}>
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Control appearance and runtime behavior. Session changes apply
                when you start or resume a session.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <TabsList>
                <TabsTrigger value="general">
                  <SlidersHorizontalIcon className="size-3" />
                  General
                </TabsTrigger>
                <TabsTrigger value="api-keys">
                  <KeyIcon className="size-3" />
                  API Keys
                </TabsTrigger>
              </TabsList>
              {onShowTutorial && (
                <Button variant="outline" size="sm" onClick={onShowTutorial}>
                  <BookOpenIcon className="size-3.5" data-icon="inline-start" />
                  Show Tutorial
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onReset}>
                <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
                Reset Defaults
              </Button>
            </div>
          </div>

          {isRecording && (
            <div className="mb-6 border border-amber-300/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs rounded-sm">
              Currently recording. Configuration updates will apply to the next
              session.
            </div>
          )}

          <TabsContent value="general">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ── Row 1: Appearance + Session ── */}
          <section className="relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            <div className="flex items-center gap-2">
              <PaletteIcon className="size-3.5 text-muted-foreground/70" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Appearance
              </h2>
            </div>
            <Separator className="my-3" />
            <SettingRow
              label="Theme"
              description="Choose light, dark, or follow your system theme."
              control={
                <div className={SEGMENTED_GROUP_CLASS}>
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={segmentedButtonClass(
                        config.themeMode === option.value
                      )}
                      onClick={() => set("themeMode", option.value)}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
            {showLightStyle && (
              <SettingRow
                label="Light Style"
                description="Color palette used in light mode."
                control={
                  <div className={SEGMENTED_GROUP_CLASS}>
                    {LIGHT_VARIANT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={segmentedButtonClass(
                          config.lightVariant === option.value
                        )}
                        onClick={() => set("lightVariant", option.value)}
                      >
                        <span
                          className="size-3 rounded-sm border border-border/50 shrink-0"
                          style={{ backgroundColor: option.swatch }}
                        />
                        {option.label}
                      </button>
                    ))}
                  </div>
                }
              />
            )}
            {showDarkStyle && (
              <SettingRow
                label="Dark Style"
                description="Color palette used in dark mode."
                control={
                  <div className={SEGMENTED_GROUP_CLASS}>
                    {DARK_VARIANT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={segmentedButtonClass(
                          config.darkVariant === option.value
                        )}
                        onClick={() => set("darkVariant", option.value)}
                      >
                        <span
                          className="size-3 rounded-sm border border-border/50 shrink-0"
                          style={{ backgroundColor: option.swatch }}
                        />
                        {option.label}
                      </button>
                    ))}
                  </div>
                }
              />
            )}
            <SettingRow
              label="Font Size"
              description="Scale the entire interface up or down."
              control={
                <div className="inline-flex items-center border border-border rounded-sm overflow-hidden">
                  {FONT_SIZE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`h-8 px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                        config.fontSize === option.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => set("fontSize", option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
            <SettingRow
              label="UI Font"
              description="Sans for a clean look; serif for an editorial feel; mono for a terminal aesthetic."
              control={
                <div className="inline-flex items-center border border-border rounded-sm overflow-hidden">
                  {FONT_FAMILY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`h-8 px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                        config.fontFamily === option.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => set("fontFamily", option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
          </section>

          <section className="relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            <div className="flex items-center gap-2">
              <SlidersHorizontalIcon className="size-3.5 text-muted-foreground/70" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Session
              </h2>
            </div>
            <Separator className="my-3" />
            <div className="space-y-1">
              <SettingRow
                label="Response Length"
                description="Control how verbose agent responses are."
                control={
                  <div className="inline-flex items-center border border-border rounded-sm overflow-hidden">
                    {([
                      { value: "concise", label: "Concise" },
                      { value: "standard", label: "Standard" },
                      { value: "detailed", label: "Detailed" },
                    ] as const).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`h-8 px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                          config.responseLength === option.value
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => set("responseLength", option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                }
              />
              <SettingRow
                label="Agent Auto-Approve"
                description="Agents skip approval for safe creates. Updates, deletes, and archives still require confirmation."
                control={
                  <Switch
                    checked={config.agentAutoApprove}
                    onCheckedChange={(v) => set("agentAutoApprove", v)}
                  />
                }
              />
              <SettingRow
                label="Auto-Delegate"
                description="Automatically launch agents for agent-classified tasks when a session summary is generated."
                control={
                  <Switch
                    checked={config.autoDelegate}
                    onCheckedChange={(v) => set("autoDelegate", v)}
                  />
                }
              />
            </div>
          </section>

          {/* ── Row 2: Transcription (full width) ── */}
          <section className="relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md lg:col-span-2">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            <div className="flex items-center gap-2">
              <MicIcon className="size-3.5 text-muted-foreground/70" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Transcription
              </h2>
            </div>
            <Separator className="my-3" />
            {(() => {
              const providerOption = getTranscriptionProviderOption(
                config.transcriptionProvider
              );
              const activeModels = providerOption.models;
              const activeModel = getTranscriptionModelOption(
                config.transcriptionProvider,
                config.transcriptionModelId
              );

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="text-2xs text-muted-foreground">
                      Provider
                    </label>
                    <Select
                      value={config.transcriptionProvider}
                      onValueChange={(value) => {
                        const provider = value as TranscriptionProvider;
                        const nextProvider = getTranscriptionProviderOption(provider);
                        const nextModel = nextProvider.models[0];
                        if (!nextModel) return;
                        onConfigChange({
                          ...config,
                          transcriptionProvider: provider,
                          transcriptionModelId: nextModel.modelId,
                          intervalMs: nextModel.defaultIntervalMs,
                          translationEnabled: nextProvider.supportsTranslation
                            ? config.translationEnabled
                            : false,
                        });
                      }}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSCRIPTION_PROVIDER_OPTIONS
                          .filter((option) =>
                            option.value === config.transcriptionProvider ||
                            isProviderConfigured(option.value, apiKeyStatus)
                          )
                          .map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-2xs text-muted-foreground">
                      {providerOption.description}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-2xs text-muted-foreground">
                      Model
                    </label>
                    <Select
                      value={activeModel.modelId}
                      onValueChange={(modelId) => {
                        const model = getTranscriptionModelOption(
                          config.transcriptionProvider,
                          modelId
                        );
                        onConfigChange({
                          ...config,
                          transcriptionModelId: model.modelId,
                          intervalMs: model.defaultIntervalMs,
                        });
                      }}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {activeModels.map((model) => (
                          <SelectItem key={model.modelId} value={model.modelId}>
                            <span>{model.label}</span>
                            <span className="ml-1.5 text-2xs text-muted-foreground">
                              - {model.description}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-2xs text-muted-foreground">
                      {activeModel.description}
                      {providerOption.supportsTranslation
                        ? `, translation via ${TRANSCRIPTION_PROVIDER_LABELS[config.transcriptionProvider]}`
                        : ", transcription only"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-2xs text-muted-foreground">
                      Language
                    </label>
                    <Select
                      value={sourceLang}
                      onValueChange={(value) => {
                        const next = value as LanguageCode;
                        onSourceLangChange(next);
                        if (next === targetLang) {
                          onTargetLangChange(next === "en" ? "ko" : "en");
                        }
                      }}
                      disabled={languagesLoading}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue>
                          {renderLanguageLabel(languages, sourceLang)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {languages.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code}>
                            {lang.name} ({lang.native})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-2xs text-muted-foreground">
                      Chunk Interval (ms)
                    </label>
                    <Input
                      type="number"
                      min={500}
                      max={60000}
                      step={100}
                      value={config.intervalMs}
                      onChange={(e) =>
                        set(
                          "intervalMs",
                          Number.parseInt(e.target.value || "0", 10)
                        )
                      }
                      className="w-full"
                    />
                    <p className="text-2xs text-muted-foreground">
                      Default for this model: {activeModel.defaultIntervalMs} ms
                    </p>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* Translation settings removed — use toolbar dropdown instead */}

          {/* ── Row 4: Agent Models (full width) ── */}
          <section className="relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md lg:col-span-2">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            <div className="flex items-center gap-2">
              <CpuIcon className="size-3.5 text-muted-foreground/70" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Model Roles
              </h2>
            </div>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(() => {
                const providerKey = (config.analysisProvider === "openrouter" || config.analysisProvider === "bedrock" || config.analysisProvider === "fireworks")
                  ? config.analysisProvider
                  : "openrouter" as const;
                const providerConfig = MODEL_CONFIG[providerKey];
                const activePresets = providerConfig.models;
                return (
                  <>
                    <div className="space-y-1">
                      <label className="text-2xs text-muted-foreground">
                        Provider
                      </label>
                      <Select
                        value={config.analysisProvider}
                        onValueChange={(v) => {
                          const provider = v as AppConfig["analysisProvider"];
                          const nextConfig = (provider === "openrouter" || provider === "bedrock" || provider === "fireworks")
                            ? MODEL_CONFIG[provider]
                            : null;
                          const defs = nextConfig?.defaults;
                          const analysisPreset = nextConfig?.models.find((p) => p.modelId === defs?.analysisModelId);
                          onConfigChange({
                            ...config,
                            analysisProvider: provider,
                            analysisModelId: defs?.analysisModelId ?? config.analysisModelId,
                            analysisReasoning: analysisPreset?.reasoning ?? false,
                            analysisProviderOnly: analysisPreset?.providerOnly,
                            taskModelId: defs?.taskModelId ?? config.taskModelId,
                            taskProviders: defs?.taskProviders ?? [],
                            utilityModelId: defs?.utilityModelId ?? config.utilityModelId,
                            synthesisModelId: defs?.synthesisModelId ?? config.synthesisModelId,
                          });
                        }}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ANALYSIS_PROVIDERS
                            .filter((option) =>
                              option.value === config.analysisProvider ||
                              isProviderConfigured(option.value, apiKeyStatus)
                            )
                            .map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-2xs text-muted-foreground">AI provider for all model roles</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-2xs text-muted-foreground">
                        Analysis Model
                      </label>
                      <Select
                        value={config.analysisModelId}
                        onValueChange={(modelId) => {
                          const preset = activePresets.find((p) => p.modelId === modelId);
                          onConfigChange({
                            ...config,
                            analysisModelId: modelId,
                            analysisReasoning: preset?.reasoning ?? config.analysisReasoning,
                            analysisProviderOnly: preset?.providerOnly,
                          });
                        }}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {activePresets.map((preset) => (
                            <SelectItem key={preset.modelId} value={preset.modelId}>
                              <span className="inline-flex items-center gap-1.5">
                                {preset.label}
                                {!!preset.reasoning && <kbd className="px-1 py-px rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">thinking</kbd>}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-2xs text-muted-foreground">
                        Live key points, insights, and agent reasoning
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-2xs text-muted-foreground">
                        Task Model
                      </label>
                      <Select
                        value={config.taskModelId}
                        onValueChange={(modelId) => {
                          const preset = activePresets.find((p) => p.modelId === modelId);
                          onConfigChange({
                            ...config,
                            taskModelId: modelId,
                            taskProviders: preset?.providers ?? [],
                          });
                        }}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {activePresets.map((preset) => (
                            <SelectItem key={preset.modelId} value={preset.modelId}>
                              <span className="inline-flex items-center gap-1.5">
                                {preset.label}
                                {!!preset.reasoning && <kbd className="px-1 py-px rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">thinking</kbd>}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-2xs text-muted-foreground">
                        Task extraction and task-size classification
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-2xs text-muted-foreground">
                        Utility Model
                      </label>
                      <Select
                        value={config.utilityModelId}
                        onValueChange={(modelId) => set("utilityModelId", modelId)}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {activePresets.map((preset) => (
                            <SelectItem key={preset.modelId} value={preset.modelId}>
                              <span className="inline-flex items-center gap-1.5">
                                {preset.label}
                                {!!preset.reasoning && <kbd className="px-1 py-px rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">thinking</kbd>}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-2xs text-muted-foreground">
                        Titles and transcript post-processing
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-2xs text-muted-foreground">
                        Synthesis Model
                      </label>
                      <Select
                        value={config.synthesisModelId}
                        onValueChange={(modelId) => set("synthesisModelId", modelId)}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {activePresets.map((preset) => (
                            <SelectItem key={preset.modelId} value={preset.modelId}>
                              <span className="inline-flex items-center gap-1.5">
                                {preset.label}
                                {!!preset.reasoning && <kbd className="px-1 py-px rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">thinking</kbd>}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-2xs text-muted-foreground">
                        Session summary, agents summary, and agent learnings
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>
          </section>

          {/* ── Row 5: Advanced (full width) ── */}
          <section className="relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md lg:col-span-2">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            <div className="flex items-center gap-2">
              <WrenchIcon className="size-3.5 text-muted-foreground/70" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Advanced
              </h2>
            </div>
            <Separator className="my-3" />
            <div className="space-y-1">
              <SettingRow
                label="Debug Mode"
                description="Enable extra logging and diagnostics."
                control={
                  <Switch
                    checked={config.debug}
                    onCheckedChange={(v) => set("debug", v)}
                  />
                }
              />
              <SettingRow
                label="Legacy Audio"
                description="Use the legacy ffmpeg loopback capture flow instead of ScreenCaptureKit."
                control={
                  <Switch
                    checked={config.legacyAudio}
                    onCheckedChange={(v) => set("legacyAudio", v)}
                  />
                }
              />
            </div>
          </section>

          {/* ── Row 6: Integrations (full width) ── */}
          <section className="relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md lg:col-span-2">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            <div className="flex items-center gap-2">
              <PlugIcon className="size-3.5 text-muted-foreground/70" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Integrations
              </h2>
            </div>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {mcpIntegrations.map((status) => {
                const ProviderIcon = resolveProviderIcon(status.mcpUrl ?? "");
                return (
                  <div key={status.provider} className="border border-border/70 bg-background px-3 py-3 rounded-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {ProviderIcon ? (
                          <ProviderIcon className="w-4 h-4 shrink-0" />
                        ) : (
                          <ServerIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                        )}
                        <p className="text-xs font-semibold text-foreground">
                          {status.label ?? status.provider} MCP
                        </p>
                      </div>
                      <span className="text-2xs text-muted-foreground">
                        {status.state}
                      </span>
                    </div>
                    <p className="mt-1 text-2xs text-muted-foreground leading-relaxed">
                      Hosted MCP via local OAuth callback.
                    </p>
                    {status.error && (
                      <p className="mt-1 text-2xs text-destructive">
                        {status.error}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      {status.state === "connected" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void onDisconnectProvider(status.provider)}
                          disabled={mcpBusy || status.enabled === false}
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => void onConnectProvider(status.provider)}
                          disabled={mcpBusy || status.enabled === false}
                        >
                          Connect {status.label ?? status.provider}
                        </Button>
                      )}
                    </div>
                    <ToolList tools={mcpToolsByProvider[status.provider]?.tools ?? []} />
                  </div>
                );
              })}
            </div>

            {/* ── Custom MCP Servers ── */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Custom MCP Servers
              </p>
              <form
                ref={addFormRef}
                className="flex flex-wrap gap-2 mb-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setCustomServerError("");
                  const result = await onAddCustomServer({
                    name: customServerName,
                    url: customServerUrl,
                    transport: customServerTransport,
                    bearerToken: customServerToken || undefined,
                  });
                  if (!result.ok) {
                    setCustomServerError(
                      result.error ?? "Failed to add server."
                    );
                    return;
                  }
                  setCustomServerName("");
                  setCustomServerUrl("");
                  setCustomServerToken("");
                  setCustomServerTransport("streamable");
                }}
              >
                <Input
                  value={customServerName}
                  onChange={(e) => setCustomServerName(e.target.value)}
                  placeholder="Name"
                  className="w-28 shrink-0"
                  required
                  disabled={mcpBusy}
                />
                <Input
                  value={customServerUrl}
                  onChange={(e) => setCustomServerUrl(e.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                  className="flex-1 min-w-40"
                  required
                  disabled={mcpBusy}
                />
                <Select
                  value={customServerTransport}
                  onValueChange={(v) =>
                    setCustomServerTransport(v as "streamable" | "sse")
                  }
                  disabled={mcpBusy}
                >
                  <SelectTrigger className="w-36 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="streamable">Streamable HTTP</SelectItem>
                    <SelectItem value="sse">SSE</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="password"
                  value={customServerToken}
                  onChange={(e) => setCustomServerToken(e.target.value)}
                  placeholder="Bearer token (optional)"
                  className="w-44 shrink-0"
                  disabled={mcpBusy}
                />
                <Button type="submit" size="sm" disabled={mcpBusy}>
                  Add
                </Button>
              </form>
              {customServerError && (
                <p className="mb-2 text-2xs text-destructive">
                  {customServerError}
                </p>
              )}
              {customMcpServers.length > 0 && (
                <div className="space-y-1.5">
                  {customMcpServers.map((server) => {
                    const serverTools =
                      mcpToolsByProvider[`custom:${server.id}`]?.tools ?? [];
                    const ProviderIcon = resolveProviderIcon(server.url);
                    return (
                      <div
                        key={server.id}
                        className="border border-border/70 bg-background px-3 py-2 rounded-sm"
                      >
                        <div className="flex items-center gap-2">
                          {ProviderIcon ? (
                            <ProviderIcon className="w-4 h-4 shrink-0" />
                          ) : (
                            <ServerIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">
                              {server.name}
                            </p>
                            <p className="text-2xs text-muted-foreground truncate">
                              {server.url}
                            </p>
                            {server.error && (
                              <p className="text-2xs text-destructive truncate">
                                {server.error}
                              </p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 text-2xs px-1.5 py-0.5 rounded-full ${
                              server.state === "connected"
                                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                                : server.state === "error"
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {server.state}
                          </span>
                          {server.state === "connected" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void onDisconnectCustomServer(server.id)
                              }
                              disabled={mcpBusy}
                            >
                              Disconnect
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void onConnectCustomServer(server.id)
                              }
                              disabled={mcpBusy}
                            >
                              Connect
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void onRemoveCustomServer(server.id)}
                            disabled={mcpBusy}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                          >
                            ✕
                          </Button>
                        </div>
                        <ToolList tools={serverTools} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
          </div>
          </TabsContent>

          <TabsContent value="api-keys">
            <ApiKeysSection
              definitions={apiKeyDefinitions}
              status={apiKeyStatus}
              config={config}
              onConfigChange={onConfigChange}
              onSave={onSaveApiKey}
              onDelete={onDeleteApiKey}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
