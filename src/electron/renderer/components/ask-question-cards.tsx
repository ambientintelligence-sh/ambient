import { useState } from "react";
import { CheckIcon, SendHorizonalIcon } from "lucide-react";
import type {
  Agent,
  AgentQuestionRequest,
  AgentQuestionSelection,
} from "@core/types";
import type {
  AnswerQuestionResult,
  SkipQuestionResult,
  AskQuestionToolOutput,
} from "./agent-step-utils";

export function AskQuestionPendingCard({
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

export function AskQuestionResolvedCard({ output }: { output: AskQuestionToolOutput }) {
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
