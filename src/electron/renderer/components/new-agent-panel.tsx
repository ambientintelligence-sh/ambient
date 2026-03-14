import { XIcon } from "lucide-react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";

type NewAgentPanelProps = {
  onLaunch: (task: string) => void;
  onClose: () => void;
};

export function NewAgentPanel({ onLaunch, onClose }: NewAgentPanelProps) {
  return (
    <div className="w-full h-full shrink-0 flex flex-col min-h-0 bg-sidebar">
      {/* Header — matches AgentDetailPanel chrome */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            New Agent
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close panel"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Compose input — same component as the follow-up input */}
      <div className="shrink-0 p-2">
        <PromptInput
          onSubmit={(msg) => {
            const task = msg.text.trim();
            if (task) onLaunch(task);
          }}
        >
          <PromptInputTextarea
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            placeholder="What should the agent do?"
            className="min-h-8 max-h-40 text-xs"
          />
          <PromptInputFooter>
            <div />
            <PromptInputSubmit />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
