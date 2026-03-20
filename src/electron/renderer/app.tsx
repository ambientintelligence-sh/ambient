import { useState, useEffect, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import type {
  Agent,
  AppConfig,
  Language,
  LanguageCode,
  TaskItem,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  AgentPlanApprovalResponse,
} from "@core/types";
import { DEFAULT_APP_CONFIG, normalizeAppConfig } from "@core/types";
import type { SkillMetadata } from "@core/agents/skills";
import { useSession } from "./hooks/use-session";
import type { ResumeData } from "./hooks/use-session";
import { useMicCapture } from "./hooks/use-mic-capture";
import { useAgents } from "./hooks/use-agents";
import { useKeyboard } from "./hooks/use-keyboard";
import { useThemeMode } from "./hooks/use-theme-mode";
import { useAppBootstrap } from "./hooks/use-app-bootstrap";
import { buildSessionPath, parseSessionRoute, pushSessionPath, replaceSessionPath } from "./lib/session-route";
import { ToolbarHeader } from "./components/toolbar-header";
import { TranscriptArea } from "./components/transcript-area";
import { LeftSidebar } from "./components/left-sidebar";
import { RightSidebar } from "./components/right-sidebar";
import { AgentDetailPanel } from "./components/agent-detail-panel";
import { NewAgentPanel } from "./components/new-agent-panel";
import { MiddlePanelTabs } from "./components/middle-panel-tabs";
import { Footer } from "./components/footer";
import { SettingsPage } from "./components/settings-page";
import { SplashScreen } from "./components/splash-screen";
import { OnboardingOverlay } from "./components/onboarding-overlay";
import { SessionSummaryPanel } from "./components/session-summary-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIntegrationStore } from "./stores/integration-store";
import { useUIStore } from "./stores/ui-store";
import { useTaskStore } from "./stores/task-store";
import { useSessionListStore } from "./stores/session-list-store";

type ResizeHandle = "left" | "right";

const MIN_TRANSCRIPT_WIDTH = 360;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 240;
const RIGHT_PANEL_MAX_WIDTH = 560;

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function joinTaskDetails(...sections: Array<string | undefined>): string | undefined {
  const normalized = sections
    .map((section) => section?.trim() ?? "")
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join("\n\n") : undefined;
}

function normalizeAgentTaskTitle(text: string): string {
  const collapsed = text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[-*0-9.)\s]+/, "")
    .replace(/[.!?]+$/g, "");
  if (!collapsed) return "";

  const splitOnMultiStep = collapsed.split(/\s(?:and|then|while)\s/i);
  const primaryStep = splitOnMultiStep[0]?.trim() || collapsed;
  if (primaryStep.length <= 110) return primaryStep;

  const clipped = primaryStep.slice(0, 110);
  const boundary = clipped.lastIndexOf(" ");
  return (boundary > 50 ? clipped.slice(0, boundary) : clipped).trim();
}

export function App() {
  // --- Language & Config (local to app, used by session hook) ---
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceLang, setSourceLang] = useLocalStorage<LanguageCode>("ambient-source-lang", "ko");
  const [targetLang, setTargetLang] = useLocalStorage<LanguageCode>("ambient-translate-to-lang", "en");
  const [translateToSelection, setTranslateToSelection] = useLocalStorage<LanguageCode | "off">("ambient-translate-to-selection", "en");
  const [armedMicInput, setArmedMicInput] = useLocalStorage<boolean>("ambient-armed-mic-input", true);
  const [armedDeviceAudio, setArmedDeviceAudio] = useLocalStorage<boolean>("ambient-armed-device-audio", true);
  const [storedAppConfig, setStoredAppConfig] = useLocalStorage<AppConfig>("ambient-app-config", DEFAULT_APP_CONFIG);
  const appConfig = normalizeAppConfig(storedAppConfig);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const panelLayoutRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{
    handle: ResizeHandle;
    startX: number;
    startLeft: number;
    startRight: number;
  } | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useLocalStorage<number>("ambient-left-panel-width", 280);
  const [rightPanelWidth, setRightPanelWidth] = useLocalStorage<number>("ambient-right-panel-width", 300);
  const pendingNewSessionRouteRef = useRef(false);
  const pendingCaptureStartRef = useRef<{ mic: boolean; deviceAudio: boolean } | null>(null);

  useEffect(() => {
    const hasStoredSelection = localStorage.getItem("ambient-translate-to-selection") !== null;
    if (hasStoredSelection) return;
    const legacyTarget =
      localStorage.getItem("ambient-translate-to-lang") ??
      localStorage.getItem("ambient-target-lang");
    if (legacyTarget) {
      setTranslateToSelection(legacyTarget as LanguageCode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Zustand stores (select state reactively, access actions via getState) ---
  const splashDone = useUIStore((s) => s.splashDone);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const langError = useUIStore((s) => s.langError);
  const routeNotice = useUIStore((s) => s.routeNotice);
  const newAgentMode = useUIStore((s) => s.newAgentMode);
  const onboardingPhase = useUIStore((s) => s.onboardingPhase);
  const onboardingCompleted = useUIStore((s) => s.onboardingCompleted);
  const tourStep = useUIStore((s) => s.tourStep);
  const finalSummaryState = useUIStore((s) => s.finalSummaryState);

  const tasks = useTaskStore((s) => s.tasks);
  const suggestions = useTaskStore((s) => s.suggestions);
  const archivedSuggestions = useTaskStore((s) => s.archivedSuggestions);
  const processingTaskIds = useTaskStore((s) => s.processingTaskIds);
  const pendingApprovalTask = useTaskStore((s) => s.pendingApprovalTask);
  const approvingLargeTask = useTaskStore((s) => s.approvingLargeTask);
  const forceWorkTabKey = useTaskStore((s) => s.forceWorkTabKey);
  const transcriptRefs = useTaskStore((s) => s.transcriptRefs);

  const sessions = useSessionListStore((s) => s.sessions);
  const selectedSessionId = useSessionListStore((s) => s.selectedSessionId);
  const resumeSessionId = useSessionListStore((s) => s.resumeSessionId);
  const sessionActive = useSessionListStore((s) => s.sessionActive);
  const sessionRestartKey = useSessionListStore((s) => s.sessionRestartKey);

  const integrationActiveProjectId = useIntegrationStore((s) => s.activeProjectId);
  const integrationMcpIntegrations = useIntegrationStore((s) => s.mcpIntegrations);
  const integrationMcpBusy = useIntegrationStore((s) => s.mcpBusy);
  const integrationCustomMcpServers = useIntegrationStore((s) => s.customMcpServers);
  const integrationMcpToolsByProvider = useIntegrationStore((s) => s.mcpToolsByProvider);
  const integrationApiKeyDefinitions = useIntegrationStore((s) => s.apiKeyDefinitions);
  const integrationApiKeyStatus = useIntegrationStore((s) => s.apiKeyStatus);
  const integrationProjects = useIntegrationStore((s) => s.projects);
  const ig = useIntegrationStore.getState;

  // Stable action accessors — Zustand getState() is always the same function reference,
  // so callbacks that call ui().setSplashDone(...) don't need the store in their dep arrays.
  const ui = useUIStore.getState;
  const ts = useTaskStore.getState;
  const sl = useSessionListStore.getState;

  const onboardingPhaseRef = useRef(onboardingPhase);
  onboardingPhaseRef.current = onboardingPhase;

  const existingTaskTexts = new Set(tasks.map((t) => t.text));

  // --- Skills ---
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  useEffect(() => {
    window.electronAPI.discoverSkills().then(setSkills).catch(() => {});
  }, []);

  // --- Bootstrap ---
  const { refreshSessions, sessionsRef } = useAppBootstrap({
    setSessions: useSessionListStore.getState().setSessions,
    setSourceLang,
    setTargetLang,
  });

  const micCapture = useMicCapture();
  const micCaptureRef = useRef(micCapture);
  micCaptureRef.current = micCapture;
  const {
    agents,
    selectedAgentId,
    selectedAgent,
    openAgentIds,
    agentTabTitles,
    agentSelectionNonce,
    selectAgent: _selectAgent,
    closeAgent,
    seedAgents,
  } = useAgents();

  const selectAgent = (id: string | null) => {
    ui().setNewAgentMode(false);
    _selectAgent(id);
  };

  const applyTargetLang = (lang: LanguageCode) => {
    setTargetLang(lang);
    setTranslateToSelection(lang);
  };

  const handleSourceLangChange = async (lang: LanguageCode) => {
    setSourceLang(lang);
    ui().setLangError("");
    if (session.sessionId) {
      await window.electronAPI.setSourceLanguage(lang);
    }
  };

  // --- Session hook ---
  const handleResumed = (data: ResumeData) => {
    sl().setSelectedSessionId(data.sessionId);
    ts().setTasks(data.tasks);
    ts().setProcessingTaskIds([]);
    seedAgents(data.sessionId, data.agents);
    ui().setFinalSummaryState({ kind: "idle" });
    void window.electronAPI.getArchivedTasks(data.sessionId).then(ts().setArchivedSuggestions);
    void refreshSessions();
    void window.electronAPI.getFinalSummary(data.sessionId).then((result) => {
      if (result.ok && result.summary) {
        ui().setFinalSummaryState({ kind: "ready", summary: result.summary });
      }
    });
  };

  const session = useSession(
    sourceLang,
    targetLang,
    sessionActive,
    appConfig,
    resumeSessionId,
    { onResumed: handleResumed, projectId: integrationActiveProjectId },
    sessionRestartKey,
    translateToSelection !== "off",
  );
  const isDeviceAudioActive =
    session.uiState?.status === "recording" || session.uiState?.status === "connecting";
  const isMicActive = session.uiState?.micEnabled ?? false;
  const isCaptureActive = isDeviceAudioActive || isMicActive;

  // Auto-start mic when a new session starts
  useEffect(() => {
    if (!session.micAutoStartPending) return;
    session.clearMicAutoStart();
    void (async () => {
      const result = await window.electronAPI.toggleMic();
      if (result.ok && result.captureInRenderer) {
        await micCaptureRef.current.start();
      }
    })();
  }, [session.micAutoStartPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Init stores ---
  useEffect(() => {
    void ig().init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.electronAPI.getLanguages().then(setLanguages);
  }, []);

  // --- IPC event subscriptions (replaces useSessionEventStream) ---
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onTaskSuggested((suggestion) => {
        useTaskStore.getState().appendSuggestion(suggestion);
      }),
      window.electronAPI.onFinalSummaryReady((summary) => {
        useUIStore.getState().setFinalSummaryState({ kind: "ready", summary });
      }),
      window.electronAPI.onFinalSummaryError((error) => {
        useUIStore.getState().setFinalSummaryState({ kind: "error", message: error });
      }),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  // --- Routing ---
  const applyRoutePathRef = useRef<(routeInput: string, availableSessions: import("@core/types").SessionMeta[]) => void>(null!);
  const refreshSessionsRef = useRef(refreshSessions);
  refreshSessionsRef.current = refreshSessions;

  applyRoutePathRef.current = (routeInput: string, availableSessions: import("@core/types").SessionMeta[]) => {
    const parsed = parseSessionRoute(routeInput);
    if (window.location.hash !== `#${parsed.normalizedPath}`) {
      replaceSessionPath(parsed.sessionId);
    }

    if (!parsed.sessionId) {
      ui().setRouteNotice(parsed.valid ? "" : "Unknown route. Showing empty state.");
      micCapture.stop();
      sl().setSelectedSessionId(null);
      sl().setSessionActive(false);
      sl().setResumeSessionId(null);
      ts().resetForSession();
      seedAgents(null, []);
      ui().setFinalSummaryState({ kind: "idle" });
      session.clearSession();
      return;
    }

    const exists = availableSessions.some((entry) => entry.id === parsed.sessionId);
    if (!exists) {
      ui().setRouteNotice(`Session ${parsed.sessionId} not found. Showing empty state.`);
      micCapture.stop();
      replaceSessionPath(null);
      sl().setSelectedSessionId(null);
      sl().setSessionActive(false);
      sl().setResumeSessionId(null);
      ts().resetForSession();
      seedAgents(null, []);
      ui().setFinalSummaryState({ kind: "idle" });
      session.clearSession();
      return;
    }

    ui().setRouteNotice("");
    ui().setSplashDone(true);
    ui().setSettingsOpen(false);
    ts().resetForSession();
    seedAgents(parsed.sessionId, []);
    ui().setFinalSummaryState({ kind: "idle" });
    sl().setSelectedSessionId(parsed.sessionId);
    sl().setResumeSessionId(parsed.sessionId);
    sl().setSessionActive(true);
  };

  const loadDemoSession = async (sessionId: string) => {
    pushSessionPath(sessionId);
    sl().setSelectedSessionId(sessionId);
    ui().setSplashDone(true);
    ui().setFinalSummaryState({ kind: "idle" });
    session.viewSession(sessionId);
    const [demoTasks, demoAgents] = await Promise.all([
      window.electronAPI.getSessionTasks(sessionId),
      window.electronAPI.getSessionAgents(sessionId),
    ]);
    ts().setTasks(demoTasks);
    seedAgents(sessionId, demoAgents);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await refreshSessionsRef.current();
      if (cancelled) return;

      const routeInput = window.location.hash || window.location.pathname;
      const parsed = parseSessionRoute(routeInput);
      const demoSession = loaded.find((s) => s.title === "Sprint Review & Planning");
      const isFirstTime = await window.electronAPI.wasSeeded();

      if ((isFirstTime || !onboardingCompleted) && demoSession && !parsed.sessionId) {
        await loadDemoSession(demoSession.id);
        if (!cancelled) {
          ui().setOnboardingPhase("tour");
        }
        return;
      }

      applyRoutePathRef.current(window.location.hash || window.location.pathname, loaded);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onLocationChange = () => {
      applyRoutePathRef.current(window.location.hash || window.location.pathname, sessionsRef.current);
    };
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("hashchange", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("hashchange", onLocationChange);
    };
  }, [sessionsRef]);

  // Inject demo suggestions when onboarding tour reaches the right sidebar (step 2+)
  useEffect(() => {
    if (onboardingPhase !== "tour" || tourStep < 2 || !selectedSessionId) return;
    const now = Date.now();
    const demoSuggestions: import("@core/types").TaskSuggestion[] = [
      {
        id: "demo-suggestion-1",
        text: "Want me to research Datadog vs Grafana Cloud pricing for your infrastructure size?",
        kind: "research",
        details: "Team discussed monitoring tools but didn't compare pricing.",
        transcriptExcerpt: "We should look at Datadog pricing tiers...",
        sessionId: selectedSessionId,
        createdAt: now,
      },
      {
        id: "demo-suggestion-2",
        text: "I noticed an action item: draft the webhook processor postmortem. Want me to start it?",
        kind: "action",
        details: "Marcus mentioned Friday's outage needs a postmortem.",
        sessionId: selectedSessionId,
        createdAt: now,
      },
      {
        id: "demo-suggestion-3",
        text: "The team agreed on 20% tech debt allocation but didn't define which items. Flag for follow-up?",
        kind: "flag",
        sessionId: selectedSessionId,
        createdAt: now,
      },
    ];
    ts().appendSuggestions(demoSuggestions);
  }, [onboardingPhase, tourStep, selectedSessionId]);

  // Load summary on tour step 4 to show the summary tab
  useEffect(() => {
    if (onboardingPhase !== "tour" || !selectedSessionId) return;
    if (tourStep === 4) {
      void window.electronAPI.getFinalSummary(selectedSessionId).then((result) => {
        if (result.ok && result.summary) {
          ui().setFinalSummaryState({ kind: "ready", summary: result.summary });
        }
      });
    }
  }, [onboardingPhase, tourStep, selectedSessionId]);

  useEffect(() => {
    return window.electronAPI.onSessionTitleGenerated((sid, title) => {
      sl().updateSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, title } : s)));
    });
  }, []);

  useEffect(() => {
    if (!session.sessionId) return;
    seedAgents(session.sessionId, agents);
    sl().setSelectedSessionId(session.sessionId);
    const currentPath = buildSessionPath(session.sessionId);
    if (pendingNewSessionRouteRef.current) {
      pushSessionPath(session.sessionId);
      pendingNewSessionRouteRef.current = false;
    } else if (parseSessionRoute(window.location.hash).normalizedPath !== currentPath) {
      replaceSessionPath(session.sessionId);
    }
    void refreshSessionsRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  useEffect(() => {
    if (!session.sessionId || !pendingCaptureStartRef.current) return;
    const selection = pendingCaptureStartRef.current;
    pendingCaptureStartRef.current = null;
    void startCaptureSelection(selection);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  useThemeMode(appConfig.themeMode, appConfig.lightVariant, appConfig.darkVariant, appConfig.fontSize, appConfig.fontFamily);

  // --- Handlers ---
  const toggleMicRuntime = async () => {
    const result = await window.electronAPI.toggleMic();
    if (result.ok && result.captureInRenderer) {
      await micCapture.start();
    } else if (result.ok && !result.micEnabled) {
      micCapture.stop();
    }
    return result;
  };

  const startCaptureSelection = async (selection: { mic: boolean; deviceAudio: boolean }) => {
    if (!selection.mic && !selection.deviceAudio) {
      ui().setRouteNotice("Select Mic Input or Device Audio before recording.");
      return false;
    }

    ui().setRouteNotice("");

    if (selection.mic && !isMicActive) {
      const result = await toggleMicRuntime();
      if (!result.ok) {
        ui().setRouteNotice(result.error ?? "Failed to enable mic input.");
        return false;
      }
    }

    if (selection.deviceAudio && !isDeviceAudioActive) {
      await session.toggleRecording();
    }

    return true;
  };

  const handleToggleMic = async () => {
    await toggleMicRuntime();
  };

  const handleToggleMicInputSelection = async () => {
    const next = !armedMicInput;
    setArmedMicInput(next);
    if (session.sessionId && isCaptureActive && next !== isMicActive) {
      await toggleMicRuntime();
    }
  };

  const handleToggleDeviceAudioSelection = async () => {
    const next = !armedDeviceAudio;
    setArmedDeviceAudio(next);
    if (session.sessionId && isCaptureActive && next !== isDeviceAudioActive) {
      await session.toggleRecording();
    }
  };

  const handleRecordToggle = async () => {
    if (isCaptureActive) {
      pendingCaptureStartRef.current = null;
      await handleStopCapture();
      return;
    }

    const selection = { mic: armedMicInput, deviceAudio: armedDeviceAudio };
    if (!session.sessionId) {
      pendingCaptureStartRef.current = selection;
      handleStart();
      return;
    }

    await startCaptureSelection(selection);
  };

  const handleConnectMcpProvider = async (providerId: string) => {
    const { notice } = await ig().connectProvider(providerId);
    if (notice) ui().setRouteNotice(notice);
  };

  const handleDisconnectMcpProvider = async (providerId: string) => {
    const { notice } = await ig().disconnectProvider(providerId);
    if (notice) ui().setRouteNotice(notice);
  };

  const handleAddCustomServer = async (cfg: { name: string; url: string; transport: "streamable" | "sse"; bearerToken?: string }) => {
    const result = await ig().addCustomServer(cfg);
    if (result.notice) ui().setRouteNotice(result.notice);
    return result;
  };

  const handleRemoveCustomServer = async (id: string) => {
    const result = await ig().removeCustomServer(id);
    if (result.notice) ui().setRouteNotice(result.notice);
    return result;
  };

  const handleConnectCustomServer = async (id: string) => {
    const result = await ig().connectCustomServer(id);
    if (result.notice) ui().setRouteNotice(result.notice);
    return result;
  };

  const handleDisconnectCustomServer = async (id: string) => {
    const result = await ig().disconnectCustomServer(id);
    if (result.notice) ui().setRouteNotice(result.notice);
    return result;
  };

  const handleSaveApiKey = async (envVar: string, value: string) => {
    const result = await ig().saveApiKey(envVar, value);
    if (result.ok && onboardingPhaseRef.current === "settings") {
      ui().setSettingsOpen(false);
      ui().setOnboardingPhase("done");
    }
    return result;
  };

  const handleDeleteApiKey = async (envVar: string) => {
    return ig().deleteApiKey(envVar);
  };

  const handleMoveSessionToProject = async (sid: string, projectId: string | null) => {
    const result = await window.electronAPI.updateSessionProject(sid, projectId);
    if (!result.ok) {
      ui().setRouteNotice(`Failed to move session: ${result.error ?? "Unknown error"}`);
      return;
    }
    ui().setRouteNotice("");
    const nextProjectId = result.session?.projectId ?? (projectId ?? undefined);
    sl().updateSessions((prev) =>
      prev.map((s) => (s.id === sid ? { ...s, projectId: nextProjectId } : s)),
    );
    sessionsRef.current = sessionsRef.current.map((s) =>
      (s.id === sid ? { ...s, projectId: nextProjectId } : s),
    );
  };

  const handleStart = () => {
    ui().setLangError("");
    ui().setSplashDone(true);
    ui().setSettingsOpen(false);
    ui().setRouteNotice("");
    ts().setSuggestions([]);
    ts().setArchivedSuggestions([]);

    if (selectedSessionId) {
      sl().setResumeSessionId(selectedSessionId);
      sl().setSessionActive(true);
      return;
    }

    pendingNewSessionRouteRef.current = true;
    replaceSessionPath(null);
    sl().setSelectedSessionId(null);
    sl().setResumeSessionId(null);
    ts().resetForSession();
    seedAgents(null, []);
    ui().setFinalSummaryState({ kind: "idle" });
    sl().setSessionActive(true);
  };

  const handleSplashComplete = () => {
    useUIStore.getState().setSplashDone(true);
  };

  const handleOnboardingSetUpKeys = () => {
    ui().markOnboardingCompleted();
    ui().setOnboardingPhase("settings");
    ui().setSettingsOpen(true);
  };

  const handleOnboardingDismiss = () => {
    ui().markOnboardingCompleted();
  };

  const handleShowTutorial = async () => {
    ui().setSettingsOpen(false);
    const allSessions = sessionsRef.current;
    const demoSession = allSessions.find((s) => s.title === "Sprint Review & Planning");
    if (demoSession) {
      await loadDemoSession(demoSession.id);
    }
    ui().setOnboardingPhase("tour");
  };

  const handleStop = () => {
    pendingCaptureStartRef.current = null;
    micCapture.stop();
    sl().setSessionActive(false);
    sl().setResumeSessionId(null);
    ui().setRouteNotice("");
    void refreshSessions();
  };

  const handleStopCapture = async () => {
    pendingCaptureStartRef.current = null;
    ui().setRouteNotice("");
    if (isDeviceAudioActive) {
      await session.toggleRecording();
    }
    if (isMicActive) {
      await toggleMicRuntime();
    }
  };

  const handleNewSession = () => {
    micCapture.stop();
    ui().setSettingsOpen(false);
    ui().setRouteNotice("");
    pendingNewSessionRouteRef.current = true;
    sl().resetForNewSession();
    ts().resetForSession();
    seedAgents(null, []);
    ui().setFinalSummaryState({ kind: "idle" });
    session.clearSession();
    sl().bumpSessionRestartKey();
    sl().setSessionActive(true);
    void refreshSessions();
  };

  const scrollUp = () => {
    transcriptRef.current?.scrollBy({ top: -60, behavior: "smooth" });
  };

  const scrollDown = () => {
    transcriptRef.current?.scrollBy({ top: 60, behavior: "smooth" });
  };

  // --- Resize handlers ---
  const startResize = (handle: ResizeHandle, clientX: number) => {
    resizeStateRef.current = {
      handle,
      startX: clientX,
      startLeft: leftPanelWidth,
      startRight: rightPanelWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const endResize = () => {
    if (!resizeStateRef.current) return;
    resizeStateRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const handleResizeMouseDown = (handle: ResizeHandle) => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    startResize(handle, event.clientX);
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const activeResize = resizeStateRef.current;
      const layoutEl = panelLayoutRef.current;
      if (!activeResize || !layoutEl) return;

      const totalWidth = layoutEl.getBoundingClientRect().width;
      if (totalWidth <= 0) return;
      const delta = event.clientX - activeResize.startX;

      if (activeResize.handle === "left") {
        const maxLeft = totalWidth - activeResize.startRight - MIN_TRANSCRIPT_WIDTH;
        setLeftPanelWidth(Math.round(clampWidth(
          activeResize.startLeft + delta,
          LEFT_PANEL_MIN_WIDTH,
          Math.min(LEFT_PANEL_MAX_WIDTH, maxLeft),
        )));
      } else if (activeResize.handle === "right") {
        const maxRight = totalWidth - activeResize.startLeft - MIN_TRANSCRIPT_WIDTH;
        setRightPanelWidth(Math.round(clampWidth(
          activeResize.startRight - delta,
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(RIGHT_PANEL_MAX_WIDTH, maxRight),
        )));
      }
    };

    const handleMouseUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      handleMouseUp();
    };
  }, [setLeftPanelWidth, setRightPanelWidth]);

  useEffect(() => {
    if (settingsOpen) return;

    const clampPanelsToLayout = () => {
      const layoutEl = panelLayoutRef.current;
      if (!layoutEl) return;

      const totalWidth = layoutEl.getBoundingClientRect().width;
      if (totalWidth <= 0) return;

      let nextLeft = clampWidth(leftPanelWidth, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH);
      let nextRight = clampWidth(rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH);

      let overflow = nextLeft + nextRight - (totalWidth - MIN_TRANSCRIPT_WIDTH);
      if (overflow > 0) {
        const consumeOverflow = (current: number, min: number) => {
          const spare = Math.max(0, current - min);
          const reduction = Math.min(spare, overflow);
          overflow -= reduction;
          return current - reduction;
        };
        nextRight = consumeOverflow(nextRight, RIGHT_PANEL_MIN_WIDTH);
        nextLeft = consumeOverflow(nextLeft, LEFT_PANEL_MIN_WIDTH);
      }

      if (nextLeft !== leftPanelWidth) setLeftPanelWidth(nextLeft);
      if (nextRight !== rightPanelWidth) setRightPanelWidth(nextRight);
    };

    clampPanelsToLayout();
    window.addEventListener("resize", clampPanelsToLayout);
    return () => window.removeEventListener("resize", clampPanelsToLayout);
  }, [leftPanelWidth, rightPanelWidth, settingsOpen, setLeftPanelWidth, setRightPanelWidth]);

  // --- Task handlers ---
  const handleAddTask = async (text: string, details?: string) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      ui().setRouteNotice("Select or start a session before adding tasks.");
      return false;
    }
    const trimmedText = text.trim();
    if (!trimmedText) return false;

    const optimisticId = crypto.randomUUID();
    const optimisticTask: TaskItem = {
      id: optimisticId,
      text: trimmedText,
      details,
      size: "large",
      completed: false,
      source: "manual",
      createdAt: Date.now(),
      sessionId: targetSessionId,
    };

    ui().setRouteNotice("");
    ts().addTask(optimisticTask);
    ts().addProcessingId(optimisticId);

    const result = await ts().persistTask({
      targetSessionId,
      text: trimmedText,
      details,
      source: "manual",
      id: optimisticId,
      createdAt: optimisticTask.createdAt,
      appConfig,
    });

    ts().removeProcessingId(optimisticId);
    if (!result.ok) {
      ts().deleteTask(optimisticId);
      ui().setRouteNotice(`Failed to add task: ${result.error ?? "Unknown error"}`);
      return false;
    }
    ts().replaceTask(optimisticId, result.task!);
    return true;
  };

  const handleCreateTaskFromSelection = async (selectionText: string, userIntentText?: string) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      const message = "Select or start a session before creating tasks.";
      ui().setRouteNotice(message);
      return { ok: false, message };
    }

    const placeholderId = `processing-${crypto.randomUUID()}`;
    const trimmedIntent = userIntentText?.trim() ?? "";
    const placeholderTask: TaskItem = {
      id: placeholderId,
      text: trimmedIntent ? `Processing: ${trimmedIntent}` : "Processing highlighted text...",
      size: "large",
      completed: false,
      source: "manual",
      createdAt: Date.now(),
      sessionId: targetSessionId,
    };
    ts().addTask(placeholderTask);
    ts().addProcessingId(placeholderId);
    ui().setRouteNotice("Processing highlighted text into a task...");

    void (async () => {
      const finalize = () => ts().removeProcessingId(placeholderId);
      const removePlaceholder = () => ts().deleteTask(placeholderId);

      const extractResult = await window.electronAPI.extractTaskFromSelectionInSession(
        targetSessionId, selectionText, trimmedIntent || undefined, appConfig,
      );

      if (!extractResult.ok) {
        removePlaceholder(); finalize();
        ui().setRouteNotice(`Could not process selection: ${extractResult.error ?? "Unknown error"}`);
        return;
      }
      if (!extractResult.taskTitle) {
        removePlaceholder(); finalize();
        ui().setRouteNotice(extractResult.reason ?? "No actionable task found in selection.");
        return;
      }

      const persistResult = await ts().persistTask({
        targetSessionId,
        text: extractResult.taskTitle,
        details: [
          trimmedIntent ? `Requested task intent:\n${trimmedIntent}` : "",
          extractResult.taskDetails?.trim() ? `Context summary:\n${extractResult.taskDetails.trim()}` : "",
          `Original transcript excerpt:\n${selectionText.trim()}`,
        ].filter(Boolean).join("\n\n"),
        source: "manual",
        appConfig,
      });

      if (!persistResult.ok) {
        removePlaceholder(); finalize();
        ui().setRouteNotice(`Failed to add task: ${persistResult.error ?? "Unknown error"}`);
        return;
      }

      ts().updateTasks((prev) => [persistResult.task!, ...prev.filter((t) => t.id !== placeholderId)]);
      finalize();
      ui().setRouteNotice(`Task created: ${persistResult.task!.text}`);
    })();

    return { ok: true };
  };

  const handleSubmitTaskInput = async (intentText: string, refs: string[]) => {
    const trimmedIntent = intentText.trim();
    if (!trimmedIntent && refs.length === 0) return;
    const selectionText = refs.length > 0 ? refs.join("\n\n---\n\n") : trimmedIntent;
    await handleCreateTaskFromSelection(selectionText, refs.length > 0 ? (trimmedIntent || undefined) : undefined);
    ts().clearTranscriptRefs();
  };

  const handleAddTaskFromDebrief = async (text: string, details?: string) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      ui().setRouteNotice("Select or start a session before adding tasks.");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    const finalTitle = normalizeAgentTaskTitle(trimmed) || trimmed;
    const finalDetails = joinTaskDetails(
      `Agent debrief next step:\n${trimmed}`,
      details?.trim() ? `Agent debrief context:\n${details.trim()}` : undefined,
    );

    const optimisticId = crypto.randomUUID();
    const optimisticTask: TaskItem = {
      id: optimisticId,
      text: finalTitle,
      details: finalDetails,
      size: "small",
      completed: false,
      source: "ai",
      createdAt: Date.now(),
      sessionId: targetSessionId,
    };

    ts().bumpForceWorkTabKey();
    ts().addTask(optimisticTask);
    ts().addProcessingId(optimisticId);

    const result = await ts().persistTask({
      targetSessionId,
      text: finalTitle,
      details: finalDetails,
      source: "ai",
      size: "small",
      id: optimisticId,
      createdAt: optimisticTask.createdAt,
      appConfig,
    });

    ts().removeProcessingId(optimisticId);
    if (!result.ok) {
      ts().deleteTask(optimisticId);
      ui().setRouteNotice(`Failed to add task: ${result.error ?? "Unknown error"}`);
      return;
    }
    ts().replaceTask(optimisticId, result.task!);
  };

  const handleToggleTask = (id: string) => {
    ts().toggleTask(id);
  };

  const handleDeleteTask = async (id: string) => {
    if (processingTaskIds.includes(id)) {
      ts().removeProcessingId(id);
      ts().deleteTask(id);
      return;
    }

    const removedTask = tasks.find((t) => t.id === id);
    ts().deleteTask(id);

    const result = await window.electronAPI.deleteTask(id);
    if (result.ok) {
      ui().setRouteNotice("");
      return;
    }
    if (removedTask) {
      ts().addTask(removedTask);
    }
    ui().setRouteNotice(`Failed to delete task: ${result.error ?? "Unknown error"}`);
  };

  const handleUpdateTask = async (id: string, text: string) => {
    ts().updateTaskText(id, text);
    const result = await window.electronAPI.updateTaskText(id, text);
    if (!result.ok) {
      ui().setRouteNotice(`Failed to update task: ${result.error ?? "Unknown error"}`);
    }
  };

  const handleAcceptSuggestion = async (suggestion: import("@core/types").TaskSuggestion) => {
    const targetSessionId = suggestion.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      ui().setRouteNotice("Missing session id for suggestion.");
      return;
    }
    ui().setRouteNotice("");
    await ts().acceptSuggestion({ suggestion, targetSessionId, appConfig });
    const accepted = useTaskStore.getState().tasks.find((t) => t.id === suggestion.id);
    if (accepted?.size === "large") {
      ui().setRouteNotice("Suggestion accepted as large. Approval is required before running the agent.");
    }
  };

  const handleDismissSuggestion = (id: string) => {
    ts().dismissSuggestion(id);
  };

  const handleDeleteArchivedSuggestion = (id: string) => {
    ts().deleteArchivedSuggestion(id);
  };

  const handleAcceptArchivedTask = async (task: TaskItem) => {
    ts().acceptArchivedTask(task);
  };

  // --- Agent handlers ---
  const launchTaskAgent = async (task: TaskItem, approvalToken?: string) => {
    const taskSessionId = task.sessionId ?? null;
    const targetSessionId = taskSessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      ui().setRouteNotice("Missing session id for this task.");
      return false;
    }

    const useActiveRuntime = sessionActive && session.sessionId === targetSessionId;
    const result = useActiveRuntime
      ? await window.electronAPI.launchAgent(task.id, task.text, task.details, approvalToken)
      : await window.electronAPI.launchAgentInSession(
          targetSessionId, task.id, task.text, task.details, appConfig, approvalToken,
        );

    if (result.ok && result.agent) {
      ui().setRouteNotice("");
      selectAgent(result.agent.id);
      ts().markTaskCompleted(task.id);
      return true;
    }
    ui().setRouteNotice(`Failed to launch agent: ${result.error ?? "Unknown error"}`);
    return false;
  };

  const handleLaunchAgent = async (task: TaskItem) => {
    if (processingTaskIds.includes(task.id)) {
      ui().setRouteNotice("Task is still processing. Wait a moment before launching.");
      return;
    }
    if (task.size === "large") {
      ts().setPendingApprovalTask(task);
      return;
    }
    await launchTaskAgent(task);
  };

  const handleNewAgent = () => {
    selectAgent(null);
    ui().setNewAgentMode(true);
  };

  const handleLaunchCustomAgent = async (task: string) => {
    ui().setNewAgentMode(false);
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      ui().setRouteNotice("No session available to launch agent.");
      return;
    }
    const result = sessionActive && session.sessionId === targetSessionId
      ? await window.electronAPI.launchCustomAgent(task)
      : await window.electronAPI.launchCustomAgentInSession(targetSessionId, task, undefined, undefined, appConfig);
    if (result.ok && result.agent) {
      selectAgent(result.agent.id);
    } else {
      ui().setRouteNotice(`Failed to launch agent: ${result.error ?? "Unknown error"}`);
    }
  };

  const handleArchiveAgent = async (agent: Agent) => {
    await window.electronAPI.archiveAgent(agent.id);
  };

  const handleRelaunchAgent = async (agent: Agent) => {
    const result = await window.electronAPI.relaunchAgent(agent.id);
    if (!result.ok) {
      ui().setRouteNotice(`Failed to relaunch agent: ${result.error ?? "Unknown error"}`);
    }
  };

  const handleApproveLargeTask = async () => {
    if (!pendingApprovalTask) return;
    ts().setApprovingLargeTask(true);
    const approval = await window.electronAPI.approveLargeTask(pendingApprovalTask.id);
    if (!approval.ok || !approval.approvalToken) {
      ts().setApprovingLargeTask(false);
      ui().setRouteNotice(`Failed to approve large task: ${approval.error ?? "Unknown error"}`);
      return;
    }
    const launched = await launchTaskAgent(pendingApprovalTask, approval.approvalToken);
    ts().setApprovingLargeTask(false);
    if (launched) {
      ts().setPendingApprovalTask(null);
    }
  };

  const handleSelectSession = (sid: string) => {
    micCapture.stop();
    ui().setSettingsOpen(false);
    ui().setRouteNotice("");
    pushSessionPath(sid);
    sl().bumpSessionRestartKey();
    sl().setSelectedSessionId(sid);
    sl().setResumeSessionId(sid);
    ts().resetForSession();
    seedAgents(sid, []);
    sl().setSessionActive(true);
  };

  const handleDeleteSession = async (id: string) => {
    await window.electronAPI.deleteSession(id);
    const isDeletedSelected = selectedSessionId === id || session.sessionId === id;
    if (isDeletedSelected) {
      micCapture.stop();
      replaceSessionPath(null);
      sl().setSelectedSessionId(null);
      sl().setSessionActive(false);
      sl().setResumeSessionId(null);
      ts().resetForSession();
      seedAgents(null, []);
      session.clearSession();
    }
    await refreshSessions();
  };

  const handleFollowUp = async (agent: Agent, question: string) => {
    const targetSessionId = agent.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return { ok: false, error: "Missing session id for this agent" };
    return window.electronAPI.followUpAgentInSession(targetSessionId, agent.id, question, appConfig);
  };

  const handleAnswerAgentQuestion = async (agent: Agent, answers: AgentQuestionSelection[]) => {
    const targetSessionId = agent.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return { ok: false, error: "Missing session id for this agent" };
    return window.electronAPI.answerAgentQuestionInSession(targetSessionId, agent.id, answers, appConfig);
  };

  const handleSkipAgentQuestion = async (agent: Agent) => {
    const targetSessionId = agent.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return { ok: false, error: "Missing session id for this agent" };
    return window.electronAPI.skipAgentQuestionInSession(targetSessionId, agent.id, appConfig);
  };

  const handleAnswerAgentToolApproval = async (agent: Agent, response: AgentToolApprovalResponse) => {
    const targetSessionId = agent.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return { ok: false, error: "Missing session id for this agent" };
    return window.electronAPI.respondAgentToolApprovalInSession(targetSessionId, agent.id, response, appConfig);
  };

  const handleAnswerPlanApproval = async (agent: Agent, response: AgentPlanApprovalResponse) => {
    const targetSessionId = agent.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return { ok: false, error: "Missing session id for this agent" };
    return window.electronAPI.respondPlanApprovalInSession(targetSessionId, agent.id, response, appConfig);
  };

  const handleCancelAgent = async (agentId: string) => {
    await window.electronAPI.cancelAgent(agentId);
  };

  const handleToggleTranslation = async () => {
    await window.electronAPI.toggleTranslation();
  };

  const handleSetTranslationMode = async (direction: "off" | "auto" | "source-target", targetLangCode?: LanguageCode) => {
    if (targetLangCode) applyTargetLang(targetLangCode);
    await window.electronAPI.setTranslationMode(direction, targetLangCode);
  };

  const handleAppConfigChange = (next: AppConfig) => {
    const prev = storedAppConfig;
    const normalized = normalizeAppConfig(next);
    setStoredAppConfig(normalized);
    const modelChanged =
      prev.analysisModelId !== normalized.analysisModelId ||
      prev.analysisProvider !== normalized.analysisProvider ||
      prev.taskModelId !== normalized.taskModelId ||
      prev.utilityModelId !== normalized.utilityModelId ||
      prev.synthesisModelId !== normalized.synthesisModelId ||
      prev.transcriptionProvider !== normalized.transcriptionProvider ||
      prev.transcriptionModelId !== normalized.transcriptionModelId;
    if (modelChanged && sessionActive) {
      sl().bumpSessionRestartKey();
    }
  };

  const handleToggleSkill = (skillId: string, enabled: boolean) => {
    const current = appConfig.disabledSkillIds ?? [];
    const next = enabled
      ? current.filter((id) => id !== skillId)
      : [...current, skillId];
    handleAppConfigChange({ ...appConfig, disabledSkillIds: next });
  };

  const handleAcceptSummaryItems = (
    items: Array<{
      text: string;
      details?: string;
      source?: "agreement" | "missed" | "question" | "action";
      userIntent?: string;
      doer?: "agent" | "human";
    }>,
  ) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return;
    if (items.length > 0) ts().bumpForceWorkTabKey();
    void (async () => {
      for (const { text, details, userIntent, doer } of items) {
        const trimmed = text.trim();
        if (!trimmed) continue;
        const trimmedUserIntent = userIntent?.trim();
        const finalTitle = doer === "agent"
          ? (normalizeAgentTaskTitle(trimmed) || trimmed)
          : trimmed;
        const finalDetails = joinTaskDetails(
          trimmedUserIntent ? `Requested outcome:\n${trimmedUserIntent}` : undefined,
          details,
        );

        const optimisticId = crypto.randomUUID();
        const optimisticTask: TaskItem = {
          id: optimisticId,
          text: finalTitle,
          details: finalDetails,
          size: "small",
          completed: false,
          source: "ai",
          createdAt: Date.now(),
          sessionId: targetSessionId,
        };

        ts().addTask(optimisticTask);
        ts().addProcessingId(optimisticId);
        const result = await ts().persistTask({
          targetSessionId,
          text: finalTitle,
          details: finalDetails,
          source: "ai",
          size: "small",
          id: optimisticId,
          createdAt: optimisticTask.createdAt,
          appConfig,
        });
        ts().removeProcessingId(optimisticId);
        if (!result.ok) {
          ts().deleteTask(optimisticId);
        } else {
          ts().replaceTask(optimisticId, result.task!);
        }
      }
    })();
  };

  const autoDelegateGenRef = useRef(0);
  const launchTaskAgentRef = useRef(launchTaskAgent);
  launchTaskAgentRef.current = launchTaskAgent;
  useEffect(() => {
    if (!appConfig.autoDelegate) return;
    if (finalSummaryState.kind !== "ready") return;

    const gen = finalSummaryState.summary.generatedAt;
    if (autoDelegateGenRef.current === gen) return;
    autoDelegateGenRef.current = gen;

    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return;

    const summary = finalSummaryState.summary;
    const indexed: Array<{ todo: typeof summary.actionItems[number]; todoId: string }> = [
      ...summary.agreementTodos.map((todo, i) => ({ todo, todoId: `agreement-task-${i}` })),
      ...summary.missedItemTodos.map((todo, i) => ({ todo, todoId: `missed-task-${i}` })),
      ...summary.unansweredQuestionTodos.map((todo, i) => ({ todo, todoId: `question-task-${i}` })),
      ...summary.actionItems.map((todo, i) => ({ todo, todoId: `action-task-${i}` })),
    ];
    const agentEntries = indexed.filter((e) => e.todo.doer === "agent");
    if (agentEntries.length === 0) return;

    const delegatedIds = agentEntries.map((e) => e.todoId);
    const existingAccepted = summary.acceptedTodoIds ?? [];
    const mergedIds = [...new Set([...existingAccepted, ...delegatedIds])];
    void window.electronAPI.patchFinalSummary(targetSessionId, { acceptedTodoIds: mergedIds });
    ui().updateFinalSummary((prev) => {
      if (prev.kind !== "ready") return prev;
      return { ...prev, summary: { ...prev.summary, acceptedTodoIds: mergedIds } };
    });

    void (async () => {
      for (const { todo } of agentEntries) {
        const result = await ts().persistTask({
          targetSessionId,
          text: normalizeAgentTaskTitle(todo.text) || todo.text,
          details: `Context: auto-delegated from session summary.\nTask: ${todo.text}`,
          source: "ai",
          appConfig,
        });
        if (result.ok && result.task) {
          ts().addTask(result.task);
          await launchTaskAgentRef.current(result.task);
        }
      }
    })();
  }, [appConfig, appConfig.autoDelegate, finalSummaryState, selectedSessionId, session.sessionId]);

  const handleTodosAccepted = (ids: string[]) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return;
    void window.electronAPI.patchFinalSummary(targetSessionId, { acceptedTodoIds: ids });
    ui().updateFinalSummary((prev) => {
      if (prev.kind !== "ready") return prev;
      return { ...prev, summary: { ...prev.summary, acceptedTodoIds: ids } };
    });
  };

  const handleGenerateSummary = async () => {
    if (finalSummaryState.kind === "loading") return;
    if (finalSummaryState.kind === "ready") return;
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    ui().setFinalSummaryState({ kind: "loading" });
    if (targetSessionId) {
      const cached = await window.electronAPI.getFinalSummary(targetSessionId);
      if (cached.ok && cached.summary) {
        ui().setFinalSummaryState({ kind: "ready", summary: cached.summary });
        return;
      }
    }
    void window.electronAPI.generateFinalSummary();
  };

  const handleRegenerateSummary = () => {
    if (finalSummaryState.kind === "loading") return;
    ui().setFinalSummaryState({ kind: "loading" });
    void window.electronAPI.generateFinalSummary();
  };

  useKeyboard({
    onToggleRecording: () => { void handleRecordToggle(); },
    onQuit: sessionActive ? handleStop : () => window.close(),
    onScrollUp: sessionActive ? scrollUp : undefined,
    onScrollDown: sessionActive ? scrollDown : undefined,
    onGenerateSummary: sessionActive ? handleGenerateSummary : undefined,
  });

  const closeAgentRef = useRef(closeAgent);
  closeAgentRef.current = closeAgent;
  useEffect(() => {
    if (!selectedAgent) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAgentRef.current(selectedAgent.id);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedAgent]);

  const visibleSessions = integrationActiveProjectId
    ? sessions.filter((s) => s.projectId === integrationActiveProjectId)
    : sessions;

  // --- Render ---
  if (!splashDone) {
    return (
      <div className="flex flex-col h-screen">
        <SplashScreen onComplete={handleSplashComplete} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <ToolbarHeader
        languages={languages}
        sourceLang={sourceLang}
        targetLang={targetLang}
        translateToSelection={translateToSelection}
        onSourceLangChange={(lang) => { void handleSourceLangChange(lang); }}
        onTargetLangChange={(lang) => { applyTargetLang(lang); ui().setLangError(""); }}
        onTranslateToSelectionChange={setTranslateToSelection}
        sessionActive={sessionActive}
        armedMicInput={armedMicInput}
        armedDeviceAudio={armedDeviceAudio}
        onToggleMicInput={() => { void handleToggleMicInputSelection(); }}
        onToggleDeviceAudio={() => { void handleToggleDeviceAudioSelection(); }}
        onRecordToggle={() => { void handleRecordToggle(); }}
        uiState={session.uiState}
        langError={langError}
        onToggleTranslation={handleToggleTranslation}
        onSetTranslationMode={handleSetTranslationMode}
        settingsOpen={settingsOpen}
        onToggleSettings={() => {
          if (settingsOpen && onboardingPhase === "settings") {
            ui().setOnboardingPhase("done");
            ui().setSettingsOpen(false);
            return;
          }
          ui().toggleSettings();
        }}
      />

      <div ref={panelLayoutRef} className="flex flex-1 min-h-0">
        {settingsOpen ? (
          <SettingsPage
            config={appConfig}
            isRecording={session.uiState?.status === "recording" || session.uiState?.status === "connecting"}
            onConfigChange={handleAppConfigChange}
            onReset={() => setStoredAppConfig(DEFAULT_APP_CONFIG)}
            mcpIntegrations={integrationMcpIntegrations}
            mcpBusy={integrationMcpBusy}
            onConnectProvider={handleConnectMcpProvider}
            onDisconnectProvider={handleDisconnectMcpProvider}
            customMcpServers={integrationCustomMcpServers}
            onAddCustomServer={handleAddCustomServer}
            onRemoveCustomServer={handleRemoveCustomServer}
            onConnectCustomServer={handleConnectCustomServer}
            onDisconnectCustomServer={handleDisconnectCustomServer}
            mcpToolsByProvider={integrationMcpToolsByProvider}
            apiKeyDefinitions={integrationApiKeyDefinitions}
            apiKeyStatus={integrationApiKeyStatus}
            onSaveApiKey={handleSaveApiKey}
            onDeleteApiKey={handleDeleteApiKey}
            initialTab={onboardingPhase === "settings" ? "api-keys" : undefined}
            onShowTutorial={handleShowTutorial}
            skills={skills}
            disabledSkillIds={appConfig.disabledSkillIds}
            onToggleSkill={handleToggleSkill}
          />
        ) : (
          <>
            <div className="shrink-0 min-h-0" style={{ width: leftPanelWidth }}>
              <LeftSidebar
                rollingKeyPoints={session.rollingKeyPoints}
                sessions={visibleSessions}
                activeSessionId={selectedSessionId}
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                projects={integrationProjects}
                activeProjectId={integrationActiveProjectId}
                onSelectProject={(id) => ig().selectProject(id)}
                onCreateProject={(name, instructions, context) => void ig().createProject(name, instructions, context)}
                onEditProject={(project) => void ig().editProject(project)}
                onDeleteProject={(id) => void ig().deleteProject(id)}
                onMoveSessionToProject={(sid, pid) => void handleMoveSessionToProject(sid, pid)}
              />
            </div>
            <div
              role="separator"
              aria-label="Resize left panel"
              aria-orientation="vertical"
              className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/50"
              onMouseDown={handleResizeMouseDown("left")}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-foreground/30" />
            </div>
            <MiddlePanelTabs
              sessionId={selectedSessionId ?? session.sessionId ?? null}
              summaryState={finalSummaryState}
              newAgentMode={newAgentMode}
              openAgentIds={openAgentIds}
              agentTabTitles={agentTabTitles}
              selectedAgentId={selectedAgentId}
              agentSelectionNonce={agentSelectionNonce}
              onSelectAgent={selectAgent}
              agents={agents}
              onCloseAgent={closeAgent}
              onCloseNewAgent={() => ui().setNewAgentMode(false)}
              onGenerateSummary={handleGenerateSummary}
              transcriptContent={
                <TranscriptArea
                  ref={transcriptRef}
                  blocks={session.blocks}
                  systemPartial={session.systemPartial}
                  micPartial={session.micPartial}
                  canTranslate={session.uiState?.canTranslate ?? false}
                  translationEnabled={session.uiState?.translationEnabled ?? false}
                  onAddTranscriptRef={(text: string) => ts().addTranscriptRef(text)}
                />
              }
              summaryContent={
                <SessionSummaryPanel
                  state={finalSummaryState}
                  existingTaskTexts={existingTaskTexts}
                  onClose={() => ui().setFinalSummaryState({ kind: "idle" })}
                  onAcceptItems={handleAcceptSummaryItems}
                  onTodosAccepted={handleTodosAccepted}
                  onRegenerate={handleRegenerateSummary}
                  asTabbedPanel
                />
              }
              agentContent={
                newAgentMode ? (
                  <NewAgentPanel
                    onLaunch={handleLaunchCustomAgent}
                    onClose={() => ui().setNewAgentMode(false)}
                  />
                ) : selectedAgent ? (
                  <AgentDetailPanel
                    agent={selectedAgent}
                    agents={agents}
                    onSelectAgent={selectAgent}
                    onClose={() => closeAgent(selectedAgent.id)}
                    onFollowUp={handleFollowUp}
                    onAnswerQuestion={handleAnswerAgentQuestion}
                    onSkipQuestion={handleSkipAgentQuestion}
                    onAnswerToolApproval={handleAnswerAgentToolApproval}
                    onAnswerPlanApproval={handleAnswerPlanApproval}
                    onCancel={handleCancelAgent}
                    onRelaunch={handleRelaunchAgent}
                    onArchive={handleArchiveAgent}
                  />
                ) : null
              }
            />
            <div
              role="separator"
              aria-label="Resize right panel"
              aria-orientation="vertical"
              className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/50"
              onMouseDown={handleResizeMouseDown("right")}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-foreground/30" />
            </div>
            <div className="shrink-0 min-h-0" style={{ width: rightPanelWidth }}>
              <RightSidebar
                tasks={tasks}
                suggestions={suggestions}
                agents={agents}
                selectedAgentId={selectedAgentId}
                forceWorkTabKey={forceWorkTabKey}
                onSelectAgent={selectAgent}
                onLaunchAgent={handleLaunchAgent}
                onNewAgent={handleNewAgent}
                onAddTask={handleAddTaskFromDebrief}
                onToggleTask={handleToggleTask}
                onDeleteTask={handleDeleteTask}
                onUpdateTask={handleUpdateTask}
                processingTaskIds={processingTaskIds}
                onAcceptSuggestion={handleAcceptSuggestion}
                onDismissSuggestion={handleDismissSuggestion}
                archivedSuggestions={archivedSuggestions}
                onAcceptArchivedTask={handleAcceptArchivedTask}
                onDeleteArchivedSuggestion={handleDeleteArchivedSuggestion}
                sessionId={selectedSessionId ?? session.sessionId ?? undefined}
                sessionActive={sessionActive}
                transcriptRefs={transcriptRefs}
                onRemoveTranscriptRef={(index: number) => ts().removeTranscriptRef(index)}
                onSubmitTaskInput={handleSubmitTaskInput}
              />
            </div>
          </>
        )}
      </div>

      {onboardingPhase === "tour" && splashDone && (
        <OnboardingOverlay
          panelLayoutRef={panelLayoutRef}
          onSetUpKeys={handleOnboardingSetUpKeys}
          onDismiss={handleOnboardingDismiss}
        />
      )}

      <Dialog
        open={!!pendingApprovalTask}
        onOpenChange={(open) => {
          if (!open && !approvingLargeTask) {
            ts().setPendingApprovalTask(null);
          }
        }}
      >
        <DialogContent showCloseButton={!approvingLargeTask}>
          <DialogHeader>
            <DialogTitle>Approve Large Task</DialogTitle>
            <DialogDescription>
              This task was classified as large and needs human approval before the agent can run.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
            {pendingApprovalTask?.text}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={approvingLargeTask}
              onClick={() => ts().setPendingApprovalTask(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={approvingLargeTask}
              onClick={() => void handleApproveLargeTask()}
            >
              {approvingLargeTask ? "Approving..." : "Approve & Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {routeNotice && (
        <div className="px-4 py-2 text-muted-foreground text-xs border-t border-border bg-muted/40">
          {routeNotice}
        </div>
      )}

      {session.errorText && (
        <div className="px-4 py-2 text-destructive text-xs border-t border-destructive/20 bg-destructive/5">
          {session.errorText}
        </div>
      )}

      <Footer
        sessionActive={sessionActive}
        statusText={session.statusText}
        onQuit={sessionActive ? handleStop : () => window.close()}
      />
    </div>
  );
}
