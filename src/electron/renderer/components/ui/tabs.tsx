import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-sm border border-border/70 bg-muted/35 p-1",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[6px] border border-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors select-none",
        "hover:bg-background/70 hover:text-foreground",
        "data-[state=active]:border-border/85 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 rounded-sm",
        "data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-150",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
