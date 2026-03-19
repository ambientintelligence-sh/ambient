import { useState } from "react";
import {
  CheckCircleIcon,
  XCircleIcon,
  LoaderCircleIcon,
  ListChecksIcon,
} from "lucide-react";
import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanContent,
  PlanTrigger,
  PlanFooter,
} from "@/components/ai-elements/plan";
import { Button } from "@/components/ui/button";
import type {
  Agent,
  AgentStep,
  AgentPlanApprovalResponse,
} from "@core/types";
import type { AnswerPlanApprovalResult } from "./agent-step-utils";

export function AgentPlanCard({
  step,
  agent,
  onAnswerPlanApproval,
}: {
  step: AgentStep;
  agent: Agent;
  onAnswerPlanApproval?: (
    agent: Agent,
    response: AgentPlanApprovalResponse,
  ) => Promise<AnswerPlanApprovalResult> | AnswerPlanApprovalResult;
}) {
  const hasContent = Boolean(step.planContent);
  const approvalState = step.planApprovalState;
  const isAwaitingApproval = approvalState === "awaiting-approval";
  const isApproved = approvalState === "approved";
  const isRejected = approvalState === "rejected";

  const [feedbackInput, setFeedbackInput] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const approvalId = step.id ? `plan-approval:${step.id}` : "";

  const handleApprove = () => {
    onAnswerPlanApproval?.(agent, {
      approvalId,
      approved: true,
    });
  };

  const handleReject = () => {
    if (showFeedback && feedbackInput.trim()) {
      onAnswerPlanApproval?.(agent, {
        approvalId,
        approved: false,
        feedback: feedbackInput.trim(),
      });
      setShowFeedback(false);
      setFeedbackInput("");
    } else {
      setShowFeedback(true);
    }
  };

  const handleRejectNoFeedback = () => {
    onAnswerPlanApproval?.(agent, {
      approvalId,
      approved: false,
    });
    setShowFeedback(false);
  };

  return (
    <div className="mt-1 py-1">
      <Plan defaultOpen={hasContent || isAwaitingApproval}>
        <PlanHeader>
          <div className="flex items-center gap-2">
            {isApproved ? (
              <CheckCircleIcon className="size-3.5 text-green-500" />
            ) : isRejected ? (
              <XCircleIcon className="size-3.5 text-muted-foreground" />
            ) : isAwaitingApproval ? (
              <LoaderCircleIcon className="size-3.5 text-amber-500 animate-spin" />
            ) : (
              <ListChecksIcon className="size-3.5 text-muted-foreground" />
            )}
            <PlanTitle>{step.planTitle ?? "Plan"}</PlanTitle>
          </div>
          {hasContent && <PlanTrigger />}
        </PlanHeader>
        {hasContent && (
          <PlanContent>
            <div className="whitespace-pre-wrap text-xs text-muted-foreground">
              {step.planContent}
            </div>
          </PlanContent>
        )}
        {isAwaitingApproval && (
          <PlanFooter className="flex flex-col gap-2 pt-2">
            {showFeedback && (
              <div className="flex w-full gap-2">
                <input
                  type="text"
                  value={feedbackInput}
                  onChange={(e) => setFeedbackInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && feedbackInput.trim()) handleReject();
                  }}
                  placeholder="What should change?"
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                  autoFocus
                />
                <Button size="sm" variant="outline" onClick={handleRejectNoFeedback}>
                  Skip
                </Button>
              </div>
            )}
            <div className="flex w-full justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={showFeedback ? handleReject : () => setShowFeedback(true)}
              >
                {showFeedback ? "Send feedback" : "Reject"}
              </Button>
              <Button size="sm" onClick={handleApprove}>
                Approve
              </Button>
            </div>
          </PlanFooter>
        )}
        {isRejected && step.planApprovalFeedback && (
          <PlanFooter className="pt-1">
            <p className="text-xs text-muted-foreground italic">
              Feedback: {step.planApprovalFeedback}
            </p>
          </PlanFooter>
        )}
      </Plan>
    </div>
  );
}
