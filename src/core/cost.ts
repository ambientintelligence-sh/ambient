import type { TranscriptionProvider, AnalysisProvider } from "./types";

type ProviderPricing = {
  audioInputPerToken: number;
  textInputPerToken: number;
  outputPerToken: number;
};

const PRICING: Record<TranscriptionProvider | AnalysisProvider, ProviderPricing> = {
  google:     { audioInputPerToken: 1.0 / 1_000_000,  textInputPerToken: 0.15 / 1_000_000, outputPerToken: 0.6 / 1_000_000 },
  vertex:     { audioInputPerToken: 1.0 / 1_000_000,  textInputPerToken: 0.5 / 1_000_000,  outputPerToken: 3.0 / 1_000_000 },
  elevenlabs: { audioInputPerToken: 0,                 textInputPerToken: 0,                 outputPerToken: 0 },
  openrouter: { audioInputPerToken: 0,                 textInputPerToken: 0.6 / 1_000_000,  outputPerToken: 2.4 / 1_000_000 },
  bedrock:    { audioInputPerToken: 0,                 textInputPerToken: 0.8 / 1_000_000,  outputPerToken: 4.0 / 1_000_000 },
  fireworks:  { audioInputPerToken: 0,                 textInputPerToken: 0.4 / 1_000_000,  outputPerToken: 1.6 / 1_000_000 },
};

export type CostAccumulator = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
};

export function createCostAccumulator(): CostAccumulator {
  return { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 };
}

export function addCost(
  acc: CostAccumulator,
  inputTokens: number,
  outputTokens: number,
  inputType: "audio" | "text",
  provider: TranscriptionProvider | AnalysisProvider = "vertex"
): number {
  const pricing = PRICING[provider];
  const inputRate = inputType === "audio"
    ? pricing.audioInputPerToken
    : pricing.textInputPerToken;
  const cost = (inputTokens * inputRate) + (outputTokens * pricing.outputPerToken);
  acc.totalInputTokens += inputTokens;
  acc.totalOutputTokens += outputTokens;
  acc.totalCost += cost;
  return acc.totalCost;
}

export function resetCost(acc: CostAccumulator) {
  acc.totalInputTokens = 0;
  acc.totalOutputTokens = 0;
  acc.totalCost = 0;
}
