import { EventEmitter } from "node:events";
import type { ModelMessage } from "ai";
import { buildAgentInitialUserPrompt, runAgent, continueAgent } from "./agent";
import { agentTitleSchema, buildAgentTitlePrompt } from "../analysis/analysis";
import { log } from "../logger";
import type { AppDatabase } from "../db/db";
import type {
  Agent,
  AgentKind,
  AgentStep,
  SessionEvents,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentToolApprovalRequest,
  AgentToolApprovalResponse,
  AgentPlanApprovalRequest,
  AgentPlanApprovalResponse,
} from "../types";
import type { AgentExternalToolSet } from "./external-tools";
import { extractAgentLearnings } from "./learn";
import { generateStructuredObject } from "../ai/structured-output";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
};

type AgentManagerDeps = {
  model: Parameters<typeof runAgent>[1]["model"];
  utilitiesModel: Parameters<typeof runAgent>[1]["model"];
  synthesisModel: Parameters<typeof runAgent>[1]["model"];
  exaApiKey?: string;
  events: TypedEmitter;
  getTranscriptContext: () => string;
  getRecentBlocks?: () => import("../types").TranscriptBlock[];
  getProjectInstructions?: () => string | undefined;
  getProjectId?: () => string | undefined;
  dataDir?: string;
  getAgentsMd: () => string;
  getProjectAgentsMd?: () => string | null;
  responseLength?: import("../types").ResponseLength;
  searchTranscriptHistory?: (query: string, limit?: number) => unknown[];
  searchAgentHistory?: (query: string, limit?: number) => unknown[];
  getExternalTools?: () => Promise<AgentExternalToolSet>;
  getCodexClient?: () => import("./codex-client").CodexClient | null;
  allowAutoApprove: boolean;
  db?: AppDatabase;
};

export type AgentManager = {
  launchAgent: (kind: AgentKind, taskId: string | undefined, task: string, sessionId?: string, taskContext?: string) => Agent;
  relaunchAgent: (agentId: string) => Agent | null;
  archiveAgent: (agentId: string) => boolean;
  followUpAgent: (agentId: string, question: string) => { ok: boolean; error?: string };
  answerAgentQuestion: (agentId: string, answers: AgentQuestionSelection[]) => { ok: boolean; error?: string };
  skipAgentQuestion: (agentId: string) => { ok: boolean; error?: string };
  answerAgentToolApproval: (agentId: string, response: AgentToolApprovalResponse) => { ok: boolean; error?: string };
  answerPlanApproval: (agentId: string, response: AgentPlanApprovalResponse) => { ok: boolean; error?: string };
  cancelAgent: (id: string) => boolean;
  hydrateAgents: (items: Agent[]) => void;
  getAgent: (id: string) => Readonly<Agent> | undefined;
  getAllAgents: () => ReadonlyArray<Readonly<Agent>>;
  getAgentsForSession: (sessionId: string) => Agent[];
};

const STEP_FLUSH_INTERVAL_MS = 2000;

async function generateAgentTitle(
  agent: Agent,
  deps: AgentManagerDeps,
  agents: Map<string, Agent>,
): Promise<void> {
  try {
    const { object } = await generateStructuredObject({
      model: deps.utilitiesModel,
      schema: agentTitleSchema,
      prompt: buildAgentTitlePrompt(agent.task),
    });
    const current = agents.get(agent.id);
    if (!current) return;
    current.task = object.title;
    deps.db?.updateAgentTask(agent.id, object.title);
    deps.events.emit("agent-title-generated", agent.id, object.title);
    log("INFO", `Agent title generated for ${agent.id}: "${object.title}"`);
  } catch (err) {
    log("WARN", `Failed to generate agent title for ${agent.id}: ${err}`);
  }
}

export function createAgentManager(deps: AgentManagerDeps): AgentManager {
  const agents = new Map<string, Agent>();
  const abortControllers = new Map<string, AbortController>();
  const conversationHistory = new Map<string, ModelMessage[]>();
  const pendingFlush = new Map<string, NodeJS.Timeout>();
  const pendingQuestions = new Map<string, {
    toolCallId: string;
    request: AgentQuestionRequest;
    resolve: (answers: AgentQuestionSelection[]) => void;
    reject: (error: Error) => void;
  }>();
  const pendingApprovals = new Map<string, {
    toolCallId: string;
    request: AgentToolApprovalRequest;
    resolve: (response: AgentToolApprovalResponse) => void;
    reject: (error: Error) => void;
  }>();
  const pendingPlanApprovals = new Map<string, {
    toolCallId: string;
    request: AgentPlanApprovalRequest;
    resolve: (response: AgentPlanApprovalResponse) => void;
    reject: (error: Error) => void;
  }>();

  function buildHistoryFromSteps(agent: Agent): ModelMessage[] {
    const history: ModelMessage[] = [];
    if (agent.task.trim()) {
      const taskPrompt = buildAgentInitialUserPrompt(agent.task, agent.taskContext);
      history.push({ role: "user", content: taskPrompt });
    }

    // Skip the first user step — it mirrors the initial task and
    // buildAgentInitialUserPrompt already added the enriched version above.
    let skippedInitialUser = false;
    for (const step of agent.steps) {
      if (!step.content.trim()) continue;
      if (step.kind === "user") {
        if (!skippedInitialUser) {
          skippedInitialUser = true;
          continue;
        }
        history.push({ role: "user", content: step.content });
      }
      if (step.kind === "text") {
        skippedInitialUser = true;
        history.push({ role: "assistant", content: step.content });
      }
    }

    return history;
  }

  // Lazy-import exa-js — returns null if unavailable instead of throwing
  let exaInstance: InstanceType<typeof import("exa-js").default> | null = null;
  let exaLoadAttempted = false;
  function tryGetExa(): typeof exaInstance {
    if (exaLoadAttempted) return exaInstance;
    exaLoadAttempted = true;
    if (!deps.exaApiKey) {
      log("INFO", "Exa SDK skipped: EXA_API_KEY not set. Agents will run without web search.");
      return null;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Exa = require("exa-js").default ?? require("exa-js");
      exaInstance = new Exa(deps.exaApiKey);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log("WARN", `Exa SDK load failed: ${msg}. Agents will run without web search.`);
    }
    return exaInstance;
  }

  function flushSteps(agentId: string) {
    const agent = agents.get(agentId);
    if (!agent || !deps.db) return;
    deps.db.updateAgent(agentId, { steps: agent.steps });
  }

  function scheduleStepFlush(agentId: string) {
    if (!deps.db) return;
    if (pendingFlush.has(agentId)) return;
    const timer = setTimeout(() => {
      pendingFlush.delete(agentId);
      flushSteps(agentId);
    }, STEP_FLUSH_INTERVAL_MS);
    pendingFlush.set(agentId, timer);
  }

  function cancelFlush(agentId: string) {
    const timer = pendingFlush.get(agentId);
    if (timer) {
      clearTimeout(timer);
      pendingFlush.delete(agentId);
    }
  }

  function rejectPendingQuestion(agentId: string, reason: string) {
    const pending = pendingQuestions.get(agentId);
    if (!pending) return;
    pendingQuestions.delete(agentId);
    pending.reject(new Error(reason));
  }

  function rejectPendingApproval(agentId: string, reason: string) {
    const pending = pendingApprovals.get(agentId);
    if (!pending) return;
    pendingApprovals.delete(agentId);
    pending.reject(new Error(reason));
  }

  function rejectPendingPlanApproval(agentId: string, reason: string) {
    const pending = pendingPlanApprovals.get(agentId);
    if (!pending) return;
    pendingPlanApprovals.delete(agentId);
    pending.reject(new Error(reason));
  }

  function requestClarification(
    agentId: string,
    request: AgentQuestionRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ): Promise<AgentQuestionSelection[]> {
    const { toolCallId, abortSignal } = options;
    rejectPendingQuestion(agentId, "Clarification request replaced by a newer request.");

    return new Promise<AgentQuestionSelection[]>((resolve, reject) => {
      const onAbort = () => {
        pendingQuestions.delete(agentId);
        reject(new Error("Cancelled"));
      };

      if (abortSignal?.aborted) {
        onAbort();
        return;
      }

      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      pendingQuestions.set(agentId, {
        toolCallId,
        request,
        resolve: (answers) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingQuestions.delete(agentId);
          resolve(answers);
        },
        reject: (error) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingQuestions.delete(agentId);
          reject(error);
        },
      });
    });
  }

  function requestToolApproval(
    agentId: string,
    request: AgentToolApprovalRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ): Promise<AgentToolApprovalResponse> {
    const { toolCallId, abortSignal } = options;
    rejectPendingApproval(agentId, "Approval request replaced by a newer request.");

    return new Promise<AgentToolApprovalResponse>((resolve, reject) => {
      const onAbort = () => {
        pendingApprovals.delete(agentId);
        reject(new Error("Cancelled"));
      };

      if (abortSignal?.aborted) {
        onAbort();
        return;
      }

      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      pendingApprovals.set(agentId, {
        toolCallId,
        request,
        resolve: (response) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingApprovals.delete(agentId);
          resolve(response);
        },
        reject: (error) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingApprovals.delete(agentId);
          reject(error);
        },
      });
    });
  }

  function requestPlanApproval(
    agentId: string,
    request: AgentPlanApprovalRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ): Promise<AgentPlanApprovalResponse> {
    const { toolCallId, abortSignal } = options;
    rejectPendingPlanApproval(agentId, "Plan approval replaced by a newer request.");

    return new Promise<AgentPlanApprovalResponse>((resolve, reject) => {
      const onAbort = () => {
        pendingPlanApprovals.delete(agentId);
        reject(new Error("Cancelled"));
      };

      if (abortSignal?.aborted) {
        onAbort();
        return;
      }

      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      pendingPlanApprovals.set(agentId, {
        toolCallId,
        request,
        resolve: (response) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingPlanApprovals.delete(agentId);
          resolve(response);
        },
        reject: (error) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingPlanApprovals.delete(agentId);
          reject(error);
        },
      });
    });
  }

  function validateQuestionAnswers(
    request: AgentQuestionRequest,
    answers: AgentQuestionSelection[],
  ): string | null {
    if (!Array.isArray(answers) || answers.length === 0) {
      return "At least one answer is required";
    }

    const byQuestionId = new Map<string, AgentQuestionSelection>();
    for (const answer of answers) {
      const questionId = answer.questionId?.trim();
      if (!questionId) return "Each answer must include a questionId";
      if (!Array.isArray(answer.selectedOptionIds)) {
        return `Missing selected options for question ${questionId}`;
      }
      byQuestionId.set(questionId, answer);
    }

    for (const question of request.questions) {
      const answer = byQuestionId.get(question.id);
      if (!answer) {
        return `Missing answer for question ${question.id}`;
      }
      const hasFreeText = typeof answer.freeText === "string" && answer.freeText.trim().length > 0;
      const selected = answer.selectedOptionIds
        .map((id) => id.trim())
        .filter(Boolean);
      if (selected.length === 0 && !hasFreeText) {
        return `Provide an answer for question ${question.id}`;
      }
      if (selected.length > 0) {
        if (!question.allow_multiple && selected.length > 1) {
          return `Question ${question.id} allows only one option`;
        }
        const validOptions = new Set(question.options.map((opt) => opt.id));
        for (const selectedId of selected) {
          if (!validOptions.has(selectedId)) {
            return `Invalid option ${selectedId} for question ${question.id}`;
          }
        }
      }
    }

    return null;
  }

  function makeAgentCallbacks(agent: Agent) {
    return {
      onStepFinish: (info: { usage: { inputTokens: number; outputTokens: number; totalTokens: number }; finishReason: string; toolCalls?: Array<{ toolName: string }> }) => {
        log("INFO", `Agent ${agent.id} step: reason=${info.finishReason}, tokens=${info.usage.totalTokens}${info.toolCalls?.length ? `, tools=${info.toolCalls.map((t) => t.toolName).join(",")}` : ""}`);
      },
      onStep: (step: AgentStep) => {
        const existingIdx = agent.steps.findIndex((s) => s.id === step.id);
        if (existingIdx >= 0) {
          agent.steps[existingIdx] = step;
        } else {
          agent.steps.push(step);
        }
        deps.events.emit("agent-step", agent.id, step);
        scheduleStepFlush(agent.id);
      },
      onComplete: (result: string, messages: ModelMessage[]) => {
        agent.status = "completed" as const;
        agent.result = result;
        agent.completedAt = Date.now();
        rejectPendingQuestion(agent.id, "Agent finished before clarification could be answered.");
        rejectPendingApproval(agent.id, "Agent finished before tool approval could be answered.");
        rejectPendingPlanApproval(agent.id, "Agent finished before plan approval could be answered.");
        conversationHistory.set(agent.id, messages);
        abortControllers.delete(agent.id);
        cancelFlush(agent.id);
        deps.db?.updateAgent(agent.id, { status: "completed", result, steps: agent.steps, completedAt: agent.completedAt });
        deps.events.emit("agent-completed", agent.id, result);
        log("INFO", `Agent completed: ${agent.id}`);
        if (deps.db) {
          try {
            deps.db.indexAgentFts(agent.id, agent.task, result, agent.taskContext ?? null);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log("WARN", `Agent FTS indexing failed for ${agent.id}: ${message}`);
          }
          const projectId = deps.getProjectId?.();
          const recentBlocks = deps.getRecentBlocks?.() ?? [];
          void extractAgentLearnings(deps.synthesisModel, agent, recentBlocks, projectId, deps.dataDir)
            .catch((err) => log("WARN", `Learning extraction error: ${err}`));
        }
      },
      onFail: (error: string, messages?: ModelMessage[]) => {
        agent.status = "failed" as const;
        agent.result = error;
        agent.completedAt = Date.now();
        if (messages && messages.length > 0) {
          conversationHistory.set(agent.id, messages);
        }
        rejectPendingQuestion(agent.id, error || "Agent failed before clarification could be answered.");
        rejectPendingApproval(agent.id, error || "Agent failed before tool approval could be answered.");
        rejectPendingPlanApproval(agent.id, error || "Agent failed before plan approval could be answered.");
        abortControllers.delete(agent.id);
        cancelFlush(agent.id);
        deps.db?.updateAgent(agent.id, { status: "failed", result: error, steps: agent.steps, completedAt: agent.completedAt });
        deps.events.emit("agent-failed", agent.id, error);
        log("ERROR", `Agent failed: ${agent.id} — ${error}`);
      },
    };
  }

  function launchAgent(
    kind: AgentKind,
    taskId: string | undefined,
    task: string,
    sessionId?: string,
    taskContext?: string,
  ): Agent {
    const now = Date.now();
    const agent: Agent = {
      id: crypto.randomUUID(),
      kind,
      taskId,
      task,
      taskContext,
      status: "running",
      steps: [
        { id: crypto.randomUUID(), kind: "user", content: task, createdAt: now },
      ],
      createdAt: now,
      sessionId,
    };

    agents.set(agent.id, agent);
    deps.db?.insertAgent(agent);
    deps.events.emit("agent-started", agent);
    log("INFO", `Agent launched: ${agent.id} (${kind})${taskId ? ` for task ${taskId}` : ""}`);

    if (kind === "custom") {
      void generateAgentTitle(agent, deps, agents);
    }

    const exa = tryGetExa();

    const controller = new AbortController();
    abortControllers.set(agent.id, controller);

    const callbacks = makeAgentCallbacks(agent);

    void (async () => {
      const agentsMd = deps.getProjectAgentsMd?.() ?? deps.getAgentsMd();

      await runAgent(agent, {
        model: deps.model,
        exa,
        getTranscriptContext: deps.getTranscriptContext,
        projectInstructions: deps.getProjectInstructions?.(),
        agentsMd: agentsMd || undefined,
        responseLength: deps.responseLength,
        searchTranscriptHistory: deps.searchTranscriptHistory,
        searchAgentHistory: deps.searchAgentHistory,
        getExternalTools: deps.getExternalTools,
        getCodexClient: deps.getCodexClient,
        allowAutoApprove: deps.allowAutoApprove,
        requestClarification: (request, options) =>
          requestClarification(agent.id, request, options),
        requestToolApproval: (request, options) =>
          requestToolApproval(agent.id, request, options),
        requestPlanApproval: (request, options) =>
          requestPlanApproval(agent.id, request, options),
        abortSignal: controller.signal,
        ...callbacks,
      });
    })();

    return agent;
  }

  function followUpAgent(agentId: string, question: string): { ok: boolean; error?: string } {
    const agent = agents.get(agentId);
    if (!agent) return { ok: false, error: "Agent not found" };
    if (agent.status === "running") return { ok: false, error: "Agent is still running" };

    const history = conversationHistory.get(agentId);
    if (!history || history.length === 0) return { ok: false, error: "No conversation history available for follow-up" };

    const exa = tryGetExa();

    // Add the user's follow-up as a visible step
    const followUpStep: AgentStep = {
      id: crypto.randomUUID(),
      kind: "user",
      content: question,
      createdAt: Date.now(),
    };
    agent.steps.push(followUpStep);

    // Reset agent to running state
    agent.status = "running";
    agent.result = undefined;
    agent.completedAt = undefined;
    deps.db?.updateAgent(agentId, { status: "running", result: undefined, completedAt: undefined, steps: agent.steps });
    deps.events.emit("agent-started", agent);

    const controller = new AbortController();
    abortControllers.set(agentId, controller);

    const callbacks = makeAgentCallbacks(agent);

    void (async () => {
      const agentsMd = deps.getProjectAgentsMd?.() ?? deps.getAgentsMd();

      await continueAgent(agent, history, question, {
        model: deps.model,
        exa,
        getTranscriptContext: deps.getTranscriptContext,
        projectInstructions: deps.getProjectInstructions?.(),
        agentsMd: agentsMd || undefined,
        responseLength: deps.responseLength,
        searchTranscriptHistory: deps.searchTranscriptHistory,
        searchAgentHistory: deps.searchAgentHistory,
        getExternalTools: deps.getExternalTools,
        getCodexClient: deps.getCodexClient,
        allowAutoApprove: deps.allowAutoApprove,
        requestClarification: (request, options) =>
          requestClarification(agent.id, request, options),
        requestToolApproval: (request, options) =>
          requestToolApproval(agent.id, request, options),
        requestPlanApproval: (request, options) =>
          requestPlanApproval(agent.id, request, options),
        abortSignal: controller.signal,
        ...callbacks,
      });
    })();

    log("INFO", `Agent follow-up: ${agentId}`);
    return { ok: true };
  }

  function hydrateAgents(items: Agent[]) {
    for (const item of items) {
      // Copy arrays to avoid accidental shared mutation with renderer snapshots.
      const agent: Agent = {
        ...item,
        steps: [...item.steps],
      };

      // Agents still marked "running" after hydration are stale — the actual
      // process is gone (session was closed while they were active). Transition
      // them to "failed" so the user can relaunch or follow up.
      if (agent.status === "running") {
        agent.status = "failed";
        agent.result = "Agent interrupted — session was closed while running.";
        agent.completedAt = Date.now();
        deps.db?.updateAgent(agent.id, {
          status: "failed",
          result: agent.result,
          completedAt: agent.completedAt,
        });
        log("INFO", `Hydrated stale running agent ${agent.id} as failed`);
      }

      agents.set(agent.id, agent);
      const history = buildHistoryFromSteps(agent);
      if (history.length > 0) {
        conversationHistory.set(agent.id, history);
      }
    }
    if (items.length > 0) {
      log("INFO", `Hydrated ${items.length} agent(s) from database`);
    }
  }

  function answerAgentQuestion(
    agentId: string,
    answers: AgentQuestionSelection[],
  ): { ok: boolean; error?: string } {
    const pending = pendingQuestions.get(agentId);
    if (!pending) {
      // If the agent failed while waiting for an answer, fall back to a
      // follow-up with the selected answers formatted as text so the
      // conversation can continue.
      const agent = agents.get(agentId);
      if (agent && agent.status === "failed") {
        const askStep = [...agent.steps].reverse().find(
          (s) => s.kind === "tool-call" && s.toolName === "askQuestion" && s.toolInput,
        );
        let formattedAnswers: string;
        if (askStep?.toolInput) {
          try {
            const parsed = JSON.parse(askStep.toolInput) as {
              questions?: Array<{
                id: string;
                prompt: string;
                options: Array<{ id: string; label: string }>;
              }>;
            };
            const lines = answers.map((a) => {
              const q = parsed.questions?.find((qq) => qq.id === a.questionId);
              const answerText = a.freeText
                || a.selectedOptionIds.map((oid) => q?.options.find((o) => o.id === oid)?.label ?? oid).join(", ");
              return `- ${q?.prompt ?? a.questionId}: ${answerText}`;
            });
            formattedAnswers = `Here are my answers:\n${lines.join("\n")}`;
          } catch {
            formattedAnswers = `Here are my answers:\n${answers.map((a) => `- ${a.questionId}: ${a.freeText || a.selectedOptionIds.join(", ")}`).join("\n")}`;
          }
        } else {
          formattedAnswers = `Here are my answers:\n${answers.map((a) => `- ${a.questionId}: ${a.freeText || a.selectedOptionIds.join(", ")}`).join("\n")}`;
        }
        const result = followUpAgent(agentId, formattedAnswers);
        return result.ok
          ? { ok: true }
          : { ok: false, error: result.error ?? "Could not resume agent with answers" };
      }
      return { ok: false, error: "No pending question for this agent" };
    }

    const validationError = validateQuestionAnswers(pending.request, answers);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    const normalizedAnswers: AgentQuestionSelection[] = pending.request.questions.map((question) => {
      const answer = answers.find((item) => item.questionId === question.id);
      const selectedOptionIds = Array.from(new Set((answer?.selectedOptionIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean)));
      const freeText = answer?.freeText?.trim();
      return {
        questionId: question.id,
        selectedOptionIds,
        ...(freeText ? { freeText } : {}),
      };
    });

    pending.resolve(normalizedAnswers);
    return { ok: true };
  }

  function skipAgentQuestion(agentId: string): { ok: boolean; error?: string } {
    const pending = pendingQuestions.get(agentId);
    if (!pending) {
      return { ok: false, error: "No pending question for this agent" };
    }
    rejectPendingQuestion(
      agentId,
      "The user skipped these questions and wants to discuss further via free-form conversation instead. Continue without structured answers — the user will elaborate in follow-up messages.",
    );
    return { ok: true };
  }

  function answerAgentToolApproval(
    agentId: string,
    response: AgentToolApprovalResponse,
  ): { ok: boolean; error?: string } {
    const pending = pendingApprovals.get(agentId);
    if (!pending) {
      return { ok: false, error: "No pending tool approval for this agent" };
    }

    if (response.approvalId !== pending.request.id) {
      return { ok: false, error: "Approval id does not match pending request" };
    }

    pending.resolve({
      approvalId: pending.request.id,
      approved: response.approved === true,
    });
    return { ok: true };
  }

  function answerPlanApproval(
    agentId: string,
    response: AgentPlanApprovalResponse,
  ): { ok: boolean; error?: string } {
    const pending = pendingPlanApprovals.get(agentId);
    if (!pending) {
      return { ok: false, error: "No pending plan approval for this agent" };
    }

    if (response.approvalId !== pending.request.id) {
      return { ok: false, error: "Approval id does not match pending plan request" };
    }

    pending.resolve({
      approvalId: pending.request.id,
      approved: response.approved === true,
      feedback: response.feedback,
    });
    return { ok: true };
  }

  function archiveAgent(agentId: string): boolean {
    const agent = agents.get(agentId);
    if (!agent || agent.status === "running") return false;
    agents.delete(agentId);
    conversationHistory.delete(agentId);
    cancelFlush(agentId);
    deps.db?.archiveAgent(agentId);
    deps.events.emit("agent-archived", agentId);
    log("INFO", `Agent archived: ${agentId}`);
    return true;
  }

  function cancelAgent(id: string): boolean {
    const controller = abortControllers.get(id);
    if (!controller) return false;
    controller.abort();
    rejectPendingApproval(id, "Cancelled");
    rejectPendingQuestion(id, "Cancelled");
    rejectPendingPlanApproval(id, "Cancelled");
    return true;
  }

  function relaunchAgent(agentId: string): Agent | null {
    const agent = agents.get(agentId);
    if (!agent) return null;
    if (agent.status === "running") return null;

    // Tear down any stale state from the previous run
    abortControllers.get(agentId)?.abort();
    abortControllers.delete(agentId);
    rejectPendingQuestion(agentId, "Agent relaunched");
    rejectPendingApproval(agentId, "Agent relaunched");
    rejectPendingPlanApproval(agentId, "Agent relaunched");
    cancelFlush(agentId);
    conversationHistory.delete(agentId);

    // Reset the agent in-place so the same object/ID is reused
    const now = Date.now();
    agent.status = "running";
    agent.steps = [
      { id: crypto.randomUUID(), kind: "user", content: agent.task, createdAt: now },
    ];
    agent.result = undefined;
    agent.completedAt = undefined;
    agent.createdAt = now;
    // Refresh task context so the agent starts with current transcript, not the
    // stale snapshot captured when the task was originally created.
    agent.taskContext = deps.getTranscriptContext();

    deps.db?.updateAgent(agentId, { status: "running", steps: agent.steps, result: undefined, completedAt: undefined });
    deps.events.emit("agent-started", agent);
    log("INFO", `Agent relaunched: ${agentId}`);

    const exa = tryGetExa();

    const controller = new AbortController();
    abortControllers.set(agentId, controller);

    void (async () => {
      const agentsMd = deps.getProjectAgentsMd?.() ?? deps.getAgentsMd();

      await runAgent(agent, {
        model: deps.model,
        exa,
        getTranscriptContext: deps.getTranscriptContext,
        projectInstructions: deps.getProjectInstructions?.(),
        agentsMd: agentsMd || undefined,
        responseLength: deps.responseLength,
        searchTranscriptHistory: deps.searchTranscriptHistory,
        searchAgentHistory: deps.searchAgentHistory,
        getExternalTools: deps.getExternalTools,
        getCodexClient: deps.getCodexClient,
        allowAutoApprove: deps.allowAutoApprove,
        requestClarification: (request, options) => requestClarification(agentId, request, options),
        requestToolApproval: (request, options) => requestToolApproval(agentId, request, options),
        requestPlanApproval: (request, options) => requestPlanApproval(agentId, request, options),
        abortSignal: controller.signal,
        ...makeAgentCallbacks(agent),
      });
    })();

    return agent;
  }

  return {
    launchAgent,
    relaunchAgent,
    archiveAgent,
    followUpAgent,
    answerAgentQuestion,
    skipAgentQuestion,
    answerAgentToolApproval,
    answerPlanApproval,
    cancelAgent,
    hydrateAgents,
    getAgent: (id) => {
      const agent = agents.get(id);
      if (!agent) return undefined;
      return { ...agent, steps: [...agent.steps] };
    },
    getAllAgents: () => [...agents.values()].map((a) => ({ ...a, steps: [...a.steps] })),
    getAgentsForSession: (sessionId) => {
      return deps.db?.getAgentsForSession(sessionId) ?? [];
    },
  };
}
