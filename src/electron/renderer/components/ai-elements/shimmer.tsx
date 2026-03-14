"use client";

import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "@/lib/utils";

type ShimmerProps<T extends ElementType = "p"> = {
  as?: T;
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function Shimmer<T extends ElementType = "p">({
  as,
  children,
  className,
  duration = 2,
  spread = 2,
  style,
  ...props
}: ShimmerProps<T>) {
  const Component = (as ?? "p") as ElementType;
  const safeDuration = Math.max(0.2, duration);
  const safeSpread = Math.max(1, spread);

  return (
    <Component
      className={cn("inline-block bg-clip-text text-transparent", className)}
      style={{
        backgroundImage:
          "linear-gradient(110deg, var(--muted-foreground) 40%, var(--foreground) 50%, var(--muted-foreground) 60%)",
        backgroundPosition: "120% 0",
        backgroundSize: `${safeSpread * 180}% 100%`,
        animation: `ai-shimmer ${safeDuration}s linear infinite`,
        ...style,
      }}
      {...props}
    >
      {children}
    </Component>
  );
}
