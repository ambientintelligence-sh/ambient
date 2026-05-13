import {
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  LightbulbIcon,
  ListChecksIcon,
  PencilIcon,
  PlayIcon,
  SearchIcon,
  TimerIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Agent, SuggestionKind } from "@core/types";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

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
  /** When undefined the tooltip shows only Dismiss (used for callout-style live suggestions). */
  onAccept?: () => void;
  onDismiss: () => void;
  dismissLabel?: string;
};

type SuggestionGridProps = {
  entries: SuggestionGridEntry[];
  agents?: Agent[];
  scanBusy?: boolean;
  timelineStartAt?: number;
  timelineEndAt?: number;
  onSelectAgent?: (id: string) => void;
};

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

const GRID_COLS = 16;
const MAX_TIMELINE_ROWS = 6;
const MIN_TIMELINE_MS = 5 * 60_000;
const NICE_ROW_DURATIONS_MS = [
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  90 * 60_000,
  120 * 60_000,
];

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

const MAX_BRIEFING_POINTS = 1;

type TimelineMarker =
  | { id: string; type: "suggestion"; timestamp: number; entry: SuggestionGridEntry }
  | { id: string; type: "agent"; timestamp: number; agent: Agent };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function chooseRowDuration(durationMs: number): number {
  const target = Math.max(durationMs, MIN_TIMELINE_MS);
  return (
    NICE_ROW_DURATIONS_MS.find((candidate) => Math.ceil(target / candidate) <= MAX_TIMELINE_ROWS) ??
    Math.ceil(target / MAX_TIMELINE_ROWS)
  );
}

function getMarkerText(marker: TimelineMarker): string {
  return marker.type === "agent" ? marker.agent.task : marker.entry.text;
}

const FOCUSED_CHIP_WIDTH = 184;
const FOCUSED_CHIP_HALF = FOCUSED_CHIP_WIDTH / 2;
const FOCUSED_CHIP_MIN_SPACING = FOCUSED_CHIP_WIDTH + 16;
const FOCUSED_TRACK_HEIGHT = 176;

function getFocusedMarkerLayout(
  markers: readonly TimelineMarker[],
  rowStartAt: number,
  rowDuration: number,
) {
  const baseWidth = Math.max(1200, markers.length * FOCUSED_CHIP_MIN_SPACING);
  let previousX = 0;
  const items = markers.map((marker, index) => {
    const idealX = clamp(
      ((marker.timestamp - rowStartAt) / rowDuration) * baseWidth,
      FOCUSED_CHIP_HALF + 8,
      baseWidth - FOCUSED_CHIP_HALF - 8,
    );
    const x = index === 0 ? idealX : Math.max(idealX, previousX + FOCUSED_CHIP_MIN_SPACING);
    previousX = x;
    return { marker, x };
  });
  return {
    width: Math.max(baseWidth, (items.at(-1)?.x ?? 0) + FOCUSED_CHIP_HALF + 8),
    items,
  };
}

function normalizeMatchText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function resolveAgentTimelineTimestamp(
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
  if (textMatch) return textMatch.createdAt + fallbackOffset;

  return fallbackTimestamp + fallbackOffset;
}

function getSuggestionMarkerClass(entry: SuggestionGridEntry): string {
  const size = entry.state === "live" ? "size-2" : "size-1.5";
  switch (entry.kind) {
    case "flag":
      return `${size} bg-[oklch(0.62_0.18_32)] shadow-[0_0_0_3px_oklch(0.62_0.18_32/0.16)]`;
    case "action":
      return `${size} bg-[oklch(0.7_0.14_78)] shadow-[0_0_0_3px_oklch(0.7_0.14_78/0.18)]`;
    case "research":
      return `${size} bg-[oklch(0.58_0.12_220)] shadow-[0_0_0_3px_oklch(0.58_0.12_220/0.16)]`;
    case "followup":
      return `${size} bg-[oklch(0.58_0.13_285)] shadow-[0_0_0_3px_oklch(0.58_0.13_285/0.16)]`;
    case "insight":
    default:
      return `${size} bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)] dark:bg-emerald-400 dark:shadow-[0_0_0_3px_rgba(52,211,153,0.22)]`;
  }
}

function getAgentMarkerClass(agent: Agent): string {
  switch (agent.status) {
    case "running":
      return "size-2.5 rotate-45 rounded-[2px] bg-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_18%,transparent)] animate-pulse";
    case "failed":
      return "size-2.5 rotate-45 rounded-[2px] bg-destructive shadow-[0_0_0_3px_color-mix(in_oklab,var(--destructive)_16%,transparent)]";
    case "completed":
    default:
      return "size-2.5 rotate-45 rounded-[2px] bg-[oklch(0.63_0.14_145)] shadow-[0_0_0_3px_oklch(0.63_0.14_145/0.16)]";
  }
}

function SuggestionTooltip({
  entry,
  timelineStartAt,
}: {
  entry: SuggestionGridEntry;
  timelineStartAt: number;
}) {
  const Icon = entry.kind ? SUGGESTION_KIND_ICONS[entry.kind] : SearchIcon;
  const flag = entry.flag?.trim();
  const details = entry.details?.trim();
  const excerpt = entry.transcriptExcerpt?.trim();
  const kindLabel = entry.kind ? KIND_LABELS[entry.kind] : "Suggestion";
  const isLive = entry.state === "live";
  const briefingPoints = entry.briefingPoints ?? [];
  const visiblePoints = briefingPoints.slice(0, MAX_BRIEFING_POINTS);
  const hiddenCount = Math.max(0, briefingPoints.length - visiblePoints.length);
  const hasBriefing = visiblePoints.length > 0;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <span className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
            <Icon className="size-3" />
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-foreground/75">
            {kindLabel}
          </span>
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
          {isLive ? (
            <span className="size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
          ) : null}
          <span>{formatElapsed(entry.createdAt - timelineStartAt)}</span>
          <span>·</span>
          <span>{relativeTime(entry.createdAt)}</span>
        </span>
      </div>

      <div
        className={[
          "pt-3",
          hasBriefing ? "grid grid-cols-[140px_1fr] gap-4" : "block",
        ].join(" ")}
      >
        {hasBriefing && (
          <div className="flex flex-col gap-1.5 border-r border-border/40 pr-3.5">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/65">
              Briefing
            </div>
            <ul className="flex flex-col gap-1.5">
              {visiblePoints.map((point, i) => (
                <li
                  key={`${i}-${point.slice(0, 20)}`}
                  className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground"
                >
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-emerald-500/70 dark:bg-emerald-400/70" />
                  <span>{point}</span>
                </li>
              ))}
              {hiddenCount > 0 && (
                <li className="pl-2.5 text-[10px] text-muted-foreground/55">
                  + {hiddenCount} earlier
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          {flag && (
            <div className="text-[11px] leading-snug text-muted-foreground/80">
              {flag}
            </div>
          )}
          <div className="text-xs font-medium leading-snug text-foreground">
            {entry.text}
          </div>
          {details && (
            <p className="text-2xs leading-relaxed text-muted-foreground">{details}</p>
          )}
          {excerpt && (
            <blockquote className="border-l-2 border-emerald-500/40 pl-2.5 text-2xs italic leading-relaxed text-muted-foreground/85 dark:border-emerald-400/40">
              {excerpt}
            </blockquote>
          )}
        </div>
      </div>

      {entry.onAccept && (
        <div className="mt-3.5 flex items-center gap-1.5 border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={entry.onAccept}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          >
            <PlayIcon className="size-2.5 fill-current" />
            Run agent
          </button>
        </div>
      )}
    </div>
  );
}

function AgentTooltip({
  agent,
  timelineStartAt,
  displayTimestamp,
  onSelectAgent,
}: {
  agent: Agent;
  timelineStartAt: number;
  displayTimestamp: number;
  onSelectAgent?: (id: string) => void;
}) {
  const statusIcon =
    agent.status === "completed" ? CheckCircle2Icon :
    agent.status === "failed" ? AlertTriangleIcon :
    CircleDotIcon;
  const StatusIcon = statusIcon;
  const duration = agent.completedAt
    ? formatElapsed(agent.completedAt - agent.createdAt)
    : relativeTime(agent.createdAt);
  const resultPreview = agent.result?.trim().split(/\n+/)[0];

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <span className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BotIcon className="size-3" />
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-foreground/75">
            Agent
          </span>
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
          <StatusIcon className="size-3" />
          <span>{agent.status}</span>
        </span>
      </div>

      <div className="space-y-2 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/70">
          <span className="inline-flex items-center gap-1 font-mono">
            <TimerIcon className="size-3" />
            {formatElapsed(displayTimestamp - timelineStartAt)}
          </span>
          {agent.createdAt !== displayTimestamp && (
            <span>launched {relativeTime(agent.createdAt)}</span>
          )}
          <span>{duration}</span>
        </div>
        <div className="text-xs font-medium leading-snug text-foreground">
          {agent.task}
        </div>
        {resultPreview && (
          <p className="line-clamp-3 text-2xs leading-relaxed text-muted-foreground">
            {resultPreview}
          </p>
        )}
      </div>

      {onSelectAgent && (
        <div className="mt-3.5 flex items-center gap-1.5 border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={() => onSelectAgent(agent.id)}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <BotIcon className="size-2.5" />
            Open agent
          </button>
        </div>
      )}
    </div>
  );
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function CellStats({
  markers,
  timelineStartAt,
}: {
  readonly markers: readonly TimelineMarker[];
  readonly timelineStartAt: number;
}) {
  const suggestionsByKind = new Map<SuggestionKind | "unspecified", number>();
  let agentCount = 0;
  let firstTs = Infinity;
  let lastTs = -Infinity;
  for (const marker of markers) {
    firstTs = Math.min(firstTs, marker.timestamp);
    lastTs = Math.max(lastTs, marker.timestamp);
    if (marker.type === "agent") {
      agentCount += 1;
    } else {
      const kind = marker.entry.kind ?? "unspecified";
      suggestionsByKind.set(kind, (suggestionsByKind.get(kind) ?? 0) + 1);
    }
  }
  const suggestionCount = markers.length - agentCount;
  const summaryParts: string[] = [];
  if (suggestionCount > 0) summaryParts.push(pluralize(suggestionCount, "suggestion"));
  if (agentCount > 0) summaryParts.push(pluralize(agentCount, "agent"));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium text-foreground">
          {summaryParts.join(" · ")}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {formatElapsed(firstTs - timelineStartAt)}
          {firstTs !== lastTs ? ` – ${formatElapsed(lastTs - timelineStartAt)}` : ""}
        </span>
      </div>
      {(suggestionsByKind.size > 0 || agentCount > 0) && (
        <ul className="flex flex-col gap-1">
          {[...suggestionsByKind.entries()].map(([kind, count]) => {
            const label = kind === "unspecified" ? "Suggestion" : KIND_LABELS[kind];
            return (
              <li
                key={`kind-${kind}`}
                className="flex items-center gap-2 text-[11px] text-muted-foreground"
              >
                <span className="size-1.5 rounded-full bg-foreground/35" />
                <span>{count} {label.toLowerCase()}{count === 1 ? "" : "s"}</span>
              </li>
            );
          })}
          {agentCount > 0 && (
            <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="size-1.5 rotate-45 bg-primary" />
              <span>{pluralize(agentCount, "agent")}</span>
            </li>
          )}
        </ul>
      )}
      <div className="border-t border-border/40 pt-2 text-[10px] text-muted-foreground/55">
        Click to expand this row
      </div>
    </div>
  );
}

export function SuggestionGrid({
  entries,
  agents = [],
  scanBusy = false,
  timelineStartAt,
  timelineEndAt,
  onSelectAgent,
}: SuggestionGridProps) {
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const focusedScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollMarkerIdRef = useRef<string | null>(null);
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.createdAt - b.createdAt),
    [entries],
  );
  const visibleAgents = useMemo(
    () => agents.filter((agent) => !agent.archived).sort((a, b) => a.createdAt - b.createdAt),
    [agents],
  );
  const markers = useMemo<TimelineMarker[]>(
    () => {
      const fallbackTimestamp = sortedEntries.at(-1)?.createdAt ?? timelineStartAt ?? Date.now();
      const suggestionMarkers = sortedEntries.map((entry): TimelineMarker => ({
        id: `suggestion-${entry.id}`,
        type: "suggestion",
        timestamp: entry.createdAt,
        entry,
      }));
      const agentMarkers = visibleAgents.map((agent, index): TimelineMarker => ({
        id: `agent-${agent.id}`,
        type: "agent",
        timestamp: resolveAgentTimelineTimestamp(
          agent,
          sortedEntries,
          fallbackTimestamp,
          (index + 1) * 15_000,
        ),
        agent,
      }));
      return [...suggestionMarkers, ...agentMarkers].sort((a, b) => a.timestamp - b.timestamp);
    },
    [sortedEntries, timelineStartAt, visibleAgents],
  );
  const markerTimestamps = markers.map((marker) => marker.timestamp);
  const startAt = timelineStartAt ?? (markerTimestamps.length > 0 ? Math.min(...markerTimestamps) : Date.now());
  const rawEndAt = timelineEndAt ?? (markerTimestamps.length > 0 ? Math.max(...markerTimestamps) : startAt);
  const duration = Math.max(MIN_TIMELINE_MS, rawEndAt - startAt);
  const endAt = startAt + duration;
  const rowDuration = chooseRowDuration(duration);
  const rows = clamp(Math.ceil(duration / rowDuration), 1, MAX_TIMELINE_ROWS);
  const focusedRowMarkers = focusedRow === null
    ? []
    : markers.filter((marker) => {
        const elapsed = clamp(marker.timestamp - startAt, 0, duration - 1);
        return Math.min(rows - 1, Math.floor(elapsed / rowDuration)) === focusedRow;
      });
  const focusedRowStartAt =
    focusedRow === null ? startAt : startAt + focusedRow * rowDuration;
  const focusedLayout =
    focusedRow === null
      ? null
      : getFocusedMarkerLayout(focusedRowMarkers, focusedRowStartAt, rowDuration);

  useEffect(() => {
    if (focusedRow === null || !focusedLayout) return;
    const pendingId = pendingScrollMarkerIdRef.current;
    if (!pendingId) return;
    const container = focusedScrollRef.current;
    if (!container) return;
    const target = focusedLayout.items.find(({ marker }) => marker.id === pendingId);
    if (!target) return;
    pendingScrollMarkerIdRef.current = null;
    const viewportWidth = container.clientWidth;
    const maxScroll = Math.max(0, focusedLayout.width - viewportWidth);
    const desired = target.x - viewportWidth / 2;
    container.scrollLeft = clamp(desired, 0, maxScroll);
  }, [focusedRow, focusedLayout]);
  const nowElapsed = clamp(Date.now() - startAt, 0, duration - 1);
  const nextRow = Math.min(rows - 1, Math.floor(nowElapsed / rowDuration));
  const nextCol = Math.min(
    GRID_COLS - 1,
    Math.floor(((nowElapsed - nextRow * rowDuration) / rowDuration) * GRID_COLS),
  );

  const markersByCell = useMemo(() => {
    const cells = new Map<string, TimelineMarker[]>();
    for (const marker of markers) {
      const elapsed = clamp(marker.timestamp - startAt, 0, duration - 1);
      const row = Math.min(rows - 1, Math.floor(elapsed / rowDuration));
      const rowElapsed = elapsed - row * rowDuration;
      const col = Math.min(GRID_COLS - 1, Math.floor((rowElapsed / rowDuration) * GRID_COLS));
      const key = `${row}:${col}`;
      cells.set(key, [...(cells.get(key) ?? []), marker]);
    }
    return cells;
  }, [duration, markers, rowDuration, rows, startAt]);

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setFocusedRow((current) => current === row ? null : row);
      setActiveMarkerId(null);
    }
  };

  const getMarkerRow = (marker: TimelineMarker) => {
    const elapsed = clamp(marker.timestamp - startAt, 0, duration - 1);
    return Math.min(rows - 1, Math.floor(elapsed / rowDuration));
  };

  const focusMarker = (marker: TimelineMarker) => {
    pendingScrollMarkerIdRef.current = marker.id;
    setFocusedRow(getMarkerRow(marker));
    setActiveMarkerId(marker.id);
  };

  const visibleRows =
    focusedRow === null
      ? Array.from({ length: rows }, (_, row) => row)
      : [focusedRow];
  const footerStartMs = focusedRow === null ? 0 : focusedRow * rowDuration;
  const footerEndMs =
    focusedRow === null ? endAt - startAt : Math.min(duration, (focusedRow + 1) * rowDuration);

  const collapseFocus = () => {
    setFocusedRow(null);
    setActiveMarkerId(null);
  };

  return (
    <div
      className="space-y-2"
      onKeyDown={(event) => {
        if (event.key === "Escape" && focusedRow !== null) {
          event.preventDefault();
          collapseFocus();
        }
      }}
    >
      {visibleRows.map((row) => {
        const rowStartMs = row * rowDuration;
        const rowEndMs = Math.min(duration, rowStartMs + rowDuration);
        const isFocused = focusedRow === row;
        const rowFocusedLayout = isFocused ? focusedLayout : null;
        return (
          <div
            key={`row-${row}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              setFocusedRow((current) => current === row ? null : row);
              setActiveMarkerId(null);
            }}
            onKeyDown={(event) => handleRowKeyDown(event, row)}
            className={[
              "grid cursor-pointer grid-cols-[58px_1fr] gap-2 rounded-lg px-1.5 py-1 transition-colors",
              isFocused ? "bg-foreground/[0.045] dark:bg-muted/40" : "hover:bg-foreground/[0.025] dark:hover:bg-muted/25",
            ].join(" ")}
          >
            <div className="flex items-center justify-end text-right font-mono text-[10px] leading-tight text-muted-foreground/60">
              <span>{formatElapsed(rowStartMs)}</span>
            </div>
            {rowFocusedLayout ? (
              <div
                className="col-start-2 min-w-0"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                    {formatElapsed(rowStartMs)} – {formatElapsed(rowEndMs)}
                  </span>
                  <button
                    type="button"
                    aria-label="Collapse row"
                    onClick={(event) => {
                      event.stopPropagation();
                      collapseFocus();
                    }}
                    className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                    Back
                  </button>
                </div>
                <div
                  ref={focusedScrollRef}
                  className="overflow-x-auto overscroll-x-contain pb-2"
                >
                <div
                  className="relative"
                  style={{ width: rowFocusedLayout.width, height: FOCUSED_TRACK_HEIGHT }}
                >
                  <span className="absolute inset-x-0 top-4 h-px bg-border/55" />
                  {rowFocusedLayout.items.map(({ marker, x }) => (
                    <button
                      key={`zoom-marker-${marker.id}`}
                      type="button"
                      aria-label={`${marker.type === "agent" ? "Agent" : "Suggestion"} at ${formatElapsed(marker.timestamp - startAt)}: ${getMarkerText(marker)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        focusMarker(marker);
                      }}
                      className="group absolute top-[7px] z-10 flex size-4 -translate-x-1/2 cursor-pointer items-center justify-center"
                      style={{ left: x }}
                    >
                      <span
                        className={[
                          marker.type === "agent"
                            ? getAgentMarkerClass(marker.agent)
                            : ["rounded-full", getSuggestionMarkerClass(marker.entry)].join(" "),
                          activeMarkerId === marker.id ? "ring-2 ring-foreground/25" : "",
                        ].join(" ")}
                      />
                    </button>
                  ))}
                  {rowFocusedLayout.items.map(({ marker, x }) => {
                    const isActive = activeMarkerId === marker.id;
                    const chipBase = [
                      "group flex h-full w-full cursor-pointer flex-col gap-1.5 rounded-xl border p-2.5 text-left shadow-sm transition-colors",
                      isActive
                        ? "border-foreground/25 bg-background text-foreground"
                        : "border-border/50 bg-background/80 text-foreground/80 hover:border-foreground/20 hover:bg-background hover:text-foreground",
                    ].join(" ");
                    const tooltipContent = marker.type === "agent" ? (
                      <AgentTooltip
                        agent={marker.agent}
                        timelineStartAt={startAt}
                        displayTimestamp={marker.timestamp}
                        onSelectAgent={onSelectAgent}
                      />
                    ) : (
                      <SuggestionTooltip
                        entry={marker.entry}
                        timelineStartAt={startAt}
                      />
                    );
                    const tooltipWidthClass = marker.type === "suggestion" && marker.entry.briefingPoints?.length
                      ? "w-[460px]"
                      : "w-80";
                    return (
                      <div
                        key={`zoom-chip-${marker.id}`}
                        className="absolute z-10"
                        style={{
                          left: x,
                          top: 36,
                          height: FOCUSED_TRACK_HEIGHT - 44,
                          width: FOCUSED_CHIP_WIDTH,
                          transform: "translateX(-50%)",
                        }}
                      >
                        <HoverCard openDelay={120} closeDelay={120}>
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                focusMarker(marker);
                              }}
                              className={chipBase}
                            >
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="font-mono text-muted-foreground/70">
                                  {formatElapsed(marker.timestamp - startAt)}
                                </span>
                                {marker.type === "agent" && (
                                  <BotIcon className="size-3 shrink-0 text-primary" />
                                )}
                              </div>
                              <p className="line-clamp-5 text-[11px] font-medium leading-snug">
                                {getMarkerText(marker)}
                              </p>
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent
                            align="center"
                            sideOffset={10}
                            className={`${tooltipWidthClass} rounded-2xl border border-border/60 bg-popover/95 p-3.5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-popover/85`}
                          >
                            {tooltipContent}
                          </HoverCardContent>
                        </HoverCard>
                      </div>
                    );
                  })}
                </div>
                </div>
              </div>
            ) : (
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: GRID_COLS }, (_, col) => {
                  const cellMarkers = markersByCell.get(`${row}:${col}`) ?? [];
                  const isNext = scanBusy && row === nextRow && col === nextCol;
                  return (
                    <div
                      key={`${row}-${col}`}
                      className="relative flex h-6 items-center justify-center"
                    >
                      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/35" />
                      {cellMarkers.length === 0 ? (
                        <span
                          className={[
                            "relative z-10 rounded-full transition-all",
                            isNext
                              ? "size-1.5 animate-pulse bg-emerald-500/45"
                              : "size-1 bg-foreground/12 dark:bg-foreground/10",
                          ].join(" ")}
                        />
                      ) : (
                        <HoverCard openDelay={120} closeDelay={120}>
                          <HoverCardTrigger asChild>
                            <div className="relative z-10 flex max-w-full flex-wrap items-center justify-center gap-1">
                              {cellMarkers.slice(0, 3).map((marker) => (
                                <button
                                  key={marker.id}
                                  type="button"
                                  aria-label={
                                    marker.type === "agent"
                                      ? `Agent at ${formatElapsed(marker.timestamp - startAt)}: ${marker.agent.task}`
                                      : `Suggestion at ${formatElapsed(marker.timestamp - startAt)}: ${marker.entry.text}`
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    focusMarker(marker);
                                  }}
                                  className="group flex size-4 cursor-pointer items-center justify-center"
                                >
                                  <span
                                    className={[
                                      marker.type === "agent"
                                        ? `transition-transform group-hover:scale-125 ${getAgentMarkerClass(marker.agent)}`
                                        : `rounded-full transition-transform group-hover:scale-150 ${getSuggestionMarkerClass(marker.entry)}`,
                                    ].join(" ")}
                                  />
                                </button>
                              ))}
                              {cellMarkers.length > 3 && (
                                <span className="rounded-full bg-foreground/10 px-1 font-mono text-[9px] text-muted-foreground">
                                  +{cellMarkers.length - 3}
                                </span>
                              )}
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent
                            align="center"
                            sideOffset={10}
                            className="w-56 rounded-xl border border-border/60 bg-popover/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/85"
                          >
                            <CellStats markers={cellMarkers} timelineStartAt={startAt} />
                          </HoverCardContent>
                        </HoverCard>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between px-[68px] pt-0.5 font-mono text-[10px] text-muted-foreground/45">
        <span>{formatElapsed(footerStartMs)}</span>
        <span>{formatElapsed(footerEndMs)}</span>
      </div>
    </div>
  );
}
