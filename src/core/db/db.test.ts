import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, type AppDatabase } from "./db";
import type { TranscriptBlock, TaskItem, Insight, Agent, FinalSummary } from "../types";

let db: AppDatabase;

beforeEach(() => {
  db = createDatabase(":memory:");
});

describe("sessions", () => {
  it("creates and retrieves a session", () => {
    db.createSession("s1", undefined, undefined, "Test Session");
    const sessions = db.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s1");
    expect(sessions[0].title).toBe("Test Session");
    expect(sessions[0].endedAt).toBeUndefined();
    expect(sessions[0].blockCount).toBe(0);
  });

  it("ends a session with timestamp and block count", () => {
    db.createSession("s1");

    const block: TranscriptBlock = {
      id: 1,
      sourceLabel: "Korean",
      sourceText: "안녕하세요",
      targetLabel: "English",
      translation: "Hello",
      audioSource: "system",
      partial: false,
      newTopic: false,
      createdAt: Date.now(),
    };
    db.insertBlock("s1", block);

    db.endSession("s1");
    const sessions = db.getSessions();
    expect(sessions[0].endedAt).toBeDefined();
    expect(sessions[0].blockCount).toBe(1);
  });

  it("treats a session as non-empty when related records exist", () => {
    db.createSession("s1");
    expect(db.isSessionEmpty("s1")).toBe(true);

    db.insertInsight({
      id: "i1",
      kind: "key-point",
      text: "Point A",
      sessionId: "s1",
      createdAt: Date.now(),
    });

    expect(db.isSessionEmpty("s1")).toBe(false);
  });

  it("detects late-arriving records after endSession", () => {
    db.createSession("s1");
    db.endSession("s1");
    expect(db.isSessionEmpty("s1")).toBe(true);

    db.insertBlock("s1", {
      id: 1,
      sourceLabel: "K",
      sourceText: "hello",
      targetLabel: "E",
      audioSource: "system",
      partial: false,
      newTopic: false,
      createdAt: Date.now(),
    });

    expect(db.isSessionEmpty("s1")).toBe(false);
  });

  it("returns sessions ordered by most recent first", () => {
    // Insert with explicit timestamps via raw DB to guarantee ordering
    db.raw.prepare("INSERT INTO sessions (id, started_at, title) VALUES (?, ?, ?)").run("s1", 1000, "First");
    db.raw.prepare("INSERT INTO sessions (id, started_at, title) VALUES (?, ?, ?)").run("s2", 2000, "Second");
    const sessions = db.getSessions();
    expect(sessions[0].id).toBe("s2");
    expect(sessions[1].id).toBe("s1");
  });

  it("respects limit parameter", () => {
    db.createSession("s1");
    db.createSession("s2");
    db.createSession("s3");
    expect(db.getSessions(2)).toHaveLength(2);
  });

  it("persists source and target language", () => {
    db.createSession("s1", "ko", "en");
    const sessions = db.getSessions();
    expect(sessions[0].sourceLang).toBe("ko");
    expect(sessions[0].targetLang).toBe("en");
  });

  it("returns undefined langs when not provided", () => {
    db.createSession("s1");
    const sessions = db.getSessions();
    expect(sessions[0].sourceLang).toBeUndefined();
    expect(sessions[0].targetLang).toBeUndefined();
  });

  it("deletes a session and its blocks and insights", () => {
    db.createSession("s1");
    db.insertBlock("s1", {
      id: 1, sourceLabel: "K", sourceText: "hello", targetLabel: "E",
      translation: "hi", audioSource: "system", partial: false, newTopic: false, createdAt: Date.now(),
    });
    db.insertInsight({
      id: "i1", kind: "key-point", text: "Important", sessionId: "s1", createdAt: Date.now(),
    });

    db.deleteSession("s1");

    expect(db.getSessions()).toHaveLength(0);
    expect(db.getBlocksForSession("s1")).toHaveLength(0);
    expect(db.getRecentInsights()).toHaveLength(0);
  });

  it("deleting one session does not affect others", () => {
    db.createSession("s1");
    db.createSession("s2");
    db.insertBlock("s1", {
      id: 1, sourceLabel: "K", sourceText: "a", targetLabel: "E",
      audioSource: "system", partial: false, newTopic: false, createdAt: Date.now(),
    });
    db.insertBlock("s2", {
      id: 2, sourceLabel: "K", sourceText: "b", targetLabel: "E",
      audioSource: "system", partial: false, newTopic: false, createdAt: Date.now(),
    });

    db.deleteSession("s1");

    expect(db.getSessions()).toHaveLength(1);
    expect(db.getSessions()[0].id).toBe("s2");
    expect(db.getBlocksForSession("s2")).toHaveLength(1);
  });
});

describe("blocks", () => {
  beforeEach(() => {
    db.createSession("s1");
  });

  it("inserts and retrieves blocks for a session", () => {
    const block: TranscriptBlock = {
      id: 1,
      sourceLabel: "Korean",
      sourceText: "테스트",
      targetLabel: "English",
      translation: "Test",
      audioSource: "microphone",
      partial: false,
      newTopic: true,
      createdAt: Date.now(),
    };
    db.insertBlock("s1", block);

    const blocks = db.getBlocksForSession("s1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].sourceText).toBe("테스트");
    expect(blocks[0].translation).toBe("Test");
    expect(blocks[0].audioSource).toBe("microphone");
    expect(blocks[0].newTopic).toBe(true);
  });

  it("handles blocks without translation", () => {
    const block: TranscriptBlock = {
      id: 2,
      sourceLabel: "Korean",
      sourceText: "테스트",
      targetLabel: "English",
      audioSource: "system",
      partial: true,
      newTopic: false,
      createdAt: Date.now(),
    };
    db.insertBlock("s1", block);

    const blocks = db.getBlocksForSession("s1");
    expect(blocks[0].translation).toBeUndefined();
    expect(blocks[0].partial).toBe(true);
  });

  it("returns blocks ordered by created_at ascending", () => {
    const now = Date.now();
    db.insertBlock("s1", {
      id: 1, sourceLabel: "K", sourceText: "second", targetLabel: "E",
      audioSource: "system", partial: false, newTopic: false, createdAt: now + 100,
    });
    db.insertBlock("s1", {
      id: 2, sourceLabel: "K", sourceText: "first", targetLabel: "E",
      audioSource: "system", partial: false, newTopic: false, createdAt: now,
    });

    const blocks = db.getBlocksForSession("s1");
    expect(blocks[0].sourceText).toBe("first");
    expect(blocks[1].sourceText).toBe("second");
  });
});

describe("tasks", () => {
  it("inserts and retrieves tasks", () => {
    const task: TaskItem = {
      id: "t1",
      text: "Buy groceries",
      size: "small",
      completed: false,
      source: "manual",
      createdAt: Date.now(),
    };
    db.insertTask(task);

    const tasks = db.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("Buy groceries");
    expect(tasks[0].size).toBe("small");
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].source).toBe("manual");
  });

  it("toggles task completion", () => {
    db.insertTask({
      id: "t1", text: "Task", size: "large", completed: false, source: "ai", createdAt: Date.now(),
    });

    db.updateTask("t1", true);
    let tasks = db.getTasks();
    expect(tasks[0].completed).toBe(true);
    expect(tasks[0].completedAt).toBeDefined();

    db.updateTask("t1", false);
    tasks = db.getTasks();
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].completedAt).toBeUndefined();
  });

  it("returns tasks ordered by most recent first", () => {
    const now = Date.now();
    db.insertTask({ id: "t1", text: "First", size: "small", completed: false, source: "manual", createdAt: now });
    db.insertTask({ id: "t2", text: "Second", size: "large", completed: false, source: "manual", createdAt: now + 100 });

    const tasks = db.getTasks();
    expect(tasks[0].text).toBe("Second");
    expect(tasks[1].text).toBe("First");
  });
});

describe("insights", () => {
  it("inserts and retrieves insights", () => {
    const insight: Insight = {
      id: "i1",
      kind: "key-point",
      text: "Important finding",
      createdAt: Date.now(),
    };
    db.insertInsight(insight);

    const insights = db.getRecentInsights();
    expect(insights).toHaveLength(1);
    expect(insights[0].kind).toBe("key-point");
    expect(insights[0].text).toBe("Important finding");
    expect(insights[0].sessionId).toBeUndefined();
  });

  it("associates insights with sessions", () => {
    db.createSession("s1");
    db.insertInsight({
      id: "i1", kind: "tip", text: "Follow up", sessionId: "s1", createdAt: Date.now(),
    });

    const insights = db.getRecentInsights();
    expect(insights[0].sessionId).toBe("s1");
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      db.insertInsight({
        id: `i${i}`, kind: "fact", text: `Decision ${i}`, createdAt: Date.now() + i,
      });
    }
    expect(db.getRecentInsights(3)).toHaveLength(3);
  });

  it("retrieves recent key points as strings", () => {
    db.insertInsight({ id: "i1", kind: "key-point", text: "Point A", createdAt: Date.now() });
    db.insertInsight({ id: "i2", kind: "tip", text: "Action B", createdAt: Date.now() + 1 });
    db.insertInsight({ id: "i3", kind: "key-point", text: "Point C", createdAt: Date.now() + 2 });

    const points = db.getRecentKeyPoints();
    expect(points).toEqual(["Point C", "Point A"]);
  });
});

describe("final summary", () => {
  beforeEach(() => {
    db.createSession("s1");
  });

  it("persists and loads structured summary fields", () => {
    const summary: FinalSummary = {
      narrative: "The team aligned on scope and timeline.",
      agreements: ["Ship pilot in two weeks."],
      missedItems: ["No rollback plan discussed."],
      unansweredQuestions: ["Who owns post-launch support?"],
      agreementTodos: [{ text: "Assign owner for pilot launch.", doer: "human" }],
      missedItemTodos: [{ text: "Draft rollback and incident plan.", doer: "agent" }],
      unansweredQuestionTodos: [{ text: "Confirm support owner and escalation path.", doer: "human" }],
      actionItems: [{ text: "Draft launch checklist", doer: "agent" }],
      generatedAt: Date.now(),
    };

    db.saveFinalSummary("s1", summary);
    expect(db.getFinalSummary("s1")).toEqual(summary);
  });

  it("returns safe defaults for legacy summary rows", () => {
    const now = Date.now();
    db.raw.prepare(`
      UPDATE sessions
      SET summary_narrative = ?,
          summary_action_items = ?,
          summary_generated_at = ?,
          summary_data = NULL
      WHERE id = ?
    `).run(
      "Legacy narrative",
      JSON.stringify(["Legacy item"]),
      now,
      "s1",
    );

    expect(db.getFinalSummary("s1")).toEqual({
      narrative: "Legacy narrative",
      agreements: [],
      missedItems: [],
      unansweredQuestions: [],
      agreementTodos: [],
      missedItemTodos: [],
      unansweredQuestionTodos: [],
      actionItems: [{ text: "Legacy item", doer: "human" }],
      generatedAt: now,
    });
  });
});

describe("agents", () => {
  beforeEach(() => {
    db.createSession("s1");
  });

  it("marks stale running agents as failed", () => {
    const baseCreatedAt = Date.now();
    const running: Agent = {
      id: "a1",
      kind: "analysis",
      taskId: "t1",
      task: "Running task",
      status: "running",
      steps: [],
      createdAt: baseCreatedAt,
      sessionId: "s1",
    };
    const completed: Agent = {
      id: "a2",
      kind: "analysis",
      taskId: "t2",
      task: "Done task",
      status: "completed",
      steps: [],
      result: "done",
      createdAt: baseCreatedAt + 1,
      completedAt: baseCreatedAt + 2,
      sessionId: "s1",
    };
    db.insertAgent(running);
    db.insertAgent(completed);

    const changes = db.failStaleRunningAgents("Interrupted by app shutdown");
    expect(changes).toBe(1);

    const agents = db.getAgentsForSession("s1");
    const runningAfter = agents.find((a) => a.id === "a1");
    const completedAfter = agents.find((a) => a.id === "a2");

    expect(runningAfter?.status).toBe("failed");
    expect(runningAfter?.result).toBe("Interrupted by app shutdown");
    expect(runningAfter?.completedAt).toBeDefined();
    expect(completedAfter?.status).toBe("completed");
    expect(completedAfter?.result).toBe("done");
  });
});

describe("full-text search", () => {
  beforeEach(() => {
    db.createSession("s1");
  });

  it("searches blocks by source text", () => {
    db.insertBlock("s1", {
      id: 1, sourceLabel: "Korean", sourceText: "오늘 날씨가 좋습니다", targetLabel: "English",
      translation: "The weather is nice today", audioSource: "system", partial: false, newTopic: false, createdAt: Date.now(),
    });
    db.insertBlock("s1", {
      id: 2, sourceLabel: "Korean", sourceText: "회의를 시작합니다", targetLabel: "English",
      translation: "Let's start the meeting", audioSource: "system", partial: false, newTopic: false, createdAt: Date.now() + 1,
    });

    const results = db.searchBlocks("weather");
    expect(results).toHaveLength(1);
    expect(results[0].sourceText).toBe("오늘 날씨가 좋습니다");
  });

  it("searches blocks by translation", () => {
    db.insertBlock("s1", {
      id: 1, sourceLabel: "Korean", sourceText: "테스트", targetLabel: "English",
      translation: "meeting discussion", audioSource: "system", partial: false, newTopic: false, createdAt: Date.now(),
    });

    const results = db.searchBlocks("meeting");
    expect(results).toHaveLength(1);
    expect(results[0].translation).toBe("meeting discussion");
  });

  it("returns empty for no matches", () => {
    db.insertBlock("s1", {
      id: 1, sourceLabel: "K", sourceText: "hello", targetLabel: "E",
      audioSource: "system", partial: false, newTopic: false, createdAt: Date.now(),
    });

    expect(db.searchBlocks("nonexistent")).toHaveLength(0);
  });
});
