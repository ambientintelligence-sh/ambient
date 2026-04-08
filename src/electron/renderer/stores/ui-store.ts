import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UpdateInfo } from "@core/update-checker";
import type { SummaryModalState } from "../components/session-summary-modal";

type OnboardingPhase = "settings" | "tour" | "done";

type UIState = {
  splashDone: boolean;
  settingsOpen: boolean;
  langError: string;
  routeNotice: string;
  newAgentMode: boolean;
  onboardingPhase: OnboardingPhase;
  onboardingCompleted: boolean;
  tourStep: number;
  finalSummaryState: SummaryModalState;
  demoMode: boolean;
  updateAvailable: UpdateInfo | null;
  updateDismissed: boolean;
};

type UIActions = {
  setSplashDone: (done: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSettings: () => void;
  setLangError: (error: string) => void;
  setRouteNotice: (notice: string) => void;
  setNewAgentMode: (mode: boolean) => void;
  setOnboardingPhase: (phase: OnboardingPhase) => void;
  markOnboardingCompleted: () => void;
  setTourStep: (step: number) => void;
  advanceTourStep: () => void;
  setFinalSummaryState: (state: SummaryModalState) => void;
  updateFinalSummary: (updater: (prev: SummaryModalState) => SummaryModalState) => void;
  setDemoMode: (v: boolean) => void;
  setUpdateAvailable: (info: UpdateInfo | null) => void;
  dismissUpdate: () => void;
};

export const useUIStore = create<UIState & UIActions>()(
  persist(
    (set) => ({
      // State
      splashDone: false,
      settingsOpen: false,
      langError: "",
      routeNotice: "",
      newAgentMode: false,
      onboardingPhase: "done" as OnboardingPhase,
      onboardingCompleted: false,
      tourStep: 0,
      finalSummaryState: { kind: "idle" } as SummaryModalState,
      demoMode: false,
      updateAvailable: null,
      updateDismissed: false,

      // Actions
      setSplashDone: (done) => set({ splashDone: done }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
      setLangError: (error) => set({ langError: error }),
      setRouteNotice: (notice) => set({ routeNotice: notice }),
      setNewAgentMode: (mode) => set({ newAgentMode: mode }),
      setOnboardingPhase: (phase) => set({ onboardingPhase: phase, ...(phase === "tour" ? { tourStep: 0 } : {}) }),
      markOnboardingCompleted: () => set({ onboardingPhase: "done", onboardingCompleted: true, tourStep: 0 }),
      setTourStep: (step) => set({ tourStep: step }),
      advanceTourStep: () => set((s) => ({ tourStep: s.tourStep + 1 })),
      setFinalSummaryState: (state) => set({ finalSummaryState: state }),
      updateFinalSummary: (updater) =>
        set((s) => ({ finalSummaryState: updater(s.finalSummaryState) })),
      setDemoMode: (v) => set({ demoMode: v }),
      setUpdateAvailable: (info) => set({ updateAvailable: info, updateDismissed: false }),
      dismissUpdate: () => set({ updateDismissed: true }),
    }),
    {
      name: "ambient-ui-store",
      partialize: (state) => ({ onboardingCompleted: state.onboardingCompleted }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<UIState>;
        // Migrate from legacy useLocalStorage key
        if (stored.onboardingCompleted === undefined) {
          try {
            const legacy = localStorage.getItem("ambient-onboarding-completed");
            if (legacy !== null) {
              stored.onboardingCompleted = JSON.parse(legacy) === true;
            }
          } catch { /* ignore */ }
        }
        return { ...current, ...stored };
      },
    },
  ),
);
