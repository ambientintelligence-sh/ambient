import { create } from "zustand";
import type {
  ProviderKind,
  ProviderTaskEntry,
  ProviderTaskEvent,
  ProviderTaskStatus,
} from "@core/types";

export type ProviderTaskRecord = {
  taskId: string;
  provider: ProviderKind;
  toolCallId?: string;
  agentId?: string;
  status: ProviderTaskStatus;
  prompt?: string;
  cwd?: string;
  threadId?: string;
  entries: ProviderTaskEntry[];
  summary?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
};

type ProviderTaskState = {
  tasks: Record<string, ProviderTaskRecord>;
  tasksByToolCallId: Record<string, string>;
  initialized: boolean;
};

type ProviderTaskActions = {
  init: () => void;
  applyEvent: (event: ProviderTaskEvent) => void;
  cancel: (taskId: string) => Promise<void>;
};

type Store = ProviderTaskState & ProviderTaskActions;

let unsubscribe: (() => void) | null = null;

export const useProviderTaskStore = create<Store>((set, get) => ({
  tasks: {},
  tasksByToolCallId: {},
  initialized: false,

  init: () => {
    if (get().initialized) return;
    set({ initialized: true });
    if (typeof window === "undefined" || !window.electronAPI) return;
    unsubscribe?.();
    unsubscribe = window.electronAPI.onProviderTaskEvent((event) => {
      get().applyEvent(event);
    });
  },

  applyEvent: (event: ProviderTaskEvent) => {
    const existing = get().tasks[event.taskId];

    if (event.kind === "started") {
      const record: ProviderTaskRecord = {
        taskId: event.taskId,
        provider: event.provider,
        toolCallId: event.toolCallId,
        agentId: event.agentId,
        status: "running",
        prompt: event.prompt,
        cwd: event.cwd,
        threadId: event.threadId,
        entries: existing?.entries ?? [],
        startedAt: event.at,
      };
      set((state) => ({
        tasks: { ...state.tasks, [event.taskId]: record },
        tasksByToolCallId: event.toolCallId
          ? { ...state.tasksByToolCallId, [event.toolCallId]: event.taskId }
          : state.tasksByToolCallId,
      }));
      return;
    }

    if (!existing) {
      // We may receive progress/completed without a prior started event
      // (e.g. if the viewer mounted after the start). Synthesize a minimal record.
      const synth: ProviderTaskRecord = {
        taskId: event.taskId,
        provider: event.provider,
        toolCallId: event.toolCallId,
        agentId: event.agentId,
        status: event.kind === "progress" ? "running" : (event.kind as ProviderTaskStatus),
        entries: [],
        startedAt: event.at,
      };
      set((state) => ({
        tasks: { ...state.tasks, [event.taskId]: synth },
        tasksByToolCallId: event.toolCallId
          ? { ...state.tasksByToolCallId, [event.toolCallId]: event.taskId }
          : state.tasksByToolCallId,
      }));
    }

    if (event.kind === "progress") {
      set((state) => {
        const current = state.tasks[event.taskId];
        if (!current) return state;
        return {
          tasks: {
            ...state.tasks,
            [event.taskId]: {
              ...current,
              entries: [...current.entries, event.entry],
            },
          },
        };
      });
      return;
    }

    if (event.kind === "completed") {
      set((state) => {
        const current = state.tasks[event.taskId];
        if (!current) return state;
        return {
          tasks: {
            ...state.tasks,
            [event.taskId]: {
              ...current,
              status: "completed",
              summary: event.summary,
              threadId: event.threadId ?? current.threadId,
              endedAt: event.at,
            },
          },
        };
      });
      return;
    }

    if (event.kind === "failed") {
      set((state) => {
        const current = state.tasks[event.taskId];
        if (!current) return state;
        return {
          tasks: {
            ...state.tasks,
            [event.taskId]: {
              ...current,
              status: "failed",
              error: event.error,
              endedAt: event.at,
            },
          },
        };
      });
      return;
    }

    if (event.kind === "cancelled") {
      set((state) => {
        const current = state.tasks[event.taskId];
        if (!current) return state;
        return {
          tasks: {
            ...state.tasks,
            [event.taskId]: {
              ...current,
              status: "cancelled",
              endedAt: event.at,
            },
          },
        };
      });
      return;
    }
  },

  cancel: async (taskId: string) => {
    const task = get().tasks[taskId];
    if (!task) return;
    await window.electronAPI.cancelProviderTask(taskId, task.provider);
  },
}));

export function useProviderTaskByToolCallId(toolCallId: string | undefined): ProviderTaskRecord | null {
  return useProviderTaskStore((state) => {
    if (!toolCallId) return null;
    const taskId = state.tasksByToolCallId[toolCallId];
    if (!taskId) return null;
    return state.tasks[taskId] ?? null;
  });
}
