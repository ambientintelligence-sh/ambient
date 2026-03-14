import { useState, useEffect } from "react";
import {
  LoaderCircleIcon,
  RefreshCwIcon,
  CheckCircleIcon,
  XCircleIcon,
  PlusIcon,
  CheckIcon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";
import type { AgentsSummary } from "@core/types";
import type { AgentsSummaryState } from "../hooks/use-agents-summary";
import { SectionLabel } from "@/components/ui/section-label";
import { Button } from "@/components/ui/button";

type AgentDebriefPanelProps = {
  state: AgentsSummaryState;
  onGenerate: () => void;
  canGenerate: boolean;
  onAddTask?: (text: string, details?: string) => void;
};

function formatDuration(totalSecs: number): string {
  if (totalSecs < 60) return `${totalSecs} sec`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
}

function AgentHighlightCard({
  task,
  status,
  keyFinding,
}: {
  agentId: string;
  task: string;
  status: "completed" | "failed";
  keyFinding: string;
}) {
  return (
    <div className={`border-l-2 pl-2 pr-1 py-1 ${status === "completed" ? "border-l-green-500/50" : "border-l-destructive/50"}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        {status === "completed"
          ? <CheckCircleIcon className="size-3 text-green-500 shrink-0" />
          : <XCircleIcon className="size-3 text-destructive shrink-0" />}
        <span className="text-xs font-medium text-foreground truncate">{task}</span>
      </div>
      <p className="text-2xs leading-snug text-muted-foreground">{keyFinding}</p>
    </div>
  );
}


function NextStepRow({
  text,
  selected,
  accepted,
  onToggle,
}: {
  text: string;
  selected: boolean;
  accepted: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      role="checkbox"
      aria-checked={selected}
      tabIndex={accepted ? -1 : 0}
      onClick={accepted ? undefined : onToggle}
      onKeyDown={(e) => {
        if (!accepted && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`flex items-center gap-2 py-1 px-1.5 rounded transition-colors select-none ${
        accepted ? "opacity-40 cursor-default" : "cursor-pointer hover:bg-muted/60"
      }`}
    >
      <div
        className={`size-3 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
          accepted
            ? "border-muted-foreground/40"
            : selected
              ? "border-foreground bg-foreground"
              : "border-muted-foreground/60"
        }`}
      >
        {(accepted || selected) && (
          <CheckIcon className={`size-1.5 ${accepted ? "text-muted-foreground/60" : "text-background"}`} />
        )}
      </div>
      <span className={`text-xs/relaxed flex-1 ${selected && !accepted ? "text-foreground font-medium" : "text-foreground/80"}`}>
        {text}
      </span>
    </li>
  );
}

function DebriefContent({
  summary,
  onAddTask,
}: {
  summary: AgentsSummary;
  onAddTask?: (text: string, details?: string) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  // Reset selection state when summary changes
  useEffect(() => {
    setSelected(new Set());
    setAccepted(new Set());
  }, [summary]);

  const toggleStep = (i: number) => {
    if (accepted.has(i)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleAddSelected = () => {
    if (!onAddTask || selected.size === 0) return;
    const sharedDetails = [
      summary.overallNarrative.trim()
        ? `Agents debrief narrative:\n${summary.overallNarrative.trim()}`
        : "",
      summary.coverageGaps.length > 0
        ? `Known coverage gaps:\n${summary.coverageGaps.map((gap) => `- ${gap}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n");
    for (const i of selected) {
      onAddTask(summary.nextSteps[i], sharedDetails || undefined);
    }
    setAccepted((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
  };

  const remainingSteps = summary.nextSteps.length - accepted.size;

  return (
    <div className="space-y-2.5">
      {/* Stats row */}
      <p className="font-mono text-2xs text-muted-foreground">
        {summary.totalAgents} agents · {summary.succeededAgents} ok
        {summary.failedAgents > 0 ? ` · ${summary.failedAgents} failed` : ""}
        {summary.totalDurationSecs > 0 ? ` · ${formatDuration(summary.totalDurationSecs)}` : ""}
      </p>

      {/* Narrative */}
      <p className="text-xs leading-relaxed text-foreground">
        {summary.overallNarrative}
      </p>

      {/* Per-agent highlight cards */}
      {summary.agentHighlights.length > 0 && (
        <div className="space-y-1">
          {summary.agentHighlights.map((h) => (
            <AgentHighlightCard
              key={h.agentId}
              agentId={h.agentId}
              task={h.task}
              status={h.status}
              keyFinding={h.keyFinding}
            />
          ))}
        </div>
      )}

      {/* Coverage gaps */}
      {summary.coverageGaps.length > 0 && (
        <div>
          <SectionLabel as="p" className="mb-1">Gaps</SectionLabel>
          <ul className="space-y-1">
            {summary.coverageGaps.map((gap, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <span className="shrink-0">·</span>
                <span>{gap}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next steps */}
      {summary.nextSteps.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <SectionLabel as="p">
              {selected.size > 0 ? `${selected.size} selected` : "Next Steps"}
            </SectionLabel>
            {onAddTask && (
              selected.size > 0 ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setSelected(new Set())}
                  >
                    Deselect all
                  </button>
                  <Button size="sm" onClick={handleAddSelected} className="gap-1 h-5 text-2xs px-2">
                    <PlusIcon className="size-2.5" />
                    Add to Tasks
                  </Button>
                </div>
              ) : remainingSteps > 0 ? (
                <button
                  type="button"
                  className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() =>
                    setSelected(new Set(summary.nextSteps.map((_, i) => i).filter((i) => !accepted.has(i))))
                  }
                >
                  Select all
                </button>
              ) : null
            )}
          </div>
          <ul>
            {summary.nextSteps.map((step, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <NextStepRow
                key={i}
                text={step}
                selected={selected.has(i)}
                accepted={accepted.has(i)}
                onToggle={() => toggleStep(i)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AgentDebriefPanel({
  state,
  onGenerate,
  canGenerate,
  onAddTask,
}: AgentDebriefPanelProps) {
  if (state.kind === "idle") return null;

  return (
    <div className="mb-3">
      <div className="sticky top-0 bg-sidebar z-10 -mx-3 px-3 py-1.5 flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1">
          <HugeiconsIcon icon={WorkoutRunIcon} className="size-3 text-muted-foreground" />
          <SectionLabel as="span">Agents Summary</SectionLabel>
        </div>
        {canGenerate && state.kind !== "loading" && (
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Regenerate debrief"
          >
            <RefreshCwIcon className="size-3" />
          </button>
        )}
      </div>

      {state.kind === "loading" && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3 animate-spin shrink-0" />
          Generating debrief…
        </div>
      )}

      {state.kind === "error" && (
        <div className="space-y-1.5">
          <p className="text-xs text-destructive">{state.message}</p>
          {canGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {state.kind === "ready" && (
        <DebriefContent summary={state.summary} onAddTask={onAddTask} />
      )}
    </div>
  );
}
