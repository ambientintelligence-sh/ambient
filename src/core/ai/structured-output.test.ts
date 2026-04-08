import { describe, expect, it } from "vitest";
import { extractJsonObjectText } from "./structured-output";

describe("extractJsonObjectText", () => {
  it("accepts fenced json", () => {
    expect(extractJsonObjectText("```json\n{\"ok\":true}\n```")).toBe("{\"ok\":true}");
  });

  it("extracts surrounding prose from a json object", () => {
    expect(extractJsonObjectText("Here you go:\n{\"ok\":true}\nThanks")).toBe("{\"ok\":true}");
  });
});
