import { describe, expect, it } from "vitest";
import {
  buildAnalysisPrompt,
  buildAgentSuggestionPrompt,
  buildAgentsSummaryPrompt,
  buildTaskFromSelectionPrompt,
  agentsSummarySchema,
  finalSummarySchema,
} from "./analysis";
import type { Agent, TranscriptBlock } from "../types";

const SAMPLE_BLOCKS: TranscriptBlock[] = [
  {
    id: 1,
    sourceLabel: "English",
    sourceText: "I want to visit Austin next month.",
    targetLabel: "Korean",
    translation: "다음 달에 오스틴을 방문하고 싶어요.",
    createdAt: 1,
    audioSource: "system",
  },
];

describe("buildAnalysisPrompt", () => {
  it("includes transcript content and session grounding rules", () => {
    const prompt = buildAnalysisPrompt(
      SAMPLE_BLOCKS,
      ["Plan trip dates"],
    );
    expect(prompt).toContain("[system] I want to visit Austin next month.");
    expect(prompt).toContain("Summary of conversation so far:");
    expect(prompt).toContain("Grounding requirements:");
    expect(prompt).toContain("Do not use memory from prior sessions.");
  });
});

describe("buildAgentSuggestionPrompt", () => {
  it("includes transcript and existing tasks", () => {
    const prompt = buildAgentSuggestionPrompt(SAMPLE_BLOCKS, [{ text: "Book flights", completed: false }]);
    expect(prompt).toContain("[system] I want to visit Austin next month.");
    expect(prompt).toContain("Existing tasks:");
    expect(prompt).toContain("[ ] Book flights");
    expect(prompt).toContain("kind");
    expect(prompt).toContain("text");
    expect(prompt).toContain("transcriptExcerpt");
  });

  it("includes historical suggestions context", () => {
    const prompt = buildAgentSuggestionPrompt(
      SAMPLE_BLOCKS,
      [{ text: "Book flights", completed: false }],
      ["Research neighborhoods in Austin", "Dive into whether to rent a car?"],
    );
    expect(prompt).toContain("Historical suggestions already shown in this session");
    expect(prompt).toContain("- Research neighborhoods in Austin");
    expect(prompt).toContain("- Dive into whether to rent a car?");
  });

  it("includes key points and educational context when provided", () => {
    const prompt = buildAgentSuggestionPrompt(
      SAMPLE_BLOCKS,
      [],
      [],
      ["Plan trip dates"],
      ["Austin has major events that can affect hotel prices"],
    );
    expect(prompt).toContain("Conversation context (key points from earlier in this meeting):");
    expect(prompt).toContain("- Plan trip dates");
    expect(prompt).toContain("Prior educational insights");
    expect(prompt).toContain("- Austin has major events that can affect hotel prices");
  });
});

describe("buildTaskFromSelectionPrompt", () => {
  it("includes shared task structure and user intent", () => {
    const prompt = buildTaskFromSelectionPrompt(
      "We should benchmark Gemini against Claude this week.",
      [{ text: "Book flights", completed: false }],
      "Focus on practical coding speed differences.",
    );

    expect(prompt).toContain("User intent for task creation:");
    expect(prompt).toContain("Focus on practical coding speed differences.");
    expect(prompt).toContain("Rough thinking:");
    expect(prompt).toContain("Rough plan:");
    expect(prompt).toContain("Questions for user:");
    expect(prompt).toContain("Done when:");
    expect(prompt).toContain("Constraints:");
  });
});

describe("finalSummarySchema", () => {
  it("coerces string and nested todo shapes into TodoItem objects", () => {
    const result = finalSummarySchema.parse({
      narrative: "A concise summary.",
      agreements: ["Ship the pilot this week."],
      missedItems: ["Rollback plan was not discussed."],
      unansweredQuestions: ["Who owns approvals?"],
      agreementTodos: ["Confirm pilot owner"],
      missedItemTodos: [{ text: { content: "Draft rollback plan" }, doer: "agent" }],
      unansweredQuestionTodos: [{ task: "Clarify approver" }],
      actionItems: [{ content: ["Schedule", "follow-up review"], doer: "human" }],
    });

    expect(result.agreementTodos).toEqual([{ text: "Confirm pilot owner", doer: "human" }]);
    expect(result.missedItemTodos).toEqual([{ text: "Draft rollback plan", doer: "agent" }]);
    expect(result.unansweredQuestionTodos).toEqual([{ text: "Clarify approver", doer: "human" }]);
    expect(result.actionItems).toEqual([{ text: "Schedule follow-up review", doer: "human" }]);
  });
});

describe("agentsSummarySchema", () => {
  it("coerces wrapped narrative and highlights shapes", () => {
    const result = agentsSummarySchema.parse({
      overallNarrative: { text: "The agents completed the audit and found two gaps." },
      agentHighlights: {
        items: [
          {
            id: "agent-1",
            title: "Review auth flow",
            outcome: "success",
            summary: "Found a missing session expiry check.",
          },
        ],
      },
      coverageGaps: { items: [{ text: "Load testing" }] },
      nextSteps: { items: [{ content: "Add session expiry test" }] },
    });

    expect(result.overallNarrative).toBe("The agents completed the audit and found two gaps.");
    expect(result.agentHighlights).toEqual([
      {
        agentId: "agent-1",
        task: "Review auth flow",
        status: "completed",
        keyFinding: "Found a missing session expiry check.",
      },
    ]);
    expect(result.coverageGaps).toEqual(["Load testing"]);
    expect(result.nextSteps).toEqual(["Add session expiry test"]);
  });

  it("unwraps common top-level wrapper objects", () => {
    const result = agentsSummarySchema.parse({
      summary: {
        overallNarrative: "The agents completed the audit.",
        agentHighlights: [],
        coverageGaps: [],
        nextSteps: [],
      },
    });

    expect(result).toEqual({
      overallNarrative: "The agents completed the audit.",
      agentHighlights: [],
      coverageGaps: [],
      nextSteps: [],
    });
  });
});

describe("buildAgentsSummaryPrompt", () => {
  it("states the strict json shape requirements", () => {
    const agents: Agent[] = [{
      id: "agent-1",
      kind: "analysis",
      task: "Review auth flow",
      status: "completed",
      steps: [],
      createdAt: 1,
      completedAt: 2,
      result: "Found one issue.",
    }];

    const prompt = buildAgentsSummaryPrompt(agents, SAMPLE_BLOCKS, ["Auth review"]);
    expect(prompt).toContain("Return JSON matching the schema exactly.");
    expect(prompt).toContain('Set "overallNarrative" to a string, not an object.');
    expect(prompt).toContain('Set "agentHighlights" to an array, not an object wrapper.');
  });
});
