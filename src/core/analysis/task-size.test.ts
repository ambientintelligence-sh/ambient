import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";
import { generateObject } from "ai";
import { classifyTaskSize } from "./task-size";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

const mockedGenerateObject = vi.mocked(generateObject);
const DUMMY_MODEL = {} as LanguageModel;

describe("classifyTaskSize", () => {
  beforeEach(() => {
    mockedGenerateObject.mockReset();
  });

  it("returns small when classifier says small", async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        size: "small",
        reason: "Single low-risk action",
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await classifyTaskSize(DUMMY_MODEL, "Email the venue");
    expect(result.size).toBe("small");
  });

  it("returns large when classifier says large", async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        size: "large",
        reason: "Needs multi-step planning",
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await classifyTaskSize(DUMMY_MODEL, "Plan the full migration rollout");
    expect(result.size).toBe("large");
  });

  it("falls back to large when classifier throws", async () => {
    mockedGenerateObject.mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await classifyTaskSize(DUMMY_MODEL, "Book flight");
    expect(result.size).toBe("large");
    expect(result.reason).toContain("Classifier error:");
  });
});
