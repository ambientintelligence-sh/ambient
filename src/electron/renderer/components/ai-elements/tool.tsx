"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

function formatToolName(type: string): string {
  const raw = type.startsWith("tool-") ? type.slice(5) : type;
  return raw.replaceAll("_", " ").replaceAll("-", " ").trim() || "tool";
}

function formatInline(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export type ToolProps = ComponentProps<typeof Collapsible>;

export function Tool({
  className,
  isStreaming = false,
  defaultOpen = false,
  open,
  onOpenChange,
  ...props
}: ToolProps & { isStreaming?: boolean }) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const prevStreaming = useRef(isStreaming);
  const currentOpen = isControlled ? open : uncontrolledOpen;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (prevStreaming.current === isStreaming) return;
    prevStreaming.current = isStreaming;
    if (!isControlled) {
      // Cursor-like behavior: open while running, collapse when done.
      setUncontrolledOpen(isStreaming);
    }
    onOpenChangeRef.current?.(isStreaming);
  }, [isControlled, isStreaming]);

  return (
    <Collapsible
      className={cn("w-full", className)}
      onOpenChange={(nextOpen) => {
        if (!isControlled) setUncontrolledOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
      open={currentOpen}
      {...props}
    />
  );
}

export type ToolHeaderProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "type"> & {
  title?: string;
  type: string;
  state: ToolState;
};

export function ToolHeader({
  title,
  type,
  state,
  className,
  ...props
}: ToolHeaderProps) {
  const stateLabel =
    state === "input-streaming"
      ? "running"
      : state === "output-error"
      ? "error"
      : state === "output-available"
      ? "done"
      : "ready";

  return (
    <CollapsibleTrigger
      className={cn(
        "group/tool-trigger flex w-full items-center gap-1 rounded-sm px-0 py-0 text-left text-2xs text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{title ?? formatToolName(type)}</span>
      <span className="shrink-0 font-mono text-2xs uppercase tracking-wide text-muted-foreground/70">
        {stateLabel}
      </span>
      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/60 transition-transform group-data-[state=open]/tool-trigger:rotate-180" />
    </CollapsibleTrigger>
  );
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cn("pl-3 pr-0 pb-0.5 pt-0.5", className)}
      {...props}
    />
  );
}

export type ToolInputProps = HTMLAttributes<HTMLDivElement> & {
  input: unknown;
};

export function ToolInput({ input, className, ...props }: ToolInputProps) {
  return (
    <div
      className={cn(
        "text-2xs text-muted-foreground/90 leading-snug font-mono break-all",
        className
      )}
      {...props}
    >
      {formatInline(input)}
    </div>
  );
}

export type ToolOutputProps = HTMLAttributes<HTMLDivElement> & {
  output?: ReactNode;
  errorText?: string;
};

export function ToolOutput({
  output,
  errorText,
  className,
  ...props
}: ToolOutputProps) {
  return (
    <div
      className={cn(
        "text-2xs text-muted-foreground/90 leading-snug",
        className
      )}
      {...props}
    >
      {errorText ?? output}
    </div>
  );
}
