import { z } from "zod";
import type { TranscriptBlock, TaskItem, Agent, TaskSuggestionAggressiveness } from "../types";
import {
  getAgentSuggestionPromptTemplate,
  getAnalysisRequestPromptTemplate,
  getSummarySystemPrompt,
  getTaskCreationSharedPromptTemplate,
  getTaskFromSelectionPromptTemplate,
  renderPromptTemplate,
} from "../prompt-loader";

export const analysisSchema = z.object({
  keyPoints: z
    .array(z.string())
    .describe("1-2 key points from the recent conversation. Each must be a specific, verifiable fact. One sentence each."),
});

export const agentSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        kind: z
          .enum(["research", "action", "insight", "flag", "followup"])
          .describe("research = share a concrete fact you looked up; action = offer to draft/create/do something specific; insight = point out something the speakers didn't notice; flag = highlight a conflict, mistake, or risk; followup = remind about a loose thread"),
        flag: z
          .string()
          .describe("Short concrete issue, contradiction, or opportunity noticed in the transcript or tools.")
          .optional(),
        text: z
          .string()
          .describe("Short, concrete next step or action the user can accept as a task. Keep it actionable and specific, not generic. Good: 'Flag the 45M vs 38M discrepancy before this gets repeated.' Bad: 'Want me to compare the figures and identify any discrepancies?'"),
        details: z
          .string()
          .describe("Brief context or rationale for the suggestion.")
          .optional(),
        transcriptExcerpt: z
          .string()
          .describe("Short verbatim transcript excerpt grounding this suggestion.")
          .optional(),
      }),
    )
    .describe("0-3 grounded suggestions. Each should pair a concrete flag or observation with a specific next step the user could accept as a task."),
});

export const taskFromSelectionSchema = z.object({
  shouldCreateTask: z
    .boolean()
    .describe("Whether a task should be created. Always true when user intent is provided. When no intent is given, true only if the selected text itself contains a clear actionable commitment."),
  taskTitle: z
    .string()
    .describe("Short actionable task title (3-10 words). Empty when shouldCreateTask is false."),
  taskDetails: z
    .string()
    .describe("Detailed context for the task preserving specifics, constraints, names, and timeline. Empty when shouldCreateTask is false."),
  reason: z
    .string()
    .describe("Brief explanation for decision."),
});

export const sessionTitleSchema = z.object({
  title: z.string().describe(
    "A concise 3-6 word title capturing the main topic or purpose of this conversation. No quotes. No filler like 'Discussion about'."
  ),
});

export function buildSessionTitlePrompt(excerpt: string): string {
  return `Generate a short, descriptive title (3-6 words) for a conversation based on this excerpt:\n\n${excerpt}\n\nFocus on the specific topic, not generic labels.`;
}

export const agentTitleSchema = z.object({
  title: z.string().describe(
    "A concise 3-6 word title for this agent task. No quotes. No filler like 'Task to' or 'Agent for'."
  ),
});

export function buildAgentTitlePrompt(task: string): string {
  return `Generate a short, descriptive title (3-6 words) for an AI agent task based on this prompt:\n\n${task.slice(0, 500)}\n\nBe specific about what is being done. No quotes.`;
}

const todoItemSchema = z.object({
  text: z.string().describe("The todo. Atomic, imperative, under 12 words, starting with a strong verb."),
  doer: z.enum(["agent", "human"]).describe(
    "'agent' if completable by an AI with web search, transcript search, and MCP tools (Notion, Linear). 'human' if it requires personal memory, physical action, or context not in the transcript."
  ),
});

function extractNestedString(value: unknown, keys: readonly string[]): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractNestedString(item, keys))
      .filter((item): item is string => Boolean(item));
    if (parts.length === 0) return undefined;
    return parts.join(" ");
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const nested = extractNestedString(record[key], keys);
    if (nested) return nested;
  }

  return undefined;
}

const TODO_KEYS = ["text", "todo", "task", "title", "value", "content", "description", "label", "item"] as const;
const LOOSE_STRING_KEYS = ["text", "content", "value", "summary", "description", "label", "title", "narrative", "message"] as const;

function extractTodoText(value: unknown): string | undefined {
  return extractNestedString(value, TODO_KEYS);
}

function extractLooseString(value: unknown): string | undefined {
  return extractNestedString(value, LOOSE_STRING_KEYS);
}

function extractLooseArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["items", "results", "entries", "highlights", "agentHighlights", "agents", "data"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }

  return undefined;
}

function unwrapAgentsSummaryRoot(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  if (
    "overallNarrative" in record ||
    "agentHighlights" in record ||
    "coverageGaps" in record ||
    "nextSteps" in record
  ) {
    return value;
  }

  for (const key of ["summary", "debrief", "result", "output", "data", "object", "response"]) {
    const nested = record[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const nestedRecord = nested as Record<string, unknown>;
    if (
      "overallNarrative" in nestedRecord ||
      "agentHighlights" in nestedRecord ||
      "coverageGaps" in nestedRecord ||
      "nextSteps" in nestedRecord
    ) {
      return nested;
    }
  }

  return value;
}

function normalizeAgentStatus(value: unknown): "completed" | "failed" | undefined {
  if (value === "completed" || value === "failed") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["completed", "complete", "done", "success", "succeeded", "ok"].includes(normalized)) {
    return "completed";
  }
  if (["failed", "failure", "error", "errored"].includes(normalized)) {
    return "failed";
  }
  return undefined;
}

const normalizedTodoItemSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    return { text: value, doer: "human" };
  }

  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const text = extractTodoText(record);
  if (!text) return value;

  return {
    text,
    doer: record.doer === "agent" || record.doer === "human" ? record.doer : "human",
  };
}, todoItemSchema);

export const finalSummarySchema = z.object({
  narrative: z.string().describe(
    "Markdown snapshot of the meeting in 2-4 concise sentences. No code fences."
  ),
  agreements: z.array(z.string()).describe(
    "Explicit agreements, decisions, or commitments reached in the meeting. 0-8 items. Each item one concise sentence."
  ),
  missedItems: z.array(z.string()).describe(
    "Important gaps, blind spots, assumptions, or things the team likely missed. 0-6 items. Empty array if none."
  ),
  unansweredQuestions: z.array(z.string()).describe(
    "Open unresolved questions from the meeting. 0-8 items. Empty array if none."
  ),
  agreementTodos: z.array(normalizedTodoItemSchema).describe(
    "For agreements that exist, provide 1-3 concrete follow-up todos tied specifically to those agreements. Empty array if no agreements."
  ),
  missedItemTodos: z.array(normalizedTodoItemSchema).describe(
    "For missedItems that exist, provide 1-3 concrete todos to close gaps or blind spots. Empty array if no missedItems."
  ),
  unansweredQuestionTodos: z.array(normalizedTodoItemSchema).describe(
    "For unansweredQuestions that exist, provide 1-3 concrete investigation/decision todos to resolve them. Empty array if no unansweredQuestions."
  ),
  actionItems: z.array(normalizedTodoItemSchema).describe(
    "Cross-cutting concrete action items not already captured in section-specific todos. Empty array if none."
  ),
});

export type FinalSummaryResult = z.infer<typeof finalSummarySchema>;

const normalizedAgentHighlightSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return {
    agentId: extractLooseString(record.agentId ?? record.id ?? record.agent_id ?? record.agent),
    task: extractLooseString(record.task ?? record.title ?? record.prompt ?? record.objective),
    status: normalizeAgentStatus(record.status ?? record.outcome ?? record.state),
    keyFinding: extractLooseString(
      record.keyFinding ?? record.finding ?? record.summary ?? record.result ?? record.text
    ),
  };
}, z.object({
  agentId: z.string().describe("Agent id, passed through unchanged."),
  task: z.string().describe("Agent's original task, passed through unchanged."),
  status: z.enum(["completed", "failed"]),
  keyFinding: z.string().describe(
    "1-2 sentence distillation of the most important finding or outcome. If failed, describe what was attempted and why."
  ),
}));

export const agentsSummarySchema = z.preprocess(
  unwrapAgentsSummaryRoot,
  z.object({
    overallNarrative: z.preprocess(
      (value) => extractLooseString(value),
      z.string().describe(
      "2-4 sentence prose debrief of what the agent fleet collectively accomplished. Focus on outcomes and synthesis across agents, not individual steps."
    )),
    agentHighlights: z.preprocess(
      (value) => extractLooseArray(value) ?? value,
      z.array(normalizedAgentHighlightSchema).describe("One entry per agent. Do not omit failed agents."),
    ),
    coverageGaps: z.preprocess(
      (value) => {
        const items = Array.isArray(value) ? value : extractLooseArray(value);
        if (!items) return value;
        return items.map((item) => extractLooseString(item) ?? item);
      },
      z.array(z.string()).describe(
      "Aspects of the objectives that remain unaddressed. Empty array if coverage is complete."
    )),
    nextSteps: z.preprocess(
      (value) => {
        const items = Array.isArray(value) ? value : extractLooseArray(value);
        if (!items) return value;
        return items.map((item) => extractLooseString(item) ?? item);
      },
      z.array(z.string()).describe(
      "Atomic follow-up todos. Each under 12 words, imperative, starting with a strong verb (e.g. 'Retest with paid API plan', 'Benchmark speed against Claude Opus'). No compound actions. Empty array if none."
    )),
  }),
);

export type AgentsSummaryResult = z.infer<typeof agentsSummarySchema>;

export function buildFinalSummaryPrompt(
  allBlocks: readonly TranscriptBlock[],
  allKeyPoints: readonly string[],
): string {
  const transcript = allBlocks
    .map((b) => {
      const line = `[${b.audioSource}] ${b.sourceText}`;
      return b.translation ? `${line} → ${b.translation}` : line;
    })
    .join("\n");

  const keyPointsSection = allKeyPoints.length > 0
    ? `\n\nKey points identified during the session:\n${allKeyPoints.map((p) => `- ${p}`).join("\n")}`
    : "";

  return `You are producing a final summary of a completed conversation that was transcribed and translated in real-time.

Output requirements:
- Return JSON matching the schema exactly.
- Keep every field concrete and specific to this transcript.
- "narrative": 2-4 sentence Markdown snapshot only.
- "agreements": capture explicit decisions/agreements that were reached.
- "missedItems": include likely blind spots and what was not discussed enough.
- "unansweredQuestions": include unresolved questions that still need answers.
- "agreementTodos": include a few follow-up todos tied to agreements.
- "missedItemTodos": include a few corrective/validation todos for missed items.
- "unansweredQuestionTodos": include a few investigation/decision todos for open questions.
- Every todo must be a single atomic action a single agent can complete in one focused pass.
- Keep each todo under 12 words and start with a strong verb.
- Do not chain actions with "and", commas, or slash-separated tasks.
- If a section has entries, provide at least 1 todo for that section.
- If a section has no entries, use an empty todo array for that section.
- "actionItems": only cross-cutting todos not already in the three section todo lists.
- Use empty arrays instead of inventing content when unsure.
- Do not include code fences.

Classifying "doer" for each todo:
- "agent": the task can be completed by an AI agent that can search the web, search transcript/agent history, ask the user clarifying questions, and call MCP tools (Notion, Linear).
- "human": the task requires personal memory, physical action, calendar scheduling, phone calls, or context not present in the transcript.
- When unsure, default to "human".

Full transcript:
${transcript || "(No transcript available)"}${keyPointsSection}`;
}

export type AnalysisResult = z.infer<typeof analysisSchema>;
export type AgentSuggestionResult = z.infer<typeof agentSuggestionSchema>;
export type AgentSuggestionItem = AgentSuggestionResult["suggestions"][number];
export type TaskFromSelectionResult = z.infer<typeof taskFromSelectionSchema>;

export function buildAnalysisPrompt(
  recentBlocks: TranscriptBlock[],
  previousKeyPoints: readonly string[],
): string {
  const summarySystemPrompt = getSummarySystemPrompt();

  const transcript = recentBlocks
    .map((b) => {
      const source = `[${b.audioSource}] ${b.sourceText}`;
      const translation = b.translation ? ` → ${b.translation}` : "";
      return source + translation;
    })
    .join("\n");

  const keyPointsSection =
    previousKeyPoints.length > 0
      ? `\n\nSummary of conversation so far:\n${previousKeyPoints.map((p) => `- ${p}`).join("\n")}`
      : "";

  return renderPromptTemplate(getAnalysisRequestPromptTemplate(), {
    summary_system_prompt: summarySystemPrompt,
    transcript,
    previous_key_points_section: keyPointsSection,
  });
}

export function buildAgentSuggestionPrompt(
  recentBlocks: TranscriptBlock[],
  existingTasks: ReadonlyArray<Pick<TaskItem, "text" | "completed" | "archived">>,
  historicalSuggestions: readonly string[] = [],
  keyPoints: readonly string[] = [],
  educationalContext: readonly string[] = [],
  aggressiveness: TaskSuggestionAggressiveness = "balanced",
): string {
  const transcript = recentBlocks
    .map((b) => {
      const source = `[${b.audioSource}] ${b.sourceText}`;
      const translation = b.translation ? ` → ${b.translation}` : "";
      return source + translation;
    })
    .join("\n");

  function taskLabel(t: Pick<TaskItem, "text" | "completed" | "archived">): string {
    if (t.archived) return `- [archived] ${t.text}`;
    return `- [${t.completed ? "x" : " "}] ${t.text}`;
  }

  const tasksSection =
    existingTasks.length > 0
      ? `\n\nExisting tasks:\n${existingTasks.map(taskLabel).join("\n")}`
      : "";

  const historicalSuggestionsSet = new Set<string>();
  const normalizedHistory = historicalSuggestions
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((text) => {
      const key = text.toLowerCase();
      if (historicalSuggestionsSet.has(key)) return false;
      historicalSuggestionsSet.add(key);
      return true;
    })
    .slice(-30);
  const historicalSuggestionsSection = normalizedHistory.length > 0
    ? `\n\nHistorical suggestions already shown in this session (DO NOT repeat or rephrase any of these):\n${normalizedHistory.map((text) => `- ${text}`).join("\n")}`
    : "";

  const keyPointsSection = keyPoints.length > 0
    ? `\n\nConversation context (key points from earlier in this meeting):\n${keyPoints.map((p) => `- ${p}`).join("\n")}`
    : "";

  const educationalSection = educationalContext.length > 0
    ? `\n\nPrior educational insights (use to inform suggestions, do not repeat):\n${educationalContext.map((text) => `- ${text}`).join("\n")}`
    : "";
  const aggressivenessSection =
    aggressiveness === "conservative"
      ? "\n\nSuggestion aggressiveness: conservative.\n- Only surface a suggestion when the transcript contains a fairly explicit follow-up, ask, deliverable, or risk.\n- If a suggestion depends on a public factual claim, do one quick external verification pass before surfacing it.\n- Prefer silence over speculative suggestions."
      : aggressiveness === "aggressive"
        ? "\n\nSuggestion aggressiveness: aggressive.\n- Proactively surface implied next steps, research opportunities, drafting help, and decision support.\n- For concrete public claims, default to a fast web check across a few sources before suggesting.\n- If there is plausible user-saving work to offer, prefer suggesting it."
        : "\n\nSuggestion aggressiveness: balanced.\n- Surface explicit follow-ups and strong implied next steps.\n- For concrete public claims, prefer one quick external verification pass before surfacing them.\n- Avoid weak or speculative suggestions.";

  return renderPromptTemplate(getAgentSuggestionPromptTemplate(), {
    transcript,
    existing_tasks_section: tasksSection,
    historical_suggestions_section: historicalSuggestionsSection,
    key_points_section: keyPointsSection,
    educational_context_section: educationalSection,
    suggestion_aggressiveness_section: aggressivenessSection,
  });
}

export function buildTaskFromSelectionPrompt(
  selectedText: string,
  existingTasks: ReadonlyArray<Pick<TaskItem, "text" | "completed">>,
  userIntentText?: string,
): string {
  const tasksSection =
    existingTasks.length > 0
      ? `\n\nExisting tasks:\n${existingTasks.map((t) => `- [${t.completed ? "x" : " "}] ${t.text}`).join("\n")}`
      : "";
  const intent = userIntentText?.trim() ?? "";
  const userIntentSection = intent
    ? `\n\nUser intent for task creation:\n${intent}`
    : "";

  return renderPromptTemplate(getTaskFromSelectionPromptTemplate(), {
    selected_text: selectedText,
    user_intent_section: userIntentSection,
    existing_tasks_section: tasksSection,
    task_creation_shared_rules: getTaskCreationSharedPromptTemplate(),
  });
}

export function buildAgentsSummaryPrompt(
  agents: readonly Agent[],
  transcriptBlocks: readonly TranscriptBlock[] = [],
  keyPoints: readonly string[] = [],
): string {
  const terminal = agents.filter(
    (a) => a.status === "completed" || a.status === "failed"
  );
  const agentDocs = terminal.map((a) => {
    const tools = [...new Set(
      a.steps.filter((s) => s.kind === "tool-call" && s.toolName).map((s) => s.toolName!)
    )];
    const durationSecs = a.completedAt && a.createdAt
      ? Math.round((a.completedAt - a.createdAt) / 1000) : 0;
    return [
      `## Agent id:${a.id} — ${a.task}`,
      `Status: ${a.status} | Duration: ${durationSecs}s`,
      tools.length > 0 ? `Tools used: ${tools.join(", ")}` : null,
      a.taskContext ? `Context: ${a.taskContext}` : null,
      a.result ? `Result:\n${a.result}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const succeeded = terminal.filter((a) => a.status === "completed").length;

  const transcriptSection = transcriptBlocks.length > 0
    ? [
        "",
        "Session transcript (source material the agents worked from):",
        transcriptBlocks.map((b) => {
          const line = `[${b.audioSource}] ${b.sourceText}`;
          return b.translation ? `${line} → ${b.translation}` : line;
        }).join("\n"),
      ].join("\n")
    : "";

  const keyPointsSection = keyPoints.length > 0
    ? [
        "",
        "Key points identified during the session:",
        keyPoints.map((p) => `- ${p}`).join("\n"),
      ].join("\n")
    : "";

  return [
    "You are producing a debrief of a completed multi-agent research session.",
    `Stats: ${terminal.length} agents · ${succeeded} succeeded · ${terminal.length - succeeded} failed`,
    transcriptSection,
    keyPointsSection,
    "",
    "Agent reports:",
    agentDocs,
    "",
    "Synthesize what was collectively learned, identify coverage gaps, and suggest next steps.",
    "Return JSON matching the schema exactly.",
    'Set "overallNarrative" to a string, not an object.',
    'Set "agentHighlights" to an array, not an object wrapper.',
    "",
    "Rules for nextSteps:",
    "- Every next step must be a single atomic action a single agent can complete in one focused pass.",
    "- Keep each next step under 12 words and start with a strong verb.",
    "- Do not chain actions with 'and', commas, or slash-separated tasks.",
  ].join("\n");
}
