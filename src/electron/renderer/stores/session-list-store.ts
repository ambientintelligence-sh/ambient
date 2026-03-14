import { create } from "zustand";
import type { SessionMeta } from "@core/types";

type SessionListState = {
  sessions: SessionMeta[];
  selectedSessionId: string | null;
  resumeSessionId: string | null;
  sessionActive: boolean;
  sessionRestartKey: number;
};

type SessionListActions = {
  setSessions: (sessions: SessionMeta[]) => void;
  updateSessions: (updater: (prev: SessionMeta[]) => SessionMeta[]) => void;
  setSelectedSessionId: (id: string | null) => void;
  setResumeSessionId: (id: string | null) => void;
  setSessionActive: (active: boolean) => void;
  bumpSessionRestartKey: () => void;
  resetForNewSession: () => void;
};

export const useSessionListStore = create<SessionListState & SessionListActions>()((set) => ({
  // State
  sessions: [],
  selectedSessionId: null,
  resumeSessionId: null,
  sessionActive: false,
  sessionRestartKey: 0,

  // Actions
  setSessions: (sessions) => set({ sessions }),
  updateSessions: (updater) => set((s) => ({ sessions: updater(s.sessions) })),
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setResumeSessionId: (id) => set({ resumeSessionId: id }),
  setSessionActive: (active) => set({ sessionActive: active }),
  bumpSessionRestartKey: () => set((s) => ({ sessionRestartKey: s.sessionRestartKey + 1 })),
  resetForNewSession: () =>
    set({
      selectedSessionId: null,
      resumeSessionId: null,
    }),
}));
