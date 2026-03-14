import { describe, it, expect } from "vitest";
import {
  buildAudioPromptForStructured,
  hasTranslatableContent,
  extractSentences,
} from "./core/language";

describe("buildAudioPromptForStructured", () => {
  it("builds auto-detect prompt for structured output", () => {
    const result = buildAudioPromptForStructured("auto", "ko", "en");
    expect(result).toContain("Detect");
    expect(result).toContain("Korean or English");
    expect(result).toContain("Never translate or paraphrase the transcript into English");
    expect(result).not.toContain("JSON");
  });

  it("builds source-target prompt for structured output", () => {
    const result = buildAudioPromptForStructured("source-target", "ko", "en");
    expect(result).toContain("Korean");
    expect(result).toContain("English");
    expect(result).toContain("Transcript must stay in Korean");
  });

  it("builds reversed language prompt", () => {
    const result = buildAudioPromptForStructured("source-target", "en", "ko");
    expect(result).toContain("English");
    expect(result).toContain("Korean");
  });

  it("does not include context or summary in prompt", () => {
    const result = buildAudioPromptForStructured("auto", "ko", "en");
    expect(result).not.toContain("Context (previous sentences");
    expect(result).not.toContain("Conversation summary");
  });
});

describe("hasTranslatableContent", () => {
  it("returns true for Korean text", () => {
    expect(hasTranslatableContent("안녕하세요")).toBe(true);
  });

  it("returns true for English text", () => {
    expect(hasTranslatableContent("Hello world")).toBe(true);
  });

  it("returns true for numbers", () => {
    expect(hasTranslatableContent("12345")).toBe(true);
  });

  it("returns true for mixed content", () => {
    expect(hasTranslatableContent("Hello 안녕 123")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasTranslatableContent("")).toBe(false);
  });

  it("returns false for whitespace only", () => {
    expect(hasTranslatableContent("   ")).toBe(false);
  });

  it("returns false for symbols only", () => {
    expect(hasTranslatableContent("!@#$%^&*()")).toBe(false);
  });

  it("returns false for punctuation only", () => {
    expect(hasTranslatableContent("...???!!!")).toBe(false);
  });
});

describe("extractSentences", () => {
  it("extracts sentence ending with period", () => {
    const result = extractSentences("Hello world.");
    expect(result.sentences).toEqual(["Hello world."]);
    expect(result.remainder).toBe("");
  });

  it("extracts sentence ending with question mark", () => {
    const result = extractSentences("How are you?");
    expect(result.sentences).toEqual(["How are you?"]);
    expect(result.remainder).toBe("");
  });

  it("extracts sentence ending with exclamation", () => {
    const result = extractSentences("Great job!");
    expect(result.sentences).toEqual(["Great job!"]);
    expect(result.remainder).toBe("");
  });

  it("handles Korean sentence markers", () => {
    const result = extractSentences("안녕하세요。");
    expect(result.sentences).toEqual(["안녕하세요。"]);
  });

  it("extracts multiple sentences", () => {
    const result = extractSentences("First. Second! Third?");
    expect(result.sentences).toEqual(["First.", "Second!", "Third?"]);
    expect(result.remainder).toBe("");
  });

  it("returns remainder for incomplete sentence", () => {
    const result = extractSentences("Hello world");
    expect(result.sentences).toEqual([]);
    expect(result.remainder).toBe("Hello world");
  });

  it("handles mixed complete and incomplete sentences", () => {
    const result = extractSentences("Complete sentence. Incomplete");
    expect(result.sentences).toEqual(["Complete sentence."]);
    expect(result.remainder).toBe(" Incomplete");
  });

  it("handles newline as sentence boundary", () => {
    const result = extractSentences("First line\nSecond line");
    expect(result.sentences).toEqual(["First line"]);
    expect(result.remainder).toBe("Second line");
  });

  it("filters out non-translatable content", () => {
    const result = extractSentences("...\nHello.");
    expect(result.sentences).toEqual(["Hello."]);
  });

  it("handles empty input", () => {
    const result = extractSentences("");
    expect(result.sentences).toEqual([]);
    expect(result.remainder).toBe("");
  });
});
