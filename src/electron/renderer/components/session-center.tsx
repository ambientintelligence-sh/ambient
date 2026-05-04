import type { ReactNode } from "react";

type SessionCenterProps = {
  mode: "home" | "new-agent" | "agent";
  homeContent: ReactNode;
  newAgentContent: ReactNode;
  agentContent: ReactNode;
};

export function SessionCenter({ mode, homeContent, newAgentContent, agentContent }: SessionCenterProps) {
  return (
    <main className="flex-1 flex flex-col min-h-0 min-w-0 relative bg-background">
      {mode === "home" && homeContent}
      {mode === "new-agent" && newAgentContent}
      {mode === "agent" && agentContent}
    </main>
  );
}
