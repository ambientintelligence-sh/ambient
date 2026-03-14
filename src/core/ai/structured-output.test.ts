import { describe, expect, it } from "vitest";
import { extractJsonObjectText, isFireworksLanguageModel } from "./structured-output";

describe("isFireworksLanguageModel", () => {
  it("detects Fireworks string model ids", () => {
    expect(isFireworksLanguageModel("accounts/fireworks/models/minimax-m2p5")).toBe(true);
    expect(isFireworksLanguageModel("openai/gpt-oss-20b")).toBe(false);
  });

  it("detects Fireworks model objects", () => {
    expect(
      isFireworksLanguageModel({
        provider: "fireworks.chat",
        modelId: "accounts/fireworks/models/gpt-oss-20b",
      } as never),
    ).toBe(true);
  });
});

describe("extractJsonObjectText", () => {
  it("accepts fenced json", () => {
    expect(extractJsonObjectText("```json\n{\"ok\":true}\n```")).toBe("{\"ok\":true}");
  });

  it("extracts surrounding prose from a json object", () => {
    expect(extractJsonObjectText("Here you go:\n{\"ok\":true}\nThanks")).toBe("{\"ok\":true}");
  });
});
