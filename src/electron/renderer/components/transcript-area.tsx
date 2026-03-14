import {
  forwardRef,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { TranscriptBlock } from "@core/types";
import { ChevronDownIcon, ChevronUpIcon, MicIcon, PencilIcon, Volume2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";

type TranscriptAreaProps = {
  blocks: TranscriptBlock[];
  systemPartial?: string;
  micPartial?: string;
  canTranslate?: boolean;
  translationEnabled?: boolean;
  onAddTranscriptRef?: (text: string) => void;
};

const PARAGRAPH_MAX_MS = 30_000;
const SELECTION_MENU_DEBOUNCE_MS = 180;

function groupIntoParagraphs(blocks: readonly TranscriptBlock[]): TranscriptBlock[][] {
  const paragraphs: TranscriptBlock[][] = [];
  let current: TranscriptBlock[] = [];
  let windowStart = 0;

  for (const block of blocks) {
    if (current.length === 0) {
      windowStart = block.createdAt;
      current.push(block);
      continue;
    }

    if (block.newTopic || block.createdAt - windowStart > PARAGRAPH_MAX_MS || block.audioSource !== current[0].audioSource) {
      paragraphs.push(current);
      current = [block];
      windowStart = block.createdAt;
    } else {
      current.push(block);
    }
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.!?\u3002\uFF01\uFF1F]\s*$/, "");
}

function joinTexts(
  paragraph: readonly TranscriptBlock[],
  getText: (b: TranscriptBlock) => string | undefined
): string {
  return paragraph
    .map((b, i) => {
      const text = getText(b) ?? "";
      if (!text) return "";
      const isLast = i === paragraph.length - 1;
      return b.partial && !isLast ? stripTrailingPunctuation(text) : text;
    })
    .filter(Boolean)
    .join(" ");
}

const NOTE_COLLAPSE_CHARS = 300;
const NOTE_COLLAPSE_LINES = 5;

function isLongNote(text: string): boolean {
  return text.length > NOTE_COLLAPSE_CHARS || text.split("\n").length > NOTE_COLLAPSE_LINES;
}

function Paragraph({ blocks, isLast, canTranslate, translationEnabled }: { blocks: TranscriptBlock[]; isLast: boolean; canTranslate: boolean; translationEnabled: boolean }) {
  const first = blocks[0];
  const isNote = first.audioSource === "note";
  const [expanded, setExpanded] = useState(false);

  const sourceText = joinTexts(blocks, (b) => b.sourceText);
  const translationText = joinTexts(blocks, (b) => b.translation);
  const hasPending = canTranslate && translationEnabled && blocks.some((b) => !b.translation);
  const isNonEnglishSource = first.sourceLabel !== "EN";
  const long = isNote && isLongNote(sourceText);

  return (
    <div className={`pb-3 ${isLast ? "" : "mb-3 border-b border-border/50"}`}>
      <div className="font-mono text-muted-foreground text-2xs mb-1 flex items-center gap-1.5">
        {isNote ? (
          <PencilIcon className="size-3" />
        ) : first.audioSource === "microphone" ? (
          <MicIcon className="size-3 text-mic-source" />
        ) : (
          <Volume2Icon className="size-3 text-system-source" />
        )}
        {formatTimestamp(first.createdAt)}
      </div>
      {isNote ? (
        <>
          <div className={`text-sm text-foreground/80 whitespace-pre-wrap ${long && !expanded ? "line-clamp-3" : ""}`}>
            {sourceText}
          </div>
          {long && (
            <button
              type="button"
              className="mt-1 flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <><ChevronUpIcon className="size-3" />Show less</>
              ) : (
                <><ChevronDownIcon className="size-3" />Show more</>
              )}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="text-sm">
            <span className="text-foreground">{sourceText}</span>
            {isNonEnglishSource && (
              <span className="text-2xs text-muted-foreground/60 ml-1.5 font-mono">
                {first.sourceLabel.toLowerCase()}
              </span>
            )}
          </div>
          {translationText ? (
            <div className="text-sm mt-0.5">
              <span className="text-foreground">
                {translationText}
                {translationEnabled && canTranslate && hasPending && (
                  <span className="text-muted-foreground ml-1 animate-pulse">
                    Translating...
                  </span>
                )}
              </span>
            </div>
          ) : (
            translationEnabled && canTranslate && (
              <div className="text-sm mt-0.5">
                <span className="text-muted-foreground animate-pulse">
                  Translating...
                </span>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

export const TranscriptArea = forwardRef<HTMLDivElement, TranscriptAreaProps>(
  function TranscriptArea({ blocks, systemPartial, micPartial, canTranslate, translationEnabled, onAddTranscriptRef }, ref) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectionMenuTimerRef = useRef<number | null>(null);
    const paragraphs = groupIntoParagraphs(blocks);
    const [selectionText, setSelectionText] = useState("");
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [addedFeedback, setAddedFeedback] = useState(false);
    const [noteInput, setNoteInput] = useState("");

    const submitNote = async () => {
      const text = noteInput.trim();
      if (!text) return;
      setNoteInput("");
      await window.electronAPI.addContextNote(text);
    };

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [blocks.length]);

    const setContainerRef = (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    const clearSelectionMenuTimer = () => {
      if (selectionMenuTimerRef.current == null) return;
      window.clearTimeout(selectionMenuTimerRef.current);
      selectionMenuTimerRef.current = null;
    };

    const clearSelectionMenu = (clearNativeSelection = false) => {
      clearSelectionMenuTimer();
      setSelectionText("");
      setMenuPosition(null);
      if (!clearNativeSelection) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges();
      }
    };

    const handleSelectionChange = (event?: SyntheticEvent) => {
      if (!onAddTranscriptRef) return;
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        clearSelectionMenu();
        return;
      }

      const range = selection.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const anchorElement = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
      if (!anchorElement || !container.contains(anchorElement)) {
        clearSelectionMenu();
        return;
      }

      const selected = selection.toString().trim();
      if (!selected) {
        clearSelectionMenu();
        return;
      }

      // Ignore if the event came from outside the transcript (e.g. note input)
      if (event?.target instanceof Node && !container.contains(event.target)) {
        clearSelectionMenu();
        return;
      }

      const rangeRect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const minLeft = container.scrollLeft + 8;
      const maxLeft = container.scrollLeft + container.clientWidth - 130;
      let left = rangeRect.left - containerRect.left + container.scrollLeft;
      left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));

      let top = rangeRect.top - containerRect.top + container.scrollTop - 34;
      if (top < container.scrollTop + 4) {
        top = rangeRect.bottom - containerRect.top + container.scrollTop + 6;
      }

      setSelectionText(selected);
      setMenuPosition({ top, left });
    };

    const handleMouseSelectionChange = () => {
      clearSelectionMenuTimer();
      selectionMenuTimerRef.current = window.setTimeout(() => {
        selectionMenuTimerRef.current = null;
        handleSelectionChange();
      }, SELECTION_MENU_DEBOUNCE_MS);
    };

    const addRef = (text: string) => {
      onAddTranscriptRef?.(text);
      setAddedFeedback(true);
      clearSelectionMenu(true);
    };

    // Auto-hide the "Added" feedback toast
    useEffect(() => {
      if (!addedFeedback) return;
      const timer = window.setTimeout(() => setAddedFeedback(false), 1500);
      return () => window.clearTimeout(timer);
    }, [addedFeedback]);

    const addRefStable = useRef(addRef);
    addRefStable.current = addRef;
    const clearSelectionMenuRef = useRef(clearSelectionMenu);
    clearSelectionMenuRef.current = clearSelectionMenu;
    const clearSelectionMenuTimerRef = useRef(clearSelectionMenuTimer);
    clearSelectionMenuTimerRef.current = clearSelectionMenuTimer;

    // ⌘L adds the current selection as a transcript ref
    useEffect(() => {
      if (!onAddTranscriptRef) return;
      const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "l") {
          const text = selectionText || window.getSelection()?.toString().trim();
          if (!text) return;
          event.preventDefault();
          addRefStable.current(text);
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [selectionText, onAddTranscriptRef]);

    // Close hint chip on outside click
    useEffect(() => {
      if (!menuPosition) return;
      const closeOnOutsidePointer = (event: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;
        if (event.target instanceof Node && container.contains(event.target)) return;
        clearSelectionMenuRef.current();
      };
      document.addEventListener("mousedown", closeOnOutsidePointer);
      return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
    }, [menuPosition]);

    useEffect(() => () => {
      clearSelectionMenuTimerRef.current();
    }, []);

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <SectionLabel className="px-4 pt-2.5 pb-1.5 shrink-0">Live Transcript</SectionLabel>
        <div
          ref={setContainerRef}
          className="relative flex-1 overflow-y-auto px-4 pb-2"
          onMouseUp={handleMouseSelectionChange}
          onKeyUp={handleSelectionChange}
          onTouchEnd={handleSelectionChange}
          onScroll={() => {
            if (menuPosition) clearSelectionMenu();
          }}
        >
          {/* "Added" confirmation toast */}
          {addedFeedback && (
            <div className="sticky top-2 z-20 float-right mr-0 mb-0 flex items-center gap-1 px-2 py-1 text-2xs bg-background border border-border shadow-sm rounded-sm text-muted-foreground">
              Added to task input
            </div>
          )}

          {/* Hint chip near selection */}
          {menuPosition && onAddTranscriptRef && selectionText && (
            <div
              className="absolute z-20"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 py-1 text-2xs bg-background border border-border shadow-sm rounded-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                onClick={() => addRef(selectionText)}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onMouseUp={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
              >
                <span className="font-mono opacity-60">⌘L</span>
                <span>Add to task</span>
              </button>
            </div>
          )}

          {paragraphs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic mt-2">
              Speak or add a note to get started...
            </p>
          ) : (
            paragraphs.map((p, i) => (
              <Paragraph
                key={String(p[0].id)}
                blocks={p}
                isLast={i === paragraphs.length - 1}
                canTranslate={canTranslate ?? false}
                translationEnabled={translationEnabled ?? false}
              />
            ))
          )}
          {systemPartial && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground/50 italic animate-pulse">
              <span>{systemPartial}</span>
            </div>
          )}
          {micPartial && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground/50 italic animate-pulse">
              <span>{micPartial}</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="shrink-0 border-t border-border/50 px-3 py-2 flex items-center gap-2">
          <PencilIcon className="size-3 shrink-0 text-muted-foreground/50" />
          <Input
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitNote();
              }
            }}
            placeholder="Add context note... (Enter to submit)"
            className="h-7 flex-1 text-xs border-none bg-transparent shadow-none focus-visible:ring-0 pl-1.5 pr-0"
          />
          {noteInput.trim() && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-2xs"
              onClick={submitNote}
            >
              Add
            </Button>
          )}
        </div>
      </div>
    );
  }
);
