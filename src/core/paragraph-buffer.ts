import { z } from "zod";
import type { LanguageModel } from "ai";
import type { AudioSource, LanguageCode } from "./types";
import { log } from "./logger";
import { toReadableError } from "./text/text-utils";
import {
  getTranscriptPolishPromptTemplate,
  renderPromptTemplate,
} from "./prompt-loader";
import { generateStructuredObject } from "./ai/structured-output";

type PendingParagraph = {
  transcript: string;
  detectedLangHint: LanguageCode;
  audioSource: AudioSource;
  capturedAt: number;
  lastUpdatedAt: number;
};

export type ParagraphBufferDeps = {
  utilitiesModel: LanguageModel;
  trackCost: (input: number, output: number, type: "text", provider: string) => void;
  emitPartial: (source: AudioSource | null, text: string) => void;
  commitTranscript: (transcript: string, lang: LanguageCode, source: AudioSource, capturedAt: number) => Promise<void>;
  debug: boolean;
};

export class ParagraphBuffer {
  private readonly pendingParagraphs = new Map<AudioSource, PendingParagraph>();
  private polishInFlight = false;
  private readonly commitIntervalMs = 6_000;
  private readonly deps: ParagraphBufferDeps;

  constructor(deps: ParagraphBufferDeps) {
    this.deps = deps;
  }

  queue(
    transcript: string,
    detectedLangHint: LanguageCode,
    audioSource: AudioSource,
    capturedAt: number,
  ): void {
    const incoming = transcript.trim();
    if (!incoming) return;

    const existing = this.pendingParagraphs.get(audioSource);
    if (!existing) {
      this.pendingParagraphs.set(audioSource, {
        transcript: incoming,
        detectedLangHint,
        audioSource,
        capturedAt,
        lastUpdatedAt: Date.now(),
      });
    } else {
      existing.transcript = this.mergeParagraphTranscript(existing.transcript, incoming);
      existing.detectedLangHint = detectedLangHint;
      existing.lastUpdatedAt = Date.now();
    }

    this.updatePreview();

    const now = Date.now();
    const pending = this.pendingParagraphs.get(audioSource)!;
    if (now - pending.capturedAt >= this.commitIntervalMs) {
      void this.commitPending([audioSource]);
    }
  }

  async commitPending(sources?: AudioSource[]): Promise<void> {
    if (this.polishInFlight) return;
    const candidates = sources
      ? [...this.pendingParagraphs.values()].filter((p) => sources.includes(p.audioSource))
      : [...this.pendingParagraphs.values()];
    if (candidates.length === 0) return;

    this.polishInFlight = true;
    try {
      for (const pending of candidates) {
        const current = this.pendingParagraphs.get(pending.audioSource);
        if (!current) continue;

        const textToPolish = current.transcript.trim();
        if (!textToPolish) {
          this.pendingParagraphs.delete(pending.audioSource);
          this.updatePreview();
          continue;
        }

        const polished = await this.polishTranscript(textToPolish);

        // Check if new text arrived while polishing. Keep the excess.
        const latest = this.pendingParagraphs.get(pending.audioSource);
        if (latest) {
          const currentText = latest.transcript.trim();
          const excess = currentText.length > textToPolish.length
            ? currentText.slice(textToPolish.length).trim()
            : "";
          if (excess) {
            latest.transcript = excess;
            latest.lastUpdatedAt = Date.now();
          } else {
            this.pendingParagraphs.delete(pending.audioSource);
          }
        }
        this.updatePreview();

        await this.deps.commitTranscript(
          polished,
          pending.detectedLangHint,
          pending.audioSource,
          pending.capturedAt,
        );
      }
    } finally {
      this.polishInFlight = false;
    }
  }

  clear(): void {
    this.pendingParagraphs.clear();
  }

  get hasPending(): boolean {
    return this.pendingParagraphs.size > 0;
  }

  get pendingCount(): number {
    return this.pendingParagraphs.size;
  }

  private mergeParagraphTranscript(existing: string, incoming: string): string {
    const a = existing.trim();
    const b = incoming.trim();
    if (!a) return b;
    if (!b) return a;
    if (a.endsWith(b)) return a;
    if (b.startsWith(a)) return b;
    return `${a} ${b}`.replace(/\s+/g, " ").trim();
  }

  private updatePreview(): void {
    for (const [src, para] of this.pendingParagraphs) {
      this.deps.emitPartial(src, para.transcript);
    }
    if (this.pendingParagraphs.size === 0) {
      this.deps.emitPartial(null, "");
    }
  }

  private async polishTranscript(transcript: string): Promise<string> {
    const trimmed = transcript.trim();
    if (trimmed.length < 20) return trimmed;

    const prompt = renderPromptTemplate(getTranscriptPolishPromptTemplate(), {
      transcript: trimmed,
    });

    try {
      const { object, usage } = await generateStructuredObject({
        model: this.deps.utilitiesModel,
        schema: z.object({ polished: z.string() }),
        prompt,
        temperature: 0,
      });

      this.deps.trackCost(usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, "text", "openrouter");

      const polished = (object as { polished: string }).polished.trim();
      return polished || trimmed;
    } catch (error) {
      if (this.deps.debug) {
        log("WARN", `Transcript polish failed: ${toReadableError(error)}`);
      }
      return trimmed;
    }
  }
}
