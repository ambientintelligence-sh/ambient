import type { Agent, AgentStep } from "@core/types";
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";
import { CirclePauseIcon, PlusIcon } from "lucide-react";
import { SectionLabel } from "@/components/ui/section-label";
import { useUIStore } from "../stores/ui-store";

type AgentListProps = {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent?: () => void;
};

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function isWaitingOnUser(steps: readonly AgentStep[]): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.toolName === "askQuestion") {
      if (step.kind === "tool-call") return true;
      if (step.kind === "tool-result") return false;
    }
    if (step.approvalState === "approval-requested") return true;
  }
  return false;
}

function StatusIcon({ status, steps }: { status: Agent["status"]; steps: readonly AgentStep[] }) {
  if (status === "running" && isWaitingOnUser(steps)) {
    return <CirclePauseIcon className="size-3.5 text-amber-500 shrink-0" />;
  }
  switch (status) {
    case "running":
      return <HugeiconsIcon icon={WorkoutRunIcon} className="size-3.5 text-primary animate-pulse shrink-0" />;
    case "completed":
      return <HugeiconsIcon icon={WorkoutRunIcon} className="size-3.5 text-green-500 shrink-0" />;
    case "failed":
      return <HugeiconsIcon icon={WorkoutRunIcon} className="size-3.5 text-destructive shrink-0" />;
  }
}

export function AgentList({
  agents,
  selectedAgentId,
  onSelectAgent,
  onNewAgent,
}: AgentListProps) {
  const demoMode = useUIStore((s) => s.demoMode);

  return (
    <section className="rounded-md border border-border/60 bg-background/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between px-2.5 py-2">
        <SectionLabel as="span">Agents{agents.length > 0 ? ` (${agents.length})` : ""}</SectionLabel>
        {onNewAgent && (
          <button
            type="button"
            onClick={onNewAgent}
            className="cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
            aria-label="New agent"
          >
            <PlusIcon className="size-3" />
          </button>
        )}
      </div>

      {agents.length > 0 && <div className="mx-2.5 h-px bg-border/60" />}

      {agents.length > 0 && (
        <ul className="space-y-1 p-2">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                className={`w-full cursor-pointer text-left rounded-md border px-2.5 py-1.5 transition-colors ${
                  selectedAgentId === agent.id
                    ? "border-primary/30 bg-primary/7 shadow-sm"
                    : "border-transparent hover:border-border/60 hover:bg-background/60"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <StatusIcon status={agent.status} steps={agent.steps} />
                  <p className="text-xs text-foreground truncate flex-1">
                    {agent.task}
                  </p>
                  <span className="text-2xs text-muted-foreground shrink-0 font-mono">
                    {demoMode
                      ? "just now"
                      : relativeTime(agent.completedAt ?? agent.createdAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
