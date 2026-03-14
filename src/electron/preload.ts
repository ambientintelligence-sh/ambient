import { contextBridge, ipcRenderer } from "electron/renderer";
import type {
  Language,
  UIState,
  TranscriptBlock,
  Summary,
  FinalSummary,
  AgentsSummary,
  LanguageCode,
  Device,
  TaskItem,
  TaskSuggestion,
  Insight,
  SessionMeta,
  ProjectMeta,
  Agent,
  AgentKind,
  AgentStep,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  AgentPlanApprovalResponse,
  AppConfigOverrides,
  McpIntegrationStatus,
  CustomMcpStatus,
  McpProviderToolSummary,
  AudioSource,
  ApiKeyDefinition,
} from "@core/types";

export type ElectronAPI = {
  wasSeeded: () => Promise<boolean>;
  getLanguages: () => Promise<Language[]>;
  startSession: (sourceLang: LanguageCode, targetLang: LanguageCode, appConfig?: AppConfigOverrides, projectId?: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;

  getProjects: () => Promise<ProjectMeta[]>;
  createProject: (name: string, instructions?: string, context?: string) => Promise<{ ok: boolean; project?: ProjectMeta; error?: string }>;
  updateProject: (id: string, patch: { name?: string; instructions?: string; context?: string }) => Promise<{ ok: boolean; project?: ProjectMeta; error?: string }>;
  deleteProject: (id: string) => Promise<{ ok: boolean; error?: string }>;
  updateSessionProject: (sessionId: string, projectId: string | null) => Promise<{ ok: boolean; session?: SessionMeta; error?: string }>;
  resumeSession: (sessionId: string, appConfig?: AppConfigOverrides) => Promise<{ ok: boolean; sessionId?: string; blocks?: TranscriptBlock[]; tasks?: TaskItem[]; insights?: Insight[]; agents?: Agent[]; error?: string }>;
  startRecording: () => Promise<{ ok: boolean; error?: string }>;
  stopRecording: () => Promise<{ ok: boolean; error?: string }>;
  toggleRecording: () => Promise<{ ok: boolean; recording?: boolean; error?: string }>;
  toggleMic: () => Promise<{ ok: boolean; micEnabled?: boolean; captureInRenderer?: boolean; error?: string }>;
  sendMicAudio: (data: ArrayBuffer) => void;
  toggleTranslation: () => Promise<{ ok: boolean; enabled?: boolean; error?: string }>;
  setTranslationMode: (direction: "off" | "auto" | "source-target", targetLang?: LanguageCode) => Promise<{ ok: boolean; error?: string }>;
  addContextNote: (text: string) => Promise<{ ok: boolean; block?: TranscriptBlock; error?: string }>;
  listMicDevices: () => Promise<Device[]>;
  shutdownSession: () => Promise<{ ok: boolean }>;
  generateFinalSummary: () => Promise<{ ok: boolean; error?: string }>;
  getFinalSummary: (sessionId: string) => Promise<{ ok: boolean; summary?: FinalSummary }>;
  patchFinalSummary: (sessionId: string, patch: Partial<FinalSummary>) => Promise<{ ok: boolean }>;
  onFinalSummaryReady: (callback: (summary: FinalSummary) => void) => () => void;
  onFinalSummaryError: (callback: (error: string) => void) => () => void;
  generateAgentsSummary: () => Promise<{ ok: boolean; error?: string }>;
  getAgentsSummary: (sessionId: string) => Promise<{ ok: boolean; summary?: AgentsSummary }>;
  onAgentsSummaryReady: (cb: (summary: AgentsSummary) => void) => () => void;
  onAgentsSummaryError: (cb: (error: string) => void) => () => void;

  getTasks: () => Promise<TaskItem[]>;
  addTask: (task: TaskItem, appConfig?: AppConfigOverrides) => Promise<{ ok: boolean; task?: TaskItem; error?: string }>;
  updateTaskText: (id: string, text: string, appConfig?: AppConfigOverrides) => Promise<{ ok: boolean; task?: TaskItem; error?: string }>;
  toggleTask: (id: string) => Promise<{ ok: boolean; error?: string }>;
  deleteTask: (id: string) => Promise<{ ok: boolean; error?: string }>;
  extractTaskFromSelectionInSession: (
    sessionId: string,
    selectedText: string,
    userIntentText?: string,
    appConfig?: AppConfigOverrides,
  ) => Promise<{ ok: boolean; taskTitle?: string; taskDetails?: string; reason?: string; error?: string }>;
  getSessions: (limit?: number) => Promise<SessionMeta[]>;
  getSessionBlocks: (sessionId: string) => Promise<TranscriptBlock[]>;
  deleteSession: (id: string) => Promise<{ ok: boolean }>;
  archiveTask: (id: string) => Promise<{ ok: boolean; error?: string }>;
  unarchiveTask: (id: string) => Promise<{ ok: boolean; error?: string }>;
  getArchivedTasks: (sessionId: string) => Promise<TaskItem[]>;
  getInsights: (limit?: number) => Promise<Insight[]>;
  getSessionTasks: (sessionId: string) => Promise<TaskItem[]>;
  getSessionInsights: (sessionId: string) => Promise<Insight[]>;

  approveLargeTask: (taskId: string) => Promise<{ ok: boolean; approvalToken?: string; error?: string }>;
  launchAgent: (taskId: string, task: string, taskContext?: string, approvalToken?: string) => Promise<{ ok: boolean; agent?: Agent; error?: string }>;
  launchCustomAgent: (task: string, taskContext?: string, kind?: AgentKind) => Promise<{ ok: boolean; agent?: Agent; error?: string }>;
  launchCustomAgentInSession: (
    sessionId: string,
    task: string,
    taskContext?: string,
    kind?: AgentKind,
    appConfig?: AppConfigOverrides,
  ) => Promise<{ ok: boolean; agent?: Agent; error?: string }>;
  launchAgentInSession: (
    sessionId: string,
    taskId: string,
    task: string,
    taskContext?: string,
    appConfig?: AppConfigOverrides,
    approvalToken?: string,
  ) => Promise<{ ok: boolean; agent?: Agent; error?: string }>;
  archiveAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  relaunchAgent: (agentId: string) => Promise<{ ok: boolean; agent?: Agent; error?: string }>;
  followUpAgent: (agentId: string, question: string) => Promise<{ ok: boolean; error?: string }>;
  followUpAgentInSession: (sessionId: string, agentId: string, question: string, appConfig?: AppConfigOverrides) => Promise<{ ok: boolean; error?: string }>;
  answerAgentQuestion: (agentId: string, answers: AgentQuestionSelection[]) => Promise<{ ok: boolean; error?: string }>;
  answerAgentQuestionInSession: (
    sessionId: string,
    agentId: string,
    answers: AgentQuestionSelection[],
    appConfig?: AppConfigOverrides,
  ) => Promise<{ ok: boolean; error?: string }>;
  skipAgentQuestion: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  skipAgentQuestionInSession: (
    sessionId: string,
    agentId: string,
    appConfig?: AppConfigOverrides,
  ) => Promise<{ ok: boolean; error?: string }>;
  respondAgentToolApproval: (agentId: string, response: AgentToolApprovalResponse) => Promise<{ ok: boolean; error?: string }>;
  respondAgentToolApprovalInSession: (
    sessionId: string,
    agentId: string,
    response: AgentToolApprovalResponse,
    appConfig?: AppConfigOverrides,
  ) => Promise<{ ok: boolean; error?: string }>;
  respondPlanApproval: (agentId: string, response: AgentPlanApprovalResponse) => Promise<{ ok: boolean; error?: string }>;
  respondPlanApprovalInSession: (
    sessionId: string,
    agentId: string,
    response: AgentPlanApprovalResponse,
    appConfig?: AppConfigOverrides,
  ) => Promise<{ ok: boolean; error?: string }>;
  cancelAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  getAgents: () => Promise<Agent[]>;
  getSessionAgents: (sessionId: string) => Promise<Agent[]>;

  getMcpIntegrationsStatus: () => Promise<McpIntegrationStatus[]>;
  connectMcpProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectMcpProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;
  addCustomMcpServer: (cfg: { name: string; url: string; transport: "streamable" | "sse"; bearerToken?: string }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  removeCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  connectCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  getCustomMcpServersStatus: () => Promise<CustomMcpStatus[]>;
  getMcpToolsInfo: () => Promise<McpProviderToolSummary[]>;

  getApiKeyDefinitions: () => Promise<ApiKeyDefinition[]>;
  getApiKeyStatus: () => Promise<Record<string, boolean>>;
  saveApiKey: (envVar: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  deleteApiKey: (envVar: string) => Promise<{ ok: boolean; error?: string }>;

  onStateChange: (callback: (state: UIState) => void) => () => void;
  onBlockAdded: (callback: (block: TranscriptBlock) => void) => () => void;
  onBlockUpdated: (callback: (block: TranscriptBlock) => void) => () => void;
  onBlocksCleared: (callback: () => void) => () => void;
  onSummaryUpdated: (callback: (summary: Summary | null) => void) => () => void;
  onCostUpdated: (callback: (cost: number) => void) => () => void;
  onPartial: (callback: (payload: { source: AudioSource | null; text: string }) => void) => () => void;
  onStatus: (callback: (text: string) => void) => () => void;
  onError: (callback: (text: string) => void) => () => void;
  onTaskAdded: (callback: (task: TaskItem) => void) => () => void;
  onTaskSuggested: (callback: (suggestion: TaskSuggestion) => void) => () => void;
  onAgentStarted: (callback: (agent: Agent) => void) => () => void;
  onAgentStep: (callback: (agentId: string, step: AgentStep) => void) => () => void;
  onAgentCompleted: (callback: (agentId: string, result: string) => void) => () => void;
  onAgentFailed: (callback: (agentId: string, error: string) => void) => () => void;
  onAgentArchived: (callback: (agentId: string) => void) => () => void;
  onAgentTitleGenerated: (callback: (agentId: string, title: string) => void) => () => void;
  onSessionTitleGenerated: (callback: (sessionId: string, title: string) => void) => () => void;

};

function createListener<T>(channel: string) {
  return (callback: (data: T) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

const api: ElectronAPI = {
  wasSeeded: () => ipcRenderer.invoke("was-seeded"),
  getLanguages: () => ipcRenderer.invoke("get-languages"),
  startSession: (sourceLang, targetLang, appConfig, projectId) => ipcRenderer.invoke("start-session", sourceLang, targetLang, appConfig, projectId),

  getProjects: () => ipcRenderer.invoke("get-projects"),
  createProject: (name, instructions, context) => ipcRenderer.invoke("create-project", name, instructions, context),
  updateProject: (id, patch) => ipcRenderer.invoke("update-project", id, patch),
  deleteProject: (id) => ipcRenderer.invoke("delete-project", id),
  updateSessionProject: (sessionId, projectId) => ipcRenderer.invoke("update-session-project", sessionId, projectId),
  resumeSession: (sessionId, appConfig) => ipcRenderer.invoke("resume-session", sessionId, appConfig),
  startRecording: () => ipcRenderer.invoke("start-recording"),
  stopRecording: () => ipcRenderer.invoke("stop-recording"),
  toggleRecording: () => ipcRenderer.invoke("toggle-recording"),
  toggleMic: () => ipcRenderer.invoke("toggle-mic"),
  sendMicAudio: (data) => ipcRenderer.send("mic-audio-data", data),
  toggleTranslation: () => ipcRenderer.invoke("toggle-translation"),
  setTranslationMode: (direction, targetLang) => ipcRenderer.invoke("set-translation-mode", direction, targetLang),
  addContextNote: (text) => ipcRenderer.invoke("add-context-note", text),
  listMicDevices: () => ipcRenderer.invoke("list-mic-devices"),
  shutdownSession: () => ipcRenderer.invoke("shutdown-session"),
  generateFinalSummary: () => ipcRenderer.invoke("generate-final-summary"),
  getFinalSummary: (sessionId) => ipcRenderer.invoke("get-final-summary", sessionId),
  patchFinalSummary: (sessionId, patch) => ipcRenderer.invoke("patch-final-summary", sessionId, patch),
  onFinalSummaryReady: createListener<FinalSummary>("session:final-summary-ready"),
  onFinalSummaryError: createListener<string>("session:final-summary-error"),
  generateAgentsSummary: () => ipcRenderer.invoke("generate-agents-summary"),
  getAgentsSummary: (id) => ipcRenderer.invoke("get-agents-summary", id),
  onAgentsSummaryReady: createListener<AgentsSummary>("session:agents-summary-ready"),
  onAgentsSummaryError: createListener<string>("session:agents-summary-error"),

  getTasks: () => ipcRenderer.invoke("get-tasks"),
  addTask: (task, appConfig) => ipcRenderer.invoke("add-task", task, appConfig),
  updateTaskText: (id, text, appConfig) => ipcRenderer.invoke("update-task-text", id, text, appConfig),
  toggleTask: (id) => ipcRenderer.invoke("toggle-task", id),
  deleteTask: (id) => ipcRenderer.invoke("delete-task", id),
  extractTaskFromSelectionInSession: (sessionId, selectedText, userIntentText, appConfig) =>
    ipcRenderer.invoke(
      "extract-task-from-selection-in-session",
      sessionId,
      selectedText,
      userIntentText,
      appConfig,
    ),
  getSessions: (limit) => ipcRenderer.invoke("get-sessions", limit),
  getSessionBlocks: (sessionId) => ipcRenderer.invoke("get-session-blocks", sessionId),
  deleteSession: (id) => ipcRenderer.invoke("delete-session", id),
  archiveTask: (id) => ipcRenderer.invoke("archive-task", id),
  unarchiveTask: (id) => ipcRenderer.invoke("unarchive-task", id),
  getArchivedTasks: (sessionId) => ipcRenderer.invoke("get-archived-tasks", sessionId),
  getInsights: (limit) => ipcRenderer.invoke("get-insights", limit),
  getSessionTasks: (sessionId) => ipcRenderer.invoke("get-session-tasks", sessionId),
  getSessionInsights: (sessionId) => ipcRenderer.invoke("get-session-insights", sessionId),

  approveLargeTask: (taskId) => ipcRenderer.invoke("approve-large-task", taskId),
  launchAgent: (taskId, task, taskContext, approvalToken) =>
    ipcRenderer.invoke("launch-agent", taskId, task, taskContext, approvalToken),
  launchCustomAgent: (task, taskContext, kind) =>
    ipcRenderer.invoke("launch-custom-agent", task, taskContext, kind),
  launchCustomAgentInSession: (sessionId, task, taskContext, kind, appConfig) =>
    ipcRenderer.invoke("launch-custom-agent-in-session", sessionId, task, taskContext, kind, appConfig),
  launchAgentInSession: (sessionId, taskId, task, taskContext, appConfig, approvalToken) =>
    ipcRenderer.invoke("launch-agent-in-session", sessionId, taskId, task, taskContext, appConfig, approvalToken),
  archiveAgent: (agentId) => ipcRenderer.invoke("archive-agent", agentId),
  relaunchAgent: (agentId) => ipcRenderer.invoke("relaunch-agent", agentId),
  followUpAgent: (agentId, question) => ipcRenderer.invoke("follow-up-agent", agentId, question),
  followUpAgentInSession: (sessionId, agentId, question, appConfig) => ipcRenderer.invoke("follow-up-agent-in-session", sessionId, agentId, question, appConfig),
  answerAgentQuestion: (agentId, answers) => ipcRenderer.invoke("answer-agent-question", agentId, answers),
  answerAgentQuestionInSession: (sessionId, agentId, answers, appConfig) =>
    ipcRenderer.invoke("answer-agent-question-in-session", sessionId, agentId, answers, appConfig),
  skipAgentQuestion: (agentId) => ipcRenderer.invoke("skip-agent-question", agentId),
  skipAgentQuestionInSession: (sessionId, agentId, appConfig) =>
    ipcRenderer.invoke("skip-agent-question-in-session", sessionId, agentId, appConfig),
  respondAgentToolApproval: (agentId, response) =>
    ipcRenderer.invoke("respond-agent-tool-approval", agentId, response),
  respondAgentToolApprovalInSession: (sessionId, agentId, response, appConfig) =>
    ipcRenderer.invoke("respond-agent-tool-approval-in-session", sessionId, agentId, response, appConfig),
  respondPlanApproval: (agentId, response) =>
    ipcRenderer.invoke("respond-plan-approval", agentId, response),
  respondPlanApprovalInSession: (sessionId, agentId, response, appConfig) =>
    ipcRenderer.invoke("respond-plan-approval-in-session", sessionId, agentId, response, appConfig),
  cancelAgent: (agentId) => ipcRenderer.invoke("cancel-agent", agentId),
  getAgents: () => ipcRenderer.invoke("get-agents"),
  getSessionAgents: (sessionId) => ipcRenderer.invoke("get-session-agents", sessionId),
  getMcpIntegrationsStatus: () => ipcRenderer.invoke("get-mcp-integrations-status"),
  connectMcpProvider: (id) => ipcRenderer.invoke("connect-mcp-provider", id),
  disconnectMcpProvider: (id) => ipcRenderer.invoke("disconnect-mcp-provider", id),
  addCustomMcpServer: (cfg) => ipcRenderer.invoke("add-custom-mcp-server", cfg),
  removeCustomMcpServer: (id) => ipcRenderer.invoke("remove-custom-mcp-server", id),
  connectCustomMcpServer: (id) => ipcRenderer.invoke("connect-custom-mcp-server", id),
  disconnectCustomMcpServer: (id) => ipcRenderer.invoke("disconnect-custom-mcp-server", id),
  getCustomMcpServersStatus: () => ipcRenderer.invoke("get-custom-mcp-servers-status"),
  getMcpToolsInfo: () => ipcRenderer.invoke("get-mcp-tools-info"),

  getApiKeyDefinitions: () => ipcRenderer.invoke("get-api-key-definitions"),
  getApiKeyStatus: () => ipcRenderer.invoke("get-api-key-status"),
  saveApiKey: (envVar, value) => ipcRenderer.invoke("save-api-key", envVar, value),
  deleteApiKey: (envVar) => ipcRenderer.invoke("delete-api-key", envVar),

  onStateChange: createListener<UIState>("session:state-change"),
  onBlockAdded: createListener<TranscriptBlock>("session:block-added"),
  onBlockUpdated: createListener<TranscriptBlock>("session:block-updated"),
  onBlocksCleared: createListener<void>("session:blocks-cleared"),
  onSummaryUpdated: createListener<Summary | null>("session:summary-updated"),
  onCostUpdated: createListener<number>("session:cost-updated"),
  onPartial: createListener<{ source: AudioSource | null; text: string }>("session:partial"),
  onStatus: createListener<string>("session:status"),
  onError: createListener<string>("session:error"),
  onTaskAdded: createListener<TaskItem>("session:task-added"),
  onTaskSuggested: createListener<TaskSuggestion>("session:task-suggested"),
  onAgentStarted: createListener<Agent>("session:agent-started"),
  onAgentStep: (callback: (agentId: string, step: AgentStep) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, agentId: string, step: AgentStep) => callback(agentId, step);
    ipcRenderer.on("session:agent-step", handler);
    return () => ipcRenderer.removeListener("session:agent-step", handler);
  },
  onAgentCompleted: (callback: (agentId: string, result: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, agentId: string, result: string) => callback(agentId, result);
    ipcRenderer.on("session:agent-completed", handler);
    return () => ipcRenderer.removeListener("session:agent-completed", handler);
  },
  onAgentFailed: (callback: (agentId: string, error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, agentId: string, error: string) => callback(agentId, error);
    ipcRenderer.on("session:agent-failed", handler);
    return () => ipcRenderer.removeListener("session:agent-failed", handler);
  },
  onAgentArchived: createListener<string>("session:agent-archived"),
  onAgentTitleGenerated: (callback: (agentId: string, title: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, agentId: string, title: string) => callback(agentId, title);
    ipcRenderer.on("session:agent-title-generated", handler);
    return () => ipcRenderer.removeListener("session:agent-title-generated", handler);
  },
  onSessionTitleGenerated: (callback: (sessionId: string, title: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, title: string) => callback(sessionId, title);
    ipcRenderer.on("session:title-generated", handler);
    return () => ipcRenderer.removeListener("session:title-generated", handler);
  },

};

contextBridge.exposeInMainWorld("electronAPI", api);
