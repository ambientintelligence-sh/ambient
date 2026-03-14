import { useEffect, useReducer } from "react";
import type { Agent, AgentStep } from "@core/types";

type AgentsState = {
  agents: Agent[];
  selectedAgentId: string | null;
  openAgentIds: string[];
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
  | { kind: "load-agents"; agents: Agent[] }
  | { kind: "reset" };

function getNextSelectedAgentId(openAgentIds: string[], closedAgentId: string): string | null {
  const currentIndex = openAgentIds.indexOf(closedAgentId);
  if (currentIndex < 0) return openAgentIds.at(-1) ?? null;
  return openAgentIds[currentIndex + 1] ?? openAgentIds[currentIndex - 1] ?? null;
}

function agentsReducer(state: AgentsState, action: AgentsAction): AgentsState {
  switch (action.kind) {
    case "agent-started": {
      const exists = state.agents.some((a) => a.id === action.agent.id);
      return {
        ...state,
        agents: exists
          ? state.agents.map((a) => a.id === action.agent.id ? action.agent : a)
          : [action.agent, ...state.agents],
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
              })()
        ),
      };
    case "agent-completed":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId
            ? { ...a, status: "completed" as const, result: action.result, completedAt: Date.now() }
            : a
        ),
      };
    case "agent-failed":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId
            ? { ...a, status: "failed" as const, result: action.error, completedAt: Date.now() }
            : a
        ),
      };
    case "agent-archived":
    case "close-agent": {
      const nextOpenAgentIds = state.openAgentIds.filter((id) => id !== action.agentId);
      const nextSelectedAgentId = state.selectedAgentId === action.agentId
        ? getNextSelectedAgentId(state.openAgentIds, action.agentId)
        : state.selectedAgentId;
      return {
        agents: action.kind === "agent-archived"
          ? state.agents.filter((a) => a.id !== action.agentId)
          : state.agents,
        selectedAgentId: nextSelectedAgentId,
        openAgentIds: nextOpenAgentIds,
        agentSelectionNonce: nextSelectedAgentId !== state.selectedAgentId
          ? state.agentSelectionNonce + 1
          : state.agentSelectionNonce,
      };
    }
    case "agent-titled":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId ? { ...a, task: action.title } : a
        ),
      };
    case "select-agent":
      return {
        ...state,
        selectedAgentId: action.agentId,
        openAgentIds: action.agentId && !state.openAgentIds.includes(action.agentId)
          ? [...state.openAgentIds, action.agentId]
          : state.openAgentIds,
        agentSelectionNonce: state.agentSelectionNonce + 1,
      };
    case "load-agents":
      return {
        agents: action.agents,
        selectedAgentId: null,
        openAgentIds: [],
        agentSelectionNonce: state.agentSelectionNonce,
      };
    case "reset":
      return { agents: [], selectedAgentId: null, openAgentIds: [], agentSelectionNonce: 0 };
  }
}

const initialState: AgentsState = {
  agents: [],
  selectedAgentId: null,
  openAgentIds: [],
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

  const seedAgents = (agents: Agent[]) => {
    dispatch({ kind: "load-agents", agents });
  };

  const selectedAgent = state.selectedAgentId
    ? state.agents.find((a) => a.id === state.selectedAgentId) ?? null
    : null;

  return {
    agents: state.agents,
    selectedAgentId: state.selectedAgentId,
    selectedAgent,
    openAgentIds: state.openAgentIds,
    agentSelectionNonce: state.agentSelectionNonce,
    selectAgent,
    closeAgent,
    seedAgents,
  };
}
