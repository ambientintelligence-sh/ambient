import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { TaskItem, TaskSuggestion, SuggestionKind, Agent } from "@core/types";
import {
  ChevronDownIcon,
  XIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  ZapIcon,
  SearchIcon,
  PencilIcon,
  LightbulbIcon,
  AlertTriangleIcon,
  ListChecksIcon,
  ArchiveIcon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputHeader,
} from "@/components/ai-elements/prompt-input";
import { AgentList } from "./agent-list";
import { AgentDebriefPanel } from "./agent-debrief-panel";
import { useAgentsSummary } from "../hooks/use-agents-summary";
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
type RightRailMode = "work" | "agents";
const EMPTY_SESSION_TAB_KEY = "__empty__";

type RightSidebarProps = {
  tasks: TaskItem[];
  suggestions: TaskSuggestion[];
  agents?: Agent[];
  selectedAgentId?: string | null;
  forceWorkTabKey?: number;
  onSelectAgent?: (id: string | null) => void;
  onLaunchAgent?: (task: TaskItem) => void;
  onNewAgent?: () => void;
  onAddTask?: (text: string, details?: string) => void;
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
  transcriptRefs?: string[];
  onRemoveTranscriptRef?: (index: number) => void;
  onSubmitTaskInput?: (text: string, refs: string[]) => void;
};

function isLineClamped(el: HTMLElement): boolean {
  return el.scrollHeight - el.clientHeight > 1 || el.scrollWidth - el.clientWidth > 1;
}

function SuggestionItem({
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
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const demoMode = useUIStore((s) => s.demoMode);

  useEffect(() => {
    if (demoMode) {
      setProgress(100);
      setOpacity(1);
      return;
    }

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
  }, [suggestion.createdAt, demoMode]);

  const KindIcon = suggestion.kind ? SUGGESTION_KIND_ICONS[suggestion.kind] : SearchIcon;

  return (
    <li
      className="relative overflow-hidden border-l-2 border-l-primary/40 bg-primary/5 transition-opacity duration-500"
      style={{ opacity }}
    >
      <div className="flex items-start gap-2 min-h-7 py-1.5 px-2 relative z-10">
        <KindIcon className="size-3 shrink-0 text-muted-foreground mt-0.5" />
        <span className="text-xs text-foreground flex-1 break-words">
          {suggestion.text}
        </span>
        <button
          type="button"
          onClick={onAccept}
          className="shrink-0 cursor-pointer p-0.5 text-primary transition-colors hover:text-primary/80"
          aria-label="Add to tasks"
        >
          <PlusIcon className="size-3" />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 cursor-pointer p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Dismiss suggestion"
        >
          <XIcon className="size-3" />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-primary/5">
        <div className="h-full bg-primary/30 transition-none" style={{ width: `${progress}%` }} />
      </div>
    </li>
  );
}

function EditableTaskItem({
  task,
  isProcessing,
  agent,
  onToggle,
  onDelete,
  onUpdate,
  onLaunchAgent,
  onSelectAgent,
}: {
  task: TaskItem;
  isProcessing: boolean;
  agent?: Agent;
  onToggle?: () => void;
  onDelete?: () => void;
  onUpdate?: (text: string) => void;
  onLaunchAgent?: () => void;
  onSelectAgent?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsClamped, setDetailsClamped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLParagraphElement>(null);
  const taskDetails = task.details?.trim() ?? "";
  const hasDetails = taskDetails.length > 0;
  const needsExpandButton = detailsOpen || detailsClamped;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    const el = detailsRef.current;
    if (!el || detailsOpen) {
      setDetailsClamped(false);
      return;
    }

    const measure = () => setDetailsClamped(isLineClamped(el));
    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [taskDetails, detailsOpen]);

  function handleDoubleClick() {
    if (isProcessing || !onUpdate) return;
    setDraft(task.text);
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.text) onUpdate?.(trimmed);
    setEditing(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(false);
  }

  return (
    <li className="flex items-start gap-2 min-h-7 group px-1 -mx-1 rounded-sm hover:bg-muted/60 transition-colors py-1.5 cursor-pointer">
      {isProcessing ? (
        <LoaderCircleIcon className="size-3 shrink-0 text-muted-foreground animate-spin mt-px" />
      ) : (
        <input
          type="checkbox"
          checked={false}
          onChange={onToggle}
          className="size-3 shrink-0 rounded-sm border-border accent-primary cursor-pointer mt-px"
        />
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKey}
          className="flex-1 text-xs bg-transparent border-b border-primary outline-none"
        />
      ) : (
        <div className="flex-1 min-w-0">
          <span
            onDoubleClick={handleDoubleClick}
            className={`text-xs block break-words leading-normal ${isProcessing ? "text-muted-foreground italic" : "text-foreground"} ${onUpdate && !isProcessing ? "cursor-text" : ""}`}
          >
            {task.text}
          </span>
          {hasDetails && (
            <div className="mt-0.5">
              <p
                ref={detailsRef}
                className={`text-2xs text-muted-foreground ${detailsOpen ? "whitespace-pre-wrap" : "line-clamp-2"}`}
              >
                {taskDetails}
              </p>
              {needsExpandButton && (
                <button
                  type="button"
                  onClick={() => setDetailsOpen((prev) => !prev)}
                  className="mt-0.5 cursor-pointer text-2xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {detailsOpen ? "Hide details" : "Show details"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {agent && onSelectAgent ? (
        <div className="flex items-center gap-0.5 shrink-0 mt-px">
          <button
            type="button"
            onClick={() => onSelectAgent(agent.id)}
            className={`cursor-pointer p-0.5 transition-colors ${
              agent.status === "completed"
                ? "text-green-500 hover:text-green-400"
                : "text-destructive hover:text-destructive/80"
            }`}
            aria-label="View agent results"
          >
            <HugeiconsIcon icon={WorkoutRunIcon} className="size-3" />
          </button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={onDelete}
              className="cursor-pointer p-0.5 text-muted-foreground transition-colors hover:text-destructive"
              aria-label="Archive task"
            >
              <Trash2Icon className="size-3" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 shrink-0 mt-px">
          {task.source === "ai" && !isProcessing && !editing && (
            <ZapIcon className="size-3 text-muted-foreground/40 group-hover:invisible" />
          )}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isProcessing && onLaunchAgent && (
              <button
                type="button"
                onClick={onLaunchAgent}
                className="cursor-pointer p-0.5 text-muted-foreground transition-colors hover:text-primary"
                aria-label="Run with agent"
              >
                <PlayIcon className="size-3" />
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="cursor-pointer p-0.5 text-muted-foreground transition-colors hover:text-destructive"
              aria-label="Delete task"
            >
              <Trash2Icon className="size-3" />
            </button>
          </div>
        </div>
      )}
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
  tasks,
  suggestions,
  agents,
  selectedAgentId,
  forceWorkTabKey = 0,
  onSelectAgent,
  onLaunchAgent,
  onNewAgent,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onUpdateTask,
  processingTaskIds = [],
  onAcceptSuggestion,
  onDismissSuggestion,
  archivedSuggestions = [],
  onAcceptArchivedTask,
  onDeleteArchivedSuggestion,
  sessionId,
  sessionActive = false,
  transcriptRefs = [],
  onRemoveTranscriptRef,
  onSubmitTaskInput,
}: RightSidebarProps) {
  const [modeBySession, setModeBySession] = useLocalStorage<Record<string, RightRailMode>>("ambient-right-rail-mode", {});
  const [completedOpen, setCompletedOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const lastAutoOpenedAgentIdRef = useRef<string | null>(null);
  const processingTaskIdSet = new Set(processingTaskIds);
  const sessionTabKey = sessionId ?? EMPTY_SESSION_TAB_KEY;
  const mode = modeBySession[sessionTabKey] ?? "work";
  const setMode = useCallback((nextMode: RightRailMode) => {
    setModeBySession((prev) => {
      if (prev[sessionTabKey] === nextMode) return prev;
      return { ...prev, [sessionTabKey]: nextMode };
    });
  }, [sessionTabKey, setModeBySession]);

  const { state: debriefState, generate: generateDebrief, canGenerate: canGenerateDebrief, preload: preloadDebrief } =
    useAgentsSummary(agents ?? [], sessionActive);

  const preloadDebriefRef = useRef(preloadDebrief);
  preloadDebriefRef.current = preloadDebrief;
  useEffect(() => {
    if (!sessionId) return;
    void window.electronAPI.getAgentsSummary(sessionId).then((res) => {
      if (res.ok && res.summary) {
        preloadDebriefRef.current(res.summary);
      }
    });
  }, [sessionId]);

  const agentByTaskId = new Map<string, Agent>();
  for (const agent of agents ?? []) {
    if (agent.taskId && !agentByTaskId.has(agent.taskId)) {
      agentByTaskId.set(agent.taskId, agent);
    }
  }

  const activeTasks: TaskItem[] = [];
  const completedTasks: TaskItem[] = [];
  let openTasksCount = 0;
  let pendingInAgentsCount = 0;
  for (const task of tasks) {
    if (task.completed) {
      completedTasks.push(task);
      continue;
    }
    openTasksCount += 1;
    if (agentByTaskId.get(task.id)?.status === "running") {
      pendingInAgentsCount += 1;
      continue;
    }
    activeTasks.push(task);
  }

  const isViewingPast = !onSubmitTaskInput;
  const completedHaveAgents = completedTasks.some((t) => agentByTaskId.has(t.id));

  // Consolidated tab-switching effect with priority: agent selection > work tab triggers > past-view defaults
  useEffect(() => {
    if (selectedAgentId) {
      lastAutoOpenedAgentIdRef.current = selectedAgentId;
      setMode("agents");
      return;
    }

    lastAutoOpenedAgentIdRef.current = null;
    if (transcriptRefs.length > 0 || forceWorkTabKey > 0) setMode("work");
    if (isViewingPast && completedHaveAgents) setCompletedOpen(true);
  }, [selectedAgentId, transcriptRefs.length, forceWorkTabKey, isViewingPast, completedHaveAgents, setMode]);

  // Force tab during onboarding tour
  const onboardingPhase = useUIStore((s) => s.onboardingPhase);
  const tourStep = useUIStore((s) => s.tourStep);

  useEffect(() => {
    if (onboardingPhase !== "tour") return;
    if (tourStep === 2) setMode("work");
    if (tourStep === 3) setMode("agents");
  }, [onboardingPhase, tourStep, setMode]);

  const handleSubmit = ({ text }: { text: string }) => {
    const refs = transcriptRefs;
    if (!text.trim() && refs.length === 0) return;
    onSubmitTaskInput?.(text.trim(), refs);
  };

  const hasRefs = transcriptRefs.length > 0;
  const totalAgentsCount = (agents ?? []).length;

  return (
    <div className="w-full h-full shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
      <div className="px-2 py-2 shrink-0">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-foreground/[0.045] p-1 dark:bg-muted/50">
          <RailModeButton
            active={mode === "agents"}
            onClick={() => setMode("agents")}
            label={`Agents (${totalAgentsCount})`}
          />
          <RailModeButton
            active={mode === "work"}
            onClick={() => setMode("work")}
            label={`Tasks (${openTasksCount})`}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {mode === "work" ? (
          <>
            {/* Active tasks */}
            <div className="mb-3">
              <div className="sticky top-0 z-10 -mx-3 mb-1.5 flex items-center justify-between gap-3 bg-sidebar/95 px-3 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-sidebar/85">
                <SectionLabel as="span">
                  {pendingInAgentsCount > 0 ? `Tasks · ${pendingInAgentsCount} in agents` : "Tasks"}
                </SectionLabel>
                <div className="flex items-center justify-end">
                  {(() => {
                    const completedByAgent = activeTasks.filter(
                      (t) => agentByTaskId.get(t.id)?.status === "completed"
                    );
                    if (completedByAgent.length === 0) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => completedByAgent.forEach((t) => onToggleTask?.(t.id))}
                        className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Complete all ({completedByAgent.length})
                      </button>
                    );
                  })()}
                </div>
              </div>
              {activeTasks.length > 0 ? (
                <ul className="space-y-px">
                  {activeTasks.map((task) => (
                    <EditableTaskItem
                      key={task.id}
                      task={task}
                      isProcessing={processingTaskIdSet.has(task.id)}
                      agent={agentByTaskId.get(task.id)}
                      onToggle={() => onToggleTask?.(task.id)}
                      onDelete={() => onDeleteTask?.(task.id)}
                      onUpdate={onUpdateTask ? (text) => onUpdateTask(task.id, text) : undefined}
                      onLaunchAgent={onLaunchAgent ? () => onLaunchAgent(task) : undefined}
                      onSelectAgent={onSelectAgent ?? undefined}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Added tasks will appear here
                </p>
              )}
              {completedTasks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCompletedOpen((prev) => !prev)}
                  className="mt-3 flex cursor-pointer items-center gap-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDownIcon
                    className={`size-3 transition-transform ${completedOpen ? "" : "-rotate-90"}`}
                  />
                  Completed ({completedTasks.length})
                </button>
              )}
              {completedTasks.length > 0 && completedOpen && (
                <ul className="mt-1.5 space-y-px">
                  {completedTasks.map((task) => {
                    const taskAgent = agentByTaskId.get(task.id);
                    return (
                      <li key={task.id} className="flex items-center gap-2 h-7 group px-1 -mx-1 rounded-sm hover:bg-muted/60 transition-colors cursor-pointer">
                        <input
                          type="checkbox"
                          checked
                          onChange={() => onToggleTask?.(task.id)}
                          className="size-3 shrink-0 rounded-sm border-border accent-primary cursor-pointer"
                        />
                        {taskAgent && onSelectAgent ? (
                          <button
                            type="button"
                            onClick={() => onSelectAgent(taskAgent.id)}
                            className="flex-1 cursor-pointer truncate text-left text-xs text-muted-foreground/60 line-through transition-colors hover:text-muted-foreground"
                          >
                            {task.text}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 truncate flex-1 line-through">
                            {task.text}
                          </span>
                        )}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          {taskAgent && onSelectAgent && (
                            <button
                              type="button"
                              onClick={() => onSelectAgent(taskAgent.id)}
                              className="cursor-pointer p-0.5 text-muted-foreground transition-colors hover:text-primary"
                              aria-label="View agent results"
                            >
                              <HugeiconsIcon icon={WorkoutRunIcon} className="size-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteTask?.(task.id)}
                            className="cursor-pointer p-0.5 text-muted-foreground transition-colors hover:text-destructive"
                            aria-label="Delete task"
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

            {/* Suggestions */}
            <div>
              <div className="sticky top-0 z-10 -mx-3 mb-1.5 bg-sidebar/95 px-3 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-sidebar/85">
                <SectionLabel as="span">Suggested</SectionLabel>
              </div>
              {suggestions.length > 0 ? (
                <ul className="space-y-1">
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
              ) : null}
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
                        className="border-l-2 border-l-muted-foreground/20 bg-muted/5 group"
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
                            aria-label="Add archived suggestion to tasks"
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
        ) : (
          <div className="pt-2">
            <AgentList
              agents={agents ?? []}
              selectedAgentId={selectedAgentId ?? null}
              onSelectAgent={onSelectAgent ?? (() => {})}
              onNewAgent={onNewAgent}
            />
            {(!agents || agents.length === 0) && (
              <p className="mt-2 text-xs text-muted-foreground italic">
                Agent activity will appear here once you run a task.
              </p>
            )}
            {agents && onSelectAgent && agents.length > 0 && (
              <>
                <div className="my-3 h-px bg-border/70" />
                <AgentDebriefPanel
                  state={debriefState}
                  onGenerate={generateDebrief}
                  canGenerate={canGenerateDebrief && sessionActive}
                  onAddTask={onAddTask}
                />
              </>
            )}
          </div>
        )}
      </div>

      {onSubmitTaskInput && mode === "work" && (
        <div className="px-2 pt-2 pb-2 shrink-0">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputHeader className="px-2 pt-1.5 pb-1 gap-1 min-h-[28px]">
              {hasRefs ? (
                transcriptRefs.map((ref, i) => (
                  <button
                    key={i}
                    type="button"
                    className="flex max-w-full cursor-pointer items-center gap-1 rounded-sm border border-border/60 bg-muted/50 pl-1.5 pr-1 py-0.5 text-2xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                    onClick={() => onRemoveTranscriptRef?.(i)}
                    title={ref}
                  >
                    <span className="truncate max-w-[160px]">
                      {ref.length > 50 ? `${ref.slice(0, 50)}…` : ref}
                    </span>
                    <XIcon className="size-2.5 shrink-0 opacity-50" />
                  </button>
                ))
              ) : (
                <span className="text-2xs text-muted-foreground/35 select-none italic">
                  Select transcript text · <kbd className="font-mono not-italic">⌘L</kbd> to add context
                </span>
              )}
            </PromptInputHeader>
            <PromptInputTextarea
              placeholder={hasRefs ? "What should these become?" : "Add a task..."}
              className="min-h-0 text-xs"
            />
            <PromptInputFooter className="px-1 py-1">
              <span className="text-2xs text-muted-foreground/35 font-mono select-none pl-1">
                {hasRefs ? `${transcriptRefs.length} snippet${transcriptRefs.length > 1 ? "s" : ""}` : ""}
              </span>
              <PromptInputSubmit size="icon-sm" />
            </PromptInputFooter>
          </PromptInput>
        </div>
      )}
      {onSubmitTaskInput && mode === "agents" && hasRefs && (
        <div className="px-3 py-2 border-t border-border text-2xs text-muted-foreground">
          {transcriptRefs.length} selected snippet{transcriptRefs.length !== 1 ? "s" : ""} ready for task input.
          <button
            type="button"
            onClick={() => setMode("work")}
            className="ml-1 cursor-pointer text-foreground transition-colors hover:text-primary"
          >
            Open Tasks
          </button>
        </div>
      )}
    </div>
  );
}
