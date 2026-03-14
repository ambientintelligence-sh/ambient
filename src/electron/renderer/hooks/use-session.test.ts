import { describe, expect, it } from "vitest";
import { initialState, sessionStateReducer } from "./use-session";

describe("useSession reducer", () => {
  it("session-resumed sets active session and clears transient state", () => {
    const dirtyState = {
      ...initialState,
      summary: { keyPoints: ["old"], updatedAt: 1 },
      cost: 123,
      statusText: "stale status",
      errorText: "stale error",
    };

    const next = sessionStateReducer(dirtyState, {
      kind: "session-resumed",
      data: {
        sessionId: "s1",
        blocks: [],
        tasks: [],
        insights: [],
        agents: [],
      },
    });

    expect(next.sessionActive).toBe(true);
    expect(next.sessionId).toBe("s1");
    expect(next.summary).toBeNull();
    expect(next.cost).toBe(0);
    expect(next.statusText).toBe("");
    expect(next.errorText).toBe("");
  });

  it("session-cleared resets all session state", () => {
    const dirtyState = {
      ...initialState,
      sessionId: "s1",
      sessionActive: true,
      blocks: [{
        id: 1,
        sourceLabel: "ko",
        sourceText: "test",
        targetLabel: "en",
        translation: "test",
        createdAt: Date.now(),
        audioSource: "system" as const,
      }],
      rollingKeyPoints: ["point"],
      statusText: "running",
      errorText: "error",
    };

    const next = sessionStateReducer(dirtyState, { kind: "session-cleared" });
    expect(next).toEqual(initialState);
  });

  it("dedupes rolling key points when summary updates repeat content", () => {
    const state = {
      ...initialState,
      rollingKeyPoints: ["Budget approved for Q2"],
    };

    const next = sessionStateReducer(state, {
      kind: "summary-updated",
      summary: {
        keyPoints: ["Budget approved for Q2", "Need legal review before launch"],
        updatedAt: Date.now(),
      },
    });

    expect(next.rollingKeyPoints).toEqual([
      "Budget approved for Q2",
      "Need legal review before launch",
    ]);
  });

  it("session-resumed rebuilds key points in chronological order without duplicates", () => {
    const next = sessionStateReducer(initialState, {
      kind: "session-resumed",
      data: {
        sessionId: "s1",
        blocks: [],
        tasks: [],
        agents: [],
        insights: [
          {
            id: "i3",
            kind: "key-point",
            text: "Need to validate assumptions",
            createdAt: 300,
            sessionId: "s1",
          },
          {
            id: "i2",
            kind: "definition",
            text: "Irrelevant non-key insight",
            createdAt: 200,
            sessionId: "s1",
          },
          {
            id: "i1",
            kind: "key-point",
            text: "Need to validate assumptions",
            createdAt: 100,
            sessionId: "s1",
          },
        ],
      },
    });

    expect(next.rollingKeyPoints).toEqual(["Need to validate assumptions"]);
  });
});
