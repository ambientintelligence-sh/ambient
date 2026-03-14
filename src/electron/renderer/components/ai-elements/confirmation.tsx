"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

type ConfirmationState = "approval-requested" | "approval-responded" | "output-denied" | "output-available";

type ConfirmationContextValue = {
  state: ConfirmationState;
  approved?: boolean;
};

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

function useConfirmationContext(): ConfirmationContextValue {
  const value = useContext(ConfirmationContext);
  if (!value) {
    throw new Error("Confirmation components must be used inside <Confirmation />");
  }
  return value;
}

export function Confirmation({
  state,
  approved,
  className,
  children,
  ...props
}: {
  state: ConfirmationState;
  approved?: boolean;
  className?: string;
  children: ReactNode;
} & ComponentProps<"div">) {
  return (
    <ConfirmationContext.Provider value={{ state, approved }}>
      <div
        className={cn("rounded-sm border border-border bg-muted/20 px-2 py-2", className)}
        {...props}
      >
        {children}
      </div>
    </ConfirmationContext.Provider>
  );
}

export function ConfirmationRequest({ children, className, ...props }: ComponentProps<"div">) {
  const { state } = useConfirmationContext();
  if (state !== "approval-requested") return null;
  return (
    <div className={cn("text-2xs text-foreground", className)} {...props}>
      {children}
    </div>
  );
}

export function ConfirmationAccepted({ children, className, ...props }: ComponentProps<"div">) {
  const { state, approved } = useConfirmationContext();
  if (!approved || (state !== "approval-responded" && state !== "output-available")) return null;
  return (
    <div className={cn("flex items-center gap-1 text-2xs text-green-600", className)} {...props}>
      {children}
    </div>
  );
}

export function ConfirmationRejected({ children, className, ...props }: ComponentProps<"div">) {
  const { state, approved } = useConfirmationContext();
  if (approved !== false || (state !== "approval-responded" && state !== "output-denied")) return null;
  return (
    <div className={cn("flex items-center gap-1 text-2xs text-destructive", className)} {...props}>
      {children}
    </div>
  );
}

export function ConfirmationActions({ children, className, ...props }: ComponentProps<"div">) {
  const { state } = useConfirmationContext();
  if (state !== "approval-requested") return null;
  return (
    <div className={cn("mt-2 flex items-center justify-end gap-1", className)} {...props}>
      {children}
    </div>
  );
}

export function ConfirmationAction({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button size="sm" className={cn("h-7 px-2", className)} {...props} />;
}
