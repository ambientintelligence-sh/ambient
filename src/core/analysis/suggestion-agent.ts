import {
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import { z } from "zod";

import type {
  TranscriptBlock,
  TaskItem,
  TaskSuggestionAggressiveness,
} from "../types";
import { log } from "../logger";
import { toReadableError } from "../text/text-utils";
import { generateStructuredObject } from "../ai/structured-output";
import {
  agentSuggestionSchema,
  type AgentSuggestionItem,
  buildAgentSuggestionPrompt,
} from "./analysis";

type ExaClient = {
  search: (
    query: string,
    options: Record<string, unknown>,
  ) => Promise<{
    results: Array<{ title: string; url: string; text?: string }>;
  }>;
};

export type SuggestionAgentDeps = {
  model: LanguageModel;
  getTranscriptContext: (
    last?: number,
    offset?: number,
  ) => { blocks: string; returned: number; total: number; remaining: number };
  searchTranscriptHistory?: (query: string, limit?: number) => unknown[];
  exa?: ExaClient | null;
  onStep?: (label: string) => void;
  debug?: boolean;
};

export type SuggestionAgentInput = {
  recentBlocks: TranscriptBlock[];
  existingTasks: ReadonlyArray<
    Pick<TaskItem, "text" | "completed" | "archived">
  >;
  historicalSuggestions: readonly string[];
  keyPoints: readonly string[];
  educationalContext: readonly string[];
  aggressiveness: TaskSuggestionAggressiveness;
};

export type SuggestionAgentResult = {
  suggestions: AgentSuggestionItem[];
  usage: { inputTokens: number; outputTokens: number };
  steps: number;
};

const STEP_BUDGET = 20;

function truncateLabel(text: string, max = 40): string {
  const clean = text.trim().replaceAll(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

const SYSTEM_PROMPT = [
  "You listen in on a live conversation like a close friend who happens to know a lot. You speak up when you notice something specific and useful — not with generic offers.",
  "",
  "Your suggestions land in a sidebar while the speakers keep talking. Think: a friend leaning over to whisper \"hey, that number's wrong\" or \"wait, you already decided this last week\" — not a research assistant offering to write a report.",
  "",
  "Be proactive. If there's a reasonable moment to help — a fact worth looking up, a past decision worth remembering, a draft worth offering — take it. You don't need a dramatic contradiction to speak up.",
  "",
  "Before you suggest, INVESTIGATE. You have up to 20 tool-calling steps — use them freely to chase threads, cross-reference, and verify. Tools available:",
  "- getTranscriptContext: read older blocks from this session to check whether the speakers already covered, resolved, or contradicted something.",
  "- searchTranscriptHistory: search prior sessions to catch stale duplicates or \"we already decided X last time\" moments.",
  "- searchWeb: look up current external facts (specific prices, recent news, exact figures, recent releases). Use when the conversation hinges on an up-to-date external fact.",
  "",
  "Guidelines:",
  "- Prefer suggestions that lead with a concrete thing — a specific number, name, date, decision, contradiction, or prior commitment. Tool output is the best source, but a sharp observation from the transcript itself is also fine.",
  "- If the transcript contains an explicit follow-up, assignment, deadline, deliverable, research question, or comparison request, prefer returning at least 1 concrete suggestion instead of none.",
  "- Never repeat or rephrase anything in the historical suggestions list.",
  "- Ignore bracketed non-speech tags like [silence], [music], [noise], [laughs]. Preserve specifics: names, places, dates, numbers, constraints.",
  "- You have step budget to spare. It's fine to make a follow-up search to verify what a first search returned, or to pull more transcript context after finding a prior mention. Don't stop at the first result if it's ambiguous.",
  "",
  "Tone and phrasing — this matters:",
  "- Write like a friend, not a research assistant. Short, natural, first-person, specific.",
  "- LEAD with the concrete thing. The offer to help comes second, and only if helpful.",
  "- AVOID these patterns entirely: \"Want me to compare X to Y?\", \"Should I pull specific data on Z?\", \"Want me to identify parallels...\", \"Should I draft a comprehensive...\", \"Want me to analyze...\", \"Want me to explore the historical context of...\". These sound like busywork.",
  "- PREFER: \"They said 45M but the UN report from March pegs it at 38M — flag it?\" / \"You covered this last Tuesday and agreed to wait until Q3.\" / \"FYI Resolution 552 was passed unanimously in 1984, not contested like they implied.\"",
  "- Name the specific number, date, person, or decision. No vague \"relevant context\" or \"historical parallels\".",
  "- If the finding itself is strong, the offer can be omitted entirely — the observation alone is the value.",
  "",
  "Output (plain text, no JSON):",
  "1. A 2-4 line research note summarizing what tools you called and what they returned.",
  "2. Then, for each candidate suggestion (0-3), a block like:",
  "   KIND: <research|action|insight|flag|followup>",
  "   TEXT: <short, natural, first-person. Leads with the concrete finding. Sounds like a friend, not a research paper.>",
  "   DETAILS: <one-line rationale grounded in what your tool calls returned>",
  "   EXCERPT: <verbatim transcript quote, optional>",
  "",
  "If you didn't find anything concrete via tools, write the research note and then the single line: NO_SUGGESTIONS.",
].join("\n");

export async function runSuggestionAgent(
  input: SuggestionAgentInput,
  deps: SuggestionAgentDeps,
): Promise<SuggestionAgentResult> {
  const userPrompt = buildAgentSuggestionPrompt(
    input.recentBlocks,
    input.existingTasks,
    input.historicalSuggestions,
    input.keyPoints,
    input.educationalContext,
    input.aggressiveness,
  );

  const emitStep = (label: string): void => {
    try {
      deps.onStep?.(label);
    } catch {
      // onStep is best-effort UI telemetry; never let it break the loop
    }
  };

  const tools: ToolSet = {
    getTranscriptContext: tool({
      description:
        "Read additional transcript blocks from the CURRENT session. Use when the base context is not enough to judge whether a suggestion is warranted.",
      inputSchema: z.object({
        last: z
          .number()
          .optional()
          .describe("Number of most recent blocks to return (default 20)"),
        offset: z
          .number()
          .optional()
          .describe("Skip this many blocks from the end to page backwards (default 0)"),
      }),
      execute: async ({ last, offset }) => {
        emitStep("Reading earlier transcript…");
        return deps.getTranscriptContext(last ?? 20, offset ?? 0);
      },
    }),
  };

  if (deps.searchTranscriptHistory) {
    const search = deps.searchTranscriptHistory;
    tools.searchTranscriptHistory = tool({
      description:
        "Search transcript blocks from PAST sessions by keyword (FTS5). Use to check whether a topic was already covered before.",
      inputSchema: z.object({
        query: z.string().describe("Keyword query"),
        limit: z
          .number()
          .optional()
          .describe("Max results to return (default 10)"),
      }),
      execute: async ({ query, limit }) => {
        emitStep(`Searching past sessions for “${truncateLabel(query)}”…`);
        return search(query, limit ?? 10);
      },
    });
  }

  if (deps.exa) {
    const exa = deps.exa;
    tools.searchWeb = tool({
      description:
        "Search the web for current, external facts (prices, news, docs, people, companies, recent releases). Use ONLY when the conversation depends on up-to-date information your training data may not cover. Prefer specific, targeted queries.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
      }),
      execute: async ({ query }) => {
        emitStep(`Looking up on the web: “${truncateLabel(query)}”…`);
        try {
          const results = await exa.search(query, {
            type: "auto",
            numResults: 5,
            text: { maxCharacters: 1000 },
          });
          return results.results;
        } catch (error) {
          const message = toReadableError(error);
          if (deps.debug) {
            log("WARN", `Suggestion agent searchWeb failed: ${message}`);
          }
          return {
            error: message,
            hint: "Web search is temporarily unavailable. Continue with transcript-only reasoning.",
          };
        }
      },
    });
  }

  let researchText = "";
  let researchUsage: LanguageModelUsage | undefined;
  let stepsTaken = 0;

  emitStep("Thinking…");

  try {
    const result = await generateText({
      model: deps.model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      tools,
      stopWhen: stepCountIs(STEP_BUDGET),
      temperature: 0,
      onStepFinish: () => {
        emitStep("Thinking…");
      },
    });
    researchText = result.text.trim();
    researchUsage = result.usage;
    stepsTaken = result.steps?.length ?? 0;
  } catch (error) {
    if (deps.debug) {
      log(
        "WARN",
        `Suggestion agent research phase failed: ${toReadableError(error)}`,
      );
    }
    throw error;
  }

  emitStep("Drafting suggestions…");

  if (!researchText || /\bNO_SUGGESTIONS\b/.test(researchText)) {
    return {
      suggestions: [],
      usage: {
        inputTokens: researchUsage?.inputTokens ?? 0,
        outputTokens: researchUsage?.outputTokens ?? 0,
      },
      steps: stepsTaken,
    };
  }

  const extractionPrompt = [
    "Convert the following research note into the agentSuggestion schema.",
    "",
    "Rules:",
    "- Return 0-3 suggestions. Zero is acceptable and preferred over weak ones.",
    "- Preserve the researcher's exact tone and phrasing in TEXT. Do NOT rewrite it into a formal question like 'Want me to...'. The conversational, first-person voice is intentional.",
    "- Preserve the kind, details, and transcript excerpt the researcher listed. Do NOT invent new candidates.",
    "- If the note ends with NO_SUGGESTIONS, return an empty suggestions array.",
    "",
    "Research note:",
    researchText,
  ].join("\n");

  try {
    const { object, usage: extractionUsage } = await generateStructuredObject({
      model: deps.model,
      schema: agentSuggestionSchema,
      prompt: extractionPrompt,
      temperature: 0,
    });

    return {
      suggestions: object.suggestions,
      usage: {
        inputTokens:
          (researchUsage?.inputTokens ?? 0) +
          (extractionUsage?.inputTokens ?? 0),
        outputTokens:
          (researchUsage?.outputTokens ?? 0) +
          (extractionUsage?.outputTokens ?? 0),
      },
      steps: stepsTaken,
    };
  } catch (error) {
    if (deps.debug) {
      log(
        "WARN",
        `Suggestion agent extraction phase failed: ${toReadableError(error)}`,
      );
    }
    throw error;
  }
}
