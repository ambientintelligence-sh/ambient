"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { ExternalLinkIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type CitationSource = {
  title: string;
  url: string;
  quote?: string;
};

export function InlineCitation({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span className={cn("inline-flex items-center", className)} {...props} />
  );
}

export function InlineCitationCard({
  children,
}: {
  children: React.ReactNode;
}) {
  return <HoverCard openDelay={150}>{children}</HoverCard>;
}

export function InlineCitationCardTrigger({
  number,
  className,
}: {
  number: string | number;
  className?: string;
}) {
  return (
    <HoverCardTrigger asChild>
      <button
        type="button"
        className={cn(
          "inline-flex cursor-default items-center justify-center rounded-sm bg-muted px-1 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          className
        )}
      >
        [{number}]
      </button>
    </HoverCardTrigger>
  );
}

export function InlineCitationCardBody({
  title,
  url,
  quote,
  className,
}: CitationSource & { className?: string }) {
  return (
    <HoverCardContent className={cn("w-72", className)}>
      <div className="flex flex-col gap-1.5">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-1 font-medium leading-snug text-primary hover:underline"
        >
          {title}
          <ExternalLinkIcon className="mt-0.5 shrink-0" size={10} />
        </a>
        <p className="break-all text-muted-foreground">{url}</p>
        {quote && (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-2 italic text-muted-foreground">
            {quote}
          </blockquote>
        )}
      </div>
    </HoverCardContent>
  );
}

/** Convenience component: a single hoverable citation badge. */
export function InlineCitationBadge({
  number,
  title,
  url,
  quote,
}: { number: string | number } & CitationSource) {
  return (
    <InlineCitation>
      <InlineCitationCard>
        <InlineCitationCardTrigger number={number} />
        <InlineCitationCardBody title={title} url={url} quote={quote} />
      </InlineCitationCard>
    </InlineCitation>
  );
}
