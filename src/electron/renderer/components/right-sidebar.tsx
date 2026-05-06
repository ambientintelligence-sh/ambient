import { useState, useEffect, useRef, type ReactNode } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { TaskItem, TaskSuggestion, SuggestionKind, Agent } from "@core/types";
import {
  ChevronDownIcon,
  XIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  SearchIcon,
  PencilIcon,
  LightbulbIcon,
  AlertTriangleIcon,
  ListChecksIcon,
  ArchiveIcon,
} from "lucide-react";
import { SectionLabel } from "@/components/ui/section-label";
import { useUIStore } from "../stores/ui-store";

const SUGGESTION_TTL_MS = 5 * 60_000;

const SUGGESTION_KIND_ICONS: Record<SuggestionKind, typeof SearchIcon> = {
  research: SearchIcon,
  action: PencilIcon,
  insight: LightbulbIcon,
  flag: AlertTriangleIcon,
  followup: ListChecksIcon,
};
export const SUGGESTION_SURFACE_STYLES = {
  callout: {
    card:
      "border-[color-mix(in_oklab,oklch(0.62_0.11_205)_38%,var(--border))] bg-[color-mix(in_oklab,oklch(0.84_0.07_205)_16%,var(--background))]",
    popupCard:
      "border-[color-mix(in_oklab,oklch(0.62_0.11_205)_40%,var(--border))] bg-[color-mix(in_oklab,oklch(0.84_0.07_205)_18%,var(--background))]",
    icon:
      "bg-[color-mix(in_oklab,oklch(0.84_0.07_205)_34%,transparent)] text-[oklch(0.48_0.1_205)] dark:text-[oklch(0.78_0.08_205)]",
    text: "text-[oklch(0.36_0.07_205)] dark:text-[oklch(0.82_0.05_205)]",
    progressTrack: "bg-[oklch(0.62_0.11_205/0.12)]",
    progressBar: "bg-[oklch(0.62_0.11_205/0.48)]",
  },
  agent: {
    card:
      "border-[color-mix(in_oklab,oklch(0.72_0.14_72)_40%,var(--border))] bg-[color-mix(in_oklab,oklch(0.86_0.11_72)_15%,var(--background))]",
    popupCard:
      "border-[color-mix(in_oklab,oklch(0.72_0.14_72)_44%,var(--border))] bg-[color-mix(in_oklab,oklch(0.86_0.11_72)_17%,var(--background))]",
    icon:
      "bg-[color-mix(in_oklab,oklch(0.86_0.11_72)_36%,transparent)] text-[oklch(0.5_0.11_72)] dark:text-[oklch(0.82_0.09_72)]",
    text: "text-[oklch(0.42_0.08_72)] dark:text-[oklch(0.86_0.06_72)]",
    action:
      "bg-[oklch(0.58_0.13_72)] text-[oklch(0.99_0.01_85)] hover:bg-[oklch(0.52_0.13_72)] dark:bg-[oklch(0.76_0.11_72)] dark:text-[oklch(0.2_0.02_72)] dark:hover:bg-[oklch(0.82_0.1_72)]",
    progressTrack: "bg-[oklch(0.72_0.14_72/0.13)]",
    progressBar: "bg-[oklch(0.72_0.14_72/0.5)]",
  },
} as const;

type RightRailMode = "summary" | "tasks" | "transcript";
const EMPTY_SESSION_TAB_KEY = "__empty__";

type SuggestionProgress = {
  scanId?: string;
  label?: string;
  busy: boolean;
  wordsUntilNextScan: number;
  liveWordsUntilNextScan?: number;
  scanWordBudget?: number;
  step?: string;
  lastScanEmpty?: boolean;
  error?: string;
};

type SuggestionScanCard = SuggestionProgress & {
  scanId: string;
  agentSteps: string[];
  updatedAt: number;
};

type RightSidebarProps = {
  tasks: TaskItem[];
  suggestions: TaskSuggestion[];
  suggestionProgress?: SuggestionProgress;
  suggestionScanCards?: SuggestionScanCard[];
  scanWordBudget?: number;
  agents?: Agent[];
  selectedAgentId?: string | null;
  forceWorkTabKey?: number;
  onSelectAgent?: (id: string | null) => void;
  onLaunchAgent?: (task: TaskItem) => void;
  onToggleTask?: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onUpdateTask?: (id: string, text: string) => void;
  processingTaskIds?: string[];
  onAcceptSuggestion?: (suggestion: TaskSuggestion) => void;
  onDismissSuggestion?: (id: string) => void;
  archivedSuggestions?: TaskItem[];
  onAcceptArchivedTask?: (task: TaskItem) => void;
  onDeleteArchivedSuggestion?: (id: string) => void;
  sessionId?: string;
  sessionActive?: boolean;
  onRequestTaskScan?: () => void;
  isViewingPast?: boolean;
  hideScanCounter?: boolean;
  hideScanActivity?: boolean;
  hideSuggestions?: boolean;
  summaryContent?: ReactNode;
  transcriptContent?: ReactNode;
  captureBar?: ReactNode;
};

export function SuggestionItem({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: TaskSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const [opacity, setOpacity] = useState(1);
  const [progress, setProgress] = useState(100);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const age = Date.now() - suggestion.createdAt;
    const remaining = Math.max(0, SUGGESTION_TTL_MS - age);

    setProgress((remaining / SUGGESTION_TTL_MS) * 100);

    const interval = setInterval(() => {
      const elapsed = Date.now() - suggestion.createdAt;
      const pct = Math.max(0, 1 - elapsed / SUGGESTION_TTL_MS) * 100;
      setProgress(pct);
    }, 100);

    const fadeTimer = setTimeout(() => setOpacity(0), Math.max(0, remaining - 500));
    const dismissTimer = setTimeout(() => onDismissRef.current(), remaining);

    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimer);
      clearTimeout(dismissTimer);
    };
  }, [suggestion.createdAt]);

  const KindIcon = suggestion.kind ? SUGGESTION_KIND_ICONS[suggestion.kind] : SearchIcon;
  const isCallout = suggestion.surface === "callout";
  const surfaceStyle = isCallout ? SUGGESTION_SURFACE_STYLES.callout : SUGGESTION_SURFACE_STYLES.agent;
  const hasDetails = Boolean(suggestion.flag?.trim() || suggestion.details?.trim() || suggestion.transcriptExcerpt?.trim());

  return (
    <li
      className={[
        "relative overflow-hidden rounded-xl border shadow-[inset_0_1px_0_hsl(var(--background)/0.7)] transition-opacity duration-500",
        surfaceStyle.card,
      ].join(" ")}
      style={{ opacity }}
    >
      <div className="flex items-start gap-2 min-h-7 py-1.5 px-2 relative z-10">
        <div className={["mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", surfaceStyle.icon].join(" ")}>
          <KindIcon className="size-3" />
        </div>
        <div className="min-w-0 flex-1">
          {suggestion.flag?.trim() && (
            <div className={["mb-1 text-[11px] font-medium break-words", surfaceStyle.text].join(" ")}>
              {suggestion.flag.trim()}
            </div>
          )}
          <div className="text-xs text-foreground break-words">
            {suggestion.text}
          </div>
          {hasDetails && (
            <button
              type="button"
              onClick={() => setDetailsOpen((prev) => !prev)}
              className="mt-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {detailsOpen ? "Hide context" : "Show context"}
            </button>
          )}
          {detailsOpen && hasDetails && (
            <div className="mt-1.5 space-y-1 text-2xs text-muted-foreground">
              {suggestion.flag?.trim() && !suggestion.details?.trim() && !suggestion.transcriptExcerpt?.trim() && (
                <p className="whitespace-pre-wrap break-words">{suggestion.flag.trim()}</p>
              )}
              {suggestion.details?.trim() && (
                <p className="whitespace-pre-wrap break-words">{suggestion.details.trim()}</p>
              )}
              {suggestion.transcriptExcerpt?.trim() && (
                <p className="whitespace-pre-wrap break-words italic text-muted-foreground/85">
                  {suggestion.transcriptExcerpt.trim()}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {!isCallout && (
            <button
              type="button"
              onClick={onAccept}
              className={["inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors", SUGGESTION_SURFACE_STYLES.agent.action].join(" ")}
              aria-label="Dispatch agent"
              title="Dispatch agent"
            >
              <PlayIcon className="size-3" />
              <span>Dispatch Agent</span>
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className={[
              "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md text-[11px] transition-colors",
              isCallout
                ? "px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                : "px-1 text-muted-foreground hover:text-foreground",
            ].join(" ")}
            aria-label="Dismiss suggestion"
          >
            <XIcon className="size-3" />
            {isCallout && <span>Dismiss</span>}
          </button>
        </div>
      </div>
      <div className={["absolute inset-x-2 bottom-1 h-[2px] overflow-hidden rounded-full", surfaceStyle.progressTrack].join(" ")}>
        <div className={["h-full rounded-full transition-none", surfaceStyle.progressBar].join(" ")} style={{ width: `${progress}%` }} />
      </div>
    </li>
  );
}

const STEP_NOISE = new Set(["Thinking…", "Gathering context…", "Drafting suggestions…"]);

export function SuggestionCounterRow({
  progress,
  configBudget,
}: {
  progress: SuggestionProgress;
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
    <div className="mb-2 px-1">
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

function ManualScanButton({ onRequestTaskScan }: { onRequestTaskScan?: () => void }) {
  if (!onRequestTaskScan) return null;

  return (
    <button
      type="button"
      onClick={() => onRequestTaskScan()}
      className="inline-flex h-6 items-center rounded-md border border-border/70 px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      Scan now
    </button>
  );
}

export function AgentActivityCard({
  progress,
  agentSteps,
  onRequestTaskScan,
  surface = "sidebar",
}: {
  progress: SuggestionProgress;
  agentSteps: string[];
  onRequestTaskScan?: () => void;
  surface?: "sidebar" | "popup";
}) {
  const DISMISS_MS = 5000;
  const [opacity, setOpacity] = useState(1);
  const [barPct, setBarPct] = useState(100);
  const [dismissed, setDismissed] = useState(false);
  const lastMeaningfulStepRef = useRef<string | undefined>(undefined);
  const cardLabel = progress.label ?? "Suggestion agent";
  const isFinished = !progress.busy;
  const hasError = !!progress.error;
  const isNothingFound = isFinished && !!progress.lastScanEmpty;
  const isPopup = surface === "popup";

  useEffect(() => {
    if (hasError) {
      setOpacity(1);
      setBarPct(100);
      setDismissed(false);
      return;
    }
    if (!isFinished) {
      setOpacity(1);
      setBarPct(100);
      setDismissed(false);
      return;
    }
    const startTime = Date.now();
    const interval = setInterval(() => {
      const pct = Math.max(0, 1 - (Date.now() - startTime) / DISMISS_MS) * 100;
      setBarPct(pct);
    }, 100);
    const fadeTimer = setTimeout(() => setOpacity(0), DISMISS_MS - 400);
    const dismissTimer = setTimeout(() => setDismissed(true), DISMISS_MS);
    return () => { clearInterval(interval); clearTimeout(fadeTimer); clearTimeout(dismissTimer); };
  }, [isFinished]);

  if (dismissed) return null;

  if (hasError) {
    return (
      <li
        className={[
          "relative overflow-hidden rounded-xl border border-destructive/30 transition-opacity duration-500",
          isPopup ? "bg-background text-foreground shadow-[0_18px_46px_rgba(0,0,0,0.22)]" : "bg-destructive/5",
        ].join(" ")}
        style={{ opacity }}
      >
        <div className="flex items-center gap-2 min-h-7 py-1.5 px-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-foreground/80">{cardLabel}</div>
            <div className="mt-0.5 text-2xs text-destructive/80">Scan failed</div>
            <div className="mt-1 text-2xs leading-5 text-muted-foreground/80 break-words">
              {progress.error}
            </div>
            <div className="mt-2">
              <ManualScanButton onRequestTaskScan={onRequestTaskScan} />
            </div>
          </div>
        </div>
      </li>
    );
  }

  if (isNothingFound) {
    return (
      <li
        className={[
          "relative overflow-hidden rounded-xl border border-border/50 transition-opacity duration-500",
          isPopup ? "bg-background text-foreground shadow-[0_18px_46px_rgba(0,0,0,0.22)]" : "bg-background/60",
        ].join(" ")}
        style={{ opacity }}
      >
        <div className="flex items-center gap-2 min-h-7 py-1.5 px-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground/75">{cardLabel}</div>
            <div className="mt-0.5 text-2xs text-muted-foreground/60 italic">Nothing found this scan</div>
          </div>
        </div>
        <div className="absolute inset-x-2 bottom-1 h-[2px] overflow-hidden rounded-full bg-muted/45">
          <div className="h-full rounded-full bg-muted-foreground/20" style={{ width: `${barPct}%`, transition: "width 100ms linear" }} />
        </div>
      </li>
    );
  }

  if (isFinished) {
    return (
      <li
        className={[
          "relative overflow-hidden rounded-xl border border-primary/20 transition-opacity duration-500",
          isPopup ? "bg-background text-foreground shadow-[0_18px_46px_rgba(0,0,0,0.22)]" : "bg-primary/5",
        ].join(" ")}
        style={{ opacity }}
      >
        <div className="flex items-center gap-2 min-h-7 py-1.5 px-2">
          <SearchIcon className="size-3 shrink-0 text-primary/60" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-foreground/80">{cardLabel}</div>
            <div className="mt-0.5 text-2xs uppercase tracking-[0.14em] text-muted-foreground/60">{progress.step ?? "Suggestions ready"}</div>
          </div>
        </div>
        <div className="absolute inset-x-2 bottom-1 h-[2px] overflow-hidden rounded-full bg-primary/8">
          <div className="h-full rounded-full bg-primary/25" style={{ width: `${barPct}%`, transition: "width 100ms linear" }} />
        </div>
      </li>
    );
  }

  const visibleSteps = agentSteps.filter((s) => !STEP_NOISE.has(s));
  const activeStep = progress.step && !STEP_NOISE.has(progress.step) ? progress.step : undefined;
  if (activeStep) lastMeaningfulStepRef.current = activeStep;
  else if (visibleSteps.length > 0) lastMeaningfulStepRef.current = visibleSteps[visibleSteps.length - 1];
  const stableStep = lastMeaningfulStepRef.current;
  const completedCount = stableStep
    ? Math.max(0, visibleSteps.lastIndexOf(stableStep))
    : visibleSteps.length;
  const statusText = completedCount > 0
    ? `${completedCount} step${completedCount === 1 ? "" : "s"} done`
    : "Scanning";
  const title = stableStep ?? "Working on suggestions";
  const isWaiting = progress.busy && (progress.step === "Preparing scan…" || !progress.step);

  return (
    <li
      className={[
        "relative overflow-hidden rounded-2xl border border-primary/20 px-3 py-2.5",
        isPopup
          ? "bg-background text-foreground shadow-[0_18px_46px_rgba(0,0,0,0.24)]"
          : "bg-primary/[0.045] shadow-[inset_0_1px_0_hsl(var(--background)/0.7)]",
      ].join(" ")}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <LoaderCircleIcon className="size-3 animate-spin text-primary/70" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-foreground/85">{title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
                <span>{cardLabel}</span>
                <span className="text-muted-foreground/35">•</span>
                <span>{statusText}</span>
              </div>
            </div>
            {isWaiting && <ManualScanButton onRequestTaskScan={onRequestTaskScan} />}
          </div>
        </div>
      </div>
    </li>
  );
}

function RailModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-7 cursor-pointer rounded-sm text-xs transition-colors",
        active
          ? "bg-background text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/70",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function RightSidebar({
  suggestions,
  suggestionProgress,
  suggestionScanCards = [],
  scanWordBudget,
  forceWorkTabKey = 0,
  onAcceptSuggestion,
  onDismissSuggestion,
  archivedSuggestions = [],
  onAcceptArchivedTask,
  onDeleteArchivedSuggestion,
  sessionId,
  sessionActive = false,
  onRequestTaskScan,
  hideScanCounter = false,
  hideScanActivity = false,
  hideSuggestions = false,
  summaryContent,
  transcriptContent,
  captureBar,
}: RightSidebarProps) {
  const [modeBySession, setModeBySession] = useLocalStorage<Record<string, RightRailMode>>("ambient-right-rail-mode-v2", {});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const sessionTabKey = sessionId ?? EMPTY_SESSION_TAB_KEY;
  const mode = modeBySession[sessionTabKey] ?? "tasks";
  const setMode = (nextMode: RightRailMode) => {
    setModeBySession((prev) => ({ ...prev, [sessionTabKey]: nextMode }));
  };

  useEffect(() => {
    if (forceWorkTabKey > 0) setMode("tasks");
  }, [forceWorkTabKey, setMode]);

  const onboardingPhase = useUIStore((s) => s.onboardingPhase);
  const tourStep = useUIStore((s) => s.tourStep);

  useEffect(() => {
    if (onboardingPhase !== "tour") return;
    if (tourStep === 2) setMode("tasks");
    if (tourStep === 3) setMode("summary");
  }, [onboardingPhase, tourStep, setMode]);

  const activeSuggestionCards = [...suggestionScanCards]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  return (
    <div className="w-full h-full shrink-0 border-l border-sidebar-border/35 flex flex-col min-h-0 bg-sidebar/90">
      {captureBar}
      <div className="px-2 py-2 shrink-0">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-foreground/[0.045] p-1 dark:bg-muted/50">
          <RailModeButton
            active={mode === "summary"}
            onClick={() => setMode("summary")}
            label="Summary"
          />
          <RailModeButton
            active={mode === "tasks"}
            onClick={() => setMode("tasks")}
            label="Tasks"
          />
          <RailModeButton
            active={mode === "transcript"}
            onClick={() => setMode("transcript")}
            label="Transcript"
          />
        </div>
      </div>
      <div className={`flex-1 min-h-0 ${mode === "tasks" ? "overflow-y-auto px-3 pb-3" : "flex flex-col"}`}>
        {mode === "tasks" ? (
          <>
            <div>
              {!hideSuggestions && (
                <div className="sticky top-0 z-20 -mx-1 mb-2 rounded-xl bg-sidebar/88 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-sidebar/72">
                  <SectionLabel as="span">Suggested tasks</SectionLabel>
                </div>
              )}
              {sessionActive && suggestionProgress && !hideScanCounter && (
                <SuggestionCounterRow progress={suggestionProgress} configBudget={scanWordBudget} />
              )}
              {!hideSuggestions && (
                (suggestions.length > 0 || (sessionActive && suggestionProgress)) ? (
                  <ul className="space-y-1">
                    {sessionActive && !hideScanActivity && activeSuggestionCards.map((card) => (
                      <AgentActivityCard
                        key={card.scanId}
                        progress={card}
                        agentSteps={card.agentSteps}
                        onRequestTaskScan={onRequestTaskScan}
                      />
                    ))}
                    {suggestions.map((s) => (
                      <SuggestionItem
                        key={s.id}
                        suggestion={s}
                        onAccept={() => onAcceptSuggestion?.(s)}
                        onDismiss={() => onDismissSuggestion?.(s.id)}
                      />
                    ))}
                  </ul>
                ) : archivedSuggestions.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    Suggested tasks will appear here
                  </p>
                ) : null
              )}
              {archivedSuggestions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setArchivedOpen((prev) => !prev)}
                  className="mt-3 flex cursor-pointer items-center gap-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDownIcon
                    className={`size-3 transition-transform ${archivedOpen ? "" : "-rotate-90"}`}
                  />
                  <ArchiveIcon className="size-3" />
                  Archived ({archivedSuggestions.length})
                </button>
              )}
              {archivedSuggestions.length > 0 && archivedOpen && (
                <ul className="mt-1.5 space-y-1">
                  {archivedSuggestions.map((task) => {
                    const KindIcon = task.suggestionKind ? SUGGESTION_KIND_ICONS[task.suggestionKind] : SearchIcon;
                    return (
                      <li
                        key={task.id}
                        className="group rounded-xl border border-border/45 bg-background/60"
                      >
                        <div className="flex items-start gap-2 min-h-7 py-1.5 px-2">
                          <KindIcon className="size-3 shrink-0 text-muted-foreground/50 mt-0.5" />
                          <span className="text-xs text-muted-foreground flex-1 break-words">
                            {task.text}
                          </span>
                          <button
                            type="button"
                            onClick={() => onAcceptArchivedTask?.(task)}
                            className="shrink-0 cursor-pointer p-0.5 text-muted-foreground transition-colors hover:text-primary opacity-0 group-hover:opacity-100"
                            aria-label="Accept archived suggestion"
                          >
                            <PlusIcon className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteArchivedSuggestion?.(task.id)}
                            className="shrink-0 cursor-pointer p-0.5 text-muted-foreground transition-colors hover:text-destructive opacity-0 group-hover:opacity-100"
                            aria-label="Delete archived suggestion"
                          >
                            <Trash2Icon className="size-3" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : mode === "summary" ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">
              {summaryContent ?? (
                <p className="px-3 py-3 text-xs text-muted-foreground italic">
                  Summary will appear here.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {transcriptContent ?? (
              <p className="px-3 py-3 text-xs text-muted-foreground italic">
                Transcript will appear here.
              </p>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
