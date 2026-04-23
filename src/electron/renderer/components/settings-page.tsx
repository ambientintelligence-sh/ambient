import type {
  ApiKeyDefinition,
  AppConfig,
  CustomMcpStatus,
  McpIntegrationStatus,
  McpProviderToolSummary,
  McpToolInfo,
  ResponseLength,
  TranscriptionProvider,
} from "@core/types";
import type { SkillMetadata } from "@core/agents/skills";
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
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";
import {
  CheckCircleIcon,
  CpuIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  MicIcon,
  PaletteIcon,
  PlugIcon,
  RotateCcwIcon,
  ServerIcon,
  ShieldCheckIcon,
  BookOpenIcon,
  SlidersHorizontalIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { resolveProviderIcon, OpenAIIcon, ClaudeIcon } from "./integration-icons";
import { useIntegrationStore } from "../stores/integration-store";
import {
  THEME_OPTIONS,
  LIGHT_VARIANT_OPTIONS,
  DARK_VARIANT_OPTIONS,
  FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  TASK_SUGGESTION_AGGRESSIVENESS_OPTIONS,
  SUGGESTION_SCAN_WORD_BUDGET_OPTIONS,
  TRANSCRIPTION_PROVIDER_OPTIONS,
  TRANSCRIPTION_PROVIDER_LABELS,
  getTranscriptionProviderOption,
  getTranscriptionModelOption,
  ANALYSIS_PROVIDERS,
  isProviderConfigured,
  isKeyNeeded,
  renderApiKeyIcon,
} from "./settings-config";

type SettingsTab = "general" | "transcription" | "models" | "api-keys" | "skills" | "memory" | "integrations";

function AgentsTabIcon({ className }: { className?: string }) {
  return <HugeiconsIcon icon={WorkoutRunIcon} className={className} />;
}

const SETTINGS_TABS: readonly { id: SettingsTab; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "general", label: "General", icon: SlidersHorizontalIcon },
  { id: "memory", label: "Agents", icon: AgentsTabIcon },
  { id: "models", label: "Models", icon: CpuIcon },
  { id: "transcription", label: "Transcription", icon: MicIcon },
  { id: "api-keys", label: "API Keys", icon: KeyIcon },
  { id: "integrations", label: "Integrations", icon: PlugIcon },
  { id: "skills", label: "Skills", icon: BookOpenIcon },
];

type SettingsPageProps = {
  config: AppConfig;
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
  initialTab?: SettingsTab;
  onShowTutorial?: () => void;
  skills?: SkillMetadata[];
  disabledSkillIds?: string[];
  onToggleSkill?: (skillId: string, enabled: boolean) => void;
};

function SegmentedControl<O extends { readonly value: string; readonly label: string }>({
  options,
  value,
  onChange,
  renderOption,
}: {
  options: readonly O[];
  value: O["value"];
  onChange: (v: O["value"]) => void;
  renderOption?: (option: O, selected: boolean) => ReactNode;
}) {
  return (
    <div className="inline-flex flex-wrap items-center justify-end gap-1 rounded-sm border border-border/70 bg-muted/35 p-1 max-w-[28rem]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`h-7 px-2.5 text-xs inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-transparent transition-colors ${
            value === option.value
              ? "border-border/85 bg-muted text-foreground dark:bg-background"
              : "bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground dark:hover:bg-background/70"
          }`}
          onClick={() => onChange(option.value)}
        >
          {renderOption ? renderOption(option, value === option.value) : option.label}
        </button>
      ))}
    </div>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`relative overflow-hidden border border-border/60 bg-card px-5 py-4 rounded-md ${className ?? ""}`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground/70" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      {description && (
        <p className="text-2xs text-muted-foreground mt-1 mb-3">{description}</p>
      )}
      <Separator className={description ? "mb-4" : "my-3"} />
      {children}
    </section>
  );
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
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
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

function OpenAiSubscriptionRow({
  loggedIn,
  accountId,
  onStatusChange,
}: {
  loggedIn: boolean;
  accountId?: string;
  onStatusChange: (next: { loggedIn: boolean; accountId?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setBusy(true);
    setError("");
    const result = await window.electronAPI.openaiCodexLogin();
    setBusy(false);
    if (result.ok) {
      onStatusChange({ loggedIn: !!result.loggedIn, accountId: result.accountId });
    } else {
      setError(result.error ?? "Login failed.");
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setError("");
    const result = await window.electronAPI.openaiCodexLogout();
    setBusy(false);
    if (result.ok) {
      onStatusChange({ loggedIn: false, accountId: undefined });
    } else {
      setError(result.error ?? "Disconnect failed.");
    }
  };

  return (
    <div className={`border border-border/60 bg-background px-3 py-3 rounded-md transition-colors ${loggedIn ? "border-l-2 border-l-green-500/50" : ""}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <OpenAIIcon className="w-3.5 h-3.5 shrink-0" />
          <p className="text-xs font-semibold text-foreground">ChatGPT Plus/Pro</p>
        </div>
        {loggedIn && (
          <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
            <CheckCircleIcon className="w-3 h-3" />
            Connected
          </span>
        )}
      </div>
      <p className="text-2xs text-muted-foreground mb-2 leading-relaxed">
        {loggedIn && accountId
          ? `Signed in as ${accountId}.`
          : "Use your ChatGPT subscription instead of an OpenAI API key. Opens your browser to authorize."}
      </p>
      <p className="text-2xs text-muted-foreground mb-2 leading-relaxed">
        ChatGPT subscription login powers agent work only. Ambient still requires an OpenRouter API key for transcription, summaries, suggestions, and other non-agent features.
      </p>
      <div className="flex items-center gap-1.5">
        {loggedIn ? (
          <Button size="sm" variant="outline" onClick={() => void handleLogout()} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <Button size="sm" onClick={() => void handleLogin()} disabled={busy}>
            {busy ? "Connecting…" : "Log in with OpenAI"}
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
  openaiCodex,
  onOpenaiCodexChange,
}: {
  definitions: ApiKeyDefinition[];
  status: Record<string, boolean>;
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
  onSave: (envVar: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (envVar: string) => Promise<{ ok: boolean; error?: string }>;
  openaiCodex: { loggedIn: boolean; accountId?: string };
  onOpenaiCodexChange: (next: { loggedIn: boolean; accountId?: string }) => void;
}) {
  const needed = definitions.filter((def) => isKeyNeeded(def, config));
  const other = definitions.filter((def) => !isKeyNeeded(def, config));

  return (
    <div className="space-y-5">
      <SettingsSection icon={ShieldCheckIcon} title="API Keys" description="Keys and subscription logins are encrypted and stored in your system keychain. They override .env values.">

        <div className={(needed.length + other.length) > 0 ? "mb-6" : ""}>
          <div className="flex items-center gap-1.5 mb-3">
            <span className="size-1.5 rounded-full bg-blue-500/70" />
            <p className="text-2xs font-medium text-foreground/60 uppercase tracking-wider">
              Subscription Login
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <OpenAiSubscriptionRow
              loggedIn={openaiCodex.loggedIn}
              accountId={openaiCodex.accountId}
              onStatusChange={onOpenaiCodexChange}
            />
          </div>
        </div>

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
      </SettingsSection>

      {isProviderConfigured("bedrock", status) && (
        <SettingsSection icon={ServerIcon} title="AWS Bedrock" description="Configure the AWS region for Bedrock API calls.">
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
        </SettingsSection>
      )}
    </div>
  );
}

function AgentsTab({
  config,
  onConfigChange,
}: {
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
}) {
  const [learnings, setLearnings] = useState<{ category: string; text: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) =>
    onConfigChange({ ...config, [key]: value });

  useEffect(() => {
    void window.electronAPI.getLearnings()
      .then(setLearnings)
      .catch(() => setLearnings([]))
      .finally(() => setLoading(false));
  }, []);

  const refresh = () => void window.electronAPI.getLearnings().then(setLearnings);

  const grouped = learnings.reduce<Record<string, string[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item.text);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <SettingsSection icon={SlidersHorizontalIcon} title="Behavior">
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
                  className={`h-8 px-2.5 text-xs inline-flex cursor-pointer items-center gap-1.5 transition-colors ${
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
          label="Suggestion Level"
          description="Control how readily Ambient surfaces suggested tasks from the conversation."
          control={
            <div className="inline-flex items-center border border-border rounded-sm overflow-hidden">
              {TASK_SUGGESTION_AGGRESSIVENESS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`h-8 px-2.5 text-xs inline-flex cursor-pointer items-center gap-1.5 transition-colors ${
                    config.taskSuggestionAggressiveness === option.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => set("taskSuggestionAggressiveness", option.value)}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />
        <SettingRow
          label="Scan Cadence"
          description="Words of new transcript before the next suggestion scan fires. Lower = more frequent scans."
          control={
            <div className="inline-flex items-center border border-border rounded-sm overflow-hidden">
              {SUGGESTION_SCAN_WORD_BUDGET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`h-8 px-2.5 text-xs inline-flex cursor-pointer items-center gap-1.5 transition-colors ${
                    config.suggestionScanWordBudget === option.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => set("suggestionScanWordBudget", option.value)}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />
        <SettingRow
          label="Auto-Approve"
          description="Agents skip approval for safe creates. Updates, deletes, and archives still require confirmation."
          control={<Switch checked={config.agentAutoApprove} onCheckedChange={(v) => set("agentAutoApprove", v)} />}
        />
        <SettingRow
          label="Auto-Delegate"
          description="Automatically launch agents for agent-classified tasks when a session summary is generated."
          control={<Switch checked={config.autoDelegate} onCheckedChange={(v) => set("autoDelegate", v)} />}
        />
        <SettingRow
          label="File Tools"
          description="Let agents read, write, edit, and search files on your machine (read, ls, grep, find, write, edit). Writes and edits always ask for approval."
          control={<Switch checked={config.localToolsFiles} onCheckedChange={(v) => set("localToolsFiles", v)} />}
        />
        <SettingRow
          label="Shell (bash)"
          description="Let agents run shell commands on your machine. Every command asks for approval before it runs."
          control={<Switch checked={config.localToolsBash} onCheckedChange={(v) => set("localToolsBash", v)} />}
        />
        <SettingRow
          label="JavaScript Sandbox"
          description="Let agents run JavaScript in a sandboxed V8 isolate. Use for pure computation — the sandbox can't install npm packages. Approval required per run."
          control={<Switch checked={config.localToolsRunJs} onCheckedChange={(v) => set("localToolsRunJs", v)} />}
        />
        <SettingRow
          label="Coding Agent"
          description="Pick a background coding agent to make available in this session. Only one can be active at a time — the agent you pick is dispatched via a tool and streams live progress into the chat. Requires the matching CLI installed and logged in."
          control={
            <div className="inline-flex items-center border border-border rounded-sm overflow-hidden">
              {([
                { value: null, label: "None" },
                { value: "codex", label: "Codex" },
                { value: "claude", label: "Claude Code" },
              ] as const).map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`h-8 px-2.5 text-xs inline-flex cursor-pointer items-center gap-1.5 transition-colors ${
                    config.codingAgent === option.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => set("codingAgent", option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection icon={AgentsTabIcon} title="Memory" description="Agents extract learnings from completed tasks. Manage what they remember here.">
        <SettingRow
          label="Continual Learning"
          description="Agents automatically learn your preferences and workspace facts after each task."
          control={<Switch checked={config.learningEnabled} onCheckedChange={(v) => set("learningEnabled", v)} />}
        />

        <Separator className="my-4" />

        {loading ? (
          <p className="text-2xs text-muted-foreground">Loading...</p>
        ) : learnings.length === 0 ? (
          <p className="text-2xs text-muted-foreground/60 italic">
            No learnings yet. Agents will start learning after completing tasks.
          </p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <p className="text-2xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-1.5">
                  {category}
                </p>
                <ul className="space-y-1">
                  {items.map((text) => (
                    <li key={text} className="group flex items-start gap-2 text-xs text-foreground/80 py-1 px-2 rounded-sm hover:bg-muted/50 transition-colors">
                      <span className="mt-1.5 size-1 rounded-full bg-muted-foreground/40 shrink-0" />
                      <span className="flex-1 leading-relaxed">{text}</span>
                      <button
                        type="button"
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive cursor-pointer"
                        onClick={() => { void window.electronAPI.deleteLearning(category, text).then(refresh); }}
                        title="Remove"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="pt-2">
              <Button variant="destructive" size="sm" onClick={() => { void window.electronAPI.clearLearnings().then(refresh); }}>
                Clear All
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>
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
  skills = [],
  disabledSkillIds = [],
  onToggleSkill,
}: SettingsPageProps) {
  const codexConnected = useIntegrationStore((s) => s.codexConnected);
  const claudeConnected = useIntegrationStore((s) => s.claudeConnected);
  const contentRef = useRef<HTMLDivElement>(null);

  const [openaiCodex, setOpenaiCodex] = useState<{ loggedIn: boolean; accountId?: string }>({
    loggedIn: false,
  });

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.openaiCodexStatus().then((result) => {
      if (cancelled || !result.ok) return;
      setOpenaiCodex({ loggedIn: !!result.loggedIn, accountId: result.accountId });
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Control appearance and runtime behavior. Session changes apply
              when you start or resume a session.
            </p>
          </div>
          <div className="flex items-center gap-3">
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
          <div className="mt-4 border border-amber-300/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs rounded-sm">
            Currently recording. Configuration updates will apply to the next
            session.
          </div>
        )}
      </div>

      {/* Sidebar + Content */}
      <Tabs
        defaultValue={initialTab ?? "general"}
        orientation="vertical"
        className="flex-1 min-h-0 flex flex-row gap-0"
        onValueChange={() => contentRef.current?.scrollTo(0, 0)}
      >
        <TabsList className="w-[200px] shrink-0 flex flex-col items-stretch h-auto gap-0.5 rounded-none border-0 border-r border-border/40 bg-transparent p-3">
          {SETTINGS_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="justify-start w-full gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:border-0 data-[state=active]:shadow-none border-0 shadow-none"
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-8 py-6">

          <TabsContent value="general">
          <div className="space-y-5">
          <SettingsSection icon={PaletteIcon} title="Appearance">
            <SettingRow
              label="Theme"
              description="Choose light, dark, or follow your system theme."
              control={
                <SegmentedControl
                  options={THEME_OPTIONS}
                  value={config.themeMode}
                  onChange={(v) => set("themeMode", v)}
                  renderOption={(o) => <>{o.icon}{o.label}</>}
                />
              }
            />
            {showLightStyle && (
              <SettingRow
                label="Light Style"
                description="Color palette used in light mode."
                control={
                  <SegmentedControl
                    options={LIGHT_VARIANT_OPTIONS}
                    value={config.lightVariant}
                    onChange={(v) => set("lightVariant", v)}
                    renderOption={(o) => <>
                      <span
                        className="size-3.5 rounded-full border-[1.5px] shrink-0"
                        style={{ backgroundColor: o.swatch, borderColor: o.accent }}
                      />
                      {o.label}
                    </>}
                  />
                }
              />
            )}
            {showDarkStyle && (
              <SettingRow
                label="Dark Style"
                description="Color palette used in dark mode."
                control={
                  <SegmentedControl
                    options={DARK_VARIANT_OPTIONS}
                    value={config.darkVariant}
                    onChange={(v) => set("darkVariant", v)}
                    renderOption={(o) => <>
                      <span
                        className="size-3.5 rounded-full border-[1.5px] shrink-0"
                        style={{ backgroundColor: o.swatch, borderColor: o.accent }}
                      />
                      {o.label}
                    </>}
                  />
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
                      className={`h-8 px-2.5 text-xs inline-flex cursor-pointer items-center gap-1.5 transition-colors ${
                        config.fontSize === option.value
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
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
                      className={`h-8 px-2.5 text-xs inline-flex cursor-pointer items-center gap-1.5 transition-colors ${
                        config.fontFamily === option.value
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
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
          </SettingsSection>

          <SettingsSection icon={WrenchIcon} title="Advanced">
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
          </SettingsSection>

          </div>
          </TabsContent>

          <TabsContent value="transcription">
          <SettingsSection icon={MicIcon} title="Transcription">
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          </SettingsSection>

          </TabsContent>

          <TabsContent value="models">
          <SettingsSection icon={CpuIcon} title="Model Roles">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(() => {
                const providerKey = (config.analysisProvider === "openrouter" || config.analysisProvider === "bedrock" || config.analysisProvider === "openai-codex")
                  ? config.analysisProvider
                  : "openrouter" as const;
                const providerConfig = MODEL_CONFIG[providerKey];
                const activePresets = providerConfig.models;
                const chatGptSubscriptionMode = config.analysisProvider === "openai-codex";
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
                          const nextConfig = (provider === "openrouter" || provider === "bedrock" || provider === "openai-codex")
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
                              isProviderConfigured(option.value, apiKeyStatus, { openaiCodexLoggedIn: openaiCodex.loggedIn }),
                            )
                            .map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-2xs text-muted-foreground">
                        {config.analysisProvider === "openai-codex"
                          ? "ChatGPT subscription only changes the agent model. Analysis, task, utility, and synthesis still run on OpenRouter."
                          : "AI provider for all model roles"}
                      </p>
                    </div>
                    {chatGptSubscriptionMode ? (
                      <div className="space-y-1">
                        <label className="text-2xs text-muted-foreground">
                          Agent Model
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
                          Controls the ChatGPT-backed agent only.
                        </p>
                      </div>
                    ) : (
                      <>
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
                    )}
                  </>
                );
              })()}
            </div>
          </SettingsSection>

          </TabsContent>

          <TabsContent value="skills">
          <SettingsSection icon={BookOpenIcon} title="Agent Skills">
            <p className="text-2xs text-muted-foreground mb-3">
              Extend agent capabilities with installed skills. Skills are discovered from{" "}
              <code className="text-[10px] bg-muted px-1 py-0.5 rounded">.agents/skills/</code> (project) and{" "}
              <code className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.config/agents/skills/</code> (global).
            </p>
            {skills.length === 0 ? (
              <p className="text-2xs text-muted-foreground/60 italic">
                No skills installed. Run <code className="text-[10px] bg-muted px-1 py-0.5 rounded">npx skills</code> to browse and install skills.
              </p>
            ) : (
              <div className="space-y-1">
                {skills.map((skill) => {
                  const enabled = !disabledSkillIds.includes(skill.id);
                  return (
                    <SettingRow
                      key={skill.id}
                      label={skill.name}
                      description={
                        `${skill.description} · ${skill.source === "project" ? "Project" : "Global"}`
                      }
                      control={
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => onToggleSkill?.(skill.id, v)}
                        />
                      }
                    />
                  );
                })}
              </div>
            )}
          </SettingsSection>
          </TabsContent>

          <TabsContent value="memory">
            <AgentsTab config={config} onConfigChange={onConfigChange} />
          </TabsContent>

          <TabsContent value="integrations">
          <SettingsSection icon={PlugIcon} title="Integrations">
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

            {/* ── Coding Agent ── */}
            {config.codingAgent !== null && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Coding Agent
                </p>
                <div className="border border-border/70 bg-background px-3 py-3 rounded-sm">
                  {config.codingAgent === "codex" ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <OpenAIIcon className="w-4 h-4 shrink-0" />
                          <p className="text-xs font-semibold text-foreground">Codex</p>
                        </div>
                        <span className="text-2xs text-muted-foreground">
                          {codexConnected ? "connected" : "ready"}
                        </span>
                      </div>
                      <p className="mt-1 text-2xs text-muted-foreground leading-relaxed">
                        Runs via the <code>codex</code> CLI. Requires it installed and logged in
                        (<code>codex login</code>). Auto-connects on first use.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <ClaudeIcon className="w-4 h-4 shrink-0" />
                          <p className="text-xs font-semibold text-foreground">Claude Code</p>
                        </div>
                        <span className="text-2xs text-muted-foreground">
                          {claudeConnected ? "connected" : "ready"}
                        </span>
                      </div>
                      <p className="mt-1 text-2xs text-muted-foreground leading-relaxed">
                        Runs via the <code>claude</code> CLI. Requires it installed and logged in
                        (Claude.ai subscription or <code>ANTHROPIC_API_KEY</code>). Auto-connects on first use.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

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
          </SettingsSection>
          </TabsContent>

          <TabsContent value="api-keys">
            <ApiKeysSection
              definitions={apiKeyDefinitions}
              status={apiKeyStatus}
              config={config}
              onConfigChange={onConfigChange}
              onSave={onSaveApiKey}
              onDelete={onDeleteApiKey}
              openaiCodex={openaiCodex}
              onOpenaiCodexChange={setOpenaiCodex}
            />
          </TabsContent>

          </div>
        </div>
      </Tabs>
    </div>
  );
}
