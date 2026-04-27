import { useState, useEffect, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import {
  CircleIcon,
  SquareIcon,
  MicIcon,
  MicOffIcon,
  Volume2Icon,
  VolumeXIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
} from "lucide-react";
import type {
  Agent,
  AppConfig,
  LanguageCode,
  TaskItem,
  UIState,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  AgentPlanApprovalResponse,
} from "@core/types";
import { DEFAULT_APP_CONFIG, normalizeAppConfig } from "@core/types";
import { useAgents } from "./hooks/use-agents";
import { useMicCapture } from "./hooks/use-mic-capture";
import { RightSidebar, AgentActivityCard, SuggestionItem } from "./components/right-sidebar";
import { AgentDetailPanel } from "./components/agent-detail-panel";
import { NewAgentPanel } from "./components/new-agent-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTaskStore } from "./stores/task-store";
import { useUIStore } from "./stores/ui-store";

function joinTaskDetails(...sections: Array<string | undefined>): string | undefined {
  const normalized = sections.map((s) => s?.trim() ?? "").filter(Boolean);
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

const EXPANDED_HEIGHT = 520;
const OVERLAY_HEIGHT = 720;
const HEADER_SCROLL_MAX = 280;
const MAX_HEIGHT_RATIO = 0.85;

function MiniScanBar({
  progress,
  configBudget,
}: {
  progress: { wordsUntilNextScan: number; liveWordsUntilNextScan?: number; scanWordBudget?: number; busy: boolean };
  configBudget?: number;
}) {
  const scanWordBudget = progress.scanWordBudget ?? configBudget ?? 200;
  const committedRemaining = Math.min(progress.wordsUntilNextScan, scanWordBudget);
  const liveRemainingRaw = progress.liveWordsUntilNextScan ?? progress.wordsUntilNextScan;
  const liveRemaining = Math.min(liveRemainingRaw, scanWordBudget);
  const committedRatio = Math.max(0, Math.min(1, (scanWordBudget - committedRemaining) / scanWordBudget));
  const liveRatio = Math.max(0, Math.min(1, (scanWordBudget - liveRemaining) / scanWordBudget));
  const label = progress.busy
    ? "Scanning…"
    : `Next scan in ${committedRemaining} word${committedRemaining === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-col gap-1 px-3 py-1.5">
      <span className="text-2xs text-muted-foreground/70 leading-none">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: 12 }, (_, i) => {
          const filled = committedRatio * 12 >= i + 1;
          const buffered = !filled && liveRatio * 12 >= i + 1;
          return (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                filled ? "bg-primary/60" : buffered ? "bg-primary/25" : "bg-muted"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

export function PopupApp({ initialSessionId }: { initialSessionId: string | null }) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(initialSessionId);
  const [uiState, setUiState] = useState<UIState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string>("Ambient");
  const [expanded, setExpanded] = useState(false);
  const [unseenAgents, setUnseenAgents] = useState(0);
  const [unseenSuggestions, setUnseenSuggestions] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [storedAppConfig] = useLocalStorage<AppConfig>("ambient-app-config", DEFAULT_APP_CONFIG);
  const appConfig = normalizeAppConfig(storedAppConfig);
  const [sourceLang] = useLocalStorage<LanguageCode>("ambient-source-lang", "en");
  const [targetLang] = useLocalStorage<LanguageCode>("ambient-translate-to-lang", "en");
  const [translateToSelection] = useLocalStorage<LanguageCode | "off">("ambient-translate-to-selection", "off");
  const [armedMicInput, setArmedMicInput] = useLocalStorage<boolean>("ambient-armed-mic-input", true);
  const [armedDeviceAudio, setArmedDeviceAudio] = useLocalStorage<boolean>("ambient-armed-device-audio", true);

  const tasks = useTaskStore((s) => s.tasks);
  const suggestions = useTaskStore((s) => s.suggestions);
  const suggestionProgress = useTaskStore((s) => s.suggestionProgress);
  const suggestionScanCards = useTaskStore((s) => s.suggestionScanCards);
  const archivedSuggestions = useTaskStore((s) => s.archivedSuggestions);
  const processingTaskIds = useTaskStore((s) => s.processingTaskIds);
  const forceWorkTabKey = useTaskStore((s) => s.forceWorkTabKey);
  const pendingApprovalTask = useTaskStore((s) => s.pendingApprovalTask);
  const approvingLargeTask = useTaskStore((s) => s.approvingLargeTask);
  const ts = useTaskStore.getState;

  const newAgentMode = useUIStore((s) => s.newAgentMode);
  const ui = useUIStore.getState;

  const {
    agents,
    selectedAgentId,
    selectedAgent,
    selectAgent: _selectAgent,
    closeAgent,
    seedAgents,
  } = useAgents();

  const selectAgent = (id: string | null) => {
    ui().setNewAgentMode(false);
    _selectAgent(id);
  };

  const micCapture = useMicCapture();
  const micCaptureRef = useRef(micCapture);
  micCaptureRef.current = micCapture;

  const isDeviceAudioActive =
    uiState?.status === "recording" || uiState?.status === "connecting";
  const isMicActive = uiState?.micEnabled ?? false;
  const isCaptureActive = isDeviceAudioActive || isMicActive;


  // Window sizing:
  //  - expanded → fixed EXPANDED_HEIGHT (capped at 85% of screen), inner area scrolls
  //  - collapsed with active content → measure header (capped at toolbar buttons + HEADER_SCROLL_MAX)
  //  - collapsed empty → just the toolbar buttons row
  const headerHasContent =
    !!currentSessionId && (suggestionScanCards.length > 0 || suggestions.length > 0);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const tb = toolbarRef.current?.offsetHeight ?? 48;
      const max = Math.floor(window.screen.availHeight * MAX_HEIGHT_RATIO);
      const inOverlay = !!selectedAgent || newAgentMode;
      if (inOverlay) {
        void window.electronAPI.resizeAgentsPopup(Math.min(OVERLAY_HEIGHT, max));
        return;
      }
      if (expanded) {
        void window.electronAPI.resizeAgentsPopup(Math.min(EXPANDED_HEIGHT, max));
        return;
      }
      const target = headerHasContent ? tb + HEADER_SCROLL_MAX : tb;
      void window.electronAPI.resizeAgentsPopup(Math.min(target, max));
    });
    return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, headerHasContent, selectedAgent, newAgentMode]);

  // Suggestions live in the always-visible header; just track them for the unseen badge.
  const prevSuggestionCountRef = useRef(0);
  const prevAgentCountRef = useRef(0);
  useEffect(() => {
    if (!hydrated) {
      prevSuggestionCountRef.current = suggestions.length;
      return;
    }
    const delta = suggestions.length - prevSuggestionCountRef.current;
    if (delta > 0 && !expanded) setUnseenSuggestions((n) => n + delta);
    prevSuggestionCountRef.current = suggestions.length;
  }, [suggestions.length, hydrated, expanded]);
  useEffect(() => {
    if (!hydrated) {
      prevAgentCountRef.current = agents.length;
      return;
    }
    const delta = agents.length - prevAgentCountRef.current;
    if (delta > 0) {
      setExpanded(true);
      if (!expanded) setUnseenAgents((n) => n + delta);
    }
    prevAgentCountRef.current = agents.length;
  }, [agents.length, hydrated, expanded]);
  useEffect(() => {
    if (pendingApprovalTask || selectedAgentId || newAgentMode) setExpanded(true);
  }, [pendingApprovalTask, selectedAgentId, newAgentMode]);
  useEffect(() => {
    if (expanded) {
      setUnseenAgents(0);
      setUnseenSuggestions(0);
    }
  }, [expanded]);

  // Track active session and uiState from backend
  useEffect(() => {
    void window.electronAPI.getActiveSessionId().then((id) => {
      if (id) setCurrentSessionId(id);
    });
    const cleanups = [
      window.electronAPI.onActiveSessionChanged((id) => setCurrentSessionId(id)),
      window.electronAPI.onStateChange((state) => setUiState(state)),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  // Hydrate when current session changes
  useEffect(() => {
    let cancelled = false;
    if (!currentSessionId) {
      ts().setTasks([]);
      ts().setSuggestions([]);
      ts().setArchivedSuggestions([]);
      seedAgents(null, []);
      setHydrated(true);
      setSessionTitle("Ambient");
      return;
    }
    setHydrated(false);
    void (async () => {
      const data = await window.electronAPI.hydrateAgentsPopup(currentSessionId);
      if (cancelled) return;
      ts().setTasks(data.tasks);
      ts().hydrateSuggestionsFromArchive(data.archivedTasks);
      seedAgents(currentSessionId, data.agents);
      const sessionList = await window.electronAPI.getSessions(200);
      if (cancelled) return;
      const meta = sessionList.find((s) => s.id === currentSessionId);
      setSessionTitle(meta?.title || "Untitled session");
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  // Subscribe to filtered events
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onTaskSuggested((suggestion) => {
        if (!currentSessionId || suggestion.sessionId === currentSessionId) {
          ts().appendSuggestion(suggestion);
        }
      }),
      window.electronAPI.onSuggestionProgress((progress) => {
        ts().setSuggestionProgress(progress);
      }),
      window.electronAPI.onSessionTitleGenerated((sid, title) => {
        if (sid === currentSessionId) setSessionTitle(title);
      }),
    ];
    return () => cleanups.forEach((fn) => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  // --- Capture/recording handlers ---
  const toggleMicRuntime = async () => {
    const result = await window.electronAPI.toggleMic();
    if (result.ok && result.captureInRenderer) {
      await micCaptureRef.current.start();
    } else if (result.ok && !result.micEnabled) {
      micCaptureRef.current.stop();
    }
    return result;
  };

  const startCaptureSelection = async (selection: { mic: boolean; deviceAudio: boolean }) => {
    if (!selection.mic && !selection.deviceAudio) return false;
    if (selection.mic && !isMicActive) {
      const r = await toggleMicRuntime();
      if (!r.ok) return false;
    }
    if (selection.deviceAudio && !isDeviceAudioActive) {
      await window.electronAPI.toggleRecording();
    }
    return true;
  };

  const handleStopCapture = async () => {
    if (isDeviceAudioActive) await window.electronAPI.toggleRecording();
    if (isMicActive) await toggleMicRuntime();
  };

  const handleRecordToggle = async () => {
    if (isCaptureActive) {
      await handleStopCapture();
      return;
    }
    const selection = { mic: armedMicInput, deviceAudio: armedDeviceAudio };
    if (!selection.mic && !selection.deviceAudio) return;

    if (!currentSessionId) {
      const result = await window.electronAPI.startSession(
        sourceLang,
        targetLang,
        appConfig,
        undefined,
        translateToSelection !== "off",
      );
      if (!result.ok || !result.sessionId) return;
      setCurrentSessionId(result.sessionId);
      // Wait a tick so backend wires events before we toggle capture
      await new Promise((r) => setTimeout(r, 0));
    }
    await startCaptureSelection(selection);
  };

  const handleToggleMicArmed = async () => {
    const next = !armedMicInput;
    setArmedMicInput(next);
    if (currentSessionId && isCaptureActive && next !== isMicActive) {
      await toggleMicRuntime();
    }
  };

  const handleToggleAudioArmed = async () => {
    const next = !armedDeviceAudio;
    setArmedDeviceAudio(next);
    if (currentSessionId && isCaptureActive && next !== isDeviceAudioActive) {
      await window.electronAPI.toggleRecording();
    }
  };

  // --- Task / agent handlers (require a session) ---
  const launchTaskAgent = async (task: TaskItem, approvalToken?: string) => {
    if (!currentSessionId) return false;
    const result = await window.electronAPI.launchAgentInSession(
      currentSessionId, task.id, task.text, task.details, appConfig, approvalToken,
    );
    if (result.ok && result.agent) {
      selectAgent(result.agent.id);
      ts().markTaskCompleted(task.id);
      return true;
    }
    return false;
  };

  const handleLaunchAgent = async (task: TaskItem) => {
    if (processingTaskIds.includes(task.id)) return;
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
    if (!currentSessionId) return;
    ui().setNewAgentMode(false);
    const result = await window.electronAPI.launchCustomAgentInSession(
      currentSessionId, task, undefined, undefined, appConfig,
    );
    if (result.ok && result.agent) selectAgent(result.agent.id);
  };

  const handleAddTaskFromDebrief = async (text: string, details?: string) => {
    if (!currentSessionId) return;
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
      sessionId: currentSessionId,
    };
    ts().bumpForceWorkTabKey();
    ts().addTask(optimisticTask);
    ts().addProcessingId(optimisticId);
    const result = await ts().persistTask({
      targetSessionId: currentSessionId,
      text: finalTitle,
      details: finalDetails,
      source: "ai",
      size: "small",
      id: optimisticId,
      createdAt: optimisticTask.createdAt,
      appConfig,
    });
    ts().removeProcessingId(optimisticId);
    if (!result.ok) ts().deleteTask(optimisticId);
    else ts().replaceTask(optimisticId, result.task!);
  };

  const handleToggleTask = (id: string) => ts().toggleTask(id);

  const handleDeleteTask = async (id: string) => {
    if (processingTaskIds.includes(id)) {
      ts().removeProcessingId(id);
      ts().deleteTask(id);
      return;
    }
    const removed = tasks.find((t) => t.id === id);
    ts().deleteTask(id);
    const result = await window.electronAPI.deleteTask(id);
    if (!result.ok && removed) ts().addTask(removed);
  };

  const handleUpdateTask = async (id: string, text: string) => {
    ts().updateTaskText(id, text);
    await window.electronAPI.updateTaskText(id, text);
  };

  const handleAcceptSuggestion = async (suggestion: import("@core/types").TaskSuggestion) => {
    const targetSessionId = suggestion.sessionId ?? currentSessionId;
    if (!targetSessionId) return;
    await ts().acceptSuggestion({ suggestion, targetSessionId, appConfig });
    const accepted = useTaskStore.getState().tasks.find((t) => t.id === suggestion.id);
    if (!accepted) return;
    if (accepted.size === "large") {
      ts().setPendingApprovalTask(accepted);
      return;
    }
    await launchTaskAgent(accepted);
  };

  const handleDismissSuggestion = (id: string) => ts().dismissSuggestion(id);
  const handleDeleteArchivedSuggestion = (id: string) => ts().deleteArchivedSuggestion(id);
  const handleAcceptArchivedTask = async (task: TaskItem) => {
    const target = task.sessionId ?? currentSessionId;
    if (!target) return;
    await ts().acceptArchivedTask({ task, targetSessionId: target, appConfig });
  };

  const handleApproveLargeTask = async () => {
    if (!pendingApprovalTask) return;
    ts().setApprovingLargeTask(true);
    const approval = await window.electronAPI.approveLargeTask(pendingApprovalTask.id);
    if (!approval.ok || !approval.approvalToken) {
      ts().setApprovingLargeTask(false);
      return;
    }
    const launched = await launchTaskAgent(pendingApprovalTask, approval.approvalToken);
    ts().setApprovingLargeTask(false);
    if (launched) ts().setPendingApprovalTask(null);
  };

  const handleFollowUp = async (agent: Agent, question: string) => {
    if (!currentSessionId) return { ok: false, error: "No active session" };
    return window.electronAPI.followUpAgentInSession(currentSessionId, agent.id, question, appConfig);
  };
  const handleAnswerAgentQuestion = async (agent: Agent, answers: AgentQuestionSelection[]) => {
    if (!currentSessionId) return { ok: false, error: "No active session" };
    return window.electronAPI.answerAgentQuestionInSession(currentSessionId, agent.id, answers, appConfig);
  };
  const handleSkipAgentQuestion = async (agent: Agent) => {
    if (!currentSessionId) return { ok: false, error: "No active session" };
    return window.electronAPI.skipAgentQuestionInSession(currentSessionId, agent.id, appConfig);
  };
  const handleAnswerAgentToolApproval = async (agent: Agent, response: AgentToolApprovalResponse) => {
    if (!currentSessionId) return { ok: false, error: "No active session" };
    return window.electronAPI.respondAgentToolApprovalInSession(currentSessionId, agent.id, response, appConfig);
  };
  const handleAnswerPlanApproval = async (agent: Agent, response: AgentPlanApprovalResponse) => {
    if (!currentSessionId) return { ok: false, error: "No active session" };
    return window.electronAPI.respondPlanApprovalInSession(currentSessionId, agent.id, response, appConfig);
  };
  const handleCancelAgent = async (agentId: string) => {
    await window.electronAPI.cancelAgent(agentId);
  };
  const handleRelaunchAgent = async (agent: Agent) => {
    await window.electronAPI.relaunchAgent(agent.id);
  };
  const handleArchiveAgent = async (agent: Agent) => {
    await window.electronAPI.archiveAgent(agent.id);
  };

  useEffect(() => {
    if (!selectedAgent && !newAgentMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedAgent) closeAgent(selectedAgent.id);
      else ui().setNewAgentMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent, newAgentMode]);

  const overlayActive = !!selectedAgent || newAgentMode;
  const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;
  const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
  const unseenTotal = unseenAgents + unseenSuggestions;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {!overlayActive && (
      <div ref={toolbarRef} className="flex flex-col shrink-0" style={dragStyle}>
      <div className="flex items-center gap-1 pl-[78px] pr-2 py-1.5">
        <button
          type="button"
          onClick={() => { void handleRecordToggle(); }}
          disabled={uiState?.status === "connecting"}
          title={isCaptureActive ? "Stop recording" : currentSessionId ? "Start recording" : "Start session and record"}
          style={noDragStyle}
          className={[
            "flex items-center gap-1.5 h-7 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
            isCaptureActive
              ? "bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-300"
              : "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.12] dark:bg-white/10 dark:hover:bg-white/15",
          ].join(" ")}
        >
          {isCaptureActive ? (
            <>
              <SquareIcon className="size-3 fill-current" />
              <span>Stop</span>
            </>
          ) : (
            <>
              <CircleIcon className="size-3 fill-red-500 text-red-500" />
              <span>Record</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => { void handleToggleMicArmed(); }}
          title={armedMicInput ? "Mic armed (click to disable)" : "Mic disabled"}
          aria-label="Toggle mic input"
          style={noDragStyle}
          className={[
            "flex items-center justify-center size-7 rounded-full transition-colors cursor-pointer",
            armedMicInput
              ? "text-foreground bg-foreground/[0.06] hover:bg-foreground/[0.12] dark:bg-white/10 dark:hover:bg-white/15"
              : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/10",
          ].join(" ")}
        >
          {armedMicInput ? <MicIcon className="size-3.5" /> : <MicOffIcon className="size-3.5" />}
        </button>

        <button
          type="button"
          onClick={() => { void handleToggleAudioArmed(); }}
          title={armedDeviceAudio ? "Device audio armed (click to disable)" : "Device audio disabled"}
          aria-label="Toggle device audio"
          style={noDragStyle}
          className={[
            "flex items-center justify-center size-7 rounded-full transition-colors cursor-pointer",
            armedDeviceAudio
              ? "text-foreground bg-foreground/[0.06] hover:bg-foreground/[0.12] dark:bg-white/10 dark:hover:bg-white/15"
              : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/10",
          ].join(" ")}
        >
          {armedDeviceAudio ? <Volume2Icon className="size-3.5" /> : <VolumeXIcon className="size-3.5" />}
        </button>

        <div className="flex items-center gap-1.5 ml-1.5 mr-auto min-w-0">
          {isCaptureActive ? (
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inset-0 rounded-full bg-red-500/35 animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
          ) : currentSessionId ? (
            <span className="inline-block size-2 rounded-full bg-muted-foreground/40 shrink-0" />
          ) : null}
          {(expanded && sessionTitle) || (isCaptureActive && uiState?.status === "connecting") ? (
            <span className="text-2xs text-muted-foreground truncate">
              {uiState?.status === "connecting" ? "Connecting…" : sessionTitle}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Collapse" : unseenTotal > 0 ? `Expand (${unseenTotal} new)` : "Expand"}
          aria-label={expanded ? "Collapse" : "Expand"}
          style={noDragStyle}
          className="relative flex items-center justify-center size-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/10 cursor-pointer transition-colors"
        >
          {expanded ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
          {!expanded && unseenTotal > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-2">
              <span className="absolute inset-0 rounded-full bg-emerald-500/45 animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
          )}
        </button>
      </div>
      {currentSessionId && suggestionProgress && (
        <MiniScanBar progress={suggestionProgress} configBudget={appConfig.suggestionScanWordBudget} />
      )}
      </div>
      )}

      {!overlayActive && headerHasContent && (
        <div className="overflow-y-auto shrink-0" style={{ maxHeight: HEADER_SCROLL_MAX }}>
          {currentSessionId && (suggestionScanCards.length > 0 || suggestions.length > 0) && (
            <ul className="px-2.5 pb-2 space-y-1">
              {isCaptureActive && suggestionScanCards
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 2)
                .map((card) => (
                  <AgentActivityCard
                    key={card.scanId}
                    progress={card}
                    agentSteps={card.agentSteps}
                    onRequestTaskScan={() => { void window.electronAPI.requestTaskScan(); }}
                  />
                ))}
              {suggestions.map((s) => (
                <SuggestionItem
                  key={s.id}
                  suggestion={s}
                  onAccept={() => handleAcceptSuggestion(s)}
                  onDismiss={() => handleDismissSuggestion(s.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        ref={contentRef}
        className={["flex-1 min-h-0 relative", expanded ? "" : "hidden"].join(" ")}
      >
        {!hydrated ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : !currentSessionId ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-foreground">No active session</p>
            <p className="text-xs text-muted-foreground">
              Press Record to start a new session.
            </p>
          </div>
        ) : (
          <div className="h-full [&>div]:bg-transparent [&>div]:border-l-0">
          <RightSidebar
            tasks={tasks}
            suggestions={suggestions}
            suggestionProgress={suggestionProgress}
            suggestionScanCards={suggestionScanCards}
            scanWordBudget={appConfig.suggestionScanWordBudget}
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
            sessionId={currentSessionId}
            sessionActive={isCaptureActive}
            onRequestTaskScan={() => { void window.electronAPI.requestTaskScan(); }}
            hideScanCounter
            hideScanActivity
            hideSuggestions
          />
          </div>
        )}
        {overlayActive && (
          <div className="absolute inset-0 bg-background flex flex-col">
            <div
              className="flex items-center pl-[78px] pr-2 py-1.5 border-b border-border/40 shrink-0"
              style={dragStyle}
            >
              <button
                type="button"
                onClick={() => {
                  if (selectedAgent) closeAgent(selectedAgent.id);
                  else ui().setNewAgentMode(false);
                }}
                style={noDragStyle}
                className="flex items-center gap-1 h-6 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/10 cursor-pointer transition-colors"
              >
                <ChevronLeftIcon className="size-3.5" />
                <span>Back</span>
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
            {newAgentMode ? (
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
                hideTaskCard
              />
            ) : null}
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={!!pendingApprovalTask}
        onOpenChange={(open) => {
          if (!open && !approvingLargeTask) ts().setPendingApprovalTask(null);
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
    </div>
  );
}
