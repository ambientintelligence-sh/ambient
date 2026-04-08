import fs from "node:fs";
import path from "node:path";
import type { AudioSource, TranscriptBlock } from "./types";
import { normalizeText } from "./text/text-utils";

export type ContextState = {
  contextBuffer: string[];
  recentTranslations: Set<string>;
  recentTranslationQueue: string[];
  transcriptBlocks: Map<number, TranscriptBlock>;
  nextBlockId: number;
  allKeyPoints: string[];
  allEducationalInsights: string[];
};

const CONTEXT_WINDOW_SIZE = 10;
const RECENT_TRANSLATION_LIMIT = 20;

export function createContextState(): ContextState {
  return {
    contextBuffer: [],
    recentTranslations: new Set(),
    recentTranslationQueue: [],
    transcriptBlocks: new Map(),
    nextBlockId: 1,
    allKeyPoints: [],
    allEducationalInsights: [],
  };
}

export function resetContextState(state: ContextState) {
  state.contextBuffer.length = 0;
  state.transcriptBlocks.clear();
  state.nextBlockId = 1;
  // Keep allKeyPoints and allEducationalInsights across resets for session continuity.
}

export function recordContext(state: ContextState, sentence: string) {
  state.contextBuffer.push(sentence);
  if (state.contextBuffer.length > CONTEXT_WINDOW_SIZE) {
    state.contextBuffer.shift();
  }
}

export function getContextWindow(state: ContextState): string[] {
  return state.contextBuffer.slice(-CONTEXT_WINDOW_SIZE);
}

export function rememberTranslation(state: ContextState, text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (state.recentTranslations.has(normalized)) return false;
  state.recentTranslations.add(normalized);
  state.recentTranslationQueue.push(normalized);
  if (state.recentTranslationQueue.length > RECENT_TRANSLATION_LIMIT) {
    const oldest = state.recentTranslationQueue.shift();
    if (oldest) state.recentTranslations.delete(oldest);
  }
  return true;
}

export function createBlock(
  state: ContextState,
  sourceLabel: string,
  sourceText: string,
  targetLabel: string,
  translation?: string,
  audioSource: AudioSource = "system"
): TranscriptBlock {
  const block: TranscriptBlock = {
    id: state.nextBlockId,
    sourceLabel,
    sourceText,
    targetLabel,
    translation,
    createdAt: Date.now(),
    audioSource,
  };
  state.transcriptBlocks.set(state.nextBlockId, block);
  state.nextBlockId += 1;
  return block;
}

export function loadAgentsMd(): string {
  const agentsMdPath = path.resolve(process.cwd(), "agents.md");
  if (!fs.existsSync(agentsMdPath)) return "";
  return fs.readFileSync(agentsMdPath, "utf-8");
}

export function writeSummaryLog(allKeyPoints: string[]) {
  if (allKeyPoints.length === 0) return;
  const summaryLogFile = path.join(process.cwd(), "summary.log");
  const ts = new Date().toISOString();
  const lines = [
    `\n--- Session: ${ts} ---`,
    ...allKeyPoints.map((p) => `\u2022 ${p}`),
    "",
  ].join("\n");
  fs.appendFileSync(summaryLogFile, lines);
}
