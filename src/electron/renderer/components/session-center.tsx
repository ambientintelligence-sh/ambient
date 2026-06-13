import type { ReactNode } from "react";

type SessionCenterProps = {
  mode: "home" | "agent";
  captureBar?: ReactNode;
  homeContent: ReactNode;
  agentContent: ReactNode;
};

export function SessionCenter({
  mode,
  captureBar,
  homeContent,
  agentContent,
}: SessionCenterProps) {
  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {captureBar && (
        <div className="sticky top-0 z-20 shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {captureBar}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mode === "home" && homeContent}
        {mode === "agent" && agentContent}
      </div>
    </main>
  );
}
