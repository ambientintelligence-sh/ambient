import type { LanguageModel } from "ai";
import { Agent as PiAgent, type AgentTool } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent, Message } from "@mariozechner/pi-ai";
import { Type, type Static, type TSchema } from "@sinclair/typebox";

import type {
  TranscriptBlock,
  TaskItem,
  TaskSuggestionAggressiveness,
} from "../types";
import { log } from "../logger";
import { toReadableError } from "../text/text-utils";
import { generateStructuredObject } from "../ai/structured-output";
import type { AgentPiModel } from "../providers";
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
  /** Pi-mono model used for the research/agentic phase. */
  agentModel: AgentPiModel;
  /** AI SDK model used for the structured extraction phase. */
  extractionModel: LanguageModel;
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

const STEP_BUDGET = 8;

function truncateLabel(text: string, max = 40): string {
  const clean = text.trim().replaceAll(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function jsonResult<T>(value: T) {
  return {
    content: [{ type: "text" as const, text: safeStringify(value) }],
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

function extractFinalText(messages: Message[]): string {
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

const SYSTEM_PROMPT = [
  "You listen in on a live conversation like a close friend who happens to know a lot. You speak up when you notice something specific and useful — not with generic offers.",
  "",
  "Your suggestions land in a sidebar while the speakers keep talking. Think: a friend leaning over to whisper \"hey, that number's wrong\" or \"wait, you already decided this last week\" — not a research assistant offering to write a report.",
  "",
  "Be proactive. If there's a reasonable moment to help — a fact worth looking up, a past decision worth remembering, a draft worth offering — take it. You don't need a dramatic contradiction to speak up.",
  "",
  "Before you suggest, INVESTIGATE — but be decisive. You have up to 8 tool-calling steps. Use them for ONE or TWO targeted lookups, not exhaustive research. The user is waiting; a fast, sharp finding beats a thorough one that takes 60 seconds. For checkable public claims, default to one quick verification pass instead of pure intuition. Tools available:",
  "- getTranscriptContext: read older blocks from this session to check whether the speakers already covered, resolved, or contradicted something.",
  "- searchTranscriptHistory: search prior sessions to catch stale duplicates or \"we already decided X last time\" moments.",
  "- searchWeb: look up current external facts (specific prices, exact figures, legal/regulatory context, recent news, official docs, recent releases). Use when the conversation hinges on a public claim you can quickly check.",
  "",
  "Guidelines:",
  "- Prefer suggestions that lead with a concrete thing — a specific number, name, date, decision, contradiction, concern, or prior commitment. Tool output is great, but a sharp observation from the transcript itself is also valid.",
  "- If the transcript includes a concrete public claim that is easy to check externally — a number, market size, timeline, legal/regulatory claim, named organization, historical comparison, or 'X is bigger than Y' framing — do a quick web lookup before surfacing it.",
  "- Treat one searchWeb call as the default verification pass. It already returns a few results. Compare the top 3-5 snippets and decide. Only do a second web search if the first results are thin, conflicting, or miss the exact figure you need.",
  "- Once you have enough to confirm, dispute, or sharpen the claim, stop researching and write the suggestion. Do not spiral into open-ended searching.",
  "- For each suggestion, separate the flag from the action: first identify the concrete issue/opportunity, then propose one crisp next step the user could actually accept as a task.",
  "- If the transcript contains an explicit follow-up, assignment, deadline, deliverable, research question, or comparison request, prefer returning at least 1 concrete suggestion instead of none.",
  "- If you notice a concrete concern, inconsistency, risk, or missing next step directly from the transcript, you MAY suggest it even if you did not use any tools.",
  "- If you could not verify a claim quickly, do not present it as settled fact. Frame the action as a fast verification task instead.",
  "- Suggest actions the user can either note or delegate, such as checking a fact, pulling a source, drafting a short brief, comparing options, or capturing a follow-up.",
  "- Do NOT suggest edits to the transcript, notes, or summary themselves. Avoid wording like 'rewrite this', 'change the transcript', 'capture this line verbatim', 'make sure the summary says', or anything that sounds like transcript cleanup.",
  "- Never repeat or rephrase anything in the historical suggestions list.",
  "- Ignore bracketed non-speech tags like [silence], [music], [noise], [laughs]. Preserve specifics: names, places, dates, numbers, constraints.",
  "- The transcript comes from automatic speech recognition and will contain errors: misheard words, wrong names, garbled numbers, homophones, dropped negations, sentences that cut off mid-phrase, missing words at the end of utterances. These are UPSTREAM ARTIFACTS, not things the speakers said or did. Treat them as invisible.",
  "- NEVER produce a suggestion that is meta-commentary about the transcript itself. Forbidden patterns include: 'the transcript cuts off', 'the ASR dropped / missed / garbled X', 'they probably meant Y but the transcript says Z', 'heads up, this sentence is incomplete', 'the recording seems to have lost...', or any variant of pointing out that the transcript has errors. The user already knows the transcript is imperfect — your job is to help with the conversation's CONTENT, not audit the transcription pipeline.",
  "- If a phrase looks off in a way that's more plausibly a mishearing or truncation than a real error in the conversation, skip it silently — do not suggest anything about it. Only flag a number/name/fact when you have strong evidence (a tool result) that it was actually said that way and is actually wrong on the merits.",
  "- Stop as soon as you have one concrete finding worth surfacing. Don't chase a second angle unless the first result is clearly too thin to act on. A follow-up query should be the exception, not the default.",
  "",
  "Tone and phrasing — this matters:",
  "- Write like a friend, not a research assistant. Short, natural, first-person, specific.",
  "- The FLAG is the concrete thing you noticed. The TEXT is the concrete next step or action to take because of that flag.",
  "- The TEXT should sound like a useful note or a delegate-able task, not an instruction to edit the transcript or polish meeting notes.",
  "- AVOID these patterns entirely: \"Want me to compare X to Y?\", \"Should I pull specific data on Z?\", \"Want me to identify parallels...\", \"Should I draft a comprehensive...\", \"Want me to analyze...\", \"Want me to explore the historical context of...\". These sound like busywork.",
  "- PREFER FLAG + ACTION pairs like: FLAG: \"They said 45M but the March UN report pegs it at 38M.\" TEXT: \"Check the latest UN figure and pull the source link.\"",
  "- Another strong pattern: FLAG: \"He compared it to cars and phones, but annual sales are on very different scales.\" TEXT: \"Pull current unit-sales figures and use them to frame the claim against actual market size.\"",
  "- Good actions: \"Pull the current casualty figure and source it.\" / \"Draft a one-paragraph brief on how China framed this.\" / \"Check whether Guterres made the same attribution.\"",
  "- Bad actions: \"Capture this exact line in the summary.\" / \"Rewrite the takeaway to say...\" / \"Make sure the transcript keeps the exact wording.\"",
  "- Name the specific number, date, person, or decision. No vague \"relevant context\" or \"historical parallels\".",
  "- If the finding itself is strong, the offer can be omitted entirely — the observation alone is the value.",
  "",
  "Output (plain text, no JSON):",
  "1. A 2-4 line note summarizing what tools you called and/or what concrete concern you noticed in the transcript.",
  "2. Then, for each candidate suggestion (0-3), a block like:",
  "   KIND: <research|action|insight|flag|followup>",
  "   FLAG: <short concrete issue, risk, contradiction, or opportunity you noticed>",
  "   TEXT: <short concrete next step or action the user could accept as a task>",
  "   DETAILS: <one-line rationale grounded in what your tool calls returned>",
  "   EXCERPT: <verbatim transcript quote, optional>",
  "",
  "If you genuinely didn't find anything concrete in either the transcript or tools, write the note and then the single line: NO_SUGGESTIONS.",
].join("\n");

const GetTranscriptContextSchema = Type.Object({
  last: Type.Optional(Type.Number({ description: "Number of most recent blocks to return (default 20)" })),
  offset: Type.Optional(Type.Number({ description: "Skip this many blocks from the end to page backwards (default 0)" })),
});

const SearchHistorySchema = Type.Object({
  query: Type.String({ description: "Keyword query" }),
  limit: Type.Optional(Type.Number({ description: "Max results to return (default 10)" })),
});

const SearchWebSchema = Type.Object({
  query: Type.String({ description: "The search query" }),
});

function buildTools(deps: SuggestionAgentDeps, emitStep: (label: string) => void): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];

  tools.push({
    name: "getTranscriptContext",
    label: "Read earlier transcript",
    description:
      "Read additional transcript blocks from the CURRENT session. Use when the base context is not enough to judge whether a suggestion is warranted.",
    parameters: GetTranscriptContextSchema,
    execute: async (_id, { last, offset }: Static<typeof GetTranscriptContextSchema>) => {
      emitStep("Reading earlier transcript…");
      return jsonResult(deps.getTranscriptContext(last ?? 20, offset ?? 0));
    },
  });

  if (deps.searchTranscriptHistory) {
    const search = deps.searchTranscriptHistory;
    tools.push({
      name: "searchTranscriptHistory",
      label: "Search past sessions",
      description:
        "Search transcript blocks from PAST sessions by keyword (FTS5). Use to check whether a topic was already covered before.",
      parameters: SearchHistorySchema,
      execute: async (_id, { query, limit }: Static<typeof SearchHistorySchema>) => {
        emitStep(`Searching past sessions for "${truncateLabel(query)}"…`);
        return jsonResult(search(query, limit ?? 10));
      },
    });
  }

  if (deps.exa) {
    const exa = deps.exa;
    tools.push({
      name: "searchWeb",
      label: "Search the web",
      description:
        "Search the web for current, external facts (prices, news, docs, people, companies, recent releases). Use ONLY when the conversation depends on up-to-date information your training data may not cover. Prefer specific, targeted queries.",
      parameters: SearchWebSchema,
      execute: async (_id, { query }: Static<typeof SearchWebSchema>) => {
        emitStep(`Looking up on the web: "${truncateLabel(query)}"…`);
        try {
          const results = await exa.search(query, {
            type: "auto",
            numResults: 6,
            contents: { text: { maxCharacters: 1000 } },
          });
          return jsonResult(results.results);
        } catch (error) {
          const message = toReadableError(error);
          if (deps.debug) {
            log("WARN", `Suggestion agent searchWeb failed: ${message}`);
          }
          return jsonResult({
            error: message,
            hint: "Web search is temporarily unavailable. Continue with transcript-only reasoning.",
          });
        }
      },
    });
  }

  return tools;
}

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

  emitStep("Thinking…");

  const tools = buildTools(deps, emitStep);

  const piAgent = new PiAgent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: deps.agentModel.model,
      thinkingLevel: deps.agentModel.thinkingLevel,
      messages: [],
      tools,
    },
    getApiKey: deps.agentModel.getApiKey
      ? async () => deps.agentModel.getApiKey!()
      : deps.agentModel.apiKey
        ? async () => deps.agentModel.apiKey
        : undefined,
  });

  let stepsTaken = 0;
  let researchInputTokens = 0;
  let researchOutputTokens = 0;
  let streamedText = "";
  let lastNonEmptyText = "";
  let deltaCount = 0;

  piAgent.subscribe((event) => {
    if (event.type === "turn_start") {
      stepsTaken += 1;
      if (streamedText) lastNonEmptyText = streamedText;
      streamedText = "";
      emitStep("Thinking…");
      if (stepsTaken > STEP_BUDGET) {
        piAgent.abort();
      }
    }
    if (event.type === "message_update") {
      const ev = event.assistantMessageEvent;
      if (ev.type === "text_delta") {
        deltaCount += 1;
        streamedText += ev.delta;
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const assistant = event.message as AssistantMessage;
      researchInputTokens += assistant.usage.input ?? 0;
      researchOutputTokens += assistant.usage.output ?? 0;
    }
  });

  let researchText = "";
  try {
    await piAgent.prompt(userPrompt);
    await piAgent.waitForIdle();
    if (streamedText) lastNonEmptyText = streamedText;
    const finalMessages = piAgent.state.messages as Message[];
    const last = finalMessages[finalMessages.length - 1] as AssistantMessage | Message | undefined;
    if (last && last.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
      const detail = last.stopReason === "aborted"
        ? "Suggestion agent aborted"
        : `Suggestion agent errored: ${last.errorMessage ?? "Unknown error"}`;
      if (deps.debug) {
        log("WARN", detail);
      }
      throw new Error(detail);
    }
    researchText = (extractFinalText(finalMessages) || lastNonEmptyText).trim();
    if (deps.debug) {
      const preview = researchText.length > 800 ? `${researchText.slice(0, 800)}...` : researchText;
      log("INFO", `Suggestion agent research note: ${preview || `<empty; deltas=${deltaCount}>`}`);
    }
  } catch (error) {
    if (deps.debug) {
      log("WARN", `Suggestion agent research phase failed: ${toReadableError(error)}`);
    }
    throw error;
  }

  emitStep("Drafting suggestions…");

  if (!researchText || /\bNO_SUGGESTIONS\b/.test(researchText)) {
    if (deps.debug) {
      log("INFO", `Suggestion agent returned NO_SUGGESTIONS (${researchText ? "explicit" : "empty research note"})`);
    }
    return {
      suggestions: [],
      usage: { inputTokens: researchInputTokens, outputTokens: researchOutputTokens },
      steps: stepsTaken,
    };
  }

  const extractionPrompt = [
    "Convert the following research note into the agentSuggestion schema.",
    "",
    "Rules:",
    "- Return 0-3 suggestions. Zero is acceptable and preferred over weak ones.",
    "- Preserve the researcher's exact tone and phrasing in FLAG and TEXT. Do NOT rewrite them into formal questions like 'Want me to...'.",
    "- Preserve the kind, flag, details, and transcript excerpt the researcher listed. Do NOT invent new candidates.",
    "- If the note ends with NO_SUGGESTIONS, return an empty suggestions array.",
    "",
    "Research note:",
    researchText,
  ].join("\n");

  try {
    const { object, usage: extractionUsage } = await generateStructuredObject({
      model: deps.extractionModel,
      schema: agentSuggestionSchema,
      prompt: extractionPrompt,
      temperature: 0,
    });

    return {
      suggestions: object.suggestions,
      usage: {
        inputTokens: researchInputTokens + (extractionUsage?.inputTokens ?? 0),
        outputTokens: researchOutputTokens + (extractionUsage?.outputTokens ?? 0),
      },
      steps: stepsTaken,
    };
  } catch (error) {
    if (deps.debug) {
      log("WARN", `Suggestion agent extraction phase failed: ${toReadableError(error)}`);
    }
    throw error;
  }
}
