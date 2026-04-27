import { useEffect, useRef, useState } from "react";
import {
  XIcon,
  CheckIcon,
  LoaderCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  RotateCcwIcon,
  ArchiveIcon,
  CopyIcon,
  RefreshCwIcon,
} from "lucide-react";
import {
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
import type {
  Agent,
  AgentStep,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  AgentPlanApprovalResponse,
} from "@core/types";
import {
  type FollowUpResult,
  type AnswerQuestionResult,
  type AnswerToolApprovalResult,
  type AnswerPlanApprovalResult,
  type SkipQuestionResult,
  type TimelineItem,
  TOOL_ACTIVITY_GRACE_MS,
  parseAskQuestionRequest,
  parseAskQuestionOutput,
  isAskQuestionStep,
  isToolApprovalStep,
  getApprovalStateOrder,
  isActivityStep,
  getActivityTitle,
  getToolCallCount,
  getActivityBounds,
  getActivityDurationSecs,
  getSearchQuery,
  getActivityStepSummary,
} from "./agent-step-utils";
import { AskQuestionPendingCard, AskQuestionResolvedCard } from "./ask-question-cards";
import { AgentPlanCard } from "./agent-plan-card";
import { ToolApprovalCard } from "./tool-approval-card";
import { ProviderTaskViewer } from "./provider-task-viewer";

const PROVIDER_TASK_TOOLS = new Set(["codex", "claude"]);

function getProviderTaskCallIdsFromSteps(steps: AgentStep[]): string[] {
  const ids = new Set<string>();
  for (const step of steps) {
    // Accept both tool-call and tool-result kinds: the AI SDK emits them with
    // the same step id, so the reducer replaces the tool-call with the tool-result
    // as soon as the (fire-and-forget) tool returns. Filtering on tool-call alone
    // would make the viewer unmount seconds after mounting.
    if (step.kind !== "tool-call" && step.kind !== "tool-result") continue;
    if (!step.toolName || !PROVIDER_TASK_TOOLS.has(step.toolName)) continue;
    if (step.id.startsWith("tool:")) ids.add(step.id.slice(5));
  }
  return [...ids];
}

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
  hideTaskCard?: boolean;
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

function StatusBadge({ status, steps }: { status: Agent["status"]; steps: readonly AgentStep[]}) {
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

function AgentTodoQueue({ items }: { items: ReadonlyArray<{ id: string; content: string; status: string }> }) {
  const unfinishedItems = items.filter((item) => item.status !== "completed" && item.status !== "cancelled");
  if (unfinishedItems.length === 0) return null;

  const orderedItems = [
    ...unfinishedItems.filter((item) => item.status === "in_progress"),
    ...unfinishedItems.filter((item) => item.status !== "in_progress"),
  ];
  const visibleItems = orderedItems.slice(0, 3);
  const hiddenCount = orderedItems.length - visibleItems.length;

  return (
    <div className="mb-1.5 rounded-lg border border-border/45 bg-background/65 px-2 py-1.5 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
          In progress
        </span>
        <span className="text-[10px] text-muted-foreground/65">
          {unfinishedItems.length} left
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {visibleItems.map((item) => {
          const active = item.status === "in_progress";
          return (
            <div key={item.id} className="flex items-start gap-2">
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/35"}`} />
              <span className={`min-w-0 flex-1 text-[11px] leading-4 ${active ? "text-foreground/88" : "text-foreground/68"}`}>
                {item.content}
              </span>
              {active && (
                <span className="shrink-0 rounded-full bg-primary/8 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-primary/70">
                  Now
                </span>
              )}
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <div className="mt-1 text-[10px] text-muted-foreground/60">
          +{hiddenCount} more
        </div>
      )}
    </div>
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
            <MessageResponse>{step.content}</MessageResponse>
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
  const providerTaskCallIds = getProviderTaskCallIdsFromSteps(steps);

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
                const hasContent = !!step.content?.trim();
                return (
                  <div key={`${step.id}:${step.kind}`} className="py-0.5 text-2xs leading-relaxed text-muted-foreground">
                    {hasContent ? (
                      <MessageResponse>{step.content}</MessageResponse>
                    ) : (
                      <span className="italic text-muted-foreground/70">Reasoning unavailable from provider.</span>
                    )}
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
      {providerTaskCallIds.map((callId) => (
        <ProviderTaskViewer key={callId} toolCallId={callId} />
      ))}
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
      <details className="group mt-1">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon className="size-3 transition-transform duration-200 group-open:rotate-180" />
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
  hideTaskCard = false,
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
    <div className="w-full h-full shrink-0 flex flex-col min-h-0 bg-background">
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
                className="cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Relaunch agent"
              >
                <RotateCcwIcon className="size-3.5" />
              </button>
            )}
            {!isRunning && onArchive && (
              <button
                type="button"
                onClick={() => onArchive(agent)}
                className="cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                aria-label="Archive agent"
              >
                <ArchiveIcon className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-1 cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close panel"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {!hideTaskCard && <TaskContextCard task={agent.task} taskContext={agent.taskContext} />}

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
