import path from "node:path";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import type {
  AgentTool,
  AgentToolResult,
} from "@mariozechner/pi-agent-core";
// @mariozechner/pi-coding-agent is externalized in vite.main.config.ts
// (pulls in native WASM + a large TUI dep graph). Electron resolves it from
// node_modules at runtime, and because it's ESM-only we load it via dynamic
// `import()` inside buildAgentTools() rather than a static import here.
import type {
  AgentStep,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentTodoItem,
  ProviderTaskEvent,
} from "../types";
import type { AgentExternalToolSet } from "./external-tools";
import type { SkillMetadata } from "./skills";
import { loadSkillContent } from "./skills";
import {
  rankExternalTools,
  resolveExternalToolName,
} from "./mcp-tool-resolution";
import { buildRunJsTool } from "./run-js-tool";
import { log } from "../logger";

/**
 * Tools that affect the user's machine (writes, shells out, evaluates code).
 * These always go through the approval flow — no auto-approve.
 * Kept in sync with the gate in `agent.ts:beforeToolCall`.
 */
export const DESTRUCTIVE_LOCAL_TOOLS = new Set([
  "write",
  "edit",
  "bash",
  "runJs",
]);

type ExaClient = {
  search: (
    query: string,
    options: Record<string, unknown>,
  ) => Promise<{
    results: Array<{ title: string; url: string; text?: string }>;
  }>;
};

export type AgentToolDeps = {
  exa?: ExaClient | null;
  getTranscriptContext: (
    last?: number,
    offset?: number,
  ) => { blocks: string; returned: number; total: number; remaining: number };
  searchTranscriptHistory?: (query: string, limit?: number) => unknown[];
  searchAgentHistory?: (query: string, limit?: number) => unknown[];
  getExternalTools?: () => Promise<AgentExternalToolSet>;
  getCodexClient?: import("./codex-client").GetCodexClient;
  getClaudeClient?: import("./claude-client").GetClaudeClient;
  emitProviderTaskEvent?: (event: ProviderTaskEvent) => void;
  enabledSkills?: SkillMetadata[];
  getFleetStatus?: () => {
    agents: Array<{ id: string; task: string; status: import("../types").AgentStatus; isYou: boolean }>;
    tasks: Array<{ id: string; text: string; completed: boolean; size: import("../types").TaskSize }>;
  };
  allowAutoApprove: boolean;
  /** Root directory local coding tools (read/write/edit/bash/…) operate from. */
  localWorkspaceCwd?: string;
  /** Feature flags for the local coding tools. */
  localTools: {
    files: boolean;
    bash: boolean;
    runJs: boolean;
  };
  requestClarification: (
    request: AgentQuestionRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ) => Promise<AgentQuestionSelection[]>;
  requestPlanApproval: (
    request: import("../types").AgentPlanApprovalRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ) => Promise<import("../types").AgentPlanApprovalResponse>;
  onStep: (step: AgentStep) => void;
  existingSteps: ReadonlyArray<AgentStep>;
  agentId: string;
};

export type BuildToolsResult = {
  tools: AgentTool<TSchema>[];
  externalTools: AgentExternalToolSet;
  codexRegistered: boolean;
  claudeRegistered: boolean;
};

/** Wrap an arbitrary JSON result as a pi-mono AgentToolResult. */
function jsonResult<T>(value: T): AgentToolResult<T> {
  return {
    content: [{ type: "text", text: safeStringify(value) }],
    details: value,
  };
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// TypeBox schemas --------------------------------------------------------

const QuerySchema = Type.Object({
  query: Type.String({ description: "The search query" }),
});

const TranscriptContextSchema = Type.Object({
  last: Type.Optional(
    Type.Number({ description: "Number of most recent blocks to return (default 10)" }),
  ),
  offset: Type.Optional(
    Type.Number({ description: "Skip this many blocks from the end to page backwards (default 0)" }),
  ),
});

const FleetStatusSchema = Type.Object({});

const AskQuestionSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  questions: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1 }),
      prompt: Type.String({ minLength: 1 }),
      options: Type.Array(
        Type.Object({
          id: Type.String({ minLength: 1 }),
          label: Type.String({ minLength: 1 }),
        }),
        { minItems: 2, maxItems: 8 },
      ),
      allow_multiple: Type.Optional(Type.Boolean()),
    }),
    { minItems: 1, maxItems: 3 },
  ),
});

const CreatePlanSchema = Type.Object({
  title: Type.String({
    description: "Brief plan title (imperative, e.g. 'Analyze the quarterly report')",
  }),
  content: Type.String({
    description: "Markdown plan body: approach, key steps, relevant files. Keep it concise and actionable.",
  }),
});

const UpdateTodosSchema = Type.Object({
  merge: Type.Boolean({
    description: "true = update matching IDs and keep the rest, false = replace entire list",
  }),
  todos: Type.Array(
    Type.Object({
      id: Type.String({ description: "Stable identifier (e.g. 'setup-auth'). Reuse across calls." }),
      content: Type.String({ description: "Concrete, actionable description" }),
      status: Type.Union([
        Type.Literal("pending"),
        Type.Literal("in_progress"),
        Type.Literal("completed"),
        Type.Literal("cancelled"),
      ]),
    }),
  ),
});

const SearchWithLimitSchema = Type.Object({
  query: Type.String({ description: "FTS5 keyword query" }),
  limit: Type.Optional(Type.Number({ description: "Max results to return (default 20)" })),
});

const SearchMcpToolsSchema = Type.Object({
  query: Type.Optional(Type.String({ description: "Search query for the tool name or description. Leave empty to browse a provider." })),
  provider: Type.Optional(Type.String({ description: "Optional provider filter, for example notion or linear." })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 10, description: "Maximum number of matches to return. Defaults to 8." }),
  ),
});

const GetMcpToolSchemaSchema = Type.Object({
  name: Type.String({
    description: "Exact MCP tool name returned by searchMcpTools or known from prior context",
  }),
});

const CallMcpToolSchemaWithAuto = Type.Object({
  name: Type.String({ description: "Exact tool name returned by searchMcpTools or known from prior context" }),
  args: Type.Record(Type.String(), Type.Unknown(), {
    description: "Arguments matching the tool's inputSchema",
  }),
  _autoApprove: Type.Optional(Type.Boolean({
    description:
      "Set to true only when creating brand-new content that does not overwrite or delete anything existing, and the action can be easily undone. Leave false or omit for updates, deletes, archives, or any irreversible change.",
  })),
});

const CallMcpToolSchema = Type.Object({
  name: Type.String({ description: "Exact tool name returned by searchMcpTools or known from prior context" }),
  args: Type.Record(Type.String(), Type.Unknown(), {
    description: "Arguments matching the tool's inputSchema",
  }),
});

const CodexSchema = Type.Object({
  prompt: Type.String({ description: "The coding task or question for Codex" }),
  threadId: Type.Optional(Type.String({ description: "Thread ID from a previous codex task to continue the conversation" })),
  workingDirectory: Type.Optional(Type.String({ description: "Working directory for code operations" })),
});

const CodexResultSchema = Type.Object({
  taskId: Type.String({ description: "The taskId returned by the codex tool" }),
});

const ClaudeSchema = Type.Object({
  prompt: Type.String({ description: "The coding task or question for Claude Code" }),
  sessionId: Type.Optional(Type.String({ description: "Session ID from a previous Claude Code task to resume the conversation" })),
  workingDirectory: Type.Optional(Type.String({ description: "Working directory for code operations" })),
});

const ClaudeResultSchema = Type.Object({
  taskId: Type.String({ description: "The taskId returned by the claude tool" }),
});

const LoadSkillSchema = Type.Object({
  name: Type.String({ description: "The name of the skill to load" }),
});

// Tool factory -----------------------------------------------------------

export async function buildAgentTools(deps: AgentToolDeps): Promise<BuildToolsResult> {
  const tools: AgentTool<TSchema>[] = [];

  // --- searchWeb --------------------------------------------------------
  if (deps.exa) {
    const exa = deps.exa;
    tools.push({
      name: "searchWeb",
      label: "Search the web",
      description:
        "Search the web for information when external facts are required. Use specific, targeted queries.",
      parameters: QuerySchema,
      execute: async (_id, { query }) => {
        try {
          const results = await exa.search(query, {
            type: "auto",
            numResults: 10,
            contents: { text: { maxCharacters: 1500 } },
          });
          return jsonResult(results.results);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log("WARN", `searchWeb failed: ${message}`);
          return jsonResult({
            error: message,
            hint: "Web search is temporarily unavailable. Continue with available context, or ask the user if they want to proceed without web search.",
          });
        }
      },
    });
  }

  // --- getTranscriptContext --------------------------------------------
  tools.push({
    name: "getTranscriptContext",
    label: "Read transcript context",
    description:
      "Read transcript blocks from the current conversation. Returns blocks plus metadata (returned, total, remaining) for pagination.",
    parameters: TranscriptContextSchema,
    execute: async (_id, { last, offset }: Static<typeof TranscriptContextSchema>) => {
      return jsonResult(deps.getTranscriptContext(last, offset));
    },
  });

  // --- getFleetStatus --------------------------------------------------
  if (deps.getFleetStatus) {
    const fleetStatusFn = deps.getFleetStatus;
    tools.push({
      name: "getFleetStatus",
      label: "Check fleet status",
      description:
        "Get current status of all agents in this session and the session task list. Use to understand what other agents are working on and avoid duplicate effort.",
      parameters: FleetStatusSchema,
      execute: async () => jsonResult(fleetStatusFn()),
    });
  }

  // --- askQuestion -----------------------------------------------------
  tools.push({
    name: "askQuestion",
    label: "Ask clarification",
    description:
      "Ask the user one or more multiple-choice clarification questions when intent is ambiguous. Wait for human responses before continuing.",
    parameters: AskQuestionSchema,
    execute: async (toolCallId, input: Static<typeof AskQuestionSchema>, signal) => {
      const answers = await deps.requestClarification(input, {
        toolCallId,
        abortSignal: signal,
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
      return jsonResult({
        title: input.title,
        questions: input.questions,
        answers: enrichedAnswers,
      });
    },
  });

  // Stable IDs for plan/todo steps — use UUIDs to avoid collision on relaunch
  const planStepId = `plan:${crypto.randomUUID()}`;
  const todoStepId = `todo:${crypto.randomUUID()}`;

  // Restore todos from previous turns so merge works across follow-ups
  let currentTodos: AgentTodoItem[] = (() => {
    for (let i = deps.existingSteps.length - 1; i >= 0; i--) {
      const step = deps.existingSteps[i];
      if (step.kind === "todo" && step.todoItems && step.todoItems.length > 0) {
        return [...step.todoItems];
      }
    }
    return [];
  })();

  // --- createPlan (keeps inline approval; plan content must exist first)
  tools.push({
    name: "createPlan",
    label: "Create plan",
    description: [
      "Create a plan document visible to the user as a collapsible card.",
      "Use for non-trivial tasks after investigation but before execution.",
      "After calling this tool, STOP and wait for the user to approve or reject the plan.",
      "The user may approve, reject, or provide feedback to revise the plan.",
      "Do NOT proceed with execution until the plan is approved.",
      "If rejected with feedback, revise and call createPlan again with the updated plan.",
      "Do NOT use for simple questions, quick lookups, or single-step tasks.",
    ].join("\n"),
    parameters: CreatePlanSchema,
    execute: async (toolCallId, { title, content }: Static<typeof CreatePlanSchema>, signal) => {
      const approvalId = `plan-approval:${planStepId}`;

      deps.onStep({
        id: planStepId,
        kind: "plan",
        content: title,
        planTitle: title,
        planContent: content,
        planApprovalState: "awaiting-approval",
        createdAt: Date.now(),
      });

      const response = await deps.requestPlanApproval(
        { id: approvalId, title, content },
        { toolCallId, abortSignal: signal },
      );

      deps.onStep({
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
        return jsonResult("Plan approved by user. Proceed with execution.");
      }

      const feedbackNote = response.feedback
        ? ` User feedback: "${response.feedback}". Revise the plan based on this feedback and call createPlan again.`
        : " Revise your approach and call createPlan again with an updated plan.";
      return jsonResult(`Plan rejected by user.${feedbackNote}`);
    },
  });

  // --- updateTodos -----------------------------------------------------
  tools.push({
    name: "updateTodos",
    label: "Update todos",
    description: [
      "Create or update a todo checklist for tracking progress on multi-step work.",
      "merge=false (default): replaces all todos with the provided list.",
      "merge=true: updates only the todos with matching IDs, keeps the rest unchanged. New IDs are appended.",
      "Only ONE todo should be 'in_progress' at a time.",
      "Mark todos 'completed' immediately after finishing, 'cancelled' if no longer needed.",
      "Do NOT use for single-step or trivial tasks.",
      "",
      "IMPORTANT — UI rendering rule:",
      "When you call this tool the UI renders the full checklist as its own card above your text response.",
      "Therefore do NOT also write the task list in your text response — no markdown table, no bullet list, no 'Here is your updated task list', no restatement of the items.",
      "In your text response, reference the checklist by pointing at it (e.g., 'Updated the checklist — starting with X') and move on to the next step or question. Never duplicate the items in prose.",
    ].join("\n"),
    parameters: UpdateTodosSchema,
    execute: async (_id, { merge, todos }: Static<typeof UpdateTodosSchema>) => {
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

      deps.onStep({
        id: todoStepId,
        kind: "todo",
        content: "Todos updated",
        todoItems: currentTodos,
        createdAt: Date.now(),
      });

      const completed = currentTodos.filter((t) => t.status === "completed").length;
      const inProgress = currentTodos.find((t) => t.status === "in_progress");
      const summary = `Todos: ${completed}/${currentTodos.length} done.` +
        (inProgress ? ` Current: ${inProgress.content}` : "");
      return jsonResult(summary);
    },
  });

  // --- searchTranscriptHistory ----------------------------------------
  if (deps.searchTranscriptHistory) {
    const search = deps.searchTranscriptHistory;
    tools.push({
      name: "searchTranscriptHistory",
      label: "Search transcript history",
      description:
        "Search past transcript blocks by keyword. Use to find specific topics, phrases, or discussions from previous sessions.",
      parameters: SearchWithLimitSchema,
      execute: async (_id, { query, limit }: Static<typeof SearchWithLimitSchema>) =>
        jsonResult(search(query, limit)),
    });
  }

  // --- searchAgentHistory ---------------------------------------------
  if (deps.searchAgentHistory) {
    const search = deps.searchAgentHistory;
    tools.push({
      name: "searchAgentHistory",
      label: "Search agent history",
      description:
        "Search past agent tasks and results by keyword. Use to find what previous agents discovered or decided.",
      parameters: SearchWithLimitSchema,
      execute: async (_id, { query, limit }: Static<typeof SearchWithLimitSchema>) =>
        jsonResult(search(query, limit)),
    });
  }

  // --- MCP tools -------------------------------------------------------
  let externalTools: AgentExternalToolSet = {};
  if (deps.getExternalTools) {
    try {
      externalTools = await deps.getExternalTools();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("WARN", `Failed to load external MCP tools: ${message}`);
      deps.onStep({
        id: `mcp-tools:error:${Date.now()}`,
        kind: "tool-result",
        content: `MCP tools unavailable: ${message}`,
        toolName: "mcp",
        createdAt: Date.now(),
      });
    }
  }

  if (deps.getExternalTools) {
    tools.push({
      name: "searchMcpTools",
      label: "Search MCP tools",
      description:
        "Search connected MCP tools by name or description. Use this first to find the right tool without loading the full MCP catalog into context.",
      parameters: SearchMcpToolsSchema,
      execute: async (_id, { query, provider, limit }: Static<typeof SearchMcpToolsSchema>) => {
        if (Object.keys(externalTools).length === 0) {
          return jsonResult({
            errorCode: "no_tools_available",
            error: "No MCP tools are currently available.",
            hint: "Connect an MCP integration first.",
            results: [],
          });
        }
        const providerFilter = provider?.trim().toLowerCase();
        const filteredTools = providerFilter
          ? Object.fromEntries(
              Object.entries(externalTools).filter(([, tool]) => tool.provider.toLowerCase() === providerFilter),
            )
          : externalTools;
        const maxResults = limit ?? 8;
        const ranked = rankExternalTools(query?.trim() ?? "", filteredTools, maxResults);
        return jsonResult({
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
        });
      },
    });

    tools.push({
      name: "getMcpToolSchema",
      label: "Get MCP tool schema",
      description:
        "Look up the full schema (name, description, inputSchema) for an MCP tool by exact name. Use this when you need to see a tool's required arguments before calling callMcpTool.",
      parameters: GetMcpToolSchemaSchema,
      execute: async (_id, { name }: Static<typeof GetMcpToolSchemaSchema>) => {
        if (Object.keys(externalTools).length === 0) {
          throw new Error("No MCP tools are currently available. Connect an integration first.");
        }
        const resolution = resolveExternalToolName(name, externalTools);
        if (!resolution.ok) {
          const failure = resolution as Extract<typeof resolution, { ok: false }>;
          return jsonResult(
            failure.suggestions
              ? { errorCode: failure.code, error: failure.error, hint: failure.hint, suggestions: failure.suggestions }
              : { errorCode: failure.code, error: failure.error, hint: failure.hint },
          );
        }
        const t = externalTools[resolution.toolName];
        if (!t) {
          return jsonResult({
            errorCode: "tool_not_found",
            error: `Tool "${name}" not found.`,
            hint: "Use searchMcpTools to find the right tool name first.",
          });
        }
        return jsonResult({
          name: resolution.toolName,
          description: t.description ?? `MCP tool: ${resolution.toolName}`,
          isMutating: t.isMutating,
          inputSchema: t.inputSchema,
        });
      },
    });

    // callMcpTool: approval is handled in beforeToolCall hook, not here.
    const callMcpSchema: TSchema = deps.allowAutoApprove ? CallMcpToolSchemaWithAuto : CallMcpToolSchema;
    tools.push({
      name: "callMcpTool",
      label: "Call MCP tool",
      description:
        "Execute an MCP integration tool by name. Use getMcpToolSchema first if you need to check the tool's inputSchema.",
      parameters: callMcpSchema,
      executionMode: "sequential",
      execute: async (toolCallId, input, signal) => {
        const { name, args } = input as { name: string; args: Record<string, unknown> };
        const resolution = resolveExternalToolName(name, externalTools);
        if (resolution.ok === false) {
          return jsonResult(
            resolution.suggestions
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
                },
          );
        }
        const external = externalTools[resolution.toolName];
        if (!external) {
          return jsonResult({
            errorCode: "tool_not_found" as const,
            error: `Tool "${resolution.toolName}" not found.`,
            hint: "Use searchMcpTools to find the exact tool name, then getMcpToolSchema before retrying.",
          });
        }
        try {
          const output = await external.execute(args, { toolCallId, abortSignal: signal });
          return jsonResult(output);
        } catch (execError) {
          const message = execError instanceof Error ? execError.message : String(execError);
          const errorCode = /missing|required|invalid|argument|parameter|schema|input/i.test(message)
            ? "missing_or_invalid_args"
            : "tool_execution_failed";
          return jsonResult({
            errorCode,
            error: `Tool "${resolution.toolName}" failed: ${message}`,
            hint: "Check the tool's inputSchema and fix the arguments, or call askQuestion to ask the user for the required information.",
          });
        }
      },
    });
  }

  // --- codex + codexResult --------------------------------------------
  let codexRegistered = false;
  const codexClient = deps.getCodexClient?.();
  if (codexClient?.isConnected) {
    codexRegistered = true;
    log("INFO", "Registering codex + codexResult tools in agent toolset");

    const agentId = deps.agentId;
    const emitProviderTaskEvent = deps.emitProviderTaskEvent;

    tools.push({
      name: "codex",
      label: "Dispatch to Codex",
      description:
        "Dispatch a coding task to OpenAI Codex, a background coding agent CLI. " +
        "This is the ONLY coding agent available in this session — route any user request to write, edit, review, or explore code here, even if the user named a different coding agent. " +
        "Returns a taskId and threadId immediately; the user watches a live inline viewer in the UI that streams Codex's commands, file changes, and reasoning. " +
        "Do NOT call codexResult automatically — only call it if the user explicitly asks about the status.",
      parameters: CodexSchema,
      execute: async (toolCallId, { prompt, threadId, workingDirectory }: Static<typeof CodexSchema>, signal) => {
        const { taskId, threadId: newThreadId } = await codexClient.startTask(prompt, {
          threadId,
          workingDirectory,
          onEvent: emitProviderTaskEvent,
          toolCallId,
          agentId,
        });
        if (signal) {
          signal.addEventListener("abort", () => codexClient.cancelTask(taskId), { once: true });
        }
        return jsonResult({
          taskId,
          threadId: newThreadId,
          status: "running" as const,
          hint: "Task dispatched. The user can see live progress in the UI. Tell the user Codex is working on it and continue the conversation. Do NOT call codexResult unless the user explicitly asks.",
        });
      },
    });

    tools.push({
      name: "codexResult",
      label: "Read Codex result",
      description:
        "Read the current state of a previously started Codex task. Only call this when the user explicitly asks about the status or result of a Codex task. Returns immediately with a snapshot.",
      parameters: CodexResultSchema,
      execute: async (_id, { taskId }: Static<typeof CodexResultSchema>) => {
        const status = codexClient.getSnapshot(taskId);
        if (status.status === "completed" && status.result) {
          return jsonResult({
            status: "completed" as const,
            threadId: status.result.threadId,
            response: status.result.result,
            progress: status.progress,
            hint: "Task complete. Use the threadId in a new codex call for follow-up turns.",
          });
        }
        if (status.status === "failed") {
          return jsonResult({
            status: "failed" as const,
            error: status.error,
            progress: status.progress,
          });
        }
        if (status.status === "cancelled") {
          return jsonResult({
            status: "cancelled" as const,
            progress: status.progress,
          });
        }
        if (status.status === "not_found") {
          return jsonResult({
            status: "not_found" as const,
            error: "No task found with that taskId. Start a new task with the codex tool.",
          });
        }
        return jsonResult({
          status: "running" as const,
          progress: status.progress,
          hint: "Task is still running. Tell the user it's still in progress — do not call this tool again unless they ask.",
        });
      },
    });
  }

  // --- claude + claudeResult ------------------------------------------
  let claudeRegistered = false;
  const claudeClient = deps.getClaudeClient?.();
  if (claudeClient?.isConnected) {
    claudeRegistered = true;
    log("INFO", "Registering claude + claudeResult tools in agent toolset");

    const agentId = deps.agentId;
    const emitProviderTaskEvent = deps.emitProviderTaskEvent;

    tools.push({
      name: "claude",
      label: "Dispatch to Claude Code",
      description:
        "Dispatch a coding task to Claude Code, a SEPARATE background coding agent CLI subprocess. " +
        "CRITICAL: This tool is NOT you — do NOT skip it and attempt the coding work yourself. The claude CLI runs in its own process, has its own tools, and writes files independently. You MUST call this tool when the user asks for any coding work. " +
        "This is the ONLY coding agent available in this session — route any user request to write, edit, review, or explore code here, even if the user named a different coding agent. " +
        "Returns a taskId and sessionId immediately; the user watches a live inline viewer in the UI that streams Claude Code's tool calls and messages. " +
        "Do NOT call claudeResult automatically — only call it if the user explicitly asks about the status.",
      parameters: ClaudeSchema,
      execute: async (toolCallId, { prompt, sessionId, workingDirectory }: Static<typeof ClaudeSchema>, signal) => {
        const { taskId, sessionId: newSessionId } = await claudeClient.startTask(prompt, {
          sessionId,
          workingDirectory,
          onEvent: emitProviderTaskEvent,
          toolCallId,
          agentId,
        });
        if (signal) {
          signal.addEventListener("abort", () => claudeClient.cancelTask(taskId), { once: true });
        }
        return jsonResult({
          taskId,
          sessionId: newSessionId,
          status: "running" as const,
          hint: "Task dispatched. The user can see live progress in the UI. Tell the user Claude Code is working on it and continue the conversation. Do NOT call claudeResult unless the user explicitly asks.",
        });
      },
    });

    tools.push({
      name: "claudeResult",
      label: "Read Claude Code result",
      description:
        "Read the current state of a previously started Claude Code task. Only call this when the user explicitly asks about the status or result of a Claude Code task. Returns immediately with a snapshot.",
      parameters: ClaudeResultSchema,
      execute: async (_id, { taskId }: Static<typeof ClaudeResultSchema>) => {
        const status = claudeClient.getSnapshot(taskId);
        if (status.status === "completed" && status.result) {
          return jsonResult({
            status: "completed" as const,
            sessionId: status.result.sessionId,
            response: status.result.result,
            progress: status.progress,
            hint: "Task complete. Use the sessionId in a new claude call for follow-up turns.",
          });
        }
        if (status.status === "failed") {
          return jsonResult({
            status: "failed" as const,
            error: status.error,
            progress: status.progress,
          });
        }
        if (status.status === "cancelled") {
          return jsonResult({
            status: "cancelled" as const,
            progress: status.progress,
          });
        }
        if (status.status === "not_found") {
          return jsonResult({
            status: "not_found" as const,
            error: "No task found with that taskId. Start a new task with the claude tool.",
          });
        }
        return jsonResult({
          status: "running" as const,
          progress: status.progress,
          hint: "Task is still running. Tell the user it's still in progress — do not call this tool again unless they ask.",
        });
      },
    });
  }

  // --- loadSkill -------------------------------------------------------
  if (deps.enabledSkills && deps.enabledSkills.length > 0) {
    const skills = deps.enabledSkills;
    tools.push({
      name: "loadSkill",
      label: "Load skill",
      description:
        "Load full instructions for an installed skill. Use this when a skill's expertise is relevant to your current task.",
      parameters: LoadSkillSchema,
      execute: async (_id, { name }: Static<typeof LoadSkillSchema>) => {
        const skill = skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (!skill) {
          return jsonResult({
            error: `Skill "${name}" not found. Available: ${skills.map((s) => s.name).join(", ")}`,
          });
        }
        const content = loadSkillContent(skill.filePath);
        const skillDir = path.dirname(skill.filePath);
        return jsonResult({ name: skill.name, content, directory: skillDir });
      },
    });
  }

  // --- Local coding tools (read/write/edit/bash/grep/find/ls) -----------
  // Source: @mariozechner/pi-coding-agent. Destructive ones
  // (write/edit/bash) are gated by beforeToolCall in agent.ts — they always
  // require explicit user approval, never auto-approve.
  const cwd = deps.localWorkspaceCwd ?? process.cwd();
  const needsCodingAgent = deps.localTools.files || deps.localTools.bash;
  if (needsCodingAgent) {
    const {
      createReadTool,
      createWriteTool,
      createEditTool,
      createBashTool,
      createGrepTool,
      createFindTool,
      createLsTool,
    } = await import("@mariozechner/pi-coding-agent");
    if (deps.localTools.files) {
      tools.push(
        createReadTool(cwd) as AgentTool<TSchema>,
        createLsTool(cwd) as AgentTool<TSchema>,
        createGrepTool(cwd) as AgentTool<TSchema>,
        createFindTool(cwd) as AgentTool<TSchema>,
        createWriteTool(cwd) as AgentTool<TSchema>,
        createEditTool(cwd) as AgentTool<TSchema>,
      );
    }
    if (deps.localTools.bash) {
      tools.push(createBashTool(cwd) as AgentTool<TSchema>);
    }
  }

  // --- runJs (sandboxed JS execution via secure-exec V8 isolate) ---------
  if (deps.localTools.runJs) {
    tools.push(buildRunJsTool(cwd) as AgentTool<TSchema>);
  }

  return { tools, externalTools, codexRegistered, claudeRegistered };
}
