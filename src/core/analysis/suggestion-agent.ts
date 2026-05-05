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
import type { ScreenshotResult } from "../screenshot";
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
  captureScreenshot?: () => Promise<ScreenshotResult>;
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
  connectedMcpTools: readonly string[];
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

const SYSTEM_PROMPT = `You listen in on a live conversation like a close friend who happens to know a lot. Your job is to pass one useful note while the speakers keep talking, not to create busywork. Think of a very smart person in a meeting quietly sliding over a note like "that number is probably wrong" or "we already decided this last week." You have two choices you can leverage: callout or agent_suggestion. A callout is a quick helpful note the user can read and dismiss, useful for facts, contradictions, reminders, risks, missing context, or "you should know this now" moments. An agent_suggestion is for investigative or background work that deserves a long-running agent, especially larger tasks like coding, multi-step research, drafting, comparison, synthesis, verification across sources, or interacting with connected external MCP tools. If the value is the note itself, choose callout. If you primarily found an angle that could use deeper investigation, choose agent_suggestion and phrase it like "I found X aspect we can look further into" or "This looks worth a deeper pass because Y." Do not ask a generic "want me to"; make the deeper path specific.

Before you suggest, investigate when it helps, but be decisive. You have up to 8 tool-calling steps and should usually spend them on one or two targeted lookups. Use getTranscriptContext to read older blocks from this session, searchTranscriptHistory to catch prior decisions or stale duplicates, searchWeb for current external facts like prices, legal context, recent news, official docs, or exact figures, and captureScreenshot whenever visual context would help, especially when the speakers refer to a slide, doc, chart, inbox, app, or code on screen. For concrete public claims, do one quick verification pass, compare the top snippets, and stop once you can confirm, dispute, or sharpen the claim.

Lead with something concrete: a number, name, date, decision, contradiction, concern, or prior commitment. Never suggest edits to the transcript, notes, or summary. Never repeat historical suggestions. Ignore bracketed non-speech tags. Treat automatic speech recognition errors as invisible upstream artifacts and do not comment on transcript quality, truncation, garbling, misheard words, or recording issues. If a phrase looks more like ASR trouble than a real conversation error, skip it silently. Stop as soon as you have one concrete finding worth surfacing.

Write like a friend, not a research assistant: short, natural, first-person, and specific. Avoid question-offer phrasing like "Want me to compare X to Y?", "Should I pull specific data on Z?", "Want me to analyze...", or "Want me to explore the historical context of..." because that sounds like busywork. For callouts, TEXT can be the note itself, such as "Small flag: the March UN figure I found is 38M, not 45M" or "You already decided last week that April 12 was the launch cutoff." For agent_suggestion, TEXT should name the concrete deeper investigation or larger task, such as "I found the market-size claim hinges on unit sales; a deeper pass should pull current figures and reframe it" or "This sounds like a coding task; use the repo context to trace the failing route and patch it." If connected MCP tools are listed in the user prompt, you may mention a specific provider or tool when it is clearly relevant, such as Linear for issue/project work or Notion for docs, but do not invent tools that are not listed. Name the specific number, date, person, tool, repo, document, or decision.

Output plain text, no JSON. First write a 2-4 line note summarizing what tools you called and/or what concrete concern you noticed. Then, for each candidate suggestion, write this block:
SURFACE: <callout|agent_suggestion>
KIND: <research|action|insight|flag|followup>
FLAG: <short concrete issue, risk, contradiction, or opportunity you noticed>
TEXT: <short useful callout note OR concrete investigative task to dispatch>
DETAILS: <one-line rationale grounded in what your tool calls returned>
EXCERPT: <verbatim transcript quote, optional>

Return 0-3 candidate suggestions. If you genuinely did not find anything concrete in either the transcript or tools, write the note and then the single line: NO_SUGGESTIONS.`;

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

const CaptureScreenshotSchema = Type.Object({});

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

  if (deps.captureScreenshot) {
    const capture = deps.captureScreenshot;
    tools.push({
      name: "captureScreenshot",
      label: "Look at the screen",
      description:
        "Capture a screenshot of the user's primary display right now and look at it. Use this freely whenever seeing what's on screen would help you understand what the user is doing — what app they're in, what document/slide/chart they're looking at, what code they're editing, what they're reacting to. You don't need a strong justification; if it might add useful context, take a look.",
      parameters: CaptureScreenshotSchema,
      execute: async () => {
        emitStep("Looking at your screen…");
        try {
          const res = await capture();
          if (res.ok === false) {
            if (deps.debug) {
              log("WARN", `Suggestion agent captureScreenshot failed: ${res.error}`);
            }
            return jsonResult({
              error: res.error,
              permissionRequired: res.permissionRequired ?? false,
            });
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Screenshot of ${res.displayLabel} (${res.width}x${res.height}).`,
              },
              {
                type: "image" as const,
                data: res.data,
                mimeType: res.mimeType,
              },
            ],
            details: {
              width: res.width,
              height: res.height,
              displayLabel: res.displayLabel,
            },
          };
        } catch (error) {
          const message = toReadableError(error);
          if (deps.debug) {
            log("WARN", `Suggestion agent captureScreenshot threw: ${message}`);
          }
          return jsonResult({
            error: message,
            hint: "Screenshot capture failed. Continue with transcript-only reasoning.",
          });
        }
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
    input.connectedMcpTools,
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
    }
  } catch (error) {
    if (deps.debug) {
      log("WARN", `Suggestion agent research phase failed: ${toReadableError(error)}`);
    }
    throw error;
  }

  emitStep("Drafting suggestions…");

  if (!researchText || /\bNO_SUGGESTIONS\b/.test(researchText)) {
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
    "- Preserve the surface, kind, flag, details, and transcript excerpt the researcher listed. Do NOT invent new candidates.",
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
