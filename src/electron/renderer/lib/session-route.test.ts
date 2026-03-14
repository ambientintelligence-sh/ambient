import { describe, expect, it } from "vitest";
import { buildSessionPath, parseSessionRoute } from "./session-route";

describe("session routes", () => {
  it("parses root-like routes as /chat", () => {
    expect(parseSessionRoute("/")).toEqual({
      sessionId: null,
      normalizedPath: "/chat",
      valid: true,
    });
    expect(parseSessionRoute("/index.html")).toEqual({
      sessionId: null,
      normalizedPath: "/chat",
      valid: true,
    });
    expect(parseSessionRoute("/chat")).toEqual({
      sessionId: null,
      normalizedPath: "/chat",
      valid: true,
    });
    expect(parseSessionRoute("")).toEqual({
      sessionId: null,
      normalizedPath: "/chat",
      valid: true,
    });
    expect(parseSessionRoute("#/chat")).toEqual({
      sessionId: null,
      normalizedPath: "/chat",
      valid: true,
    });
  });

  it("parses /chat/:sessionId and #/chat/:sessionId", () => {
    expect(parseSessionRoute("/chat/abc")).toEqual({
      sessionId: "abc",
      normalizedPath: "/chat/abc",
      valid: true,
    });
    expect(parseSessionRoute("#/chat/abc")).toEqual({
      sessionId: "abc",
      normalizedPath: "/chat/abc",
      valid: true,
    });
  });

  it("normalizes invalid paths to /chat", () => {
    expect(parseSessionRoute("/chat/abc/def")).toEqual({
      sessionId: null,
      normalizedPath: "/chat",
      valid: false,
    });
    expect(parseSessionRoute("/unknown")).toEqual({
      sessionId: null,
      normalizedPath: "/chat",
      valid: false,
    });
  });

  it("builds /chat and /chat/:sessionId paths", () => {
    expect(buildSessionPath(null)).toBe("/chat");
    expect(buildSessionPath("")).toBe("/chat");
    expect(buildSessionPath("abc")).toBe("/chat/abc");
  });
});
