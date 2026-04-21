// All shared types for Ambient.
import { getAnalysisModelPreset, MODEL_CONFIG } from "./models";

export type LanguageCode =
  | "en"
  | "es"
  | "fr"
  | "de"
  | "it"
  | "pt"
  | "zh"
  | "ja"
  | "ko"
  | "ar"
  | "hi"
  | "ru"
  | "tl";

export type Language = {
  code: LanguageCode;
  name: string;
  native: string;
};

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "tl", name: "Tagalog", native: "Tagalog" },
];

export type Direction = "auto" | "source-target";
export type Device = { index: number; name: string };
export type AudioSource = "system" | "microphone" | "note";
export type ThemeMode = "system" | "light" | "dark";
export type LightVariant = "linen" | "ivory" | "blossom" | "moss";
export type DarkVariant = "papaya" | "slate" | "abyss" | "cyber-city";

export type TranscriptionProvider =
  | "openrouter"
  | "vertex"
  | "google";
export type AnalysisProvider = "openrouter" | "google" | "vertex" | "bedrock" | "openai-codex";
export type { AnalysisModelPreset } from "./models";

export type TranscriptBlock = {
  id: number;
  sourceLabel: string;
  sourceText: string;
  targetLabel: string;
  translation?: string;
  partial?: boolean;
  newTopic?: boolean;
  createdAt: number;
  audioSource: AudioSource;
  sessionId?: string;
};

export type Summary = {
  keyPoints: string[];
  updatedAt: number;
};

export type TodoItem = { text: string; doer: "agent" | "human" };

export type FinalSummary = {
  narrative: string; // concise markdown snapshot of the full conversation
  agreements: string[]; // explicit agreements/decisions reached in the meeting
  missedItems: string[]; // important points that were likely missed or underexplored
  unansweredQuestions: string[]; // open questions that remained unresolved
  agreementTodos: TodoItem[]; // concrete follow-up todos tied to agreements
  missedItemTodos: TodoItem[]; // concrete todos to address missed/underexplored items
  unansweredQuestionTodos: TodoItem[]; // concrete todos to answer unresolved questions
  actionItems: TodoItem[]; // cross-cutting action items / todos
  acceptedTodoIds?: string[]; // IDs of todos already transferred to tasks
  modelId?: string; // synthesis model used to generate this summary
  generatedAt: number;
};

export type AgentsSummary = {
  overallNarrative: string;
  agentHighlights: Array<{
    agentId: string;
    task: string;
    status: "completed" | "failed";
    keyFinding: string;
  }>;
  coverageGaps: string[];
  nextSteps: string[];
  modelId?: string; // synthesis model used to generate this debrief
  generatedAt: number;
  totalAgents: number;
  succeededAgents: number;
  failedAgents: number;
  totalDurationSecs: number;
};

export type TaskItem = Readonly<{
  id: string;
  text: string;
  details?: string;
  size: TaskSize;
  completed: boolean;
  archived?: boolean;
  suggestionKind?: SuggestionKind;
  source: "ai" | "manual";
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
}>;

export type TaskSize = "small" | "large";

export type SuggestionKind = "research" | "action" | "insight" | "flag" | "followup";

export type TaskSuggestion = Readonly<{
  id: string;
  text: string;
  details?: string;
  transcriptExcerpt?: string;
  kind?: SuggestionKind;
  sessionId?: string;
  createdAt: number;
}>;

export type InsightKind =
  | "definition"
  | "context"
  | "fact"
  | "tip"
  | "key-point";

export type Insight = Readonly<{
  id: string;
  kind: InsightKind;
  text: string;
  createdAt: number;
  sessionId?: string;
}>;

export type ProjectMeta = Readonly<{
  id: string;
  name: string;
  instructions?: string;
  context?: string;
  createdAt: number;
}>;

export type SessionMeta = Readonly<{
  id: string;
  startedAt: number;
  endedAt?: number;
  title?: string;
  blockCount: number;
  agentCount: number;
  sourceLang?: LanguageCode;
  targetLang?: LanguageCode;
  projectId?: string;
}>;

export type UIState = {
  deviceName: string;
  modelId: string;
  intervalMs: number;
  status: "idle" | "connecting" | "recording" | "paused";
  contextLoaded: boolean;
  cost?: number;
  translationEnabled: boolean;
  canTranslate: boolean;
  direction: Direction;
  micEnabled: boolean;
};

export type SessionConfig = {
  device?: string;
  direction: Direction;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  intervalMs: number;
  transcriptionProvider: TranscriptionProvider;
  transcriptionModelId: string;
  analysisProvider: AnalysisProvider;
  analysisModelId: string;
  analysisProviderOnly?: string;
  analysisReasoning: boolean;
  taskModelId: string;
  taskProviders: string[];
  utilityModelId: string;
  synthesisModelId: string;
  vertexProject?: string;
  vertexLocation: string;
  bedrockRegion: string;
  responseLength: ResponseLength;
  taskSuggestionAggressiveness: TaskSuggestionAggressiveness;
  suggestionScanWordBudget: SuggestionScanWordBudget;
  debug: boolean;
  legacyAudio: boolean;
  translationEnabled: boolean;
  agentAutoApprove: boolean;
  /** Enables the local file tools: read, write, edit, ls, grep, find. */
  localToolsFiles: boolean;
  /** Enables the local bash shell tool. */
  localToolsBash: boolean;
  /** Enables the sandboxed runJs V8 tool. */
  localToolsRunJs: boolean;
  codingAgent: CodingAgentProvider;
  disabledSkillIds: string[];
  learningEnabled: boolean;
  micDevice?: string;
};

export type CodingAgentProvider = "codex" | "claude" | null;

export type FontSize = "sm" | "md" | "lg";
export type FontFamily = "sans" | "serif" | "mono";
export type ResponseLength = "concise" | "standard" | "detailed";
export type TaskSuggestionAggressiveness = "conservative" | "balanced" | "aggressive";
export type SuggestionScanWordBudget = 100 | 150 | 200;

export type AppConfig = {
  themeMode: ThemeMode;
  lightVariant: LightVariant;
  darkVariant: DarkVariant;
  fontSize: FontSize;
  fontFamily: FontFamily;
  direction: Direction;
  intervalMs: number;
  transcriptionProvider: TranscriptionProvider;
  transcriptionModelId: string;
  analysisProvider: AnalysisProvider;
  analysisModelId: string;
  analysisProviderOnly?: string;
  analysisReasoning: boolean;
  taskModelId: string;
  taskProviders: string[];
  utilityModelId: string;
  synthesisModelId: string;
  vertexProject?: string;
  vertexLocation: string;
  bedrockRegion: string;
  responseLength: ResponseLength;
  taskSuggestionAggressiveness: TaskSuggestionAggressiveness;
  suggestionScanWordBudget: SuggestionScanWordBudget;
  debug: boolean;
  legacyAudio: boolean;
  agentAutoApprove: boolean;
  autoDelegate: boolean;
  /** Enables the local file tools: read, write, edit, ls, grep, find. */
  localToolsFiles: boolean;
  /** Enables the local bash shell tool. */
  localToolsBash: boolean;
  /** Enables the sandboxed runJs V8 tool. */
  localToolsRunJs: boolean;
  codingAgent: CodingAgentProvider;
  disabledSkillIds: string[];
  learningEnabled: boolean;
};

export type AppConfigOverrides = Partial<AppConfig>;

export type ApiKeyDefinition = Readonly<{
  envVar: string;
  label: string;
  placeholder: string;
  providers: string[];
}>;

export type McpIntegrationMode = "oauth" | "token";
export type McpIntegrationConnection = "connected" | "disconnected" | "error";

export type McpIntegrationStatus = Readonly<{
  provider: string;
  mode: McpIntegrationMode;
  state: McpIntegrationConnection;
  enabled: boolean;
  label?: string;
  error?: string;
  lastConnectedAt?: number;
  mcpUrl?: string;
}>;

export type CustomMcpTransport = "streamable" | "sse";

export type McpToolInfo = {
  name: string;
  description?: string;
  isMutating: boolean;
};

export type McpProviderToolSummary = {
  /** "notion" | "linear" | "custom:<uuid>" */
  provider: string;
  tools: McpToolInfo[];
};

export type CustomMcpStatus = {
  id: string;
  name: string;
  url: string;
  transport: CustomMcpTransport;
  state: McpIntegrationConnection;
  error?: string;
  lastConnectedAt?: number;
};

const ENV = typeof process !== "undefined" ? process.env : undefined;

export const DEFAULT_VERTEX_MODEL_ID =
  ENV?.VERTEX_MODEL_ID ?? "gemini-3-flash-preview";
export const DEFAULT_VERTEX_LOCATION =
  ENV?.GOOGLE_VERTEX_PROJECT_LOCATION ?? "global";
export const DEFAULT_BEDROCK_REGION =
  ENV?.AWS_REGION ?? "us-east-1";
export const DEFAULT_TRANSCRIPTION_MODEL_ID =
  ENV?.TRANSCRIPTION_MODEL_ID ?? "scribe_v2_realtime";
export { getAnalysisModelPreset } from "./models";

export const DEFAULT_ANALYSIS_MODEL_ID =
  ENV?.ANALYSIS_MODEL_ID ?? "moonshotai/kimi-k2-thinking";
export const DEFAULT_TASK_MODEL_ID =
  ENV?.TODO_MODEL_ID ?? "openai/gpt-oss-120b";
export const DEFAULT_INTERVAL_MS = 8000;
export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_LIGHT_VARIANT: LightVariant = "moss";
export const DEFAULT_DARK_VARIANT: DarkVariant = "papaya";
export const DEFAULT_FONT_SIZE: FontSize = "md";
export const DEFAULT_FONT_FAMILY: FontFamily = "sans";
export const DEFAULT_TASK_SUGGESTION_AGGRESSIVENESS: TaskSuggestionAggressiveness = "balanced";

function normalizeLightVariant(
  value: unknown,
  fallback: LightVariant
): LightVariant {
  switch (value) {
    case "linen":
    case "ivory":
    case "blossom":
    case "moss":
      return value;
    default:
      return fallback;
  }
}

function normalizeDarkVariant(
  value: unknown,
  fallback: DarkVariant
): DarkVariant {
  switch (value) {
    case "papaya":
    case "slate":
    case "abyss":
    case "cyber-city":
      return value;
    default:
      return fallback;
  }
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  themeMode: DEFAULT_THEME_MODE,
  lightVariant: DEFAULT_LIGHT_VARIANT,
  darkVariant: DEFAULT_DARK_VARIANT,
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
  direction: "auto",
  intervalMs: DEFAULT_INTERVAL_MS,
  transcriptionProvider: "openrouter",
  transcriptionModelId: "google/gemini-3-flash-preview",
  analysisProvider: "openrouter",
  analysisModelId: MODEL_CONFIG.openrouter.defaults.analysisModelId,
  analysisReasoning: false,
  taskModelId: MODEL_CONFIG.openrouter.defaults.taskModelId,
  taskProviders: MODEL_CONFIG.openrouter.defaults.taskProviders,
  utilityModelId: MODEL_CONFIG.openrouter.defaults.utilityModelId,
  synthesisModelId: MODEL_CONFIG.openrouter.defaults.synthesisModelId,
  vertexProject: ENV?.GOOGLE_VERTEX_PROJECT_ID,
  vertexLocation: DEFAULT_VERTEX_LOCATION,
  bedrockRegion: DEFAULT_BEDROCK_REGION,
  responseLength: "standard",
  taskSuggestionAggressiveness: DEFAULT_TASK_SUGGESTION_AGGRESSIVENESS,
  suggestionScanWordBudget: 200,
  debug: !!ENV?.DEBUG,
  legacyAudio: false,
  agentAutoApprove: false,
  autoDelegate: false,
  localToolsFiles: true,
  localToolsBash: true,
  localToolsRunJs: false,
  codingAgent: null,
  disabledSkillIds: [],
  learningEnabled: true,
};

function resolveCodingAgent(merged: Partial<AppConfig> & Record<string, unknown>): CodingAgentProvider {
  // New field wins when explicitly set.
  if (merged.codingAgent === "codex" || merged.codingAgent === "claude") {
    return merged.codingAgent;
  }
  if (merged.codingAgent === null) return null;
  // Legacy fields — migrate persisted state from the old dual-toggle design.
  // Prefer claude if both were set (unlikely, but matches the user's explicit opt-in).
  if (merged.claudeEnabled === true) return "claude";
  if (merged.codexEnabled === true) return "codex";
  return null;
}

export function normalizeAppConfig(
  input?: AppConfigOverrides | null
): AppConfig {
  const merged: AppConfig = {
    ...DEFAULT_APP_CONFIG,
    ...(input ?? {}),
  };

  const themeMode: ThemeMode =
    merged.themeMode === "dark" ||
    merged.themeMode === "light" ||
    merged.themeMode === "system"
      ? merged.themeMode
      : DEFAULT_APP_CONFIG.themeMode;
  const rawLightVariant =
    (input as { lightVariant?: unknown } | null | undefined)?.lightVariant ??
    merged.lightVariant;
  const lightVariant = normalizeLightVariant(
    rawLightVariant,
    DEFAULT_APP_CONFIG.lightVariant
  );
  const rawDarkVariant =
    (input as { darkVariant?: unknown } | null | undefined)?.darkVariant ??
    merged.darkVariant;
  const darkVariant = normalizeDarkVariant(
    rawDarkVariant,
    DEFAULT_APP_CONFIG.darkVariant
  );
  const fontSize: FontSize =
    merged.fontSize === "sm" ||
    merged.fontSize === "md" ||
    merged.fontSize === "lg"
      ? merged.fontSize
      : DEFAULT_APP_CONFIG.fontSize;
  const fontFamily: FontFamily =
    merged.fontFamily === "sans" || merged.fontFamily === "serif" || merged.fontFamily === "mono"
      ? merged.fontFamily
      : DEFAULT_APP_CONFIG.fontFamily;
  const direction: Direction =
    merged.direction === "source-target" || merged.direction === "auto"
      ? merged.direction
      : DEFAULT_APP_CONFIG.direction;
  const transcriptionProvider: TranscriptionProvider =
    merged.transcriptionProvider === "openrouter" ||
    merged.transcriptionProvider === "vertex" ||
    merged.transcriptionProvider === "google"
      ? merged.transcriptionProvider
      : DEFAULT_APP_CONFIG.transcriptionProvider;
  const analysisProvider: AnalysisProvider =
    merged.analysisProvider === "openrouter" ||
    merged.analysisProvider === "google" ||
    merged.analysisProvider === "vertex" ||
    merged.analysisProvider === "bedrock" ||
    merged.analysisProvider === "openai-codex"
      ? merged.analysisProvider
      : DEFAULT_APP_CONFIG.analysisProvider;
  const intervalMs =
    Number.isFinite(merged.intervalMs) && merged.intervalMs > 0
      ? Math.round(merged.intervalMs)
      : DEFAULT_APP_CONFIG.intervalMs;
  const transcriptionModelId =
    merged.transcriptionModelId?.trim() ||
    DEFAULT_APP_CONFIG.transcriptionModelId;
  const analysisModelId =
    merged.analysisModelId?.trim() || DEFAULT_APP_CONFIG.analysisModelId;
  const analysisModelPreset = getAnalysisModelPreset(analysisModelId);
  const analysisProviderOnly =
    analysisModelPreset?.providerOnly ?? (merged.analysisProviderOnly?.trim() || undefined);
  const analysisReasoning = analysisModelPreset?.reasoning ?? !!merged.analysisReasoning;
  const legacyMemoryModelId = (() => {
    const raw = (input as { memoryModelId?: unknown } | null | undefined)?.memoryModelId;
    return typeof raw === "string" ? raw.trim() : "";
  })();
  const synthesisModelId =
    merged.synthesisModelId?.trim() ||
    legacyMemoryModelId ||
    DEFAULT_APP_CONFIG.synthesisModelId;
  const taskSuggestionAggressiveness: TaskSuggestionAggressiveness =
    merged.taskSuggestionAggressiveness === "conservative" ||
    merged.taskSuggestionAggressiveness === "aggressive" ||
    merged.taskSuggestionAggressiveness === "balanced"
      ? merged.taskSuggestionAggressiveness
      : DEFAULT_APP_CONFIG.taskSuggestionAggressiveness;
  const suggestionScanWordBudget: SuggestionScanWordBudget =
    merged.suggestionScanWordBudget === 100 ||
    merged.suggestionScanWordBudget === 150 ||
    merged.suggestionScanWordBudget === 200
      ? merged.suggestionScanWordBudget
      : DEFAULT_APP_CONFIG.suggestionScanWordBudget;

  return {
    ...merged,
    themeMode,
    lightVariant,
    darkVariant,
    fontSize,
    fontFamily,
    direction,
    transcriptionProvider,
    analysisProvider,
    intervalMs,
    transcriptionModelId,
    analysisModelId,
    taskModelId: merged.taskModelId?.trim() || DEFAULT_APP_CONFIG.taskModelId,
    utilityModelId: merged.utilityModelId?.trim() || DEFAULT_APP_CONFIG.utilityModelId,
    synthesisModelId,
    vertexLocation:
      merged.vertexLocation?.trim() || DEFAULT_APP_CONFIG.vertexLocation,
    vertexProject: merged.vertexProject?.trim() || undefined,
    bedrockRegion:
      merged.bedrockRegion?.trim() || DEFAULT_APP_CONFIG.bedrockRegion,
    responseLength:
      merged.responseLength === "concise" ||
      merged.responseLength === "standard" ||
      merged.responseLength === "detailed"
        ? merged.responseLength
        : (merged as unknown as { compact?: boolean }).compact
          ? "concise"
          : DEFAULT_APP_CONFIG.responseLength,
    taskSuggestionAggressiveness,
    suggestionScanWordBudget,
    debug: !!merged.debug,
    legacyAudio: !!merged.legacyAudio,
    agentAutoApprove: !!merged.agentAutoApprove,
    autoDelegate: !!merged.autoDelegate,
    localToolsFiles: merged.localToolsFiles !== false,
    localToolsBash: merged.localToolsBash !== false,
    localToolsRunJs: !!merged.localToolsRunJs,
    codingAgent: resolveCodingAgent(merged),
    analysisProviderOnly,
    analysisReasoning,
    taskProviders:
      Array.isArray(merged.taskProviders) && merged.taskProviders.length > 0
        ? merged.taskProviders
        : DEFAULT_APP_CONFIG.taskProviders,
    disabledSkillIds: Array.isArray(merged.disabledSkillIds)
      ? merged.disabledSkillIds
      : DEFAULT_APP_CONFIG.disabledSkillIds,
    learningEnabled: merged.learningEnabled !== false,
  };
}

// Agent types
export type AgentStatus = "running" | "completed" | "failed";
export type AgentKind = "analysis" | "custom";
export type AgentStepKind =
  | "thinking"
  | "tool-call"
  | "tool-result"
  | "text"
  | "user"
  | "plan"
  | "todo";

export type AgentTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type AgentTodoItem = Readonly<{
  id: string;
  content: string;
  status: AgentTodoStatus;
}>;

export type AgentQuestionOption = Readonly<{
  id: string;
  label: string;
}>;

export type AgentQuestion = Readonly<{
  id: string;
  prompt: string;
  options: AgentQuestionOption[];
  allow_multiple?: boolean;
}>;

export type AgentQuestionRequest = Readonly<{
  title?: string;
  questions: AgentQuestion[];
}>;

export type AgentQuestionSelection = Readonly<{
  questionId: string;
  selectedOptionIds: string[];
  freeText?: string;
}>;

export type AgentToolApprovalRequest = Readonly<{
  id: string;
  toolName: string;
  provider: string;
  title: string;
  summary: string;
  input?: string;
}>;

export type AgentToolApprovalResponse = Readonly<{
  approvalId: string;
  approved: boolean;
}>;

export type AgentToolApprovalState =
  | "approval-requested"
  | "approval-responded"
  | "output-denied"
  | "output-available";

export type AgentPlanApprovalRequest = Readonly<{
  id: string;
  title: string;
  content: string;
}>;

export type AgentPlanApprovalResponse = Readonly<{
  approvalId: string;
  approved: boolean;
  feedback?: string;
}>;

export type AgentPlanApprovalState =
  | "awaiting-approval"
  | "approved"
  | "rejected";

export type AgentStep = Readonly<{
  id: string;
  kind: AgentStepKind;
  content: string;
  toolName?: string;
  toolInput?: string;
  approvalId?: string;
  approvalState?: AgentToolApprovalState;
  approvalApproved?: boolean;
  planTitle?: string;
  planContent?: string;
  planApprovalState?: AgentPlanApprovalState;
  planApprovalFeedback?: string;
  todoItems?: AgentTodoItem[];
  createdAt: number;
}>;

export type Agent = {
  id: string;
  kind: AgentKind;
  taskId?: string;
  task: string;
  taskContext?: string;
  status: AgentStatus;
  steps: AgentStep[];
  result?: string;
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
  archived?: boolean;
};

// Provider task types — shared by codex and claude-code background tasks
export type ProviderKind = "codex" | "claude";

export type ProviderTaskStatus = "running" | "completed" | "failed" | "cancelled";

export type ProviderTaskEntry = Readonly<
  | { type: "command"; command: string; exitCode?: number }
  | { type: "file-change"; changes: ReadonlyArray<{ kind: string; path: string }> }
  | { type: "reasoning"; text: string }
  | { type: "message"; text: string }
  | { type: "tool-call"; toolName: string; input?: string }
  | { type: "raw"; text: string }
>;

export type ProviderTaskEventBase = Readonly<{
  taskId: string;
  provider: ProviderKind;
  toolCallId?: string;
  agentId?: string;
  at: number;
}>;

export type ProviderTaskEvent =
  | (ProviderTaskEventBase & { kind: "started"; prompt: string; cwd?: string; threadId?: string })
  | (ProviderTaskEventBase & { kind: "progress"; entry: ProviderTaskEntry })
  | (ProviderTaskEventBase & { kind: "completed"; summary: string; threadId?: string })
  | (ProviderTaskEventBase & { kind: "failed"; error: string })
  | (ProviderTaskEventBase & { kind: "cancelled" });

// Session event types for EventEmitter
export type SessionEvents = {
  "state-change": [state: UIState];
  "block-added": [block: TranscriptBlock];
  "block-updated": [block: TranscriptBlock];
  "blocks-cleared": [];
  "summary-updated": [summary: Summary | null];
  "final-summary-ready": [summary: FinalSummary];
  "final-summary-error": [error: string];
  "cost-updated": [cost: number];
  partial: [payload: { source: AudioSource | null; text: string }];
  status: [text: string];
  error: [error: string];
  "task-added": [task: TaskItem];
  "task-updated": [task: TaskItem];
  "task-suggested": [suggestion: TaskSuggestion];
  "suggestion-progress": [payload: {
    scanId?: string;
    label?: string;
    busy: boolean;
    wordsUntilNextScan: number;
    liveWordsUntilNextScan?: number;
    scanWordBudget?: number;
    step?: string;
    lastScanEmpty?: boolean;
    error?: string;
  }];
  "agent-started": [agent: Agent];
  "agent-step": [agentId: string, step: AgentStep];
  "agent-completed": [agentId: string, result: string];
  "agent-failed": [agentId: string, error: string];
  "agent-archived": [agentId: string];
  "agents-summary-ready": [summary: AgentsSummary];
  "agents-summary-error": [error: string];
  "session-title-generated": [sessionId: string, title: string];
  "agent-title-generated": [agentId: string, title: string];
  "provider-task-event": [event: ProviderTaskEvent];
};
