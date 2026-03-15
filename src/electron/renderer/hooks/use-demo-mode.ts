import { useCallback, useEffect, useRef } from "react";
import { useUIStore } from "../stores/ui-store";
import { useTaskStore } from "../stores/task-store";
import type { TaskSuggestion } from "@core/types";

// Hardcoded to avoid importing seed-demo.ts (which pulls in node:crypto + better-sqlite3)
const TRIP_SESSION_ID = "demo-trip-session";
const BRAIN_SESSION_ID = "demo-brain-session";
const STUDY_SESSION_ID = "demo-study-session";
const MEETING_SESSION_ID = "demo-meeting-session";

const DEFAULT_STEP_MS = 3000;

type DemoStep = {
  action: () => void | Promise<void>;
  durationMs?: number;
};

type DemoContext = {
  loadSession: (id: string) => Promise<void>;
  scrollTranscript: (pct: number) => void;
  selectAgent: (id: string | null) => void;
  forceWorkTab: () => void;
  loadSummary: (sessionId: string) => void;
  injectSuggestions: (sessionId: string) => void;
};

const SESSION_ORDER = [
  TRIP_SESSION_ID,
  BRAIN_SESSION_ID,
  STUDY_SESSION_ID,
  MEETING_SESSION_ID,
];

function buildSuggestionsForSession(sessionId: string, now: number): TaskSuggestion[] {
  switch (sessionId) {
    case TRIP_SESSION_ID:
      return [
        {
          id: "demo-sug-trip-1",
          text: "Want me to research travel insurance options for a 10-day Japan trip?",
          kind: "research",
          details: "Nobody discussed travel insurance — important for international trips.",
          sessionId,
          createdAt: now,
        },
        {
          id: "demo-sug-trip-2",
          text: "I can look into luggage forwarding services (Yamato Transport) for city-to-city transit.",
          kind: "action",
          details: "Moving luggage between Tokyo, Hakone, and Kyoto wasn't addressed.",
          sessionId,
          createdAt: now,
        },
        {
          id: "demo-sug-trip-3",
          text: "ANA sale ends Tuesday — should everyone book flights now before prices increase?",
          kind: "flag",
          sessionId,
          createdAt: now,
        },
      ];

    case BRAIN_SESSION_ID:
      return [
        {
          id: "demo-sug-brain-1",
          text: "Want me to check domain availability for mise.app and supper.app?",
          kind: "action",
          details: "Team narrowed to two name candidates but didn't check availability.",
          sessionId,
          createdAt: now,
        },
        {
          id: "demo-sug-brain-2",
          text: "I can research GDPR implications of storing user fridge photos — privacy is a potential concern.",
          kind: "research",
          details: "No discussion of data privacy for the photo-based ingredient detection.",
          sessionId,
          createdAt: now,
        },
        {
          id: "demo-sug-brain-3",
          text: "The 6-week MVP timeline seems tight with LLM integration. Flag for scope review?",
          kind: "flag",
          sessionId,
          createdAt: now,
        },
      ];

    case STUDY_SESSION_ID:
      return [
        {
          id: "demo-sug-study-1",
          text: "Want me to create a comparison of linearizability vs sequential consistency with examples?",
          kind: "research",
          details: "This distinction came up but wasn't fully clarified.",
          sessionId,
          createdAt: now,
        },
        {
          id: "demo-sug-study-2",
          text: "Professor hinted BFT will be on the exam — should I draft practice questions on 3f+1 proofs?",
          kind: "action",
          details: "Byzantine fault tolerance was flagged as exam-critical.",
          sessionId,
          createdAt: now,
        },
        {
          id: "demo-sug-study-3",
          text: "The gossip protocol section was rushed. Want me to summarize convergence properties?",
          kind: "followup",
          sessionId,
          createdAt: now,
        },
      ];

    case MEETING_SESSION_ID:
      return [
        {
          id: "demo-sug-meeting-1",
          text: "Want me to research Datadog vs Grafana Cloud pricing for your infrastructure size?",
          kind: "research",
          details: "Team discussed monitoring tools but didn't compare pricing.",
          transcriptExcerpt: "We should look at Datadog pricing tiers...",
          sessionId,
          createdAt: now,
        },
        {
          id: "demo-sug-meeting-2",
          text: "I noticed an action item: draft the webhook processor postmortem. Want me to start it?",
          kind: "action",
          details: "Marcus mentioned Friday's outage needs a postmortem.",
          sessionId,
          createdAt: now,
        },
        {
          id: "demo-sug-meeting-3",
          text: "The team agreed on 20% tech debt allocation but didn't define which items. Flag for follow-up?",
          kind: "flag",
          sessionId,
          createdAt: now,
        },
      ];

    default:
      return [];
  }
}

function buildSessionSteps(sessionId: string, ctx: DemoContext): DemoStep[] {
  switch (sessionId) {
    case TRIP_SESSION_ID:
      return [
        { action: () => ctx.loadSession(TRIP_SESSION_ID) },
        { action: () => ctx.scrollTranscript(0.3) },
        { action: () => ctx.scrollTranscript(0.6) },
        { action: () => { ctx.injectSuggestions(TRIP_SESSION_ID); ctx.forceWorkTab(); } },
        { action: () => ctx.selectAgent("demo-agent-itinerary") },
        { action: () => ctx.selectAgent("demo-agent-flights") },
        { action: () => ctx.selectAgent("demo-agent-ryokan") },
        { action: () => ctx.selectAgent("demo-agent-visa") },
        { action: () => ctx.loadSummary(TRIP_SESSION_ID) },
        { action: () => {} }, // hold on summary
      ];

    case BRAIN_SESSION_ID:
      return [
        { action: () => ctx.loadSession(BRAIN_SESSION_ID) },
        { action: () => ctx.scrollTranscript(0.4) },
        { action: () => ctx.scrollTranscript(0.8) },
        { action: () => { ctx.injectSuggestions(BRAIN_SESSION_ID); ctx.forceWorkTab(); } },
        { action: () => ctx.selectAgent("demo-agent-competitive") },
        { action: () => ctx.selectAgent("demo-agent-mvp-spec") },
        { action: () => ctx.selectAgent("demo-agent-domains") },
        { action: () => ctx.selectAgent("demo-agent-interview-guide") },
        { action: () => ctx.loadSummary(BRAIN_SESSION_ID) },
        { action: () => {} }, // hold on summary
      ];

    case STUDY_SESSION_ID:
      return [
        { action: () => ctx.loadSession(STUDY_SESSION_ID) },
        { action: () => ctx.scrollTranscript(0.5) },
        { action: () => { ctx.injectSuggestions(STUDY_SESSION_ID); ctx.forceWorkTab(); } },
        { action: () => ctx.selectAgent("demo-agent-study-guide") },
        { action: () => ctx.selectAgent("demo-agent-bft-review") },
        { action: () => ctx.selectAgent("demo-agent-uncommitted") },
        { action: () => ctx.selectAgent("demo-agent-practice") },
        { action: () => ctx.loadSummary(STUDY_SESSION_ID) },
        { action: () => {} }, // hold on summary
      ];

    case MEETING_SESSION_ID:
      return [
        { action: () => ctx.loadSession(MEETING_SESSION_ID) },
        { action: () => ctx.scrollTranscript(0.5) },
        { action: () => { ctx.injectSuggestions(MEETING_SESSION_ID); ctx.forceWorkTab(); } },
        { action: () => {} }, // hold on suggestions + tasks
        { action: () => ctx.selectAgent("demo-agent-matviews") },
        { action: () => ctx.selectAgent("demo-agent-postmortem") },
        { action: () => ctx.selectAgent("demo-agent-monitoring") },
        { action: () => ctx.selectAgent("demo-agent-migration") },
        { action: () => ctx.loadSummary(MEETING_SESSION_ID) },
        { action: () => {} }, // hold on summary
      ];

    default:
      return [];
  }
}

type UseDemoModeOptions = {
  loadDemoSession: (sessionId: string) => Promise<void>;
  transcriptRef: React.RefObject<HTMLDivElement | null>;
  selectAgent: (id: string | null) => void;
  selectedSessionId: string | null;
};

export function useDemoMode({
  loadDemoSession,
  transcriptRef,
  selectAgent,
  selectedSessionId,
}: UseDemoModeOptions) {
  const demoMode = useUIStore((s) => s.demoMode);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepIndexRef = useRef(0);
  const sessionIndexRef = useRef(0);
  const stepsRef = useRef<DemoStep[]>([]);

  const loadDemoSessionRef = useRef(loadDemoSession);
  loadDemoSessionRef.current = loadDemoSession;
  const selectAgentRef = useRef(selectAgent);
  selectAgentRef.current = selectAgent;
  const transcriptRefRef = useRef(transcriptRef);
  transcriptRefRef.current = transcriptRef;
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;

  const ui = useUIStore.getState;
  const ts = useTaskStore.getState;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const ctxRef = useRef<DemoContext>(null!);
  ctxRef.current = {
    loadSession: async (id: string) => {
      selectAgentRef.current(null);
      ui().setFinalSummaryState({ kind: "idle" });
      await loadDemoSessionRef.current(id);
      const el = transcriptRefRef.current.current;
      if (el) el.scrollTop = 0;
    },
    scrollTranscript: (pct: number) => {
      const el = transcriptRefRef.current.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight * pct, behavior: "smooth" });
    },
    selectAgent: (id: string | null) => {
      selectAgentRef.current(id);
    },
    forceWorkTab: () => {
      // Deselect agent so sidebar doesn't auto-switch to agents tab,
      // then bump forceWorkTabKey to trigger work tab via existing logic
      selectAgentRef.current(null);
      ts().bumpForceWorkTabKey();
    },
    loadSummary: (sessionId: string) => {
      selectAgentRef.current(null);
      void window.electronAPI.getFinalSummary(sessionId).then((result) => {
        if (result.ok && result.summary) {
          ui().setFinalSummaryState({ kind: "ready", summary: result.summary });
        }
      });
    },
    injectSuggestions: (sessionId: string) => {
      const now = Date.now();
      ts().setSuggestions([]);
      const suggestions = buildSuggestionsForSession(sessionId, now);
      ts().appendSuggestions(suggestions);
    },
  };

  const runNextStep = useCallback(() => {
    const steps = stepsRef.current;
    const idx = stepIndexRef.current;
    if (idx >= steps.length) return;

    const step = steps[idx];
    const result = step.action();
    stepIndexRef.current = idx + 1;

    if (stepIndexRef.current < steps.length) {
      const delay = step.durationMs ?? DEFAULT_STEP_MS;
      timerRef.current = setTimeout(runNextStep, delay);
    }
    void result;
  }, []);

  const startSession = useCallback((sessionIndex: number) => {
    clearTimer();
    sessionIndexRef.current = sessionIndex;
    const sessionId = SESSION_ORDER[sessionIndex];
    if (!sessionId) return;

    stepsRef.current = buildSessionSteps(sessionId, ctxRef.current);
    stepIndexRef.current = 0;
    runNextStep();
  }, [clearTimer, runNextStep]);

  const startDemo = useCallback(() => {
    ui().setDemoMode(true);
    ui().markOnboardingCompleted();
    const currentId = selectedSessionIdRef.current;
    const idx = currentId ? SESSION_ORDER.indexOf(currentId) : 0;
    startSession(idx >= 0 ? idx : 0);
  }, [startSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextSession = useCallback(() => {
    if (!useUIStore.getState().demoMode) return;
    const next = (sessionIndexRef.current + 1) % SESSION_ORDER.length;
    startSession(next);
  }, [startSession]);

  const stopDemo = useCallback(() => {
    clearTimer();
    ui().setDemoMode(false);
  }, [clearTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        if (useUIStore.getState().demoMode) {
          stopDemo();
        } else {
          startDemo();
        }
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key === "N") {
        e.preventDefault();
        nextSession();
        return;
      }
      if (e.key === "Escape" && useUIStore.getState().demoMode) {
        e.preventDefault();
        stopDemo();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [startDemo, stopDemo, nextSession]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return { demoMode, startDemo, nextSession, stopDemo };
}
