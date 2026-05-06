import {
  AlertTriangleIcon,
  LightbulbIcon,
  ListChecksIcon,
  PencilIcon,
  PlayIcon,
  SearchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import type { SuggestionKind } from "@core/types";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

export type SuggestionGridEntry = {
  id: string;
  state: "live" | "archived";
  text: string;
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
  scanBusy?: boolean;
  /** Session-wide rolling key points, rendered alongside the suggestion in the hover card. */
  keyPoints?: string[];
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

const MAX_BRIEFING_POINTS = 5;

function SuggestionTooltip({
  entry,
  keyPoints,
}: {
  entry: SuggestionGridEntry;
  keyPoints: string[];
}) {
  const Icon = entry.kind ? SUGGESTION_KIND_ICONS[entry.kind] : SearchIcon;
  const flag = entry.flag?.trim();
  const details = entry.details?.trim();
  const excerpt = entry.transcriptExcerpt?.trim();
  const kindLabel = entry.kind ? KIND_LABELS[entry.kind] : "Suggestion";
  const isLive = entry.state === "live";
  const visiblePoints = keyPoints.slice(-MAX_BRIEFING_POINTS).reverse();
  const hiddenCount = Math.max(0, keyPoints.length - visiblePoints.length);
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

      <div className="mt-3.5 flex items-center gap-1.5 border-t border-border/40 pt-3">
        {entry.onAccept && (
          <button
            type="button"
            onClick={entry.onAccept}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          >
            <PlayIcon className="size-2.5 fill-current" />
            Run agent
          </button>
        )}
        <button
          type="button"
          onClick={entry.onDismiss}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-2.5" />
          {entry.dismissLabel ?? "Dismiss"}
        </button>
      </div>
    </div>
  );
}

export function SuggestionGrid({
  entries,
  scanBusy = false,
  keyPoints = [],
}: SuggestionGridProps) {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const filled = sorted.length;
  // Always render filled rows + one trailing row of placeholders. Empty grid
  // shows a single row of faint dots, which doubles as the "Listening" affordance.
  const rows = Math.ceil(filled / GRID_COLS) + 1;
  const total = rows * GRID_COLS;
  const nextSlot = Math.min(filled, total - 1);
  const hasBriefing = keyPoints.length > 0;
  const popupWidthClass = hasBriefing ? "w-[460px]" : "w-80";

  return (
    <div
      className="grid w-full gap-1.5"
      style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, i) => {
        const entry = sorted[i];
        if (entry) {
          const isLive = entry.state === "live";
          return (
            <HoverCard key={entry.id} openDelay={80} closeDelay={120}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  aria-label={`Suggestion: ${entry.text}`}
                  className="group flex aspect-square cursor-pointer items-center justify-center"
                >
                  <span
                    className={[
                      "rounded-full transition-all group-hover:scale-150",
                      isLive
                        ? "size-2 bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)] group-hover:shadow-[0_0_0_5px_rgba(16,185,129,0.3)] dark:bg-emerald-400 dark:shadow-[0_0_0_3px_rgba(52,211,153,0.22)] dark:group-hover:shadow-[0_0_0_5px_rgba(52,211,153,0.34)]"
                        : "size-1.5 bg-emerald-500/55 dark:bg-emerald-400/55 group-hover:bg-emerald-500 dark:group-hover:bg-emerald-400",
                    ].join(" ")}
                  />
                </button>
              </HoverCardTrigger>
              <HoverCardContent
                align="center"
                sideOffset={10}
                className={`${popupWidthClass} rounded-2xl border border-border/60 bg-popover/95 p-3.5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-popover/85`}
              >
                <SuggestionTooltip entry={entry} keyPoints={keyPoints} />
              </HoverCardContent>
            </HoverCard>
          );
        }

        const isNext = i === nextSlot;
        return (
          <div
            key={`empty-${i}`}
            className="flex aspect-square items-center justify-center"
          >
            <span
              className={[
                "rounded-full transition-all",
                isNext && scanBusy
                  ? "size-1.5 bg-emerald-500/40 animate-pulse"
                  : "size-1 bg-foreground/15 dark:bg-foreground/12",
              ].join(" ")}
            />
          </div>
        );
      })}
    </div>
  );
}
