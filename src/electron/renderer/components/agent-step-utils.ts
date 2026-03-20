import type {
  AgentStep,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentToolApprovalState,
} from "@core/types";

export type FollowUpResult = { ok: boolean; error?: string };
export type AnswerQuestionResult = { ok: boolean; error?: string };
export type AnswerToolApprovalResult = { ok: boolean; error?: string };
export type AnswerPlanApprovalResult = { ok: boolean; error?: string };
export type SkipQuestionResult = { ok: boolean; error?: string };

export type AskQuestionToolOutput = {
  title?: string;
  questions: AgentQuestionRequest["questions"];
  answers: AgentQuestionSelection[];
};

export function parseAskQuestionRequest(raw: string | undefined): AgentQuestionRequest | null {
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

export function parseAskQuestionOutput(raw: string | undefined): AskQuestionToolOutput | null {
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

export function isAskQuestionStep(step: AgentStep): boolean {
  return step.toolName === "askQuestion"
    && (step.kind === "tool-call" || step.kind === "tool-result");
}

export function isToolApprovalStep(step: AgentStep): boolean {
  return !!step.approvalState && !!step.approvalId;
}

export function getApprovalStateOrder(state: AgentToolApprovalState): number {
  switch (state) {
    case "approval-requested": return 0;
    case "approval-responded": return 1;
    case "output-denied": return 2;
    case "output-available": return 2;
  }
}

export function formatToolName(toolName?: string): string {
  if (!toolName) return "Tool";
  return toolName
    .replace(/^notion__/, "Notion / ")
    .replace(/^linear__/, "Linear / ");
}

export type TimelineItem =
  | { kind: "step"; step: AgentStep }
  | {
      kind: "activity";
      id: string;
      title: string;
      steps: AgentStep[];
      isStreaming: boolean;
    };

export const TOOL_ACTIVITY_GRACE_MS = 3_000;

export function isActivityStep(step: AgentStep): boolean {
  return (
    step.kind === "thinking" ||
    step.kind === "tool-call" ||
    step.kind === "tool-result"
  );
}

export function getActivityTitle(steps: AgentStep[]): string {
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

export function getToolCallCount(steps: AgentStep[]): number {
  const toolCallIds = new Set<string>();
  for (const step of steps) {
    if (step.kind === "tool-call" || step.kind === "tool-result") {
      toolCallIds.add(step.id);
    }
  }
  return toolCallIds.size;
}

export function getActivityBounds(steps: AgentStep[]): { start: number; end: number } | null {
  if (steps.length === 0) return null;
  const timestamps = steps.map((step) => step.createdAt).filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return {
    start: Math.min(...timestamps),
    end: Math.max(...timestamps),
  };
}

export function getActivityDurationSecs(steps: AgentStep[], isStreaming: boolean): number | null {
  const bounds = getActivityBounds(steps);
  if (!bounds) return null;
  const end = isStreaming ? Date.now() : bounds.end;
  return Math.max(1, Math.round((end - bounds.start) / 1000));
}

export function getSearchQuery(step: AgentStep): string | null {
  if (step.toolName !== "searchWeb") return null;
  const match = step.content.match(/^Searched:\s*(.+)$/i);
  const query = match?.[1]?.trim();
  return query ? query : null;
}

export function getActivityStepSummary(step: AgentStep): string {
  if (step.kind === "thinking") return "Thought";
  if (step.kind === "text") return "Update";
  if (step.toolName === "searchWeb") return "Search";
  if (step.toolName) return `Tool: ${step.toolName}`;
  return "Action";
}
