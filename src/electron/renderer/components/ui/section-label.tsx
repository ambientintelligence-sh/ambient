import type { ElementType, ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type SectionLabelProps<T extends ElementType = "h2"> = {
  as?: T;
  className?: string;
  children: React.ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export function SectionLabel<T extends ElementType = "h2">({
  as,
  className,
  children,
  ...props
}: SectionLabelProps<T>) {
  const Tag = (as ?? "h2") as ElementType;
  return (
    <Tag
      className={cn(
        "section-label text-2xs font-medium text-muted-foreground uppercase tracking-wider",
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
