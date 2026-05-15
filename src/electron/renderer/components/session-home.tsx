import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Agent, AppConfig, SessionMeta, TaskItem, TaskSuggestion, TranscriptBlock } from "@core/types";
import { ComposerSendButton } from "./composer-send-button";
import { ModelPicker } from "./model-picker";
import { SuggestionGrid, type SuggestionGridEntry } from "./suggestion-grid";

type SessionHomeProps = {
  onLaunchAgent: (task: string) => void;
  appConfig: AppConfig;
  onAppConfigChange: (next: AppConfig) => void;
  captureBar?: ReactNode;
  suggestions: TaskSuggestion[];
  archivedSuggestions: TaskItem[];
  agents: Agent[];
  blocks: TranscriptBlock[];
  sessionMeta?: SessionMeta | null;
  scanBusy?: boolean;
  rollingKeyPoints: string[];
  onAcceptSuggestion: (suggestion: TaskSuggestion) => void;
  onDismissSuggestion: (id: string) => void;
  onAcceptArchivedTask: (task: TaskItem) => void;
  onDeleteArchivedSuggestion: (id: string) => void;
  onSelectAgent: (id: string) => void;
};

function SectionHeader({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/70">
        {label}
      </span>
      {meta && (
        <span className="font-mono text-2xs text-muted-foreground/60">{meta}</span>
      )}
    </div>
  );
}

export function SessionHome({
  onLaunchAgent,
  appConfig,
  onAppConfigChange,
  captureBar,
  suggestions,
  archivedSuggestions,
  agents,
  blocks,
  sessionMeta,
  scanBusy,
  rollingKeyPoints,
  onAcceptSuggestion,
  onDismissSuggestion,
  onAcceptArchivedTask,
  onDeleteArchivedSuggestion,
  onSelectAgent,
}: SessionHomeProps) {
  const [taskDraft, setTaskDraft] = useState("");

  const entries = useMemo<SuggestionGridEntry[]>(() => {
    const live: SuggestionGridEntry[] = suggestions.map((s) => ({
      id: s.id,
      state: "live",
      text: s.text,
      flag: s.flag,
      details: s.details,
      transcriptExcerpt: s.transcriptExcerpt,
      kind: s.kind,
      createdAt: s.createdAt,
      // Callouts are informational; only agent suggestions get a Run-agent action.
      onAccept: s.surface === "agent_suggestion" ? () => onAcceptSuggestion(s) : undefined,
      onDismiss: () => onDismissSuggestion(s.id),
    }));
    const archived: SuggestionGridEntry[] = archivedSuggestions.map((task) => ({
      id: task.id,
      state: "archived",
      text: task.text,
      details: task.details,
      kind: task.suggestionKind,
      createdAt: task.createdAt,
      onAccept: () => onAcceptArchivedTask(task),
      onDismiss: () => onDeleteArchivedSuggestion(task.id),
      dismissLabel: "Delete",
    }));
    const combined = [...live, ...archived];
    if (combined.length === 0 || rollingKeyPoints.length === 0) return combined;

    const ordered = [...combined].sort((a, b) => a.createdAt - b.createdAt);
    const briefingPoints = rollingKeyPoints.slice(-ordered.length);
    const firstBriefingIndex = ordered.length - briefingPoints.length;
    const briefingByEntryId = new Map<string, string>();

    ordered.forEach((entry, index) => {
      const briefingPoint = briefingPoints[index - firstBriefingIndex];
      if (briefingPoint) briefingByEntryId.set(entry.id, briefingPoint);
    });

    return combined.map((entry) => {
      const briefingPoint = briefingByEntryId.get(entry.id);
      return briefingPoint ? { ...entry, briefingPoints: [briefingPoint] } : entry;
    });
  }, [
    suggestions,
    archivedSuggestions,
    rollingKeyPoints,
    onAcceptSuggestion,
    onDismissSuggestion,
    onAcceptArchivedTask,
    onDeleteArchivedSuggestion,
  ]);

  const submitTask = () => {
    const trimmed = taskDraft.trim();
    if (!trimmed) return;
    onLaunchAgent(trimmed);
    setTaskDraft("");
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitTask();
    }
  };

  const canSubmit = taskDraft.trim().length > 0;
  const liveCount = suggestions.length;
  const totalCount = entries.length;
  const timelineTimestamps = [
    sessionMeta?.startedAt,
    ...blocks.map((block) => block.createdAt),
    ...entries.map((entry) => entry.createdAt),
  ].filter((timestamp): timestamp is number => typeof timestamp === "number" && Number.isFinite(timestamp));
  const timelineStartAt = timelineTimestamps.length > 0
    ? Math.min(...timelineTimestamps)
    : Date.now();
  const workstreamMeta =
    liveCount > 0 && totalCount !== liveCount
      ? `${liveCount} live · ${totalCount} total`
      : agents.length > 0
        ? `${totalCount} found · ${agents.length} agents`
        : `${totalCount} found`;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-6 pt-10 pb-8">
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-sm">
          {captureBar}

          <div className="flex flex-col gap-2.5 px-4 py-5">
            <SectionHeader label="Session Workstream" meta={workstreamMeta} />
            <SuggestionGrid
              entries={entries}
              agents={agents}
              scanBusy={scanBusy}
              timelineStartAt={timelineStartAt}
              onSelectAgent={onSelectAgent}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-background shadow-sm">
          <textarea
            rows={2}
            value={taskDraft}
            onChange={(e) => setTaskDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Ask an agent to work on something"
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0"
          />

          <div className="flex items-center gap-1 px-2 pb-2">
            <ModelPicker config={appConfig} onConfigChange={onAppConfigChange} />
            <div className="flex-1" />
            <ComposerSendButton onClick={submitTask} disabled={!canSubmit} />
          </div>
        </div>
      </div>
    </div>
  );
}
