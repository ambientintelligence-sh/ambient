import { useEffect, useReducer, useRef } from "react";
import type { UIState, TranscriptBlock, Summary, LanguageCode, TaskItem, Insight, Agent, AppConfig, AudioSource } from "@core/types";

export type SessionState = {
  sessionId: string | null;
  uiState: UIState | null;
  blocks: TranscriptBlock[];
  summary: Summary | null;
  rollingKeyPoints: string[];
  cost: number;
  systemPartial: string;
  micPartial: string;
  statusText: string;
  errorText: string;
  sessionActive: boolean;
  micAutoStartPending: boolean;
};

type ResumeData = {
  sessionId: string;
  blocks: TranscriptBlock[];
  tasks: TaskItem[];
  insights: Insight[];
  agents: Agent[];
};

type SessionAction =
  | { kind: "state-change"; state: UIState }
  | { kind: "block-added"; block: TranscriptBlock }
  | { kind: "block-updated"; block: TranscriptBlock }
  | { kind: "blocks-cleared" }
  | { kind: "summary-updated"; summary: Summary | null }
  | { kind: "cost-updated"; cost: number }
  | { kind: "partial"; source: AudioSource | null; text: string }
  | { kind: "status"; text: string }
  | { kind: "error"; text: string }
  | { kind: "session-started"; sessionId: string }
  | { kind: "session-resumed"; data: ResumeData }
  | { kind: "session-ended" }
  | { kind: "mic-auto-started" }
  | { kind: "session-viewed"; sessionId: string; blocks: TranscriptBlock[]; keyPoints: string[] };

const MAX_ROLLING_KEY_POINTS = 160;

function sortBlocks(blocks: TranscriptBlock[]): TranscriptBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id - b.id;
  });
}

function normalizeKeyPointText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .toLowerCase();
}

function mergeRollingKeyPoints(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of [...existing, ...incoming]) {
    const text = raw.trim().replace(/\s+/g, " ");
    if (!text) continue;
    const key = normalizeKeyPointText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(text);
  }
  if (next.length <= MAX_ROLLING_KEY_POINTS) return next;
  return next.slice(-MAX_ROLLING_KEY_POINTS);
}

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.kind) {
    case "state-change":
      return { ...state, uiState: action.state };
    case "block-added": {
      const clearPartial =
        action.block.audioSource === "system" ? { systemPartial: "" } :
        action.block.audioSource === "microphone" ? { micPartial: "" } :
        {};
      return { ...state, ...clearPartial, blocks: sortBlocks([...state.blocks, action.block]) };
    }
    case "block-updated":
      return {
        ...state,
        blocks: sortBlocks(state.blocks.map((b) =>
          b.id === action.block.id ? action.block : b
        )),
      };
    case "blocks-cleared":
      return { ...state, blocks: [], summary: null, rollingKeyPoints: [], cost: 0, systemPartial: "", micPartial: "", statusText: "" };
    case "summary-updated":
      return {
        ...state,
        summary: action.summary,
        rollingKeyPoints: action.summary
          ? mergeRollingKeyPoints(state.rollingKeyPoints, action.summary.keyPoints)
          : state.rollingKeyPoints,
      };
    case "cost-updated":
      return { ...state, cost: action.cost };
    case "partial":
      if (action.source === null) return { ...state, systemPartial: "", micPartial: "" };
      return action.source === "system"
        ? { ...state, systemPartial: action.text }
        : { ...state, micPartial: action.text };
    case "status":
      return { ...state, statusText: action.text };
    case "error":
      return { ...state, errorText: action.text };
    case "session-started":
      return {
        ...state,
        sessionActive: true,
        sessionId: action.sessionId,
        blocks: [],
        summary: null,
        rollingKeyPoints: [],
        cost: 0,
        systemPartial: "",
        micPartial: "",
        statusText: "",
        errorText: "",
        micAutoStartPending: false,
      };
    case "session-resumed": {
      const keyPoints = [...action.data.insights]
        .filter((i) => i.kind === "key-point")
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((i) => i.text);
      return {
        ...state,
        sessionActive: true,
        sessionId: action.data.sessionId,
        blocks: sortBlocks(action.data.blocks),
        rollingKeyPoints: mergeRollingKeyPoints([], keyPoints),
        summary: null,
        cost: 0,
        systemPartial: "",
        micPartial: "",
        statusText: "",
        errorText: "",
      };
    }
    case "session-ended":
      return { ...state, sessionActive: false, uiState: null, systemPartial: "", micPartial: "", statusText: "", errorText: "", micAutoStartPending: false };
    case "mic-auto-started":
      return { ...state, micAutoStartPending: false };
    case "session-viewed":
      return {
        ...state,
        sessionId: action.sessionId,
        blocks: sortBlocks(action.blocks),
        rollingKeyPoints: mergeRollingKeyPoints([], action.keyPoints),
        sessionActive: false,
        uiState: null,
        summary: null,
        cost: 0,
        systemPartial: "",
        micPartial: "",
        statusText: "",
        errorText: "",
      };
  }
}

const initialState: SessionState = {
  sessionId: null,
  uiState: null,
  blocks: [],
  summary: null,
  rollingKeyPoints: [],
  cost: 0,
  systemPartial: "",
  micPartial: "",
  statusText: "",
  errorText: "",
  sessionActive: false,
  micAutoStartPending: false,
};

export type InternalSessionAction = SessionAction | { kind: "session-cleared" };

export function sessionStateReducer(state: SessionState, action: InternalSessionAction): SessionState {
  if (action.kind === "session-cleared") {
    return {
      ...initialState,
    };
  }
  return sessionReducer(state, action);
}

export type { ResumeData };
export { sessionReducer, initialState };

export type SessionOptions = {
  onResumed?: (data: ResumeData) => void;
  projectId?: string | null;
};

export function useSession(
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  active: boolean,
  appConfig: AppConfig,
  resumeSessionId: string | null = null,
  options: SessionOptions = {},
  restartKey = 0,
) {
  const [state, dispatch] = useReducer(sessionStateReducer, initialState);
  const onResumedRef = useRef(options.onResumed);
  const appConfigRef = useRef(appConfig);
  const projectIdRef = useRef(options.projectId);
  const sourceLangRef = useRef(sourceLang);
  const targetLangRef = useRef(targetLang);
  onResumedRef.current = options.onResumed;
  appConfigRef.current = appConfig;
  projectIdRef.current = options.projectId;
  sourceLangRef.current = sourceLang;
  targetLangRef.current = targetLang;

  useEffect(() => {
    if (!active) return;

    const api = window.electronAPI;
    const cleanups: (() => void)[] = [];

    cleanups.push(api.onStateChange((s) => dispatch({ kind: "state-change", state: s })));
    cleanups.push(api.onBlockAdded((b) => dispatch({ kind: "block-added", block: b })));
    cleanups.push(api.onBlockUpdated((b) => dispatch({ kind: "block-updated", block: b })));
    cleanups.push(api.onBlocksCleared(() => dispatch({ kind: "blocks-cleared" })));
    cleanups.push(api.onSummaryUpdated((s) => dispatch({ kind: "summary-updated", summary: s })));
    cleanups.push(api.onCostUpdated((c) => dispatch({ kind: "cost-updated", cost: c })));
    cleanups.push(api.onPartial((p) => dispatch({ kind: "partial", source: p.source, text: p.text })));
    cleanups.push(api.onStatus((t) => dispatch({ kind: "status", text: t })));
    cleanups.push(api.onError((t) => dispatch({ kind: "error", text: t })));

    if (resumeSessionId) {
      api.resumeSession(resumeSessionId, appConfigRef.current).then((result) => {
        if (result.ok && result.sessionId) {
          const data: ResumeData = {
            sessionId: result.sessionId,
            blocks: result.blocks ?? [],
            tasks: result.tasks ?? [],
            insights: result.insights ?? [],
            agents: result.agents ?? [],
          };
          dispatch({ kind: "session-resumed", data });
          onResumedRef.current?.(data);
        } else {
          dispatch({ kind: "error", text: result.error ?? "Failed to resume session" });
        }
      });
    } else {
      api.startSession(sourceLangRef.current, targetLangRef.current, appConfigRef.current, projectIdRef.current ?? undefined).then((result) => {
        if (result.ok && result.sessionId) {
          dispatch({ kind: "session-started", sessionId: result.sessionId });
        } else {
          dispatch({ kind: "error", text: result.error ?? "Failed to start session" });
        }
      });
    }

    return () => {
      cleanups.forEach((fn) => fn());
      api.shutdownSession();
      dispatch({ kind: "session-ended" });
    };
  }, [active, resumeSessionId, restartKey]);

  const toggleRecording = async () => {
    const result = await window.electronAPI.toggleRecording();
    if (!result.ok) {
      dispatch({ kind: "error", text: result.error ?? "Failed to toggle recording" });
    }
  };

  const viewSession = async (sessionId: string) => {
    const api = window.electronAPI;
    const [blocks, insights] = await Promise.all([
      api.getSessionBlocks(sessionId),
      api.getSessionInsights(sessionId),
    ]);
    const keyPoints = [...insights]
      .filter((i: Insight) => i.kind === "key-point")
      .sort((a: Insight, b: Insight) => a.createdAt - b.createdAt)
      .map((i: Insight) => i.text);
    dispatch({ kind: "session-viewed", sessionId, blocks, keyPoints });
  };

  const clearSession = () => {
    dispatch({ kind: "session-cleared" });
  };

  const clearMicAutoStart = () => {
    dispatch({ kind: "mic-auto-started" });
  };

  return { ...state, toggleRecording, viewSession, clearSession, clearMicAutoStart };
}
