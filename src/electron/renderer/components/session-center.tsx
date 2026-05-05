import type { ReactNode } from "react";

type SessionCenterProps = {
  mode: "home" | "agent";
  homeContent: ReactNode;
  agentContent: ReactNode;
};

export function SessionCenter({
  mode,
  homeContent,
  agentContent,
}: SessionCenterProps) {
  return (
    <main className="flex-1 flex flex-col min-h-0 min-w-0 relative bg-background">
      {mode === "home" && homeContent}
      {mode === "agent" && agentContent}
    </main>
  );
}
