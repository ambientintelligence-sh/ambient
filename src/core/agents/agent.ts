import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import type {
  AgentStep,
  Agent,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentToolApprovalRequest,
  AgentToolApprovalResponse,
  AgentPlanApprovalRequest,
  AgentPlanApprovalResponse,
  AgentTodoItem,
} from "../types";
import { log } from "../logger";
import {
  getAgentInitialUserPromptTemplate,
  getAgentSystemPromptTemplate,
  renderPromptTemplate,
} from "../prompt-loader";
import { normalizeProviderErrorMessage } from "../text/text-utils";
import type { AgentExternalToolSet } from "./external-tools";
import {
  rankExternalTools,
  resolveExternalToolName,
  shouldRequireApproval,
} from "./mcp-tool-resolution";

type ExaClient = {
  search: (
    query: string,
    options: Record<string, unknown>
  ) => Promise<{
    results: Array<{ title: string; url: string; text?: string }>;
  }>;
};

export type AgentDeps = {
  model: Parameters<typeof streamText>[0]["model"];
  exa?: ExaClient | null;
  getTranscriptContext: () => string;
  projectInstructions?: string;
  agentsMd?: string;
  responseLength?: import("../types").ResponseLength;
  searchTranscriptHistory?: (query: string, limit?: number) => unknown[];
  searchAgentHistory?: (query: string, limit?: number) => unknown[];
  getExternalTools?: () => Promise<AgentExternalToolSet>;
  allowAutoApprove: boolean;
  requestClarification: (
    request: AgentQuestionRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal }
  ) => Promise<AgentQuestionSelection[]>;
  requestToolApproval: (
    request: AgentToolApprovalRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal }
  ) => Promise<AgentToolApprovalResponse>;
  requestPlanApproval: (
    request: AgentPlanApprovalRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal }
  ) => Promise<AgentPlanApprovalResponse>;
  onStep: (step: AgentStep) => void;
  onStepFinish?: (info: { usage: { inputTokens: number; outputTokens: number; totalTokens: number }; finishReason: string; toolCalls?: Array<{ toolName: string }> }) => void;
  onComplete: (result: string, messages: ModelMessage[]) => void;
  onFail: (error: string, messages?: ModelMessage[]) => void;
  abortSignal?: AbortSignal;
};

const MAX_CONSECUTIVE_TOOL_ERRORS = 3;
const STREAM_MAX_RETRIES = 3;
const STEP_TIMEOUT_MS = 120_000;
const CHUNK_TIMEOUT_MS = 30_000;

const askQuestionInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  questions: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        prompt: z.string().trim().min(1),
        options: z
          .array(
            z.object({
              id: z.string().trim().min(1),
              label: z.string().trim().min(1),
            })
          )
          .min(2)
          .max(8),
        allow_multiple: z.boolean().optional(),
      })
    )
    .min(1)
    .max(3),
});

function formatCurrentDateForPrompt(now: Date): string {
  const longDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  return `${longDate} (ISO: ${now.toISOString().slice(0, 10)})`;
}

const RESPONSE_LENGTH_PROMPTS: Record<import("../types").ResponseLength, string | null> = {
  concise:
    "## Response Length\n\n" +
    "Be concise. Prefer short paragraphs and bullet points over long prose. " +
    "Lead with the key finding or answer, then add supporting detail only if it adds clear value. " +
    "Omit filler, preambles, and restating the question. " +
    "Aim for the shortest response that fully addresses the task.",
  standard: null,
  detailed:
    "## Response Length\n\n" +
    "Provide thorough, detailed responses. Include relevant context, supporting evidence, " +
    "and comprehensive analysis. Explore multiple angles when appropriate. " +
    "Prioritize completeness over brevity — the user wants depth.",
};

const buildSystemPrompt = (
  transcriptContext: string,
  projectInstructions?: string,
  agentsMd?: string,
  responseLength?: import("../types").ResponseLength,
) => {
  const base = renderPromptTemplate(getAgentSystemPromptTemplate(), {
    today: formatCurrentDateForPrompt(new Date()),
    transcript_context: transcriptContext,
  });

  const sections: string[] = [];
  if (projectInstructions?.trim()) {
    sections.push(`## Project Instructions\n\n${projectInstructions.trim()}`);
  }
  if (agentsMd?.trim()) {
    sections.push(`## Agent Memory\n\n${agentsMd.trim()}`);
  }
  sections.push(base);

  const lengthPrompt = RESPONSE_LENGTH_PROMPTS[responseLength ?? "standard"];
  if (lengthPrompt) {
    sections.push(lengthPrompt);
  }

  return sections.join("\n\n---\n\n");
};

export function buildAgentInitialUserPrompt(
  task: string,
  taskContext?: string
): string {
  const contextText = taskContext?.trim();
  const contextSection = contextText ? `\n\nContext:\n${contextText}` : "";
  return renderPromptTemplate(getAgentInitialUserPromptTemplate(), {
    task: task.trim(),
    context_section: contextSection,
  });
}

function buildApprovalTitle(toolName: string, provider: string): string {
  const clean = toolName.includes("__") ? toolName.split("__").slice(1).join("__") : toolName;
  const label = provider === "notion" ? "Notion" : provider === "linear" ? "Linear" : "MCP";
  return `${label} tool: ${clean}`;
}

function summarizeApprovalInput(input: unknown): string {
  try {
    const text = JSON.stringify(input);
    if (!text) return "(no input)";
    return text.length > 600 ? `${text.slice(0, 600)}...` : text;
  } catch {
    return String(input ?? "(no input)");
  }
}


type CallMcpToolErrorCode =
  | "tool_name_required"
  | "tool_ambiguous"
  | "tool_not_found"
  | "no_tools_available"
  | "missing_or_invalid_args"
  | "tool_execution_failed"
  | "tool_denied";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function classifyToolExecutionError(message: string): CallMcpToolErrorCode {
  if (/missing|required|invalid|argument|parameter|schema|input/i.test(message)) {
    return "missing_or_invalid_args";
  }
  return "tool_execution_failed";
}

function getMcpCallResultCode(output: unknown): CallMcpToolErrorCode | null {
  const record = asObject(output);
  if (!record) return null;
  const code = record.errorCode;
  return typeof code === "string" ? (code as CallMcpToolErrorCode) : null;
}

function getMcpCallResultStatus(output: unknown): "success" | "error" | "denied" {
  if (typeof output === "string") {
    const normalized = output.trim().toLowerCase();
    if (!normalized) return "success";
    if (/\b(denied|rejected|forbidden|not approved)\b/.test(normalized)) {
      return "denied";
    }
    if (/\b(error|failed|failure|exception|invalid|missing)\b/.test(normalized)) {
      return "error";
    }
    return "success";
  }

  const code = getMcpCallResultCode(output);
  if (code === "tool_denied") return "denied";
  if (code) return "error";

  const record = asObject(output);
  if (!record) return "success";
  const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
  if (status === "denied" || status === "rejected") return "denied";
  if (status === "error" || status === "failed" || status === "failure") return "error";
  if (record.ok === false || record.success === false) return "error";
  if (record.isError === true) return "error";
  if (record.denied === true) return "denied";
  if (typeof record.error === "string" && record.error.trim().length > 0) {
    return "error";
  }
  return "success";
}

function getMcpCallResultHint(output: unknown): string {
  const record = asObject(output);
  if (!record) return "";
  const hint = record.hint;
  const error = record.error;
  const content = record.content;
  const hintText = typeof hint === "string" ? hint : "";
  const errorText = typeof error === "string" ? error : "";
  const contentText = Array.isArray(content)
    ? content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const typed = item as { type?: unknown; text?: unknown };
        if (typed.type !== "text" || typeof typed.text !== "string") return "";
        return typed.text;
      })
      .filter(Boolean)
      .join(" ")
    : "";
  return `${errorText} ${hintText} ${contentText}`.trim().toLowerCase();
}

function getMcpCallResultErrorText(output: unknown): string {
  const record = asObject(output);
  if (!record) return "";
  const error = record.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "";
}




async function buildTools(
  exa: ExaClient | null | undefined,
  getTranscriptContext: () => string,
  requestClarification: AgentDeps["requestClarification"],
  requestToolApproval: AgentDeps["requestToolApproval"],
  requestPlanApproval: AgentDeps["requestPlanApproval"],
  onStep: AgentDeps["onStep"],
  allowAutoApprove: boolean,
  existingSteps: ReadonlyArray<AgentStep>,
  getExternalTools?: AgentDeps["getExternalTools"],
  searchTranscriptHistory?: AgentDeps["searchTranscriptHistory"],
  searchAgentHistory?: AgentDeps["searchAgentHistory"],
) {
  const baseTools: Parameters<typeof streamText>[0]["tools"] = {};

  if (exa) {
    const exaClient = exa;
    baseTools["searchWeb"] = tool({
      description:
        "Search the web for information when external facts are required. Use specific, targeted queries.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
      }),
      execute: async ({ query }) => {
        try {
          const results = await exaClient.search(query, {
            type: "auto",
            numResults: 10,
            text: { maxCharacters: 1500 },
          });

          return results.results;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log("WARN", `searchWeb failed: ${message}`);
          return {
            error: message,
            hint:
              "Web search is temporarily unavailable. Continue with available context, or ask the user if they want to proceed without web search.",
          };
        }
      },
    });
  }

  baseTools["getTranscriptContext"] = tool({
    description:
      "Get recent transcript blocks from the current conversation for more context.",
    inputSchema: z.object({}),
    execute: async () => {
      return getTranscriptContext();
    },
  });

  baseTools["askQuestion"] = tool({
    description:
      "Ask the user one or more multiple-choice clarification questions when intent is ambiguous. Wait for human responses before continuing.",
    inputSchema: askQuestionInputSchema,
    execute: async (input, { toolCallId, abortSignal }) => {
      const answers = await requestClarification(input, {
        toolCallId,
        abortSignal,
      });
      const enrichedAnswers = answers.map((answer) => {
        const question = input.questions.find((q) => q.id === answer.questionId);
        const selectedLabels = question
          ? answer.selectedOptionIds
              .map((optId) => question.options.find((opt) => opt.id === optId)?.label)
              .filter(Boolean)
          : [];
        return {
          ...answer,
          selectedLabels,
          ...(answer.freeText ? { userText: answer.freeText } : {}),
        };
      });
      return {
        title: input.title,
        questions: input.questions,
        answers: enrichedAnswers,
      };
    },
  });

  // Stable IDs for plan/todo steps — use UUIDs to avoid collision on relaunch
  const planStepId = `plan:${crypto.randomUUID()}`;
  const todoStepId = `todo:${crypto.randomUUID()}`;

  // Restore todos from previous turns so merge works across follow-ups
  let currentTodos: AgentTodoItem[] = (() => {
    for (let i = existingSteps.length - 1; i >= 0; i--) {
      const step = existingSteps[i];
      if (step.kind === "todo" && step.todoItems && step.todoItems.length > 0) {
        return [...step.todoItems];
      }
    }
    return [];
  })();

  baseTools["createPlan"] = tool({
    description: [
      "Create a plan document visible to the user as a collapsible card.",
      "Use for non-trivial tasks after investigation but before execution.",
      "After calling this tool, STOP and wait for the user to approve or reject the plan.",
      "The user may approve, reject, or provide feedback to revise the plan.",
      "Do NOT proceed with execution until the plan is approved.",
      "If rejected with feedback, revise and call createPlan again with the updated plan.",
      "Do NOT use for simple questions, quick lookups, or single-step tasks.",
    ].join("\n"),
    inputSchema: z.object({
      title: z.string().describe("Brief plan title (imperative, e.g. 'Analyze the quarterly report')"),
      content: z.string().describe("Markdown plan body: approach, key steps, relevant files. Keep it concise and actionable."),
    }),
    execute: async ({ title, content }, { toolCallId, abortSignal }) => {
      const approvalId = `plan-approval:${planStepId}`;

      // Emit the plan step with awaiting-approval state
      onStep({
        id: planStepId,
        kind: "plan",
        content: title,
        planTitle: title,
        planContent: content,
        planApprovalState: "awaiting-approval",
        createdAt: Date.now(),
      });

      // Block until the user approves or rejects
      const response = await requestPlanApproval(
        { id: approvalId, title, content },
        { toolCallId, abortSignal },
      );

      // Update the plan step with the approval result
      onStep({
        id: planStepId,
        kind: "plan",
        content: title,
        planTitle: title,
        planContent: content,
        planApprovalState: response.approved ? "approved" : "rejected",
        planApprovalFeedback: response.feedback,
        createdAt: Date.now(),
      });

      if (response.approved) {
        return `Plan approved by user. Proceed with execution.`;
      }

      const feedbackNote = response.feedback
        ? ` User feedback: "${response.feedback}". Revise the plan based on this feedback and call createPlan again.`
        : " Revise your approach and call createPlan again with an updated plan.";
      return `Plan rejected by user.${feedbackNote}`;
    },
  });

  baseTools["updateTodos"] = tool({
    description: [
      "Create or update a todo checklist for tracking progress on multi-step work.",
      "merge=false (default): replaces all todos with the provided list.",
      "merge=true: updates only the todos with matching IDs, keeps the rest unchanged. New IDs are appended.",
      "Only ONE todo should be 'in_progress' at a time.",
      "Mark todos 'completed' immediately after finishing, 'cancelled' if no longer needed.",
      "Do NOT use for single-step or trivial tasks.",
    ].join("\n"),
    inputSchema: z.object({
      merge: z.boolean().describe("true = update matching IDs and keep the rest, false = replace entire list"),
      todos: z.array(
        z.object({
          id: z.string().describe("Stable identifier (e.g. 'setup-auth'). Reuse across calls."),
          content: z.string().describe("Concrete, actionable description"),
          status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
        })
      ),
    }),
    execute: async ({ merge, todos }) => {
      if (merge) {
        const incoming = new Map(todos.map((t) => [t.id, t]));
        currentTodos = currentTodos.map((existing) => incoming.get(existing.id) ?? existing);
        for (const t of todos) {
          if (!currentTodos.some((e) => e.id === t.id)) {
            currentTodos.push(t);
          }
        }
      } else {
        currentTodos = todos.map((t) => ({ id: t.id, content: t.content, status: t.status }));
      }

      onStep({
        id: todoStepId,
        kind: "todo",
        content: "Todos updated",
        todoItems: currentTodos,
        createdAt: Date.now(),
      });

      const completed = currentTodos.filter((t) => t.status === "completed").length;
      const inProgress = currentTodos.find((t) => t.status === "in_progress");
      return `Todos: ${completed}/${currentTodos.length} done.` +
        (inProgress ? ` Current: ${inProgress.content}` : "");
    },
  });

  if (searchTranscriptHistory) {
    baseTools["searchTranscriptHistory"] = tool({
      description:
        "Search past transcript blocks by keyword. Use to find specific topics, phrases, or discussions from previous sessions.",
      inputSchema: z.object({
        query: z.string().describe("FTS5 keyword query (e.g. 'budget meeting' or 'API integration')"),
        limit: z.number().optional().describe("Max results to return (default 20)"),
      }),
      execute: async ({ query, limit }) => searchTranscriptHistory(query, limit),
    });
  }

  if (searchAgentHistory) {
    baseTools["searchAgentHistory"] = tool({
      description:
        "Search past agent tasks and results by keyword. Use to find what previous agents discovered or decided.",
      inputSchema: z.object({
        query: z.string().describe("FTS5 keyword query (e.g. 'pricing strategy' or 'competitor analysis')"),
        limit: z.number().optional().describe("Max results to return (default 20)"),
      }),
      execute: async ({ query, limit }) => searchAgentHistory(query, limit),
    });
  }

  if (!getExternalTools) {
    return { tools: baseTools, externalTools: {} as AgentExternalToolSet };
  }

  let externalTools: AgentExternalToolSet = {};
  try {
    externalTools = await getExternalTools();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `Failed to load external MCP tools: ${message}`);
    onStep({
      id: `mcp-tools:error:${Date.now()}`,
      kind: "tool-result",
      content: `MCP tools unavailable: ${message}`,
      toolName: "mcp",
      createdAt: Date.now(),
    });
    return { tools: baseTools, externalTools: {} as AgentExternalToolSet };
  }

  // Expose a schema-lookup tool so the agent can inspect a tool's inputSchema
  // before calling it. Tool names should come from searchMcpTools or prior context.
  baseTools["searchMcpTools"] = tool({
    description:
      "Search connected MCP tools by name or description. Use this first to find the right tool without loading the full MCP catalog into context.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search query for the tool name or description. Leave empty to browse a provider."),
      provider: z.string().optional().describe("Optional provider filter, for example notion or linear."),
      limit: z.number().int().min(1).max(10).optional().describe("Maximum number of matches to return. Defaults to 8."),
    }),
    execute: async ({ query, provider, limit }) => {
      if (Object.keys(externalTools).length === 0) {
        return {
          errorCode: "no_tools_available",
          error: "No MCP tools are currently available.",
          hint: "Connect an MCP integration first.",
          results: [],
        };
      }

      const providerFilter = provider?.trim().toLowerCase();
      const filteredTools = providerFilter
        ? Object.fromEntries(
          Object.entries(externalTools).filter(([, tool]) => tool.provider.toLowerCase() === providerFilter)
        )
        : externalTools;
      const maxResults = limit ?? 8;
      const ranked = rankExternalTools(query?.trim() ?? "", filteredTools, maxResults);

      return {
        query: query?.trim() ?? "",
        provider: providerFilter ?? null,
        totalMatches: ranked.length,
        results: ranked.slice(0, maxResults).map(({ name, tool }) => ({
          name,
          provider: tool.provider,
          description: tool.description ?? "",
          isMutating: tool.isMutating,
        })),
        hint: ranked.length > 0
          ? "Use getMcpToolSchema with an exact tool name from these results before calling callMcpTool."
          : "Try a different query or provider filter.",
      };
    },
  });

  // Expose a schema-lookup tool so the agent can inspect a tool's inputSchema
  // before calling it. Tool names should come from searchMcpTools or prior context.
  baseTools["getMcpToolSchema"] = tool({
    description:
      "Look up the full schema (name, description, inputSchema) for an MCP tool by exact name. " +
      "Use this when you need to see a tool's required arguments before calling callMcpTool.",
    inputSchema: z.object({
      name: z.string().describe("Exact MCP tool name returned by searchMcpTools or known from prior context"),
    }),
    execute: async ({ name }) => {
      if (Object.keys(externalTools).length === 0) {
        throw new Error("No MCP tools are currently available. Connect an integration first.");
      }
      const resolution = resolveExternalToolName(name, externalTools);
      if (!resolution.ok) {
        const failure = resolution as Extract<typeof resolution, { ok: false }>;
        return failure.suggestions
          ? { errorCode: failure.code, error: failure.error, hint: failure.hint, suggestions: failure.suggestions }
          : { errorCode: failure.code, error: failure.error, hint: failure.hint };
      }
      const t = externalTools[resolution.toolName];
      if (!t) {
        return { errorCode: "tool_not_found", error: `Tool "${name}" not found.`, hint: "Use searchMcpTools to find the right tool name first." };
      }
      return {
        name: resolution.toolName,
        description: t.description ?? `MCP tool: ${resolution.toolName}`,
        isMutating: t.isMutating,
        inputSchema: t.inputSchema,
      };
    },
  });

  const callMcpToolSchema = allowAutoApprove
    ? z.object({
        name: z.string().describe("Exact tool name returned by searchMcpTools or known from prior context"),
        args: z.record(z.string(), z.unknown()).describe("Arguments matching the tool's inputSchema"),
        _autoApprove: z.boolean().optional().describe(
          "Set to true only when creating brand-new content that does not overwrite or delete anything existing, and the action can be easily undone. Leave false or omit for updates, deletes, archives, or any irreversible change."
        ),
      })
    : z.object({
        name: z.string().describe("Exact tool name returned by searchMcpTools or known from prior context"),
        args: z.record(z.string(), z.unknown()).describe("Arguments matching the tool's inputSchema"),
      });

  baseTools["callMcpTool"] = tool({
    description:
      "Execute an MCP integration tool by name. Use getMcpToolSchema first if you need to check the tool's inputSchema.",
    inputSchema: callMcpToolSchema,
    execute: async (input, { toolCallId, abortSignal }) => {
      const { name, args, _autoApprove: autoApprove } = input as {
        name: string;
        args: Record<string, unknown>;
        _autoApprove?: boolean;
      };

      const resolution = resolveExternalToolName(name, externalTools);
      if (resolution.ok === false) {
        return resolution.suggestions
          ? {
            errorCode: resolution.code,
            error: resolution.error,
            hint: resolution.hint,
            suggestions: resolution.suggestions,
          }
          : {
            errorCode: resolution.code,
            error: resolution.error,
            hint: resolution.hint,
          };
      }

      const resolvedName = resolution.toolName;
      const external = externalTools[resolvedName];
      if (!external) {
        return {
          errorCode: "tool_not_found" as const,
          error: `Tool "${resolvedName}" not found.`,
          hint: "Use searchMcpTools to find the exact tool name, then getMcpToolSchema before retrying.",
        };
      }

      const approvalId = `approval:${toolCallId}`;
      const requiresApproval = shouldRequireApproval(
        external.isMutating,
        allowAutoApprove,
        autoApprove,
      );

      if (requiresApproval) {
        const request: AgentToolApprovalRequest = {
          id: approvalId,
          toolName: resolvedName,
          provider: external.provider,
          title: buildApprovalTitle(resolvedName, external.provider),
          summary: "This tool can create, update, or delete external data.",
          input: summarizeApprovalInput(args),
        };

        onStep({
          id: `${approvalId}:requested`,
          kind: "tool-call",
          toolName: resolvedName,
          toolInput: request.input,
          approvalId,
          approvalState: "approval-requested",
          content: `Approval required: ${request.title}`,
          createdAt: Date.now(),
        });

        const approvalResponse = await requestToolApproval(request, {
          toolCallId,
          abortSignal,
        });

        onStep({
          id: `${approvalId}:responded`,
          kind: "tool-result",
          toolName: resolvedName,
          toolInput: request.input,
          approvalId,
          approvalState: "approval-responded",
          approvalApproved: approvalResponse.approved,
          content: approvalResponse.approved ? "Approved by user" : "Rejected by user",
          createdAt: Date.now(),
        });

        if (!approvalResponse.approved) {
          onStep({
            id: `${approvalId}:denied`,
            kind: "tool-result",
            toolName: resolvedName,
            toolInput: request.input,
            approvalId,
            approvalState: "output-denied",
            approvalApproved: false,
            content: "Tool execution denied",
            createdAt: Date.now(),
          });
          return {
            denied: true,
            reason: "User denied this tool execution.",
            errorCode: "tool_denied" as const,
          };
        }
      }

      let output: unknown;
      try {
        output = await external.execute(args, { toolCallId, abortSignal });
      } catch (execError) {
        const message = execError instanceof Error ? execError.message : String(execError);
        return {
          errorCode: classifyToolExecutionError(message),
          error: `Tool "${resolvedName}" failed: ${message}`,
          hint: "Check the tool's inputSchema and fix the arguments, or call askQuestion to ask the user for the required information.",
        };
      }

      if (requiresApproval) {
        onStep({
          id: `${approvalId}:completed`,
          kind: "tool-result",
          toolName: resolvedName,
          toolInput: summarizeApprovalInput(output),
          approvalId,
          approvalState: "output-available",
          approvalApproved: true,
          content: "Tool execution completed",
          createdAt: Date.now(),
        });
      }

      return output;
    },
  });

  return { tools: baseTools, externalTools };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getSearchQuery(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const query = (input as Record<string, unknown>).query;
  return typeof query === "string" ? query.trim() || null : null;
}

function parseAskQuestionInput(input: unknown): AgentQuestionRequest | null {
  const parsed = askQuestionInputSchema.safeParse(input);
  if (!parsed.success) return null;
  return parsed.data;
}

function getAskQuestionAnswerCount(output: unknown): number {
  if (!output || typeof output !== "object") return 0;
  const answers = (output as Record<string, unknown>).answers;
  if (!Array.isArray(answers)) return 0;
  return answers.length;
}

function summarizeToolCall(
  toolName: string,
  input: unknown
): {
  content: string;
  toolInput?: string;
} {
  if (toolName === "searchWeb") {
    const query = getSearchQuery(input);
    if (query) {
      return { content: `Searched: ${query}` };
    }
    return { content: "Searching the web", toolInput: safeJson(input) };
  }

  if (toolName === "getTranscriptContext") {
    return { content: "Reading transcript context" };
  }

  if (toolName === "askQuestion") {
    const request = parseAskQuestionInput(input);
    if (request) {
      const count = request.questions.length;
      return {
        content: `Needs clarification (${count} question${count === 1 ? "" : "s"})`,
        toolInput: safeJson(request),
      };
    }
    return { content: "Needs clarification", toolInput: safeJson(input) };
  }

  if (toolName === "searchTranscriptHistory") {
    const query = getSearchQuery(input);
    return { content: query ? `Searching transcripts: ${query}` : "Searching transcript history" };
  }

  if (toolName === "searchAgentHistory") {
    const query = getSearchQuery(input);
    return { content: query ? `Searching agents: ${query}` : "Searching agent history" };
  }

  if (toolName === "createPlan") {
    const title = (input as Record<string, unknown>)?.title;
    return { content: typeof title === "string" ? `Planning: ${title}` : "Planning" };
  }

  if (toolName === "updateTodos") {
    return { content: "Updating todos" };
  }

  if (toolName === "getMcpToolSchema") {
    const name = (input as Record<string, unknown>)?.name;
    return { content: typeof name === "string" ? `Looking up schema: ${name}` : "Looking up MCP tool schema" };
  }

  if (toolName === "searchMcpTools") {
    const query = typeof (input as Record<string, unknown>)?.query === "string"
      ? (input as Record<string, unknown>).query as string
      : "";
    return { content: query ? `Searching MCP tools: ${query}` : "Searching MCP tools" };
  }

  if (toolName === "callMcpTool") {
    const name = (input as Record<string, unknown>)?.name;
    return { content: typeof name === "string" ? `Calling MCP tool: ${name}` : "Calling MCP tool", toolInput: safeJson(input) };
  }

  return {
    content: `Using ${toolName}`,
    toolInput: safeJson(input),
  };
}

function summarizeToolResult(
  toolName: string,
  input: unknown,
  output: unknown
): {
  content: string;
  toolInput?: string;
} {
  if (toolName === "searchWeb") {
    const query = getSearchQuery(input);
    if (query) {
      return { content: `Searched: ${query}` };
    }
    return { content: "Search complete" };
  }

  if (toolName === "getTranscriptContext") {
    return { content: "Loaded transcript context" };
  }

  if (toolName === "askQuestion") {
    const count = getAskQuestionAnswerCount(output);
    return {
      content:
        count > 0
          ? `Clarification received (${count} answered)`
          : "Clarification received",
      toolInput: safeJson(output),
    };
  }

  if (toolName === "createPlan") {
    return { content: "Plan created" };
  }

  if (toolName === "updateTodos") {
    return { content: "Todos updated" };
  }

  if (toolName === "searchTranscriptHistory") {
    const results = Array.isArray(output) ? output : [];
    return { content: `Found ${results.length} transcript${results.length === 1 ? "" : "s"}` };
  }

  if (toolName === "searchAgentHistory") {
    const results = Array.isArray(output) ? output : [];
    return { content: `Found ${results.length} agent result${results.length === 1 ? "" : "s"}` };
  }

  if (toolName === "getMcpToolSchema") {
    const record = asObject(output);
    const name = record && typeof record.name === "string" ? record.name : null;
    return { content: name ? `Schema loaded: ${name}` : "Schema lookup complete" };
  }

  if (toolName === "searchMcpTools") {
    const record = asObject(output);
    const results = Array.isArray(record?.results) ? record.results : [];
    return { content: `Found ${results.length} MCP tool${results.length === 1 ? "" : "s"}` };
  }

  if (toolName === "callMcpTool") {
    const name = (input as Record<string, unknown>)?.name;
    const label = typeof name === "string" ? name : "MCP tool";
    const status = getMcpCallResultStatus(output);
    if (status === "error") {
      const errorText = getMcpCallResultErrorText(output);
      return {
        content: `${label} failed`,
        toolInput: errorText || safeJson(output),
      };
    }
    if (status === "denied") {
      return { content: `${label} denied`, toolInput: safeJson(output) };
    }
    return { content: `${label} complete`, toolInput: safeJson(output) };
  }

  return {
    content: `${toolName} complete`,
    toolInput: safeJson(output),
  };
}

/**
 * Run agent with an initial prompt (first turn).
 */
export async function runAgent(agent: Agent, deps: AgentDeps): Promise<void> {
  const initialPrompt = buildAgentInitialUserPrompt(
    agent.task,
    agent.taskContext
  );
  const inputMessages: ModelMessage[] = [
    { role: "user", content: initialPrompt },
  ];
  await runAgentWithMessages(agent, inputMessages, deps);
}

/**
 * Continue an agent conversation with existing messages + a new user question.
 */
export async function continueAgent(
  agent: Agent,
  previousMessages: ModelMessage[],
  followUpQuestion: string,
  deps: AgentDeps
): Promise<void> {
  const inputMessages: ModelMessage[] = [
    ...previousMessages,
    { role: "user", content: followUpQuestion },
  ];
  await runAgentWithMessages(agent, inputMessages, deps);
}

async function runAgentWithMessages(
  agent: Agent,
  inputMessages: ModelMessage[],
  deps: AgentDeps
): Promise<void> {
  const {
    model,
    exa,
    getTranscriptContext,
    projectInstructions,
    agentsMd,
    responseLength,
    searchTranscriptHistory,
    searchAgentHistory,
    getExternalTools,
    allowAutoApprove,
    requestClarification,
    requestToolApproval,
    requestPlanApproval,
    onStep,
    onStepFinish,
    onComplete,
    onFail,
    abortSignal,
  } = deps;

  let streamError: string | null = null;

  try {
    const { tools } = await buildTools(
      exa,
      getTranscriptContext,
      requestClarification,
      requestToolApproval,
      requestPlanApproval,
      onStep,
      allowAutoApprove,
      agent.steps,
      getExternalTools,
      searchTranscriptHistory,
      searchAgentHistory,
    );
    const systemPrompt = buildSystemPrompt(
      getTranscriptContext(),
      projectInstructions,
      agentsMd,
      responseLength,
    );

    // Track consecutive tool errors to circuit-break runaway retries
    let consecutiveToolErrors = 0;

    const result = streamText({
      model,
      system: systemPrompt,
      messages: inputMessages,
      maxRetries: STREAM_MAX_RETRIES,
      timeout: { stepMs: STEP_TIMEOUT_MS, chunkMs: CHUNK_TIMEOUT_MS },
      stopWhen: stepCountIs(20),
      abortSignal,
      tools,
      onStepFinish: (stepResult) => {
        // Track consecutive tool errors for circuit-breaking
        const hasToolError = stepResult.finishReason === "tool-calls" &&
          stepResult.toolCalls?.some((tc: { toolName: string }) => {
            for (let i = agent.steps.length - 1; i >= 0; i--) {
              const s = agent.steps[i];
              if (s.toolName === tc.toolName && s.kind === "tool-result") {
                return s.content.includes("failed");
              }
            }
            return false;
          });
        if (hasToolError) {
          consecutiveToolErrors += 1;
          if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
            log("WARN", `Agent ${agent.id}: ${consecutiveToolErrors} consecutive tool errors, stopping`);
          }
        } else {
          consecutiveToolErrors = 0;
        }

        onStepFinish?.({
          usage: stepResult.usage,
          finishReason: stepResult.finishReason,
          toolCalls: stepResult.toolCalls?.map((tc: { toolName: string }) => ({ toolName: tc.toolName })),
        });
      },
      prepareStep: ({ stepNumber, messages: stepMessages }) => {
        // Circuit-break on consecutive tool errors
        if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
          return { toolChoice: "none" as const };
        }
        // Trim large tool results after step 5 to prevent context overflow
        if (stepNumber > 5 && stepMessages.length > 15) {
          const trimmed: ModelMessage[] = stepMessages.map((msg) => {
            if (msg.role !== "tool") return msg;
            const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            if (content.length <= 2000) return msg;
            // Replace tool content with a truncated version to stay within context limits
            return {
              role: "tool" as const,
              content: [{ type: "tool-result" as const, toolCallId: "trimmed", toolName: "trimmed", output: { type: "text" as const, value: content.slice(0, 2000) + "\n...(truncated)" } }],
            };
          });
          return { messages: trimmed };
        }
        return {};
      },
      onError: ({ error }) => {
        streamError = error instanceof Error ? error.message : String(error);
      },
      onAbort: () => {
        onFail("Cancelled", inputMessages);
      },
    });

    const streamedAt = Date.now();
    // Per-run prefix ensures step IDs are unique across runs (initial + follow-ups).
    // stepIndex increments on each start-step to avoid ID collisions when providers
    // reuse the same part.id across agentic steps within a single streamText call.
    const runPrefix = `${streamedAt}`;
    let stepIndex = 0;
    let textStepId: string | null = null;
    let streamedText = "";
    let lastNonEmptyText = ""; // survives start-step resets; used as finalText fallback
    let deltaCount = 0;
    let firstDeltaAfterMs: number | null = null;
    const reasoningById = new Map<string, string>();

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          deltaCount += 1;
          firstDeltaAfterMs ??= Date.now() - streamedAt;
          streamedText += part.text;
          textStepId = `text:${runPrefix}:${stepIndex}:${part.id}`;
          onStep({
            id: textStepId,
            kind: "text",
            content: streamedText,
            createdAt: streamedAt,
          });
          break;
        }
        case "reasoning-start": {
          const reasoningStepId = `reasoning:${runPrefix}:${stepIndex}:${part.id}`;
          onStep({
            id: reasoningStepId,
            kind: "thinking",
            content: "Thinking...",
            createdAt: Date.now(),
          });
          break;
        }
        case "reasoning-delta": {
          const reasoningStepId = `reasoning:${runPrefix}:${stepIndex}:${part.id}`;
          const next = `${reasoningById.get(reasoningStepId) ?? ""}${part.text}`;
          reasoningById.set(reasoningStepId, next);
          onStep({
            id: reasoningStepId,
            kind: "thinking",
            content: next.trim() || "Thinking...",
            createdAt: Date.now(),
          });
          break;
        }
        case "tool-call": {
          // createPlan/updateTodos emit their own steps; skip redundant tool-call.
          if (part.toolName === "createPlan" || part.toolName === "updateTodos") break;
          const { content, toolInput } = summarizeToolCall(
            part.toolName,
            part.input
          );
          const toolStepId = `tool:${part.toolCallId}`;
          onStep({
            id: toolStepId,
            kind: "tool-call",
            content,
            toolName: part.toolName,
            toolInput,
            createdAt: Date.now(),
          });
          break;
        }
        case "tool-result": {
          if (part.preliminary) break;
          // createPlan/updateTodos emit their own steps; skip redundant tool-result.
          if (part.toolName === "createPlan" || part.toolName === "updateTodos") break;
          const { content, toolInput } = summarizeToolResult(
            part.toolName,
            part.input,
            part.output
          );
          const toolStepId = `tool:${part.toolCallId}`;
          onStep({
            id: toolStepId,
            kind: "tool-result",
            content,
            toolName: part.toolName,
            toolInput,
            createdAt: Date.now(),
          });
          break;
        }
        case "tool-error": {
          const toolStepId = `tool:${part.toolCallId}`;
          const errorMessage = part.error instanceof Error ? part.error.message : safeJson(part.error);
          // For askQuestion, preserve the original tool-call step so the question
          // card stays visible even if the tool execution errors (e.g. agent
          // cancelled/failed while waiting for user input).
          const stepId = part.toolName === "askQuestion"
            ? `${toolStepId}:error`
            : toolStepId;
          onStep({
            id: stepId,
            kind: "tool-result",
            content: `${part.toolName} failed: ${errorMessage}`,
            toolName: part.toolName,
            toolInput: errorMessage,
            createdAt: Date.now(),
          });
          break;
        }
        case "tool-output-denied": {
          const toolStepId = `tool:${part.toolCallId}`;
          onStep({
            id: toolStepId,
            kind: "tool-result",
            content: `${part.toolName} denied`,
            toolName: part.toolName,
            toolInput: safeJson(part),
            approvalState: "output-denied",
            approvalApproved: false,
            createdAt: Date.now(),
          });
          break;
        }
        case "start-step": {
          // Preserve last step's text before resetting for the new step
          if (streamedText) lastNonEmptyText = streamedText;
          streamedText = "";
          textStepId = null;
          stepIndex += 1;
          break;
        }
        case "abort": {
          return;
        }
        default: {
          break;
        }
      }
    }

    // If onError captured an error but the stream didn't throw, surface it now
    if (streamError) {
      onFail(normalizeProviderErrorMessage(streamError), inputMessages);
      return;
    }

    // result.text resolves to the last step's text only (SDK design).
    // Fall back to lastNonEmptyText so tool-only final steps don't clobber earlier output.
    if (streamedText) lastNonEmptyText = streamedText;
    const lastStepText = (await result.text).trim();
    const finalText = lastStepText || lastNonEmptyText || "No results found.";

    // Only emit the final text step if result.text has content — it finalises the
    // last streamed text block. If the final step was tool-only, streaming already
    // emitted the correct content and we don't need to overwrite anything.
    if (lastStepText && textStepId) {
      onStep({
        id: textStepId,
        kind: "text",
        content: lastStepText,
        createdAt: streamedAt,
      });
    }

    // Build full conversation history for future follow-ups
    const response = await result.response;
    const fullHistory = [...inputMessages, ...response.messages];

    log(
      "INFO",
      `Agent stream ${agent.id}: deltas=${deltaCount}, firstDeltaMs=${firstDeltaAfterMs ?? -1}, totalMs=${Date.now() - streamedAt}`
    );
    onComplete(finalText, fullHistory);
  } catch (error) {
    // streamError has the real provider error (e.g. rate limit). NoOutputGeneratedError
    // is the SDK wrapper thrown when the stream ends with no steps recorded.
    const rawMessage = streamError ?? (error instanceof Error ? error.message : String(error));
    const message = normalizeProviderErrorMessage(rawMessage);
    onFail(message, inputMessages);
  }
}
