import {
  AlertTriangleIcon,
  BotIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  Clock3Icon,
  LightbulbIcon,
  ListChecksIcon,
  PencilIcon,
  PlayIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Agent, SuggestionKind } from "@core/types";
import { Button } from "@/components/ui/button";

export type SuggestionGridEntry = {
  id: string;
  state: "live" | "archived";
  text: string;
  briefingPoints?: string[];
  flag?: string;
  details?: string;
  transcriptExcerpt?: string;
  kind?: SuggestionKind;
  createdAt: number;
  /** When undefined the item is an informational callout rather than a runnable task. */
  onAccept?: () => void;
  onDismiss: () => void;
  dismissLabel?: string;
};

type SuggestionGridProps = {
  entries: SuggestionGridEntry[];
  agents?: Agent[];
  scanBusy?: boolean;
  timelineStartAt?: number;
  onSelectAgent?: (id: string) => void;
};

type WorkstreamItem =
  | { id: string; type: "suggestion"; timestamp: number; entry: SuggestionGridEntry }
  | { id: string; type: "agent"; timestamp: number; agent: Agent };

const SUGGESTION_KIND_ICONS: Record<SuggestionKind, LucideIcon> = {
  research: SearchIcon,
  action: PencilIcon,
  insight: LightbulbIcon,
  flag: AlertTriangleIcon,
  followup: ListChecksIcon,
};

const KIND_LABELS: Record<SuggestionKind, string> = {
  research: "Research",
  action: "Action",
  insight: "Insight",
  flag: "Flag",
  followup: "Follow up",
};

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeMatchText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function resolveAgentTimestamp(
  agent: Agent,
  entries: readonly SuggestionGridEntry[],
  fallbackTimestamp: number,
  fallbackOffset: number,
): number {
  if (agent.taskId) {
    const linked = entries.find((entry) => entry.id === agent.taskId);
    if (linked) return linked.createdAt + fallbackOffset;
  }

  const agentTask = normalizeMatchText(agent.task);
  if (!agentTask) return fallbackTimestamp + fallbackOffset;
  const textMatch = entries.find((entry) => {
    const entryText = normalizeMatchText(entry.text);
    if (!entryText) return false;
    return entryText === agentTask || entryText.includes(agentTask) || agentTask.includes(entryText);
  });

  return textMatch ? textMatch.createdAt + fallbackOffset : fallbackTimestamp + fallbackOffset;
}

function statusLabel(agent: Agent): string {
  switch (agent.status) {
    case "running":
      return "Agent running";
    case "failed":
      return "Agent needs attention";
    case "completed":
    default:
      return "Agent result";
  }
}

function statusTone(agent: Agent): string {
  switch (agent.status) {
    case "running":
      return "border-primary/35 bg-primary/10 text-primary";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "completed":
    default:
      return "border-[oklch(0.63_0.14_145/0.35)] bg-[oklch(0.63_0.14_145/0.12)] text-[oklch(0.43_0.12_145)] dark:text-[oklch(0.76_0.12_145)]";
  }
}

function suggestionTone(entry: SuggestionGridEntry): string {
  switch (entry.kind) {
    case "flag":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "action":
      return "border-[oklch(0.7_0.14_78/0.35)] bg-[oklch(0.7_0.14_78/0.13)] text-[oklch(0.48_0.11_78)] dark:text-[oklch(0.82_0.12_78)]";
    case "research":
      return "border-[oklch(0.58_0.12_220/0.35)] bg-[oklch(0.58_0.12_220/0.12)] text-[oklch(0.42_0.1_220)] dark:text-[oklch(0.76_0.1_220)]";
    case "followup":
      return "border-[oklch(0.58_0.13_285/0.35)] bg-[oklch(0.58_0.13_285/0.12)] text-[oklch(0.42_0.1_285)] dark:text-[oklch(0.76_0.1_285)]";
    case "insight":
    default:
      return "border-[oklch(0.63_0.14_145/0.35)] bg-[oklch(0.63_0.14_145/0.12)] text-[oklch(0.43_0.12_145)] dark:text-[oklch(0.76_0.12_145)]";
  }
}

function Chip({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium leading-none ${className}`}>
      {children}
    </span>
  );
}

function TimelineMarker({
  item,
}: {
  item: WorkstreamItem;
}) {
  if (item.type === "agent") {
    const StatusIcon =
      item.agent.status === "completed" ? CheckCircle2Icon :
      item.agent.status === "failed" ? AlertTriangleIcon :
      BotIcon;
    return (
      <span className={`relative z-10 flex size-7 items-center justify-center rounded-full border shadow-sm ${statusTone(item.agent)}`}>
        <StatusIcon className="size-3.5" />
      </span>
    );
  }

  const Icon = item.entry.kind ? SUGGESTION_KIND_ICONS[item.entry.kind] : SparklesIcon;
  return (
    <span className={`relative z-10 flex size-7 items-center justify-center rounded-full border shadow-sm ${suggestionTone(item.entry)}`}>
      <Icon className="size-3.5" />
    </span>
  );
}

function SuggestionCard({
  entry,
  expanded,
  onToggleExpanded,
}: {
  entry: SuggestionGridEntry;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const kindLabel = entry.kind ? KIND_LABELS[entry.kind] : "Suggestion";
  const hasContext = entry.flag?.trim() || entry.details?.trim() || entry.transcriptExcerpt?.trim();
  const hasMore = Boolean(hasContext || entry.briefingPoints?.length);
  const acceptLabel = entry.state === "archived" ? "Run again" : "Run agent";
  const dismissIcon = entry.dismissLabel === "Delete" ? Trash2Icon : XIcon;
  const DismissIcon = dismissIcon;

  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-background/80 px-3 py-2.5 shadow-sm transition-colors hover:border-border hover:bg-background">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/75">
              {entry.onAccept ? "Suggested task" : "Session note"}
            </span>
            <Chip className={suggestionTone(entry)}>{kindLabel}</Chip>
            {entry.state === "live" && (
              <Chip className="border-primary/20 bg-primary/10 text-primary">New</Chip>
            )}
          </div>
          <p className="text-sm font-medium leading-snug text-foreground">{entry.text}</p>
        </div>
        {entry.onAccept && (
          <Button
            type="button"
            size="sm"
            onClick={entry.onAccept}
            className="shrink-0"
          >
            <PlayIcon className="size-3 fill-current" />
            {acceptLabel}
          </Button>
        )}
      </div>

      {expanded && hasContext && (
        <div className="mt-2.5 space-y-2">
          {entry.flag?.trim() && (
            <p className="text-xs leading-relaxed text-muted-foreground">{entry.flag}</p>
          )}
          {entry.details?.trim() && (
            <p className="text-xs leading-relaxed text-muted-foreground">{entry.details}</p>
          )}
          {entry.transcriptExcerpt?.trim() && (
            <blockquote className="border-l-2 border-border pl-2.5 text-xs italic leading-relaxed text-muted-foreground/85">
              {entry.transcriptExcerpt}
            </blockquote>
          )}
        </div>
      )}

      {expanded && entry.briefingPoints?.length ? (
        <div className="mt-2.5 rounded-md bg-muted/45 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
          {entry.briefingPoints[0]}
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between">
        {hasMore ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDownIcon className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            {expanded ? "Less context" : "Context"}
          </button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={entry.onDismiss}
          className="text-muted-foreground"
        >
          <DismissIcon className="size-3" />
          {entry.dismissLabel ?? "Dismiss"}
        </Button>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onSelectAgent,
  expanded,
  onToggleExpanded,
}: {
  agent: Agent;
  onSelectAgent?: (id: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const resultPreview = agent.result?.trim().split(/\n+/)[0];
  const duration = agent.completedAt
    ? formatElapsed(agent.completedAt - agent.createdAt)
    : relativeTime(agent.createdAt);
  const hasResult = Boolean(resultPreview);

  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-background/80 px-3 py-2.5 shadow-sm transition-colors hover:border-border hover:bg-background">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/75">
              {statusLabel(agent)}
            </span>
            <Chip className={statusTone(agent)}>{agent.status}</Chip>
            <Chip className="border-border/70 bg-muted/45 text-muted-foreground">{duration}</Chip>
          </div>
          <p className="text-sm font-medium leading-snug text-foreground">{agent.task}</p>
        </div>
        {onSelectAgent && (
          <Button
            type="button"
            variant={agent.status === "running" ? "default" : "outline"}
            size="sm"
            onClick={() => onSelectAgent(agent.id)}
            className="shrink-0"
          >
            <BotIcon className="size-3" />
            Open
          </Button>
        )}
      </div>

      {expanded && resultPreview && (
        <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {resultPreview}
        </p>
      )}

      {hasResult && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={onToggleExpanded}
            className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDownIcon className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            {expanded ? "Less result" : "Result preview"}
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyWorkstream({ scanBusy }: { scanBusy: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/25 px-4 py-5 text-center">
      <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
        {scanBusy ? <Clock3Icon className="size-4 animate-pulse" /> : <SparklesIcon className="size-4" />}
      </div>
      <p className="text-sm font-medium text-foreground">
        {scanBusy ? "Listening for useful work" : "No suggested work yet"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {scanBusy
          ? "Tasks and agent results will appear here in session order."
          : "Start recording or ask an agent below; the workstream will collect suggestions, agent runs, and results."}
      </p>
    </div>
  );
}

export function SuggestionGrid({
  entries,
  agents = [],
  scanBusy = false,
  timelineStartAt,
  onSelectAgent,
}: SuggestionGridProps) {
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => new Set());
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.createdAt - b.createdAt),
    [entries],
  );
  const visibleAgents = useMemo(
    () => agents.filter((agent) => !agent.archived).sort((a, b) => a.createdAt - b.createdAt),
    [agents],
  );
  const items = useMemo<WorkstreamItem[]>(() => {
    const fallbackTimestamp = sortedEntries.at(-1)?.createdAt ?? timelineStartAt ?? Date.now();
    const suggestionItems = sortedEntries.map((entry): WorkstreamItem => ({
      id: `suggestion-${entry.id}`,
      type: "suggestion",
      timestamp: entry.createdAt,
      entry,
    }));
    const agentItems = visibleAgents.map((agent, index): WorkstreamItem => ({
      id: `agent-${agent.id}`,
      type: "agent",
      timestamp: resolveAgentTimestamp(
        agent,
        sortedEntries,
        fallbackTimestamp,
        (index + 1) * 15_000,
      ),
      agent,
    }));

    return [...suggestionItems, ...agentItems].sort((a, b) => a.timestamp - b.timestamp);
  }, [sortedEntries, timelineStartAt, visibleAgents]);

  const startAt = timelineStartAt ?? items[0]?.timestamp ?? Date.now();

  const toggleExpanded = (itemId: string) => {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  if (items.length === 0) {
    return <EmptyWorkstream scanBusy={scanBusy} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[oklch(0.58_0.12_220)]" />
          Suggested task
        </span>
        <span className="inline-flex items-center gap-1.5">
          <BotIcon className="size-3 text-primary" />
          Agent work
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-px w-5 bg-border" />
          Session order
        </span>
      </div>

      <ol className="relative space-y-3">
        <span className="absolute bottom-5 left-[48px] top-5 w-px bg-border/70" aria-hidden="true" />
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[38px_28px_minmax(0,1fr)] gap-2">
            <div className="pt-1.5 text-right font-mono text-[10px] leading-tight text-muted-foreground/70">
              <div>{formatElapsed(item.timestamp - startAt)}</div>
              <div className="mt-1 text-[9px] text-muted-foreground/45">{relativeTime(item.timestamp)}</div>
            </div>
            <div className="flex justify-center pt-0.5">
              <TimelineMarker item={item} />
            </div>
            {item.type === "suggestion" ? (
              <SuggestionCard
                entry={item.entry}
                expanded={expandedItemIds.has(item.id)}
                onToggleExpanded={() => toggleExpanded(item.id)}
              />
            ) : (
              <AgentCard
                agent={item.agent}
                onSelectAgent={onSelectAgent}
                expanded={expandedItemIds.has(item.id)}
                onToggleExpanded={() => toggleExpanded(item.id)}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
