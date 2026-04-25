import { describe, expect, it } from "vitest";

import { countScanWords } from "./text-utils";

describe("countScanWords", () => {
  it("counts latin words by whitespace-delimited tokens", () => {
    expect(countScanWords("hello world from ambient")).toBe(4);
  });

  it("counts CJK characters so scan progress advances sanely", () => {
    expect(countScanWords("你好世界")).toBe(4);
    expect(countScanWords("오늘회의")).toBe(4);
    expect(countScanWords("こんにちは")).toBe(5);
  });

  it("handles mixed latin and CJK text", () => {
    expect(countScanWords("今天 meeting notes")).toBe(4);
  });
});
