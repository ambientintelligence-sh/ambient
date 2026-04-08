import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import type {
  Agent,
  AgentStep,
  AgentToolApprovalResponse,
} from "@core/types";
import { formatToolName, type AnswerToolApprovalResult } from "./agent-step-utils";

export function ToolApprovalCard({
  agent,
  step,
  onAnswerToolApproval,
}: {
  agent: Agent;
  step: AgentStep;
  onAnswerToolApproval?: (
    agent: Agent,
    response: AgentToolApprovalResponse,
  ) => Promise<AnswerToolApprovalResult> | AnswerToolApprovalResult;
}) {
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [submitError, setSubmitError] = useState("");
  const approvalId = step.approvalId;
  const approvalState = step.approvalState;
  if (!approvalId || !approvalState) return null;

  const toolLabel = formatToolName(step.toolName);

  const submitApproval = async (approved: boolean) => {
    if (!onAnswerToolApproval || approvalState !== "approval-requested") return;
    setSubmitError("");
    setSubmitting(approved ? "approve" : "reject");
    const result = await onAnswerToolApproval(agent, { approvalId, approved });
    setSubmitting(null);
    if (!result.ok) {
      setSubmitError(result.error ?? "Could not submit approval.");
    }
  };

  const isDenied =
    approvalState === "output-denied" ||
    (approvalState === "approval-responded" && step.approvalApproved === false);
  const isApproved =
    approvalState === "output-available" ||
    (approvalState === "approval-responded" && step.approvalApproved !== false);

  if (isApproved) {
    return (
      <div className="mt-1 flex items-center gap-1.5 py-1">
        <CheckIcon className="size-3 text-primary/60 shrink-0" />
        <span className="text-2xs text-muted-foreground">{toolLabel}</span>
      </div>
    );
  }

  if (isDenied) {
    return (
      <div className="mt-1 flex items-center gap-1.5 py-1">
        <XIcon className="size-3 text-muted-foreground/40 shrink-0" />
        <span className="text-2xs text-muted-foreground/50 line-through">{toolLabel}</span>
      </div>
    );
  }

  // approval-requested
  return (
    <div className="mt-1 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-2xs text-foreground truncate">{toolLabel}</span>
        <button
          type="button"
          onClick={() => void submitApproval(false)}
          disabled={submitting !== null}
          className="shrink-0 text-2xs text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => void submitApproval(true)}
          disabled={submitting !== null}
          className="shrink-0 text-2xs font-medium text-foreground hover:text-primary disabled:opacity-40 transition-colors"
        >
          Allow
        </button>
      </div>
      {step.content && (
        <p className="mt-0.5 text-2xs text-muted-foreground/60 leading-relaxed">{step.content}</p>
      )}
      {submitError && (
        <p className="mt-1 text-2xs text-destructive">{submitError}</p>
      )}
    </div>
  );
}
