import { useState, type KeyboardEvent } from "react";
import type { Agent, AppConfig } from "@core/types";
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";
import { ComposerSendButton } from "./composer-send-button";
import { ModelPicker } from "./model-picker";

type SessionHomeProps = {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onLaunchAgent: (task: string) => void;
  appConfig: AppConfig;
  onAppConfigChange: (next: AppConfig) => void;
};

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function SessionHome({
  agents,
  selectedAgentId,
  onSelectAgent,
  onLaunchAgent,
  appConfig,
  onAppConfigChange,
}: SessionHomeProps) {
  const [taskDraft, setTaskDraft] = useState("");

  const submitTask = () => {
    const trimmed = taskDraft.trim();
    if (!trimmed) return;
    onLaunchAgent(trimmed);
    setTaskDraft("");
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitTask();
    }
  };

  const canSubmit = taskDraft.trim().length > 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 pt-12 pb-8 flex flex-col gap-6">
        <div className="rounded-2xl border border-border bg-background shadow-sm">
          <textarea
            rows={2}
            value={taskDraft}
            onChange={(e) => setTaskDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Ask an agent to work on something"
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0"
          />

          <div className="flex items-center gap-1 px-2 pb-2">
            <ModelPicker config={appConfig} onConfigChange={onAppConfigChange} />
            <div className="flex-1" />
            <ComposerSendButton onClick={submitTask} disabled={!canSubmit} />
          </div>
        </div>

        {agents.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {agents.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => onSelectAgent(agent.id)}
                  className={`w-full cursor-pointer text-left rounded-md border px-3 py-2 transition-colors ${
                    selectedAgentId === agent.id
                      ? "border-primary/30 bg-primary/5"
                      : "border-transparent hover:border-border/60 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon
                      icon={WorkoutRunIcon}
                      className={`size-3.5 shrink-0 ${
                        agent.status === "running"
                          ? "text-primary animate-pulse"
                          : agent.status === "completed"
                            ? "text-green-500"
                            : "text-muted-foreground"
                      }`}
                    />
                    <p className="text-xs text-foreground truncate flex-1">{agent.task}</p>
                    <span className="text-2xs text-muted-foreground shrink-0 font-mono">
                      {relativeTime(agent.completedAt ?? agent.createdAt)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm font-medium text-foreground">No chats yet</p>
            <p className="mt-1 text-xs text-muted-foreground">New agent chats will live here</p>
          </div>
        )}
      </div>
    </div>
  );
}
