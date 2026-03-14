import { describe, it, expect } from "vitest";
import { pcmToWavBuffer } from "./core/audio/audio-utils";
import {
  normalizeText,
  cleanTranslationOutput,
  toReadableError,
} from "./core/text/text-utils";

describe("pcmToWavBuffer", () => {
  it("creates valid WAV header", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    expect(wav.length).toBe(44 + 100);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.toString("ascii", 36, 40)).toBe("data");
  });

  it("sets correct file size in header", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const chunkSize = wav.readUInt32LE(4);
    expect(chunkSize).toBe(36 + 100);
  });

  it("sets correct sample rate", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const sampleRate = wav.readUInt32LE(24);
    expect(sampleRate).toBe(16000);
  });

  it("sets mono channel", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const numChannels = wav.readUInt16LE(22);
    expect(numChannels).toBe(1);
  });

  it("sets 16-bit sample depth", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const bitsPerSample = wav.readUInt16LE(34);
    expect(bitsPerSample).toBe(16);
  });

  it("sets correct byte rate", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const byteRate = wav.readUInt32LE(28);
    expect(byteRate).toBe(16000 * 1 * 2);
  });

  it("copies PCM data after header", () => {
    const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const wav = pcmToWavBuffer(pcm, 16000);

    expect(wav[44]).toBe(0x01);
    expect(wav[45]).toBe(0x02);
    expect(wav[46]).toBe(0x03);
    expect(wav[47]).toBe(0x04);
  });

  it("handles different sample rates", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 44100);

    const sampleRate = wav.readUInt32LE(24);
    expect(sampleRate).toBe(44100);
  });
});

describe("normalizeText", () => {
  it("trims whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeText("hello   world")).toBe("hello world");
  });

  it("handles tabs and newlines", () => {
    expect(normalizeText("hello\t\nworld")).toBe("hello world");
  });

  it("returns empty string for whitespace only", () => {
    expect(normalizeText("   ")).toBe("");
  });

  it("handles mixed whitespace", () => {
    expect(normalizeText("  hello \n\t world  ")).toBe("hello world");
  });
});

describe("cleanTranslationOutput", () => {
  it("returns first non-header line", () => {
    expect(cleanTranslationOutput("Hello world")).toBe("Hello world");
  });

  it("filters out markdown headers", () => {
    expect(cleanTranslationOutput("# Header\nActual content")).toBe(
      "Actual content"
    );
  });

  it("filters out Translation: prefix lines", () => {
    expect(cleanTranslationOutput("Translation:\nThe content")).toBe(
      "The content"
    );
  });

  it("filters out Explanation: prefix lines", () => {
    expect(cleanTranslationOutput("Explanation of the text\nActual")).toBe(
      "Actual"
    );
  });

  it("filters out Breakdown: prefix lines", () => {
    expect(cleanTranslationOutput("Breakdown of sentence\nResult")).toBe(
      "Result"
    );
  });

  it("removes leading dash", () => {
    expect(cleanTranslationOutput("- The translation")).toBe("The translation");
  });

  it("removes leading en-dash", () => {
    expect(cleanTranslationOutput("– The translation")).toBe("The translation");
  });

  it("removes leading em-dash", () => {
    expect(cleanTranslationOutput("— The translation")).toBe("The translation");
  });

  it("handles empty input", () => {
    expect(cleanTranslationOutput("")).toBe("");
  });

  it("handles whitespace only", () => {
    expect(cleanTranslationOutput("   \n   ")).toBe("");
  });

  it("falls back to first line if all lines are headers", () => {
    expect(cleanTranslationOutput("# Header\n## Another")).toBe("# Header");
  });
});

describe("toReadableError", () => {
  it("extracts message from Error", () => {
    const error = new Error("Something went wrong");
    expect(toReadableError(error)).toBe("Something went wrong");
  });

  it("converts string to string", () => {
    expect(toReadableError("Plain string error")).toBe("Plain string error");
  });

  it("returns Unknown error for number", () => {
    expect(toReadableError(404)).toBe("Unknown error");
  });

  it("returns Unknown error for null", () => {
    expect(toReadableError(null)).toBe("Unknown error");
  });

  it("returns Unknown error for undefined", () => {
    expect(toReadableError(undefined)).toBe("Unknown error");
  });

  it("returns Unknown error for plain object", () => {
    expect(toReadableError({ code: "ERR" })).toBe("Unknown error");
  });

  it("extracts message from error-like object", () => {
    expect(toReadableError({ message: "oops" })).toBe("oops");
  });

  it("maps provider auth errors to actionable message", () => {
    expect(toReadableError("User not found.")).toBe(
      "OpenRouter request failed with 'User not found'. This can be caused by an OpenRouter outage or an invalid OPENROUTER_API_KEY."
    );
  });

  it("enriches generic provider errors from response body", () => {
    expect(
      toReadableError({
        message: "Provider returned error",
        responseBody: JSON.stringify({ error: { message: "User not found." } }),
      })
    ).toBe(
      "OpenRouter request failed with 'User not found'. This can be caused by an OpenRouter outage or an invalid OPENROUTER_API_KEY."
    );
  });

  it("adds HTTP status for generic provider errors without details", () => {
    expect(
      toReadableError({
        message: "Provider returned error",
        statusCode: 401,
      })
    ).toBe("Provider returned error (HTTP 401).");
  });

  it("extracts nested provider error from metadata.raw payload", () => {
    expect(
      toReadableError({
        message: "Provider returned error",
        responseBody: JSON.stringify({
          error: {
            message: "Provider returned error",
            metadata: {
              raw: JSON.stringify({ error: "Model did not output valid JSON." }),
            },
          },
        }),
      })
    ).toBe("Model did not output valid JSON.");
  });
});
