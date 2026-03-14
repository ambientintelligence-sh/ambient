import { useEffect, useRef, useState } from "react";
import {
  XIcon,
  CheckIcon,
  LoaderCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  RotateCcwIcon,
  ArchiveIcon,
  CopyIcon,
  RefreshCwIcon,
  SendHorizonalIcon,
  ListChecksIcon,
} from "lucide-react";
import {
  CitedMessageResponse,
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanContent,
  PlanTrigger,
  PlanFooter,
} from "@/components/ai-elements/plan";
import { Button } from "@/components/ui/button";
import {
  Queue,
  QueueSection,
  QueueSectionContent,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
} from "@/components/ai-elements/queue";
import type {
  Agent,
  AgentStep,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  AgentToolApprovalState,
  AgentPlanApprovalResponse,
} from "@core/types";

type FollowUpResult = { ok: boolean; error?: string };
type AnswerQuestionResult = { ok: boolean; error?: string };
type AnswerToolApprovalResult = { ok: boolean; error?: string };
type AnswerPlanApprovalResult = { ok: boolean; error?: string };

type SkipQuestionResult = { ok: boolean; error?: string };

type AgentDetailPanelProps = {
  agent: Agent;
  agents: Agent[];
  onSelectAgent: (id: string) => void;
  onClose: () => void;
  onFollowUp?: (agent: Agent, question: string) => Promise<FollowUpResult> | FollowUpResult;
  onAnswerQuestion?: (
    agent: Agent,
    answers: AgentQuestionSelection[],
  ) => Promise<AnswerQuestionResult> | AnswerQuestionResult;
  onSkipQuestion?: (
    agent: Agent,
  ) => Promise<SkipQuestionResult> | SkipQuestionResult;
  onAnswerToolApproval?: (
    agent: Agent,
    response: AgentToolApprovalResponse,
  ) => Promise<AnswerToolApprovalResult> | AnswerToolApprovalResult;
  onAnswerPlanApproval?: (
    agent: Agent,
    response: AgentPlanApprovalResponse,
  ) => Promise<AnswerPlanApprovalResult> | AnswerPlanApprovalResult;
  onCancel?: (agentId: string) => void;
  onRelaunch?: (agent: Agent) => void;
  onArchive?: (agent: Agent) => void;
};

function isWaitingOnUser(steps: readonly AgentStep[]): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.toolName === "askQuestion") {
      if (step.kind === "tool-call") return true;
      if (step.kind === "tool-result") return false;
    }
    if (step.approvalState === "approval-requested") return true;
    if (step.planApprovalState === "awaiting-approval") return true;
  }
  return false;
}

function StatusBadge({ status, steps }: { status: Agent["status"]; steps: readonly AgentStep[] }) {
  const waiting = status === "running" && isWaitingOnUser(steps);
  switch (status) {
    case "running":
      return waiting ? (
        <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-2xs font-medium text-amber-600">
          <LoaderCircleIcon className="size-3" />
          Waiting
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
          <LoaderCircleIcon className="size-3 animate-spin" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 rounded-sm bg-green-500/10 px-1.5 py-0.5 text-2xs font-medium text-green-600">
          <CheckCircleIcon className="size-3" />
          Done
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-2xs font-medium text-destructive">
          <XCircleIcon className="size-3" />
          Failed
        </span>
      );
  }
}

type AskQuestionToolOutput = {
  title?: string;
  questions: AgentQuestionRequest["questions"];
  answers: AgentQuestionSelection[];
};

function parseAskQuestionRequest(raw: string | undefined): AgentQuestionRequest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentQuestionRequest>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
    const questions = parsed.questions
      .map((question) => {
        if (!question || typeof question !== "object") return null;
        if (typeof question.id !== "string" || !question.id.trim()) return null;
        if (typeof question.prompt !== "string" || !question.prompt.trim()) return null;
        if (!Array.isArray(question.options) || question.options.length === 0) return null;
        const options = question.options
          .map((option) => {
            if (!option || typeof option !== "object") return null;
            if (typeof option.id !== "string" || !option.id.trim()) return null;
            if (typeof option.label !== "string" || !option.label.trim()) return null;
            return { id: option.id, label: option.label };
          })
          .filter((option): option is { id: string; label: string } => !!option);
        if (options.length === 0) return null;
        return {
          id: question.id,
          prompt: question.prompt,
          options,
          allow_multiple: question.allow_multiple === true,
        };
      })
      .filter(Boolean) as AgentQuestionRequest["questions"];
    if (questions.length === 0) return null;
    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      questions,
    };
  } catch {
    return null;
  }
}

function parseAskQuestionOutput(raw: string | undefined): AskQuestionToolOutput | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AskQuestionToolOutput>;
    if (!parsed || typeof parsed !== "object") return null;
    const questionRequest = parseAskQuestionRequest(JSON.stringify({
      title: parsed.title,
      questions: parsed.questions,
    }));
    if (!questionRequest) return null;
    const answers = Array.isArray(parsed.answers)
      ? parsed.answers
          .map((answer) => {
            if (!answer || typeof answer !== "object") return null;
            if (typeof answer.questionId !== "string" || !answer.questionId.trim()) return null;
            if (!Array.isArray(answer.selectedOptionIds)) return null;
            const selectedOptionIds = answer.selectedOptionIds
              .map((id) => (typeof id === "string" ? id.trim() : ""))
              .filter(Boolean);
            const freeText = typeof answer.freeText === "string" ? answer.freeText : undefined;
            return { questionId: answer.questionId, selectedOptionIds, freeText };
          })
          .filter((answer): answer is NonNullable<typeof answer> => !!answer)
      : [];

    return {
      title: questionRequest.title,
      questions: questionRequest.questions,
      answers,
    };
  } catch {
    return null;
  }
}

function isAskQuestionStep(step: AgentStep): boolean {
  return step.toolName === "askQuestion"
    && (step.kind === "tool-call" || step.kind === "tool-result");
}

function isToolApprovalStep(step: AgentStep): boolean {
  return !!step.approvalState && !!step.approvalId;
}

function getApprovalStateOrder(state: AgentToolApprovalState): number {
  switch (state) {
    case "approval-requested": return 0;
    case "approval-responded": return 1;
    case "output-denied": return 2;
    case "output-available": return 2;
  }
}

function formatToolName(toolName?: string): string {
  if (!toolName) return "Tool";
  return toolName
    .replace(/^notion__/, "Notion / ")
    .replace(/^linear__/, "Linear / ");
}

function AskQuestionPendingCard({
  agent,
  request,
  onAnswerQuestion,
  onSkipQuestion,
}: {
  agent: Agent;
  request: AgentQuestionRequest;
  onAnswerQuestion?: (
    agent: Agent,
    answers: AgentQuestionSelection[],
  ) => Promise<AnswerQuestionResult> | AnswerQuestionResult;
  onSkipQuestion?: (
    agent: Agent,
  ) => Promise<SkipQuestionResult> | SkipQuestionResult;
}) {
  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, Set<string>>>({});
  const [textByQuestion, setTextByQuestion] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const toggleChip = (questionId: string, optionId: string, allowMultiple: boolean) => {
    setSelectedByQuestion((prev) => {
      const current = prev[questionId] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        if (!allowMultiple) next.clear();
        next.add(optionId);
      }
      return { ...prev, [questionId]: next };
    });
  };

  const canSubmit = request.questions.every((q) => {
    const chips = selectedByQuestion[q.id];
    const text = textByQuestion[q.id]?.trim();
    return (chips && chips.size > 0) || (text && text.length > 0);
  });

  const handleSubmit = async () => {
    if (!onAnswerQuestion || !canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    const answers: AgentQuestionSelection[] = request.questions.map((q) => {
      const chips = selectedByQuestion[q.id];
      const text = textByQuestion[q.id]?.trim();
      return {
        questionId: q.id,
        selectedOptionIds: chips ? [...chips] : [],
        ...(text ? { freeText: text } : {}),
      };
    });
    try {
      const result = await onAnswerQuestion(agent, answers);
      if (result.ok) return;
      setSubmitError(result.error ?? "Could not submit answers.");
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Could not submit answers.";
      setSubmitError(errorText);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && canSubmit) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleSkip = async () => {
    if (!onSkipQuestion) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const result = await onSkipQuestion(agent);
      if (!result.ok) {
        setSubmitError(result.error ?? "Could not skip.");
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not skip.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 mb-1">
      <div className="border-l-2 border-l-amber-500/60 pl-3">
        <p className="text-2xs font-medium text-amber-600/80 mb-2.5">
          {request.title || "Needs your input"}
        </p>

        <div className="space-y-4">
          {request.questions.map((question, index) => {
            const selected = selectedByQuestion[question.id] ?? new Set<string>();
            const text = textByQuestion[question.id] ?? "";
            return (
              <div key={question.id}>
                <p className="text-2xs text-foreground/90 font-medium leading-relaxed mb-2">
                  {request.questions.length > 1 ? `${index + 1}. ` : ""}
                  {question.prompt}
                </p>

                <div className="flex flex-wrap gap-1.5 mb-2">
                  {question.options.map((option) => {
                    const isSelected = selected.has(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() =>
                          toggleChip(
                            question.id,
                            option.id,
                            !!question.allow_multiple,
                          )
                        }
                        className={[
                          "inline-flex min-h-7 items-center gap-1 rounded-md border px-2.5 py-1.5 text-2xs font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-1",
                          isSelected
                            ? "border-primary/55 bg-primary/16 text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_18%,transparent)]"
                            : "border-border/70 bg-background text-foreground/82 shadow-sm hover:border-primary/35 hover:bg-primary/[0.08] hover:text-foreground",
                        ].join(" ")}
                      >
                        {isSelected && (
                          <CheckIcon className="size-2.5 shrink-0" />
                        )}
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <input
                  type="text"
                  value={text}
                  onChange={(e) =>
                    setTextByQuestion((c) => ({
                      ...c,
                      [question.id]: e.target.value,
                    }))
                  }
                  onKeyDown={handleKeyDown}
                  placeholder="Or type something else..."
                  className="w-full rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-2xs text-foreground placeholder:text-muted-foreground/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15 transition-[border-color,box-shadow]"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pl-3">
        <div className="flex-1 min-w-0">
          {submitError && (
            <p className="text-2xs text-destructive truncate">{submitError}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onSkipQuestion && (
            <button
              type="button"
              onClick={() => void handleSkip()}
              disabled={submitting}
              className="rounded-md px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-30"
            >
              Chat instead
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!onAnswerQuestion || !canSubmit || submitting}
            className="inline-flex items-center gap-1 rounded-md border border-primary/45 bg-primary/15 px-3 py-1.5 text-2xs font-medium text-primary shadow-sm transition-[background-color,border-color,color,box-shadow] hover:border-primary/60 hover:bg-primary/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-25"
          >
            {submitting ? "Sending..." : "Reply"}
            {!submitting && <SendHorizonalIcon className="size-2.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function AskQuestionResolvedCard({ output }: { output: AskQuestionToolOutput }) {
  const answersByQuestionId = new Map(
    output.answers.map((answer) => [answer.questionId, answer])
  );

  return (
    <div className="mt-2 mb-1 border-l-2 border-l-border/40 pl-3 py-1">
      <p className="text-2xs text-muted-foreground/60 mb-1.5">
        {output.title || "Answered"}
      </p>
      <div className="space-y-1.5">
        {output.questions.map((question) => {
          const answer = answersByQuestionId.get(question.id);
          const selectedLabels = question.options
            .filter((option) => (answer?.selectedOptionIds ?? []).includes(option.id))
            .map((option) => option.label);
          const freeText = (answer as { freeText?: string } | undefined)?.freeText;
          const parts = [...selectedLabels, ...(freeText ? [freeText] : [])];
          const displayText = parts.length > 0 ? parts.join(", ") : "No answer";
          return (
            <div key={question.id}>
              <p className="text-2xs text-muted-foreground/50 leading-snug">
                {question.prompt}
              </p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedLabels.map((label) => (
                  <span
                    key={label}
                    className="text-2xs px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
                {freeText && (
                  <span className="text-2xs text-foreground/70 italic">
                    {freeText}
                  </span>
                )}
                {parts.length === 0 && (
                  <span className="text-2xs text-muted-foreground/40 italic">
                    {displayText}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolApprovalCard({
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

function TextStepActions({
  content,
  onRegenerate,
}: {
  content: string;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={copied ? "Copied" : "Copy message"}
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Regenerate response"
        >
          <RefreshCwIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

function AgentPlanCard({
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


function AgentTodoQueue({ items }: { items: ReadonlyArray<{ id: string; content: string; status: string }> }) {
  if (items.length === 0) return null;

  return (
    <Queue className="max-h-[150px] overflow-y-auto rounded-b-none border-b-0 border-input">
      <QueueSection>
        <QueueSectionContent>
          <div>
            {items.map((item) => {
              const done = item.status === "completed" || item.status === "cancelled";
              return (
                <QueueItem key={item.id}>
                  <div className="flex items-center gap-2">
                    <QueueItemIndicator completed={done} />
                    <QueueItemContent completed={done}>
                      {item.content}
                    </QueueItemContent>
                  </div>
                </QueueItem>
              );
            })}
          </div>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  );
}

function StepItem({
  agent,
  step,
  isRunning,
  onAnswerQuestion,
  onSkipQuestion,
  onAnswerToolApproval,
  onAnswerPlanApproval,
  onRegenerate,
}: {
  agent: Agent;
  step: AgentStep;
  isRunning: boolean;
  onAnswerQuestion?: (
    agent: Agent,
    answers: AgentQuestionSelection[],
  ) => Promise<AnswerQuestionResult> | AnswerQuestionResult;
  onSkipQuestion?: (
    agent: Agent,
  ) => Promise<SkipQuestionResult> | SkipQuestionResult;
  onAnswerToolApproval?: (
    agent: Agent,
    response: AgentToolApprovalResponse,
  ) => Promise<AnswerToolApprovalResult> | AnswerToolApprovalResult;
  onAnswerPlanApproval?: (
    agent: Agent,
    response: AgentPlanApprovalResponse,
  ) => Promise<AnswerPlanApprovalResult> | AnswerPlanApprovalResult;
  onRegenerate?: () => void;
}) {
  if (isToolApprovalStep(step)) {
    return (
      <ToolApprovalCard
        agent={agent}
        step={step}
        onAnswerToolApproval={onAnswerToolApproval}
      />
    );
  }

  if (step.kind === "tool-call" && step.toolName === "askQuestion") {
    const request = parseAskQuestionRequest(step.toolInput);
    if (!request) return null;
    return (
      <AskQuestionPendingCard
        agent={agent}
        request={request}
        onAnswerQuestion={onAnswerQuestion}
        onSkipQuestion={onSkipQuestion}
      />
    );
  }

  if (step.kind === "tool-result" && step.toolName === "askQuestion") {
    const output = parseAskQuestionOutput(step.toolInput);
    if (!output) return null;
    return <AskQuestionResolvedCard output={output} />;
  }

  switch (step.kind) {
    case "text":
      return (
        <div className="group mt-1 py-2">
          <div className="text-xs text-foreground leading-relaxed [&_a]:text-primary [&_a]:underline">
            <CitedMessageResponse>{step.content}</CitedMessageResponse>
          </div>
          <TextStepActions content={step.content} onRegenerate={onRegenerate} />
        </div>
      );
    case "user":
      return (
        <Message from="user" className="mt-1 max-w-full">
          <MessageContent className="text-xs leading-relaxed rounded-md px-3 py-1.5">
            {step.content}
          </MessageContent>
        </Message>
      );
    case "plan":
      return <AgentPlanCard step={step} agent={agent} onAnswerPlanApproval={onAnswerPlanApproval} />;
    case "todo":
      return null;
    default:
      return null;
  }
}

type TimelineItem =
  | { kind: "step"; step: AgentStep }
  | {
      kind: "activity";
      id: string;
      title: string;
      steps: AgentStep[];
      isStreaming: boolean;
    };

const TOOL_ACTIVITY_GRACE_MS = 3_000;

function isActivityStep(step: AgentStep): boolean {
  return (
    step.kind === "thinking" ||
    step.kind === "tool-call" ||
    step.kind === "tool-result"
  );
}

function getActivityTitle(steps: AgentStep[]): string {
  const hasThought = steps.some((step) => step.kind === "thinking");
  const toolSteps = steps.filter(
    (step) =>
      (step.kind === "tool-call" || step.kind === "tool-result") &&
      step.toolName !== "askQuestion"
  );
  const searchCount = toolSteps.filter((step) => step.toolName === "searchWeb").length;

  if (hasThought && searchCount > 0) {
    return `Thought + ${searchCount} search${searchCount === 1 ? "" : "es"}`;
  }
  if (hasThought && toolSteps.length > 0) {
    return `Thought + ${toolSteps.length} tool${toolSteps.length === 1 ? "" : "s"}`;
  }
  if (hasThought) {
    return "Thought process";
  }
  if (searchCount > 0) {
    return `Did ${searchCount} search${searchCount === 1 ? "" : "es"}`;
  }
  return `Used ${toolSteps.length} tool${toolSteps.length === 1 ? "" : "s"}`;
}

function getToolCallCount(steps: AgentStep[]): number {
  const toolCallIds = new Set<string>();
  for (const step of steps) {
    if (step.kind === "tool-call" || step.kind === "tool-result") {
      toolCallIds.add(step.id);
    }
  }
  return toolCallIds.size;
}

function getActivityBounds(steps: AgentStep[]): { start: number; end: number } | null {
  if (steps.length === 0) return null;
  const timestamps = steps.map((step) => step.createdAt).filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return {
    start: Math.min(...timestamps),
    end: Math.max(...timestamps),
  };
}

function getActivityDurationSecs(steps: AgentStep[], isStreaming: boolean): number | null {
  const bounds = getActivityBounds(steps);
  if (!bounds) return null;
  const end = isStreaming ? Date.now() : bounds.end;
  return Math.max(1, Math.round((end - bounds.start) / 1000));
}

function getSearchQuery(step: AgentStep): string | null {
  if (step.toolName !== "searchWeb") return null;
  const match = step.content.match(/^Searched:\s*(.+)$/i);
  const query = match?.[1]?.trim();
  return query ? query : null;
}

function getActivityStepSummary(step: AgentStep): string {
  if (step.kind === "thinking") return "Thought";
  if (step.kind === "text") return "Update";
  if (step.toolName === "searchWeb") return "Search";
  if (step.toolName) return `Tool: ${step.toolName}`;
  return "Action";
}

function ActivitySummaryItem({
  title,
  steps,
  isStreaming,
}: {
  title: string;
  steps: AgentStep[];
  isStreaming: boolean;
}) {
  const { stopScroll } = useStickToBottomContext();
  const toolCallCount = getToolCallCount(steps);
  const hasThought = steps.some((s) => s.kind === "thinking");
  const lastStep = steps[steps.length - 1];
  const activityDuration = getActivityDurationSecs(steps, isStreaming);
  const bounds = getActivityBounds(steps);

  let headerLabel: string;
  if (hasThought) {
    const thoughtPart = activityDuration ? `Thought for ${activityDuration}s` : "Thought";
    headerLabel = toolCallCount > 0
      ? `${thoughtPart} · ${toolCallCount} tool${toolCallCount === 1 ? "" : "s"}`
      : thoughtPart;
  } else {
    headerLabel = `${toolCallCount} tool${toolCallCount === 1 ? "" : "s"} called`;
  }

  return (
    <div className="mt-1 py-0.5">
      <ChainOfThought
        defaultOpen={isStreaming}
        isStreaming={isStreaming}
        startedAt={bounds?.start}
      >
        <ChainOfThoughtHeader onClickCapture={() => stopScroll()}>
          {headerLabel}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <div className="space-y-1">
            {steps.map((step) => {
              const isActive = isStreaming && step.id === lastStep?.id;
              if (step.kind === "thinking") {
                return (
                  <div key={`${step.id}:${step.kind}`} className="py-0.5 text-2xs leading-relaxed text-muted-foreground">
                    <MessageResponse>{step.content}</MessageResponse>
                  </div>
                );
              }
              if (step.kind === "text") {
                return (
                  <div
                    key={`${step.id}:${step.kind}`}
                    className="rounded-sm bg-muted/15 px-1.5 py-1 text-2xs leading-relaxed text-muted-foreground/95 [&_a]:text-primary [&_a]:underline"
                  >
                    <MessageResponse>{step.content}</MessageResponse>
                  </div>
                );
              }
              const searchQuery = getSearchQuery(step);
              return (
                <ChainOfThoughtStep
                  key={`${step.id}:${step.kind}`}
                  className="px-0 py-0.5"
                  description={getActivityStepSummary(step)}
                  icon={searchQuery ? SearchIcon : undefined}
                  label={<MessageResponse>{step.content}</MessageResponse>}
                  status={isActive ? "active" : "complete"}
                >
                  {searchQuery ? (
                    <ChainOfThoughtSearchResults>
                      <ChainOfThoughtSearchResult>
                        {searchQuery}
                      </ChainOfThoughtSearchResult>
                    </ChainOfThoughtSearchResults>
                  ) : null}
                </ChainOfThoughtStep>
              );
            })}
          </div>
        </ChainOfThoughtContent>
      </ChainOfThought>
    </div>
  );
}

function TaskContextCard({ task, taskContext }: { task: string; taskContext?: string }) {
  const contextText = taskContext?.trim();
  if (!contextText) return null;

  return (
    <div className="shrink-0 border-b border-border bg-muted/20 px-3 py-2">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        Task
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-foreground">{task}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-2xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
          Context
        </summary>
        <div className="mt-1 max-h-40 overflow-y-auto rounded-sm border border-border/60 bg-background px-2 py-1.5">
          <p className="whitespace-pre-wrap text-2xs leading-relaxed text-muted-foreground">
            {contextText}
          </p>
        </div>
      </details>
    </div>
  );
}

export function AgentDetailPanel({
  agent,
  agents,
  onSelectAgent,
  onClose,
  onFollowUp,
  onAnswerQuestion,
  onSkipQuestion,
  onAnswerToolApproval,
  onAnswerPlanApproval,
  onCancel,
  onRelaunch,
  onArchive,
}: AgentDetailPanelProps) {
  const [followUpError, setFollowUpError] = useState("");
  const [timelineNow, setTimelineNow] = useState(() => Date.now());
  const stepFirstSeenAtRef = useRef<Map<string, number>>(new Map());
  const promotedTextStepIdsRef = useRef<Set<string>>(new Set());
  const visibleSteps = (() => {
    const filtered = agent.steps.filter(
      (step) =>
        step.kind === "user" ||
        step.kind === "text" ||
        step.kind === "thinking" ||
        step.kind === "tool-call" ||
        step.kind === "tool-result" ||
        step.kind === "plan" ||
        step.kind === "todo"
    );

    const firstNonUserAt = filtered.reduce((earliest, step) => {
      if (step.kind === "user") return earliest;
      return Math.min(earliest, step.createdAt);
    }, Number.POSITIVE_INFINITY);

    // If there's already a user step before the first response, the original
    // input is preserved in the steps array — no synthetic step needed.
    const hasInitialPromptStep = filtered.some(
      (step) =>
        step.kind === "user" &&
        step.createdAt <= firstNonUserAt
    );

    const withInitialPrompt =
      agent.task.trim() && !hasInitialPromptStep
        ? [
            {
              id: `initial-user:${agent.id}`,
              kind: "user" as const,
              content: agent.task.trim(),
              createdAt: agent.createdAt,
            },
            ...filtered,
          ]
        : filtered;

    // Preserve event order from the agent stream; timestamp sorting can
    // mis-order tool/thought vs final text because text uses turn start time.
    return withInitialPrompt;
  })();

  useEffect(() => {
    const seenAt = stepFirstSeenAtRef.current;
    const promoted = promotedTextStepIdsRef.current;
    const now = Date.now();
    const visibleIds = new Set(visibleSteps.map((step) => step.id));
    for (const step of visibleSteps) {
      if (!seenAt.has(step.id)) {
        seenAt.set(step.id, now);
      }
    }
    for (const id of [...seenAt.keys()]) {
      if (!visibleIds.has(id)) {
        seenAt.delete(id);
      }
    }
    for (const id of [...promoted.keys()]) {
      if (!visibleIds.has(id)) {
        promoted.delete(id);
      }
    }
  }, [visibleSteps]);

  const currentIndex = agents.findIndex((a) => a.id === agent.id);
  const hasPrev = currentIndex < agents.length - 1;
  const hasNext = currentIndex > 0;
  const isRunning = agent.status === "running";
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      setTimelineNow(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRunning]);
  const activeTurnStartAt = (() => {
    const lastUserStep = [...agent.steps]
      .reverse()
      .find((step) => step.kind === "user");
    return lastUserStep?.createdAt ?? agent.createdAt;
  })();
  const hasCurrentTurnActivity = agent.steps.some(
    (step) => step.kind !== "user" && step.createdAt >= activeTurnStartAt
  );
  const showPlanning = isRunning && !hasCurrentTurnActivity;
  const timelineItems = (() => {
    // Pre-pass: track the latest approval state per approvalId
    const latestApprovalStep = new Map<string, AgentStep>();
    for (const step of visibleSteps) {
      if (step.approvalId && step.approvalState) {
        const existing = latestApprovalStep.get(step.approvalId);
        if (
          !existing ||
          getApprovalStateOrder(step.approvalState) > getApprovalStateOrder(existing.approvalState!)
        ) {
          latestApprovalStep.set(step.approvalId, step);
        }
      }
    }

    // Tool names that go through approval — their regular tool-call/result stream
    // steps are redundant (the approval card covers them).
    const approvedToolNames = new Set<string>();
    for (const step of latestApprovalStep.values()) {
      if (step.toolName) approvedToolNames.add(step.toolName);
    }

    const items: TimelineItem[] = [];
    let pendingActivity: AgentStep[] = [];
    let activityIndex = 0;
    const seenApprovalIds = new Set<string>();
    // Steps pulled into pendingActivity via lookahead; skip them in normal flow.
    const lookaheadConsumed = new Set<string>();
    const hasFutureActivityInTurn = new Array(visibleSteps.length).fill(false);
    let turnHasFutureActivity = false;
    for (let i = visibleSteps.length - 1; i >= 0; i--) {
      const step = visibleSteps[i];
      if (step.kind === "user") {
        turnHasFutureActivity = false;
        continue;
      }
      hasFutureActivityInTurn[i] = turnHasFutureActivity;
      if (isActivityStep(step)) {
        turnHasFutureActivity = true;
      }
    }
    const stepOrder = new Map<string, number>();
    visibleSteps.forEach((step, index) => {
      stepOrder.set(step.id, index);
    });

    const flushActivity = () => {
      if (pendingActivity.length === 0) return;
      const steps = pendingActivity;
      pendingActivity = [];
      const id = `activity:${agent.id}:${activityIndex}`;
      activityIndex += 1;
      const isCurrentTurnGroup = steps.some(
        (step) => step.createdAt >= activeTurnStartAt
      );
      const lastStep = steps[steps.length - 1];
      const lastStepOrder = lastStep ? (stepOrder.get(lastStep.id) ?? -1) : -1;
      const hasTextAfterActivity =
        lastStepOrder >= 0 &&
        visibleSteps.some((s, idx) => idx > lastStepOrder && s.kind === "text");
      items.push({
        kind: "activity",
        id,
        steps,
        title: getActivityTitle(steps),
        isStreaming: isRunning && !hasTextAfterActivity && isCurrentTurnGroup,
      });
    };

    for (const [index, step] of visibleSteps.entries()) {
      // Skip steps already pulled in by approval lookahead.
      if (lookaheadConsumed.has(step.id)) continue;

      // Skip regular tool-result steps for approved tools — output-available covers them.
      if (
        step.kind === "tool-result" &&
        !step.approvalState &&
        step.toolName &&
        approvedToolNames.has(step.toolName)
      ) {
        continue;
      }

      if (isAskQuestionStep(step)) {
        flushActivity();
        items.push({ kind: "step", step });
        continue;
      }
      if (isToolApprovalStep(step)) {
        const id = step.approvalId!;
        if (seenApprovalIds.has(id)) continue;
        seenApprovalIds.add(id);
        // The regular tool-call stream step for this tool arrives AFTER the
        // approval-requested step due to AI SDK event ordering. Pull it into
        // the current activity group now so it appears before the approval card.
        if (step.toolName) {
          const match = visibleSteps.find(
            (s) =>
              !lookaheadConsumed.has(s.id) &&
              s.kind === "tool-call" &&
              !s.approvalState &&
              s.toolName === step.toolName
          );
          if (match) {
            pendingActivity.push(match);
            lookaheadConsumed.add(match.id);
          }
        }
        flushActivity();
        items.push({ kind: "step", step: latestApprovalStep.get(id) ?? step });
        continue;
      }
      if (
        isActivityStep(step)
      ) {
        pendingActivity.push(step);
        continue;
      }
      if (
        step.kind === "text" &&
        pendingActivity.length > 0 &&
        (() => {
          if (promotedTextStepIdsRef.current.has(step.id)) return false;
          if (hasFutureActivityInTurn[index]) return true;
          if (!isRunning) return false;
          const firstSeenAt = stepFirstSeenAtRef.current.get(step.id) ?? step.createdAt;
          const withinGrace = timelineNow - firstSeenAt < TOOL_ACTIVITY_GRACE_MS;
          if (!withinGrace) {
            // Once text is promoted to normal output, keep it there to avoid
            // jitter from re-grouping when later tool calls appear.
            promotedTextStepIdsRef.current.add(step.id);
          }
          return withinGrace;
        })()
      ) {
        pendingActivity.push(step);
        continue;
      }
      flushActivity();
      items.push({ kind: "step", step });
    }

    flushActivity();

    // Post-process: hoist activity groups and askQuestion steps before text
    // in the same turn so chain-of-thought / QA cards precede the response.
    // Plan/todo steps render inline where they were emitted.
    // Activity groups are only reordered once the run finishes to avoid jitter.
    for (let i = 1; i < items.length; i++) {
      const item = items[i];
      const isAskQuestionItem = item.kind === "step" && isAskQuestionStep(item.step);
      const isActivityItem = item.kind === "activity";
      if (!isAskQuestionItem && !(isActivityItem && !isRunning)) continue;
      // Find the earliest preceding text in this turn
      let insertAt = i;
      for (let j = i - 1; j >= 0; j--) {
        const prev = items[j];
        if (prev.kind === "step" && prev.step.kind === "user") break;
        if (prev.kind === "step" && prev.step.kind === "text") insertAt = j;
      }
      if (insertAt < i) {
        const [moved] = items.splice(i, 1);
        items.splice(insertAt, 0, moved);
      }
    }

    return items;
  })();

  const lastTextStepId = (() => {
    for (let i = timelineItems.length - 1; i >= 0; i--) {
      const item = timelineItems[i];
      if (item.kind === "step" && item.step.kind === "text") {
        return item.step.id;
      }
    }
    return null;
  })();

  const latestTodoItems = (() => {
    for (let i = agent.steps.length - 1; i >= 0; i--) {
      const step = agent.steps[i];
      if (step.kind === "todo" && step.todoItems && step.todoItems.length > 0) {
        return step.todoItems;
      }
    }
    return [];
  })();

  const handleFollowUpSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || !onFollowUp) return;
    setFollowUpError("");
    const result = await onFollowUp(agent, text);
    if (!result.ok) {
      const errorText = result.error ?? "Follow-up could not start.";
      setFollowUpError(errorText);
      throw new Error(errorText);
    }
  };

  const handleCancel = () => {
    onCancel?.(agent.id);
  };

  return (
    <div className="w-full h-full shrink-0 flex flex-col min-h-0 bg-sidebar">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={agent.status} steps={agent.steps} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            Agent
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {agents.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => hasPrev && onSelectAgent(agents[currentIndex + 1].id)}
                  disabled={!hasPrev}
                  className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
                  aria-label="Previous agent"
                >
                  <ChevronLeftIcon className="size-3.5" />
                </button>
                <span className="text-2xs font-mono text-muted-foreground tabular-nums mx-0.5">
                  {agents.length - currentIndex}/{agents.length}
                </span>
                <button
                  type="button"
                  onClick={() => hasNext && onSelectAgent(agents[currentIndex - 1].id)}
                  disabled={!hasNext}
                  className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
                  aria-label="Next agent"
                >
                  <ChevronRightIcon className="size-3.5" />
                </button>
              </>
            )}
            {!isRunning && onRelaunch && (
              <button
                type="button"
                onClick={() => onRelaunch(agent)}
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Relaunch agent"
              >
                <RotateCcwIcon className="size-3.5" />
              </button>
            )}
            {!isRunning && onArchive && (
              <button
                type="button"
                onClick={() => onArchive(agent)}
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                aria-label="Archive agent"
              >
                <ArchiveIcon className="size-3.5" />
              </button>
            )}
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
      </div>

      <TaskContextCard task={agent.task} taskContext={agent.taskContext} />

      {/* Step timeline */}
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="px-3 py-2.5">
          {visibleSteps.length === 0 && !isRunning && (
            <p className="text-xs italic text-muted-foreground">
              No messages yet.
            </p>
          )}
          {timelineItems.map((item) =>
            item.kind === "activity" ? (
              <ActivitySummaryItem
                key={item.id}
                isStreaming={item.isStreaming}
                steps={item.steps}
                title={item.title}
              />
            ) : (
              <StepItem
                key={item.step.id}
                agent={agent}
                step={item.step}
                isRunning={isRunning}
                onAnswerQuestion={onAnswerQuestion}
                onSkipQuestion={onSkipQuestion}
                onAnswerToolApproval={onAnswerToolApproval}
                onAnswerPlanApproval={onAnswerPlanApproval}
                onRegenerate={
                  !isRunning && onRelaunch && item.step.id === lastTextStepId
                    ? () => onRelaunch(agent)
                    : undefined
                }
              />
            )
          )}
          {showPlanning && (
            <div className="py-1">
              <Shimmer as="p" className="text-xs text-muted-foreground">
                Planning
              </Shimmer>
            </div>
          )}
          {agent.status === "failed" && agent.result && agent.result !== "Cancelled" && (
            <div className="py-2">
              <p className="text-2xs text-destructive leading-relaxed">
                {agent.result}
              </p>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Follow-up input */}
      {onFollowUp && (
        <div className="shrink-0 border-t border-border p-2">
          <AgentTodoQueue items={latestTodoItems} />
          <PromptInput onSubmit={handleFollowUpSubmit}>
            <PromptInputTextarea
              placeholder={isRunning ? "Type ahead — stop the agent to send" : "Ask a follow-up..."}
              className="min-h-8 max-h-24 text-xs"
            />
            <PromptInputFooter>
              <div />
              <PromptInputSubmit
                status={isRunning && onCancel ? "streaming" : undefined}
                onStop={handleCancel}
              />
            </PromptInputFooter>
          </PromptInput>
          {followUpError && (
            <p className="mt-1.5 text-2xs text-destructive">
              {followUpError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
