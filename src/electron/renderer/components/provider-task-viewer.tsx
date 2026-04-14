import { useEffect, useState } from "react";
import type { ProviderTaskEntry } from "@core/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Spinner } from "./ui/spinner";
import { cn } from "@/lib/utils";
import {
  useProviderTaskByToolCallId,
  useProviderTaskStore,
  type ProviderTaskRecord,
} from "@/stores/provider-task-store";

type ProviderTaskViewerProps = {
  toolCallId: string;
};

export function ProviderTaskViewer({ toolCallId }: ProviderTaskViewerProps) {
  const task = useProviderTaskByToolCallId(toolCallId);
  const cancel = useProviderTaskStore((s) => s.cancel);
  const [open, setOpen] = useState(true);

  // Auto-collapse once the task finishes; auto-expand while running.
  useEffect(() => {
    if (!task) return;
    setOpen(task.status === "running");
  }, [task?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;

  const providerLabel = task.provider === "codex" ? "Codex" : "Claude Code";
  const statusLabel: Record<ProviderTaskRecord["status"], string> = {
    running: "Running",
    completed: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  const badgeVariant: Record<ProviderTaskRecord["status"], "default" | "destructive" | "secondary" | "outline"> = {
    running: "secondary",
    completed: "default",
    failed: "destructive",
    cancelled: "outline",
  };

  const elapsed = task.endedAt
    ? Math.max(0, Math.round((task.endedAt - task.startedAt) / 1000))
    : null;

  return (
    <div className="mt-1 rounded-md border border-border bg-muted/10">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex flex-1 items-center gap-2 text-left text-2xs",
                "text-muted-foreground hover:text-foreground",
              )}
            >
              {task.status === "running" ? (
                <Spinner className="size-3" />
              ) : (
                <span
                  className={cn("size-1.5 rounded-full", {
                    "bg-green-500": task.status === "completed",
                    "bg-red-500": task.status === "failed",
                    "bg-muted-foreground": task.status === "cancelled",
                  })}
                />
              )}
              <span className="font-medium text-foreground">{providerLabel}</span>
              <Badge variant={badgeVariant[task.status]} className="h-4 px-1 text-2xs">
                {statusLabel[task.status]}
              </Badge>
              <span className="ml-auto flex items-center gap-2">
                {elapsed !== null && <span>{elapsed}s</span>}
                <span className="text-muted-foreground">
                  {task.entries.length} {task.entries.length === 1 ? "event" : "events"}
                </span>
              </span>
            </button>
          </CollapsibleTrigger>
          {task.status === "running" && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => void cancel(task.taskId)}
              className="h-5 px-1.5 text-2xs"
            >
              Stop
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <div className="border-t border-border/60 px-2 py-1.5">
            {task.prompt && (
              <div className="mb-1.5 rounded-sm bg-muted/30 px-1.5 py-1 text-2xs text-muted-foreground">
                <span className="font-medium text-foreground">Prompt: </span>
                {task.prompt.length > 200 ? `${task.prompt.slice(0, 200)}…` : task.prompt}
              </div>
            )}
            {task.entries.length === 0 && task.status === "running" && (
              <div className="py-2 text-center text-2xs text-muted-foreground">
                Waiting for first event…
              </div>
            )}
            {task.entries.length > 0 && (
              <ul className="space-y-1">
                {task.entries.map((entry, i) => (
                  <li key={i} className="text-2xs leading-snug">
                    <EntryRow entry={entry} />
                  </li>
                ))}
              </ul>
            )}
            {task.summary && task.status === "completed" && (
              <div className="mt-2 rounded-sm border border-border/40 bg-background px-1.5 py-1 text-2xs leading-relaxed">
                <span className="mb-0.5 block font-medium text-foreground">Result</span>
                <span className="text-muted-foreground">
                  {task.summary.length > 600 ? `${task.summary.slice(0, 600)}…` : task.summary}
                </span>
              </div>
            )}
            {task.error && (
              <div className="mt-2 rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-1 text-2xs text-destructive">
                {task.error}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function EntryRow({ entry }: { entry: ProviderTaskEntry }) {
  if (entry.type === "command") {
    return (
      <div className="flex items-start gap-1.5">
        <span className="shrink-0 text-muted-foreground/70">$</span>
        <span className="flex-1 break-all font-mono text-muted-foreground">
          {truncate(entry.command, 240)}
        </span>
        {entry.exitCode !== undefined && (
          <span
            className={cn(
              "shrink-0 font-mono",
              entry.exitCode === 0 ? "text-muted-foreground/70" : "text-destructive",
            )}
          >
            {entry.exitCode}
          </span>
        )}
      </div>
    );
  }
  if (entry.type === "file-change") {
    return (
      <div className="flex flex-col gap-0.5">
        {entry.changes.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="shrink-0 text-muted-foreground/70">{c.kind}</span>
            <span className="font-mono text-muted-foreground">{c.path}</span>
          </div>
        ))}
      </div>
    );
  }
  if (entry.type === "reasoning") {
    return <span className="text-muted-foreground/80 italic">{truncate(entry.text, 240)}</span>;
  }
  if (entry.type === "message") {
    return <span className="text-muted-foreground">{truncate(entry.text, 240)}</span>;
  }
  if (entry.type === "tool-call") {
    return (
      <div className="flex items-start gap-1.5">
        <span className="shrink-0 text-muted-foreground/70">⚙</span>
        <span className="flex-1 font-mono text-muted-foreground">
          {entry.toolName}
          {entry.input ? ` · ${truncate(entry.input, 160)}` : null}
        </span>
      </div>
    );
  }
  return <span className="text-muted-foreground">{truncate(entry.text, 240)}</span>;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
