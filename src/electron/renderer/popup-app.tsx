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
  CheckIcon,
  XIcon,
  ClockIcon,
  AlertCircleIcon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";
import type {
  Agent,
  AppConfig,
  LanguageCode,
  TaskItem,
  TaskSuggestion,
  UIState,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  AgentPlanApprovalResponse,
} from "@core/types";
import { DEFAULT_APP_CONFIG, normalizeAppConfig } from "@core/types";
import { useAgents } from "./hooks/use-agents";
import { useMicCapture } from "./hooks/use-mic-capture";
import { useThemeMode } from "./hooks/use-theme-mode";
import { AgentActivityCard } from "./components/right-sidebar";
import { AgentDetailPanel } from "./components/agent-detail-panel";
import { NewAgentPanel } from "./components/new-agent-panel";
import { ErrorBoundary } from "./components/error-boundary";
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
import { rlog } from "./lib/renderer-log";

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

const EXPANDED_HEIGHT = 560;
const OVERLAY_HEIGHT = 720;
const HEADER_SCROLL_MAX = 280;
const MAX_HEIGHT_RATIO = 0.85;
const POPUP_RESIZE_BUFFER = 12;

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
  const visibleRatio = Math.max(committedRatio, liveRatio);
  return (
    <div className="px-3">
      <div
        aria-label="Suggestion scan progress"
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={[
            "h-full rounded-full bg-primary/55 transition-[width] duration-300 ease-out",
            progress.busy ? "animate-pulse" : "",
          ].join(" ")}
          style={{ width: progress.busy ? "100%" : `${Math.round(visibleRatio * 100)}%` }}
        />
      </div>
    </div>
  );
}

function MiniSuggestionCard({
  suggestion,
  onQueue,
  onDismiss,
  style,
  surface = "panel",
}: {
  suggestion: TaskSuggestion;
  onQueue: () => void;
  onDismiss: () => void;
  style?: React.CSSProperties;
  surface?: "panel" | "collapsed";
}) {
  const hasContext = Boolean(suggestion.flag?.trim() || suggestion.details?.trim() || suggestion.transcriptExcerpt?.trim());

  return (
    <li
      className={[
        "list-none animate-in slide-in-from-top-2 fade-in duration-300 rounded-[18px] p-3 backdrop-blur-2xl",
        surface === "collapsed"
          ? "border border-border/25 bg-background/96 dark:bg-background/90"
          : "bg-background/92 shadow-[0_18px_46px_rgba(0,0,0,0.18)] dark:bg-background/84",
      ].join(" ")}
      style={style}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ClockIcon className="size-3" />
        </div>
        <div className="min-w-0 flex-1">
          {suggestion.flag?.trim() && (
            <div className="mb-1 text-[11px] font-medium leading-snug text-foreground/70">
              {suggestion.flag.trim()}
            </div>
          )}
          <div className="text-xs font-medium leading-snug text-foreground">
            {suggestion.text}
          </div>
          {hasContext && (
            <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {suggestion.details?.trim() || suggestion.transcriptExcerpt?.trim()}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3" />
          Dismiss
        </button>
        <button
          type="button"
          onClick={onQueue}
          className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <CheckIcon className="size-3" />
          Run
        </button>
      </div>
    </li>
  );
}

function MiniSuggestionStack({
  suggestions,
  onQueueSuggestion,
  onDismissSuggestion,
}: {
  suggestions: TaskSuggestion[];
  onQueueSuggestion: (suggestion: TaskSuggestion) => void;
  onDismissSuggestion: (id: string) => void;
}) {
  const visible = suggestions.slice(0, 3);
  const topSuggestion = visible[0];
  const cardBacks = visible.slice(1, 3);
  const peekStep = 10;
  const stackPaddingBottom = Math.max(14, cardBacks.length * peekStep + 6);
  return (
    <div
      className="relative pointer-events-auto px-3 pt-2"
      style={{ paddingBottom: `${stackPaddingBottom}px` }}
    >
      {cardBacks.map((suggestion, index) => {
        const bottomOffset = stackPaddingBottom - (index + 1) * peekStep;
        return (
          <div
            key={suggestion.id}
            className="absolute top-2 rounded-[18px] border border-border/20 bg-background/90 backdrop-blur-2xl transition-all duration-300 ease-out dark:bg-background/78"
            style={{
              left: "12px",
              right: "12px",
              bottom: `${bottomOffset}px`,
              opacity: 0.92 - index * 0.06,
              zIndex: 12 - index,
            }}
          />
        );
      })}
      {topSuggestion && (
        <div className="relative z-30 transition-all duration-300 ease-out">
          <MiniSuggestionCard
            suggestion={topSuggestion}
            onQueue={() => onQueueSuggestion(topSuggestion)}
            onDismiss={() => onDismissSuggestion(topSuggestion.id)}
            surface="collapsed"
          />
        </div>
      )}
    </div>
  );
}

function MiniWorkflowPanel({
  suggestions,
  agents,
  onQueueSuggestion,
  onDismissSuggestion,
  onOpenAgent,
  panelRef,
}: {
  suggestions: TaskSuggestion[];
  agents: Agent[];
  onQueueSuggestion: (suggestion: TaskSuggestion) => void;
  onDismissSuggestion: (id: string) => void;
  onOpenAgent: (agent: Agent) => void;
  panelRef?: React.Ref<HTMLDivElement>;
}) {
  const activeAgents = agents.filter((agent) => !agent.archived);
  const runningAgents = activeAgents.filter((agent) => agent.status === "running").length;
  const doneAgents = activeAgents.filter((agent) => agent.status === "completed").length;
  const failedAgents = activeAgents.filter((agent) => agent.status === "failed").length;
  const hasAttention = suggestions.length > 0 || activeAgents.length > 0;
  const statusLabel = (agent: Agent) => {
    if (agent.status === "running") return "Running";
    if (agent.status === "failed") return "Failed";
    return "Done";
  };
  const relativeTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div ref={panelRef} className="flex h-full flex-col gap-3 overflow-y-auto px-3 pb-3 pt-2">
      {suggestions.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Suggestions
            </h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {suggestions.length} new
            </span>
          </div>
          <ul className="space-y-2">
            {suggestions.map((suggestion, index) => (
              <MiniSuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onQueue={() => onQueueSuggestion(suggestion)}
                onDismiss={() => onDismissSuggestion(suggestion.id)}
                style={{ animationDelay: `${index * 45}ms` }}
              />
            ))}
          </ul>
        </section>
      )}

      {activeAgents.length > 0 && (
        <section className="rounded-md border border-border/60 bg-background/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center justify-between px-2.5 py-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Agents ({activeAgents.length})
            </h2>
            <div className="flex flex-wrap justify-end gap-1 text-[10px] text-muted-foreground">
              {runningAgents > 0 && <span>{runningAgents} running</span>}
              {doneAgents > 0 && <span>{doneAgents} done</span>}
              {failedAgents > 0 && <span>{failedAgents} failed</span>}
            </div>
          </div>
          <div className="mx-2.5 h-px bg-border/60" />
          <ul className="space-y-1 p-2">
            {activeAgents.slice(0, 6).map((agent) => {
              const canOpen = agent.status !== "running";
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    disabled={!canOpen}
                    onClick={() => onOpenAgent(agent)}
                    className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-left transition-colors enabled:hover:border-border/60 enabled:hover:bg-background/60 disabled:cursor-default"
                  >
                    <HugeiconsIcon
                      icon={WorkoutRunIcon}
                      className={[
                        "size-3.5 shrink-0",
                        agent.status === "running"
                          ? "text-primary animate-pulse"
                          : agent.status === "failed"
                          ? "text-destructive"
                          : "text-green-500",
                      ].join(" ")}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="block truncate text-xs text-foreground">
                        {agent.task}
                      </span>
                    </span>
                    <span className="shrink-0 text-2xs font-mono text-muted-foreground">
                      {statusLabel(agent)} · {relativeTime(agent.completedAt ?? agent.createdAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!hasAttention && (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="mb-2 flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <AlertCircleIcon className="size-4" />
          </div>
          <p className="text-sm font-medium text-foreground">Nothing needs attention</p>
          <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-muted-foreground">
            New task suggestions will slide in here while Ambient listens.
          </p>
        </div>
      )}
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
  const toolbarRowRef = useRef<HTMLDivElement>(null);
  const headerContentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const expandedPanelRef = useRef<HTMLDivElement>(null);

  const [storedAppConfig] = useLocalStorage<AppConfig>("ambient-app-config", DEFAULT_APP_CONFIG);
  const appConfig = normalizeAppConfig(storedAppConfig);
  const [sourceLang] = useLocalStorage<LanguageCode>("ambient-source-lang", "en");
  const [targetLang] = useLocalStorage<LanguageCode>("ambient-translate-to-lang", "en");
  const [translateToSelection] = useLocalStorage<LanguageCode | "off">("ambient-translate-to-selection", "off");
  const [armedMicInput, setArmedMicInput] = useLocalStorage<boolean>("ambient-armed-mic-input", true);
  const [armedDeviceAudio, setArmedDeviceAudio] = useLocalStorage<boolean>("ambient-armed-device-audio", true);
  useThemeMode(appConfig.themeMode, appConfig.lightVariant, appConfig.darkVariant, appConfig.fontSize, appConfig.fontFamily);

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

  useEffect(() => {
    const previousBodyBackground = document.body.style.background;
    const previousDocumentBackground = document.documentElement.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => {
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousDocumentBackground;
    };
  }, []);


  // Window sizing:
  //  - expanded → natural content height up to the expanded cap
  //  - collapsed suggestions → natural card height, with no inner scrolling
  //  - collapsed scan activity → compact capped preview
  //  - collapsed empty → just the toolbar buttons row
  const headerHasContent =
    !!currentSessionId && (suggestionScanCards.length > 0 || suggestions.length > 0);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const rowHeight = toolbarRowRef.current?.offsetHeight ?? 40;
      const scanBarHeight = currentSessionId && suggestionProgress ? 4 : 0;
      const tb = rowHeight + scanBarHeight;
      const max = Math.floor(window.screen.availHeight * MAX_HEIGHT_RATIO);
      const inOverlay = !!selectedAgent || newAgentMode;
      if (inOverlay) {
        void window.electronAPI.resizeAgentsPopup(Math.min(OVERLAY_HEIGHT + POPUP_RESIZE_BUFFER, max));
        return;
      }
      if (expanded) {
        const expandedContentHeight = expandedPanelRef.current?.scrollHeight ?? 0;
        const desired = tb + Math.max(160, expandedContentHeight) + POPUP_RESIZE_BUFFER;
        void window.electronAPI.resizeAgentsPopup(Math.min(desired, EXPANDED_HEIGHT, max));
        return;
      }
      const rawHeaderContentHeight = headerContentRef.current?.scrollHeight ?? 0;
      const headerContentHeight = !headerHasContent
        ? 0
        : suggestions.length > 0
          ? rawHeaderContentHeight
          : Math.min(rawHeaderContentHeight, HEADER_SCROLL_MAX);
      const target = tb + headerContentHeight + POPUP_RESIZE_BUFFER;
      void window.electronAPI.resizeAgentsPopup(Math.min(target, max));
    });
    return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    expanded,
    headerHasContent,
    selectedAgent,
    newAgentMode,
    currentSessionId,
    suggestions.length,
    suggestionScanCards.length,
    suggestionProgress.busy,
    suggestionProgress.wordsUntilNextScan,
    agents.length,
    hydrated,
  ]);

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
    if (delta > 0 && !expanded) setUnseenAgents((n) => n + delta);
    prevAgentCountRef.current = agents.length;
  }, [agents.length, hydrated, expanded]);
  useEffect(() => {
    if (pendingApprovalTask) setExpanded(true);
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
    void window.electronAPI.getActiveSessionState().then((state) => {
      if (state) setUiState(state);
    });
    const cleanups = [
      window.electronAPI.onActiveSessionChanged((id) => {
        setCurrentSessionId(id);
        if (!id) setUiState(null);
        else {
          // New session became active while popup is open — pull a fresh snapshot
          // so we don't wait for the next state-change event.
          void window.electronAPI.getActiveSessionState().then((state) => {
            if (state) setUiState(state);
          });
        }
      }),
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
      try {
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
      } catch (err) {
        rlog("ERROR", "Popup hydration failed", err);
        if (!cancelled) setHydrated(true);
      }
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
      window.electronAPI.onTasksChanged((sid, nextTasks, nextArchivedTasks, changedTaskId) => {
        if (!currentSessionId || sid !== currentSessionId) return;
        const activeTaskIds = new Set(nextTasks.map((task) => task.id));
        const currentSuggestions = useTaskStore.getState().suggestions;
        const nextSuggestions = currentSuggestions.filter((suggestion) => {
          if (activeTaskIds.has(suggestion.id)) return false;
          return !changedTaskId || suggestion.id !== changedTaskId;
        });
        const liveSuggestionIds = new Set(nextSuggestions.map((suggestion) => suggestion.id));
        ts().setTasks(nextTasks);
        ts().setArchivedSuggestions(nextArchivedTasks.filter((task) => !liveSuggestionIds.has(task.id)));
        ts().setSuggestions(nextSuggestions);
      }),
      window.electronAPI.onTaskAdded((task) => {
        if (task.sessionId && task.sessionId !== currentSessionId) return;
        const exists = useTaskStore.getState().tasks.some((t) => t.id === task.id);
        if (!exists) ts().addTask(task);
        ts().setSuggestions(useTaskStore.getState().suggestions.filter((suggestion) => suggestion.id !== task.id));
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
      ts().markTaskCompleted(task.id);
      return true;
    }
    rlog("WARN", `Popup launchTaskAgent failed`, result);
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

  const handleAcceptSuggestion = async (suggestion: TaskSuggestion) => {
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

  const handleDismissSuggestion = (id: string) => ts().dismissSuggestion(id, appConfig);
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
  const solidSurface = expanded || overlayActive;

  return (
    <div className={[
      "flex flex-col h-screen overflow-hidden text-foreground",
      solidSurface ? "rounded-[14px] border border-border/55 bg-background shadow-sm" : "bg-transparent pointer-events-none",
    ].join(" ")}>
      {!overlayActive && (
      <div
        ref={toolbarRef}
        className={[
          "flex flex-col shrink-0 pointer-events-auto",
          solidSurface ? "" : "rounded-[14px] border border-border/55 bg-background shadow-sm",
        ].join(" ")}
        style={dragStyle}
      >
      <div ref={toolbarRowRef} className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => { void handleRecordToggle(); }}
          disabled={uiState?.status === "connecting"}
          title={isCaptureActive ? "Stop recording" : currentSessionId ? "Start recording" : "Start session and record"}
          style={noDragStyle}
          className={[
            "flex h-7 w-[86px] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
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

        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 ml-1.5">
          {isCaptureActive ? (
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inset-0 rounded-full bg-red-500/35 animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
          ) : currentSessionId ? (
            <span className="inline-block size-2 rounded-full bg-muted-foreground/40 shrink-0" />
          ) : (
            <span className="inline-block size-2 rounded-full bg-transparent shrink-0" />
          )}
          {uiState?.status === "connecting" ? (
            <span className="text-2xs text-muted-foreground truncate">Connecting…</span>
          ) : isCaptureActive ? (
            <span className="text-2xs text-red-600/80 dark:text-red-300/80 truncate">Recording</span>
          ) : currentSessionId && sessionTitle ? (
            <span className="text-2xs text-muted-foreground truncate">{sessionTitle}</span>
          ) : (
            <span className="text-2xs text-muted-foreground/70 truncate">Ambient</span>
          )}
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
        <button
          type="button"
          onClick={() => { void window.electronAPI.closeAgentsPopup(); }}
          title="Close mini window"
          aria-label="Close mini window"
          style={noDragStyle}
          className="flex items-center justify-center size-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/10 cursor-pointer transition-colors"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      {currentSessionId && suggestionProgress && (
        <MiniScanBar
          progress={suggestionProgress}
          configBudget={appConfig.suggestionScanWordBudget}
        />
      )}
      </div>
      )}

      {!overlayActive && !expanded && headerHasContent && (
        <div
          ref={headerContentRef}
          className="pointer-events-auto overflow-hidden shrink-0"
          style={suggestions.length > 0 ? undefined : { maxHeight: HEADER_SCROLL_MAX }}
        >
          {currentSessionId && suggestions.length > 0 && (
            <MiniSuggestionStack
              suggestions={suggestions}
              onQueueSuggestion={(suggestion) => { void handleAcceptSuggestion(suggestion); }}
              onDismissSuggestion={handleDismissSuggestion}
            />
          )}
          {currentSessionId && suggestions.length === 0 && suggestionScanCards.length > 0 && (
            <ul className="px-3 pb-2 pt-2 space-y-2">
              {isCaptureActive && suggestionScanCards
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 1)
                .map((card) => (
                  <AgentActivityCard
                    key={card.scanId}
                    progress={card}
                    agentSteps={card.agentSteps}
                    onRequestTaskScan={() => { void window.electronAPI.requestTaskScan(); }}
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
          <div className="h-full">
          <ErrorBoundary tag="popup-sidebar">
          <MiniWorkflowPanel
            suggestions={suggestions}
            agents={agents}
            panelRef={expandedPanelRef}
            onQueueSuggestion={(suggestion) => { void handleAcceptSuggestion(suggestion); }}
            onDismissSuggestion={handleDismissSuggestion}
            onOpenAgent={(agent) => {
              if (!currentSessionId) return;
              void window.electronAPI.openAgentInMainApp(currentSessionId, agent.id);
            }}
          />
          </ErrorBoundary>
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
            <ErrorBoundary tag="popup-overlay">
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
            </ErrorBoundary>
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
