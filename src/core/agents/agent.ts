import {
  Agent as PiAgent,
  type AgentEvent as PiAgentEvent,
  type AgentMessage as PiAgentMessage,
} from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
} from "@mariozechner/pi-ai";
import type {
  AgentStep,
  Agent,
  AgentStatus,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentToolApprovalRequest,
  AgentToolApprovalResponse,
  AgentPlanApprovalRequest,
  AgentPlanApprovalResponse,
  ProviderTaskEvent,
  TaskSize,
} from "../types";
import { log } from "../logger";
import {
  getAgentInitialUserPromptTemplate,
  getAgentSystemPromptTemplate,
  getClaudeInstructions,
  getCodexInstructions,
  getCodingAgentIdentityInstructions,
  renderPromptTemplate,
} from "../prompt-loader";
import { normalizeProviderErrorMessage } from "../text/text-utils";
import type { AgentExternalToolSet } from "./external-tools";
import type { SkillMetadata } from "./skills";
import {
  resolveExternalToolName,
  shouldRequireApproval,
} from "./mcp-tool-resolution";
import { buildAgentTools, DESTRUCTIVE_LOCAL_TOOLS } from "./tools";
import type { AgentPiModel } from "../providers";

type ExaClient = {
  search: (
    query: string,
    options: Record<string, unknown>,
  ) => Promise<{
    results: Array<{ title: string; url: string; text?: string }>;
  }>;
};

export type AgentDeps = {
  model: AgentPiModel;
  exa?: ExaClient | null;
  getTranscriptSummary: () => string;
  getTranscriptContext: (last?: number, offset?: number) => { blocks: string; returned: number; total: number; remaining: number };
  projectInstructions?: string;
  agentsMd?: string;
  responseLength?: import("../types").ResponseLength;
  searchTranscriptHistory?: (query: string, limit?: number) => unknown[];
  searchAgentHistory?: (query: string, limit?: number) => unknown[];
  getExternalTools?: () => Promise<AgentExternalToolSet>;
  getCodexClient?: import("./codex-client").GetCodexClient;
  getClaudeClient?: import("./claude-client").GetClaudeClient;
  emitProviderTaskEvent?: (event: ProviderTaskEvent) => void;
  enabledSkills?: SkillMetadata[];
  getFleetStatus?: () => {
    agents: Array<{ id: string; task: string; status: AgentStatus; isYou: boolean }>;
    tasks: Array<{ id: string; text: string; completed: boolean; size: TaskSize }>;
  };
  allowAutoApprove: boolean;
  /** Working directory for local coding tools (read/write/edit/bash/runJs). Defaults to process.cwd(). */
  localWorkspaceCwd?: string;
  /** Feature flags for the local coding tools. */
  localTools: {
    files: boolean;
    bash: boolean;
    runJs: boolean;
  };
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
  onStepFinish?: (info: { finishReason: string; toolCalls?: Array<{ toolName: string }> }) => void;
  onComplete: (result: string, messages: Message[]) => void;
  onFail: (error: string, messages?: Message[]) => void;
  abortSignal?: AbortSignal;
};

const MAX_CONSECUTIVE_TOOL_ERRORS = 3;
const MAX_AGENT_TURNS = 20;

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
  codexEnabled?: boolean,
  claudeEnabled?: boolean,
  enabledSkills?: SkillMetadata[],
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

  if (codexEnabled || claudeEnabled) {
    sections.push(getCodingAgentIdentityInstructions());
  }

  if (codexEnabled) {
    sections.push(getCodexInstructions());
  }

  if (claudeEnabled) {
    sections.push(getClaudeInstructions());
  }

  if (enabledSkills && enabledSkills.length > 0) {
    const skillLines = enabledSkills.map(
      (s) => `- **${s.name}**: ${s.description}`,
    );
    sections.push(
      "## Available Skills\n\n" +
        "You have access to the following skills. Use the loadSkill tool to load full instructions for a skill when its expertise is relevant to your task.\n\n" +
        skillLines.join("\n"),
    );
  }

  const lengthPrompt = RESPONSE_LENGTH_PROMPTS[responseLength ?? "standard"];
  if (lengthPrompt) {
    sections.push(lengthPrompt);
  }

  return sections.join("\n\n---\n\n");
};

export function buildAgentInitialUserPrompt(
  task: string,
  taskContext?: string,
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

function localToolApprovalTitle(toolName: string, args: unknown): string {
  const argRecord = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (toolName) {
    case "bash": {
      const cmd = typeof argRecord.command === "string" ? argRecord.command : "";
      const short = cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
      return `Run shell: ${short}`;
    }
    case "write": {
      const p = typeof argRecord.path === "string" ? argRecord.path : "";
      return `Write file: ${p}`;
    }
    case "edit": {
      const p = typeof argRecord.path === "string" ? argRecord.path : "";
      return `Edit file: ${p}`;
    }
    case "runJs":
      return "Run JavaScript in sandbox";
    default:
      return `Run ${toolName}`;
  }
}

function localToolApprovalSummary(toolName: string): string {
  switch (toolName) {
    case "bash":
      return "Execute this shell command on your machine.";
    case "write":
      return "Create or overwrite this file on your machine.";
    case "edit":
      return "Modify this existing file on your machine.";
    case "runJs":
      return "Execute JavaScript in a sandboxed V8 isolate on your machine.";
    default:
      return "Run this local tool on your machine.";
  }
}

/**
 * Shared approval gate: emits tool-call/tool-result steps, blocks until the
 * user responds, returns `{block: true}` on denial. Used for both MCP tools
 * and local destructive tools.
 */
async function runApprovalGate(params: {
  toolCallId: string;
  toolName: string;
  provider: string;
  title: string;
  summary: string;
  input: string;
  signal?: AbortSignal;
  onStep: (step: AgentStep) => void;
  requestToolApproval: AgentDeps["requestToolApproval"];
}): Promise<{ block: true; reason: string } | undefined> {
  const { toolCallId, toolName, provider, title, summary, input, signal, onStep, requestToolApproval } = params;
  const approvalId = `approval:${toolCallId}`;
  const request: AgentToolApprovalRequest = {
    id: approvalId,
    toolName,
    provider,
    title,
    summary,
    input,
  };

  onStep({
    id: `${approvalId}:requested`,
    kind: "tool-call",
    toolName,
    toolInput: input,
    approvalId,
    approvalState: "approval-requested",
    content: `Approval required: ${title}`,
    createdAt: Date.now(),
  });

  const response = await requestToolApproval(request, { toolCallId, abortSignal: signal });

  onStep({
    id: `${approvalId}:responded`,
    kind: "tool-result",
    toolName,
    toolInput: input,
    approvalId,
    approvalState: "approval-responded",
    approvalApproved: response.approved,
    content: response.approved ? "Approved by user" : "Rejected by user",
    createdAt: Date.now(),
  });

  if (!response.approved) {
    onStep({
      id: `${approvalId}:denied`,
      kind: "tool-result",
      toolName,
      toolInput: input,
      approvalId,
      approvalState: "output-denied",
      approvalApproved: false,
      content: "Tool execution denied",
      createdAt: Date.now(),
    });
    return { block: true, reason: `User denied ${toolName}.` };
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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

function getAskQuestionAnswerCount(output: unknown): number {
  const parsed = parseJsonIfString(output);
  if (!parsed || typeof parsed !== "object") return 0;
  const answers = (parsed as Record<string, unknown>).answers;
  if (!Array.isArray(answers)) return 0;
  return answers.length;
}

function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function summarizeToolCall(toolName: string, input: unknown): { content: string; toolInput?: string } {
  if (toolName === "searchWeb") {
    const query = getSearchQuery(input);
    if (query) return { content: `Searched: ${query}` };
    return { content: "Searching the web", toolInput: safeJson(input) };
  }
  if (toolName === "getTranscriptContext") {
    const record = asObject(input);
    const last = record?.last;
    const offset = record?.offset;
    const detail = typeof last === "number" || typeof offset === "number"
      ? ` (last=${last ?? 10}, offset=${offset ?? 0})`
      : "";
    return { content: `Reading transcript context${detail}` };
  }
  if (toolName === "getFleetStatus") return { content: "Checking fleet status" };
  if (toolName === "askQuestion") {
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
  if (toolName === "updateTodos") return { content: "Updating todos" };
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
    return {
      content: typeof name === "string" ? `Calling MCP tool: ${name}` : "Calling MCP tool",
      toolInput: safeJson(input),
    };
  }
  if (toolName === "loadSkill") {
    const name = (input as Record<string, unknown>)?.name;
    return { content: typeof name === "string" ? `Loading skill: ${name}` : "Loading skill" };
  }
  return { content: `Using ${toolName}`, toolInput: safeJson(input) };
}

type ToolSummary = { content: string; toolInput?: string };

const TOOL_RESULT_SUMMARIZERS: Record<string, (input: unknown, output: unknown) => ToolSummary> = {
  searchWeb: (input) => {
    const query = getSearchQuery(input);
    return { content: query ? `Searched: ${query}` : "Search complete" };
  },
  getTranscriptContext: (_input, output) => {
    const record = asObject(parseJsonIfString(output));
    const returned = typeof record?.returned === "number" ? record.returned : "?";
    const total = typeof record?.total === "number" ? record.total : "?";
    return { content: `Loaded ${returned}/${total} transcript blocks` };
  },
  getFleetStatus: (_input, output) => {
    const record = asObject(parseJsonIfString(output));
    const agentCount = Array.isArray(record?.agents) ? record.agents.length : 0;
    return { content: `Fleet: ${agentCount} agent${agentCount === 1 ? "" : "s"}` };
  },
  askQuestion: (_input, output) => {
    const count = getAskQuestionAnswerCount(output);
    return {
      content: count > 0 ? `Clarification received (${count} answered)` : "Clarification received",
      toolInput: safeJson(output),
    };
  },
  createPlan: () => ({ content: "Plan created" }),
  updateTodos: () => ({ content: "Todos updated" }),
  searchTranscriptHistory: (_input, output) => {
    const parsed = parseJsonIfString(output);
    const results = Array.isArray(parsed) ? parsed : [];
    return { content: `Found ${results.length} transcript${results.length === 1 ? "" : "s"}` };
  },
  searchAgentHistory: (_input, output) => {
    const parsed = parseJsonIfString(output);
    const results = Array.isArray(parsed) ? parsed : [];
    return { content: `Found ${results.length} agent result${results.length === 1 ? "" : "s"}` };
  },
  getMcpToolSchema: (_input, output) => {
    const record = asObject(parseJsonIfString(output));
    const name = record && typeof record.name === "string" ? record.name : null;
    return { content: name ? `Schema loaded: ${name}` : "Schema lookup complete" };
  },
  searchMcpTools: (_input, output) => {
    const record = asObject(parseJsonIfString(output));
    const results = Array.isArray(record?.results) ? record.results : [];
    return { content: `Found ${results.length} MCP tool${results.length === 1 ? "" : "s"}` };
  },
  callMcpTool: (input, output) => {
    const name = (input as Record<string, unknown>)?.name;
    const label = typeof name === "string" ? name : "MCP tool";
    return { content: `${label} complete`, toolInput: safeJson(output) };
  },
  loadSkill: (input) => {
    const name = (input as Record<string, unknown>)?.name;
    return { content: typeof name === "string" ? `Loaded: ${name}` : "Skill loaded" };
  },
};

function summarizeToolResult(toolName: string, input: unknown, output: unknown): ToolSummary {
  const summarizer = TOOL_RESULT_SUMMARIZERS[toolName];
  if (summarizer) return summarizer(input, output);
  return { content: `${toolName} complete`, toolInput: safeJson(output) };
}

// Pi-mono message → text extraction for the final `result` string.
function extractFinalText(messages: PiAgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const assistant = msg as AssistantMessage;
    const texts = assistant.content
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text.trim())
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n\n");
  }
  return "";
}

/**
 * Run agent with an initial prompt (first turn).
 */
export async function runAgent(agent: Agent, deps: AgentDeps): Promise<void> {
  const initialPrompt = buildAgentInitialUserPrompt(
    agent.task,
    agent.taskContext,
  );
  await runAgentWithMessages(agent, [], initialPrompt, deps);
}

/**
 * Continue an agent conversation with existing messages + a new user question.
 */
export async function continueAgent(
  agent: Agent,
  previousMessages: Message[],
  followUpQuestion: string,
  deps: AgentDeps,
): Promise<void> {
  await runAgentWithMessages(agent, previousMessages, followUpQuestion, deps);
}

async function runAgentWithMessages(
  agent: Agent,
  previousMessages: Message[],
  newUserPrompt: string,
  deps: AgentDeps,
): Promise<void> {
  const {
    model,
    exa,
    getTranscriptSummary,
    getTranscriptContext,
    projectInstructions,
    agentsMd,
    responseLength,
    searchTranscriptHistory,
    searchAgentHistory,
    getExternalTools,
    getCodexClient,
    getClaudeClient,
    emitProviderTaskEvent,
    enabledSkills,
    getFleetStatus,
    allowAutoApprove,
    localWorkspaceCwd,
    localTools,
    requestClarification,
    requestToolApproval,
    requestPlanApproval,
    onStep,
    onStepFinish,
    onComplete,
    onFail,
    abortSignal,
  } = deps;

  try {
    const { tools, externalTools, codexRegistered, claudeRegistered } = await buildAgentTools({
      exa,
      getTranscriptContext,
      searchTranscriptHistory,
      searchAgentHistory,
      getExternalTools,
      getCodexClient,
      getClaudeClient,
      emitProviderTaskEvent,
      enabledSkills,
      getFleetStatus,
      allowAutoApprove,
      localWorkspaceCwd,
      localTools,
      requestClarification,
      requestPlanApproval,
      onStep,
      existingSteps: agent.steps,
      agentId: agent.id,
    });

    const systemPrompt = buildSystemPrompt(
      getTranscriptSummary(),
      projectInstructions,
      agentsMd,
      responseLength,
      codexRegistered,
      claudeRegistered,
      enabledSkills,
    );

    const piAgent = new PiAgent({
      initialState: {
        systemPrompt,
        model: model.model,
        thinkingLevel: model.thinkingLevel,
        messages: previousMessages as PiAgentMessage[],
        tools,
      },
      getApiKey: model.apiKey ? async () => model.apiKey : undefined,
      beforeToolCall: async ({ toolCall, args }, signal) => {
        // 1) MCP tools: approval depends on tool's isMutating flag + auto-approve hint.
        if (toolCall.name === "callMcpTool") {
          const input = args as { name: string; args: Record<string, unknown>; _autoApprove?: boolean };
          const resolution = resolveExternalToolName(input.name, externalTools);
          if (!resolution.ok) return;
          const external = externalTools[resolution.toolName];
          if (!external) return;
          const requiresApproval = shouldRequireApproval(
            external.isMutating,
            allowAutoApprove,
            input._autoApprove,
          );
          if (!requiresApproval) return;

          return runApprovalGate({
            toolCallId: toolCall.id,
            toolName: resolution.toolName,
            provider: external.provider,
            title: buildApprovalTitle(resolution.toolName, external.provider),
            summary: "This tool can create, update, or delete external data.",
            input: summarizeApprovalInput(input.args),
            signal,
            onStep,
            requestToolApproval,
          });
        }

        // 2) Local destructive tools (write/edit/bash/runJs): always require approval.
        if (DESTRUCTIVE_LOCAL_TOOLS.has(toolCall.name)) {
          return runApprovalGate({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            provider: "local",
            title: localToolApprovalTitle(toolCall.name, args),
            summary: localToolApprovalSummary(toolCall.name),
            input: summarizeApprovalInput(args),
            signal,
            onStep,
            requestToolApproval,
          });
        }
      },
    });

    // Merge caller abort with pi-mono's internal signal.
    if (abortSignal) {
      if (abortSignal.aborted) {
        piAgent.abort();
      } else {
        abortSignal.addEventListener("abort", () => piAgent.abort(), { once: true });
      }
    }

    // Circuit breaker + turn counter + history trim.
    let consecutiveToolErrors = 0;
    let assistantTurns = 0;

    piAgent.transformContext = async (messages) => {
      if (assistantTurns <= 5 || messages.length <= 15) return messages;
      return messages.map((m) => {
        if (m.role !== "toolResult") return m;
        const text = m.content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join("");
        if (text.length <= 2000) return m;
        return {
          ...m,
          content: [{ type: "text" as const, text: text.slice(0, 2000) + "\n...(truncated)" }],
        };
      });
    };

    const runStartedAt = Date.now();
    const runPrefix = `${runStartedAt}`;
    let stepIndex = 0;
    let textStepId: string | null = null;
    let streamedText = "";
    let lastNonEmptyText = "";
    let deltaCount = 0;
    const toolArgsById = new Map<string, unknown>();

    piAgent.subscribe((event: PiAgentEvent) => {
      switch (event.type) {
        case "turn_start": {
          assistantTurns += 1;
          if (streamedText) lastNonEmptyText = streamedText;
          streamedText = "";
          textStepId = null;
          stepIndex += 1;
          if (assistantTurns > MAX_AGENT_TURNS) {
            log("WARN", `Agent ${agent.id}: exceeded max turns (${MAX_AGENT_TURNS}), aborting`);
            piAgent.abort();
          }
          break;
        }
        case "message_update": {
          const ev = event.assistantMessageEvent;
          if (ev.type === "text_delta") {
            deltaCount += 1;
            streamedText += ev.delta;
            textStepId = `text:${runPrefix}:${stepIndex}`;
            onStep({
              id: textStepId,
              kind: "text",
              content: streamedText,
              createdAt: runStartedAt,
            });
          } else if (ev.type === "thinking_start") {
            const reasoningStepId = `reasoning:${runPrefix}:${stepIndex}:${ev.contentIndex}`;
            onStep({
              id: reasoningStepId,
              kind: "thinking",
              content: "Thinking...",
              createdAt: Date.now(),
            });
          } else if (ev.type === "thinking_delta" || ev.type === "thinking_end") {
            const reasoningStepId = `reasoning:${runPrefix}:${stepIndex}:${ev.contentIndex}`;
            const partial = ev.partial;
            const thinkingBlock = partial.content[ev.contentIndex];
            const text = thinkingBlock && thinkingBlock.type === "thinking"
              ? thinkingBlock.thinking
              : "";
            onStep({
              id: reasoningStepId,
              kind: "thinking",
              content: text.trim() || "Thinking...",
              createdAt: Date.now(),
            });
          }
          break;
        }
        case "tool_execution_start": {
          toolArgsById.set(event.toolCallId, event.args);
          // createPlan/updateTodos emit their own steps.
          if (event.toolName === "createPlan" || event.toolName === "updateTodos") break;
          const { content, toolInput } = summarizeToolCall(event.toolName, event.args);
          onStep({
            id: `tool:${event.toolCallId}`,
            kind: "tool-call",
            content,
            toolName: event.toolName,
            toolInput,
            createdAt: Date.now(),
          });
          break;
        }
        case "tool_execution_end": {
          const args = toolArgsById.get(event.toolCallId);
          toolArgsById.delete(event.toolCallId);
          if (event.toolName === "createPlan" || event.toolName === "updateTodos") break;
          if (event.isError) {
            consecutiveToolErrors += 1;
            const errText = typeof event.result === "object" && event.result && "content" in event.result
              ? safeJson(event.result)
              : String(event.result);
            const stepId = event.toolName === "askQuestion"
              ? `tool:${event.toolCallId}:error`
              : `tool:${event.toolCallId}`;
            onStep({
              id: stepId,
              kind: "tool-result",
              content: `${event.toolName} failed`,
              toolName: event.toolName,
              toolInput: errText,
              createdAt: Date.now(),
            });
            if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
              log("WARN", `Agent ${agent.id}: ${consecutiveToolErrors} consecutive tool errors, stripping tools and aborting`);
              // Drop all tools so no more tool calls can happen on the next turn
              piAgent.state.tools = [];
            }
          } else {
            consecutiveToolErrors = 0;
            const details = (event.result as { details?: unknown })?.details;
            const { content, toolInput } = summarizeToolResult(event.toolName, args, details);
            onStep({
              id: `tool:${event.toolCallId}`,
              kind: "tool-result",
              content,
              toolName: event.toolName,
              toolInput,
              createdAt: Date.now(),
            });
          }
          break;
        }
        case "turn_end": {
          onStepFinish?.({
            finishReason: "stop",
            toolCalls: event.toolResults.map((t) => ({ toolName: t.toolName })),
          });
          break;
        }
        default:
          break;
      }
    });

    await piAgent.prompt(newUserPrompt);

    // Wait for lifecycle settlement
    await piAgent.waitForIdle();

    if (streamedText) lastNonEmptyText = streamedText;
    const finalMessages = piAgent.state.messages as Message[];
    const last = finalMessages[finalMessages.length - 1];

    // If the last assistant message failed or aborted, surface as failure.
    if (last && last.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
      if (last.stopReason === "aborted") {
        onFail("Cancelled", finalMessages);
      } else {
        const message = normalizeProviderErrorMessage(last.errorMessage ?? "Unknown error");
        onFail(message, finalMessages);
      }
      return;
    }

    const finalText = extractFinalText(finalMessages) || lastNonEmptyText || "No results found.";

    // Ensure the final streamed text step is committed
    if (streamedText && textStepId) {
      onStep({
        id: textStepId,
        kind: "text",
        content: streamedText,
        createdAt: runStartedAt,
      });
    }

    log(
      "INFO",
      `Agent stream ${agent.id}: deltas=${deltaCount}, totalMs=${Date.now() - runStartedAt}`,
    );
    onComplete(finalText, finalMessages);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = normalizeProviderErrorMessage(rawMessage);
    onFail(message);
  }
}

// Re-export helpers that agent-manager relies on.
export type { ImageContent };
