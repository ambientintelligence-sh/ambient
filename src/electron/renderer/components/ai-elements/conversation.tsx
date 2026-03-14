"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, MessageSquareIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export function Conversation({
  className,
  resize = "smooth",
  initial = "smooth",
  children,
  ...props
}: ConversationProps) {
  return (
    <StickToBottom
      className={cn("relative flex h-full min-h-0 flex-col overflow-hidden", className)}
      initial={initial}
      resize={resize}
      {...props}
    >
      {children}
    </StickToBottom>
  );
}

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export function ConversationContent({
  className,
  scrollClassName,
  children,
  ...props
}: ConversationContentProps) {
  return (
    <StickToBottom.Content
      className={cn("flex flex-col gap-2 px-3 py-2.5", className)}
      scrollClassName={cn("h-full overflow-y-auto", scrollClassName)}
      {...props}
    >
      {children}
    </StickToBottom.Content>
  );
}

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export function ConversationScrollButton({
  className,
  onClick,
  ...props
}: ConversationScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;

  return (
    <Button
      aria-label="Scroll to bottom"
      className={cn(
        "absolute bottom-2 left-1/2 -translate-x-1/2 rounded-sm border border-border bg-background/90 hover:bg-muted",
        className
      )}
      onClick={(event) => {
        void scrollToBottom({ animation: "smooth" });
        onClick?.(event);
      }}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      <ChevronDownIcon className="size-3.5" />
    </Button>
  );
}

export type ConversationEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  description?: string;
  icon?: ReactNode;
};

export function ConversationEmptyState({
  title,
  description,
  icon,
  className,
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div
      className={cn("flex min-h-32 flex-col items-center justify-center gap-2 py-10 text-center", className)}
      {...props}
    >
      <div className="text-muted-foreground">{icon ?? <MessageSquareIcon className="size-5" />}</div>
      <p className="text-xs font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-[32ch] text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
