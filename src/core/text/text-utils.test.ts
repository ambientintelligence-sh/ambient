import { describe, expect, it } from "vitest";
import { isLikelyDuplicateTaskText, normalizeTaskText } from "./text-utils";

describe("normalizeTaskText", () => {
  it("normalizes whitespace, case, and punctuation", () => {
    expect(normalizeTaskText("  Find places on Victoria Drive still open at 8 PM!  ")).toBe(
      "find places on victoria drive still open at 8 pm"
    );
  });
});

describe("isLikelyDuplicateTaskText", () => {
  it("matches equivalent tasks with minor wording differences", () => {
    const a = "Find pho restaurants in Vancouver open past 9 PM";
    const b = "Find a pho restaurant in Vancouver that is open after 9pm";
    expect(isLikelyDuplicateTaskText(a, b)).toBe(true);
  });

  it("matches punctuation and case variants", () => {
    expect(isLikelyDuplicateTaskText("Call Alex about taxes", "call alex about taxes.")).toBe(true);
  });

  it("does not treat unrelated tasks as duplicates", () => {
    const a = "Book a dentist appointment for next week";
    const b = "Compare internet providers in Seattle";
    expect(isLikelyDuplicateTaskText(a, b)).toBe(false);
  });
});
