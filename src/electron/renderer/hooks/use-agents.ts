import { useEffect, useReducer } from "react";
import type { Agent, AgentStep } from "@core/types";

type SessionAgentUIState = {
  selectedAgentId: string | null;
  openAgentIds: string[];
};

type AgentsState = {
  currentSessionId: string | null;
  agents: Agent[];
  sessionAgentUI: Record<string, SessionAgentUIState>;
  sessionAgentTitles: Record<string, Record<string, string>>;
  agentSelectionNonce: number;
};

type AgentsAction =
  | { kind: "agent-started"; agent: Agent }
  | { kind: "agent-step"; agentId: string; step: AgentStep }
  | { kind: "agent-completed"; agentId: string; result: string }
  | { kind: "agent-failed"; agentId: string; error: string }
  | { kind: "agent-archived"; agentId: string }
  | { kind: "agent-titled"; agentId: string; title: string }
  | { kind: "select-agent"; agentId: string | null }
  | { kind: "close-agent"; agentId: string }
  | { kind: "set-agent-steps"; agentId: string; steps: AgentStep[]; status?: Agent["status"] }
  | { kind: "load-agents"; sessionId: string | null; agents: Agent[] }
  | { kind: "reset" };

function getNextSelectedAgentId(openAgentIds: string[], closedAgentId: string): string | null {
  const currentIndex = openAgentIds.indexOf(closedAgentId);
  if (currentIndex < 0) return openAgentIds.at(-1) ?? null;
  return openAgentIds[currentIndex + 1] ?? openAgentIds[currentIndex - 1] ?? null;
}

function getSessionAgentUI(state: AgentsState, sessionId: string | null): SessionAgentUIState {
  if (!sessionId) return { selectedAgentId: null, openAgentIds: [] };
  return state.sessionAgentUI[sessionId] ?? { selectedAgentId: null, openAgentIds: [] };
}

function setSessionAgentUI(
  state: AgentsState,
  sessionId: string | null,
  nextUI: SessionAgentUIState,
): Record<string, SessionAgentUIState> {
  if (!sessionId) return state.sessionAgentUI;
  return {
    ...state.sessionAgentUI,
    [sessionId]: nextUI,
  };
}

function mergeSessionAgentTitles(
  state: AgentsState,
  sessionId: string | null,
  agents: Agent[],
): Record<string, Record<string, string>> {
  if (!sessionId || agents.length === 0) return state.sessionAgentTitles;
  const nextTitles = { ...(state.sessionAgentTitles[sessionId] ?? {}) };
  for (const agent of agents) {
    nextTitles[agent.id] = agent.task;
  }
  return {
    ...state.sessionAgentTitles,
    [sessionId]: nextTitles,
  };
}

function agentsReducer(state: AgentsState, action: AgentsAction): AgentsState {
  switch (action.kind) {
    case "agent-started": {
      if (state.currentSessionId && action.agent.sessionId !== state.currentSessionId) {
        return state;
      }
      const exists = state.agents.some((a) => a.id === action.agent.id);
      return {
        ...state,
        agents: exists
          ? state.agents.map((a) => (a.id === action.agent.id ? action.agent : a))
          : [action.agent, ...state.agents],
        sessionAgentTitles: mergeSessionAgentTitles(state, state.currentSessionId, [action.agent]),
      };
    }
    case "agent-step":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id !== action.agentId
            ? a
            : (() => {
                const existingIdx = a.steps.findIndex((s) => s.id === action.step.id);
                if (existingIdx >= 0) {
                  return {
                    ...a,
                    steps: a.steps.map((s, idx) => (idx === existingIdx ? action.step : s)),
                  };
                }
                return { ...a, steps: [...a.steps, action.step] };
              })(),
        ),
      };
    case "agent-completed":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId
            ? { ...a, status: "completed" as const, result: action.result, completedAt: Date.now() }
            : a,
        ),
      };
    case "agent-failed":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId
            ? { ...a, status: "failed" as const, result: action.error, completedAt: Date.now() }
            : a,
        ),
      };
    case "agent-archived":
    case "close-agent": {
      const sessionUI = getSessionAgentUI(state, state.currentSessionId);
      const nextOpenAgentIds = sessionUI.openAgentIds.filter((id) => id !== action.agentId);
      const nextSelectedAgentId = sessionUI.selectedAgentId === action.agentId
        ? getNextSelectedAgentId(sessionUI.openAgentIds, action.agentId)
        : sessionUI.selectedAgentId;

      return {
        ...state,
        agents: action.kind === "agent-archived"
          ? state.agents.filter((a) => a.id !== action.agentId)
          : state.agents,
        sessionAgentUI: setSessionAgentUI(state, state.currentSessionId, {
          selectedAgentId: nextSelectedAgentId,
          openAgentIds: nextOpenAgentIds,
        }),
        agentSelectionNonce: nextSelectedAgentId !== sessionUI.selectedAgentId
          ? state.agentSelectionNonce + 1
          : state.agentSelectionNonce,
      };
    }
    case "agent-titled":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId ? { ...a, task: action.title } : a,
        ),
        sessionAgentTitles: state.currentSessionId
          ? {
              ...state.sessionAgentTitles,
              [state.currentSessionId]: {
                ...(state.sessionAgentTitles[state.currentSessionId] ?? {}),
                [action.agentId]: action.title,
              },
            }
          : state.sessionAgentTitles,
      };
    case "select-agent": {
      const sessionUI = getSessionAgentUI(state, state.currentSessionId);
      return {
        ...state,
        sessionAgentUI: setSessionAgentUI(state, state.currentSessionId, {
          selectedAgentId: action.agentId,
          openAgentIds: action.agentId && !sessionUI.openAgentIds.includes(action.agentId)
            ? [...sessionUI.openAgentIds, action.agentId]
            : sessionUI.openAgentIds,
        }),
        agentSelectionNonce: state.agentSelectionNonce + 1,
      };
    }
    case "set-agent-steps":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId
            ? { ...a, steps: action.steps, ...(action.status ? { status: action.status } : {}) }
            : a,
        ),
      };
    case "load-agents": {
      const restoredSessionUI = getSessionAgentUI(state, action.sessionId);
      const isPlaceholderLoad = action.agents.length === 0;
      const validAgentIds = new Set(action.agents.map((agent) => agent.id));
      const nextOpenAgentIds = isPlaceholderLoad
        ? restoredSessionUI.openAgentIds
        : restoredSessionUI.openAgentIds.filter((agentId) => validAgentIds.has(agentId));
      const nextSelectedAgentId = isPlaceholderLoad
        ? restoredSessionUI.selectedAgentId
        : restoredSessionUI.selectedAgentId && validAgentIds.has(restoredSessionUI.selectedAgentId)
          ? restoredSessionUI.selectedAgentId
          : null;

      return {
        ...state,
        currentSessionId: action.sessionId,
        agents: action.agents,
        sessionAgentUI: setSessionAgentUI(state, action.sessionId, {
          selectedAgentId: nextSelectedAgentId,
          openAgentIds: nextOpenAgentIds,
        }),
        sessionAgentTitles: mergeSessionAgentTitles(state, action.sessionId, action.agents),
      };
    }
    case "reset":
      return { currentSessionId: null, agents: [], sessionAgentUI: {}, sessionAgentTitles: {}, agentSelectionNonce: 0 };
  }
}

const initialState: AgentsState = {
  currentSessionId: null,
  agents: [],
  sessionAgentUI: {},
  sessionAgentTitles: {},
  agentSelectionNonce: 0,
};

export function useAgents() {
  const [state, dispatch] = useReducer(agentsReducer, initialState);

  useEffect(() => {
    const api = window.electronAPI;
    const cleanups = [
      api.onAgentStarted((agent) => dispatch({ kind: "agent-started", agent })),
      api.onAgentStep((agentId, step) => dispatch({ kind: "agent-step", agentId, step })),
      api.onAgentCompleted((agentId, result) => dispatch({ kind: "agent-completed", agentId, result })),
      api.onAgentFailed((agentId, error) => dispatch({ kind: "agent-failed", agentId, error })),
      api.onAgentArchived((agentId) => dispatch({ kind: "agent-archived", agentId })),
      api.onAgentTitleGenerated((agentId, title) => dispatch({ kind: "agent-titled", agentId, title })),
    ];

    return () => cleanups.forEach((fn) => fn());
  }, []);

  const selectAgent = (agentId: string | null) => {
    dispatch({ kind: "select-agent", agentId });
  };

  const closeAgent = (agentId: string) => {
    dispatch({ kind: "close-agent", agentId });
  };

  const seedAgents = (sessionId: string | null, agents: Agent[]) => {
    dispatch({ kind: "load-agents", sessionId, agents });
  };

  const setAgentSteps = (agentId: string, steps: AgentStep[], status?: Agent["status"]) => {
    dispatch({ kind: "set-agent-steps", agentId, steps, status });
  };

  const currentSessionUI = getSessionAgentUI(state, state.currentSessionId);
  const currentSessionAgentTitles = state.currentSessionId
    ? (state.sessionAgentTitles[state.currentSessionId] ?? {})
    : {};
  const selectedAgent = currentSessionUI.selectedAgentId
    ? state.agents.find((a) => a.id === currentSessionUI.selectedAgentId) ?? null
    : null;

  return {
    agents: state.agents,
    selectedAgentId: currentSessionUI.selectedAgentId,
    selectedAgent,
    openAgentIds: currentSessionUI.openAgentIds,
    agentTabTitles: currentSessionAgentTitles,
    agentSelectionNonce: state.agentSelectionNonce,
    selectAgent,
    closeAgent,
    seedAgents,
    setAgentSteps,
  };
}
