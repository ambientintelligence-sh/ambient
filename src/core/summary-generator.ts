import type { LanguageModel } from "ai";
import type {
  Agent,
  AgentsSummary,
  FinalSummary,
  TranscriptBlock,
} from "./types";
import { log } from "./logger";
import { toReadableError } from "./text/text-utils";
import {
  finalSummarySchema,
  agentsSummarySchema,
  buildFinalSummaryPrompt,
  buildAgentsSummaryPrompt,
} from "./analysis/analysis";
import { generateStructuredObject } from "./ai/structured-output";
import type { AppDatabase } from "./db/db";

function formatSummaryError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return toReadableError(error);
}

export type SummaryGeneratorDeps = {
  synthesisModel: LanguageModel;
  synthesisModelId: string;
  sessionId: string;
  db: AppDatabase | null;
  trackCost: (input: number, output: number, type: "text", provider: string) => void;
};

export async function generateFinalSummary(
  blocks: TranscriptBlock[],
  keyPoints: readonly string[],
  deps: SummaryGeneratorDeps,
): Promise<FinalSummary> {
  const prompt = buildFinalSummaryPrompt(blocks, keyPoints);

  const { object, usage } = await generateStructuredObject({
    model: deps.synthesisModel,
    schema: finalSummarySchema,
    prompt,
    temperature: 0,
  });

  deps.trackCost(usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, "text", "openrouter");

  const summary: FinalSummary = {
    narrative: object.narrative.trim(),
    agreements: object.agreements.map((item) => item.trim()).filter(Boolean),
    missedItems: object.missedItems.map((item) => item.trim()).filter(Boolean),
    unansweredQuestions: object.unansweredQuestions.map((item) => item.trim()).filter(Boolean),
    agreementTodos: object.agreementTodos
      .map((item) => ({ text: item.text.trim(), doer: item.doer }))
      .filter((item) => item.text),
    missedItemTodos: object.missedItemTodos
      .map((item) => ({ text: item.text.trim(), doer: item.doer }))
      .filter((item) => item.text),
    unansweredQuestionTodos: object.unansweredQuestionTodos
      .map((item) => ({ text: item.text.trim(), doer: item.doer }))
      .filter((item) => item.text),
    actionItems: object.actionItems
      .map((item) => ({ text: item.text.trim(), doer: item.doer }))
      .filter((item) => item.text),
    modelId: deps.synthesisModelId,
    generatedAt: Date.now(),
  };

  deps.db?.saveFinalSummary(deps.sessionId, summary);
  return summary;
}

export async function generateAgentsSummary(
  agents: Agent[],
  blocks: TranscriptBlock[],
  keyPoints: readonly string[],
  deps: SummaryGeneratorDeps,
): Promise<AgentsSummary> {
  const prompt = buildAgentsSummaryPrompt(agents, blocks, keyPoints);

  const { object, usage } = await generateStructuredObject({
    model: deps.synthesisModel,
    schema: agentsSummarySchema,
    prompt,
    temperature: 0,
  });

  deps.trackCost(usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, "text", "openrouter");

  const totalDurationSecs = agents.reduce((acc, a) => {
    return acc + (a.completedAt && a.createdAt
      ? Math.round((a.completedAt - a.createdAt) / 1000) : 0);
  }, 0);

  const summary: AgentsSummary = {
    overallNarrative: object.overallNarrative.trim(),
    agentHighlights: object.agentHighlights,
    coverageGaps: object.coverageGaps,
    nextSteps: object.nextSteps.map((s) => s.trim()).filter(Boolean),
    modelId: deps.synthesisModelId,
    generatedAt: Date.now(),
    totalAgents: agents.length,
    succeededAgents: agents.filter((a) => a.status === "completed").length,
    failedAgents: agents.filter((a) => a.status === "failed").length,
    totalDurationSecs,
  };

  deps.db?.saveAgentsSummary(deps.sessionId, summary);
  return summary;
}

export { formatSummaryError };
