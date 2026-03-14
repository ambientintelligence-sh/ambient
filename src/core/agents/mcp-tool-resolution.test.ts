import { describe, expect, it } from "vitest";
import type { AgentExternalToolSet } from "./external-tools";
import {
  rankExternalTools,
  resolveExternalToolName,
  shouldRequireApproval,
} from "./mcp-tool-resolution";

function buildTools(): AgentExternalToolSet {
  return {
    notion__create_page: {
      name: "notion__create_page",
      provider: "notion",
      description: "Create a Notion page in a database",
      inputSchema: { type: "object" },
      isMutating: true,
      execute: async () => ({ ok: true }),
    },
    notion__create_project: {
      name: "notion__create_project",
      provider: "notion",
      description: "Create a Notion project entry",
      inputSchema: { type: "object" },
      isMutating: true,
      execute: async () => ({ ok: true }),
    },
    linear__create_issue: {
      name: "linear__create_issue",
      provider: "linear",
      description: "Create a Linear issue",
      inputSchema: { type: "object" },
      isMutating: true,
      execute: async () => ({ ok: true }),
    },
    linear__list_issues: {
      name: "linear__list_issues",
      provider: "linear",
      description: "List issues assigned to a user",
      inputSchema: { type: "object" },
      isMutating: false,
      execute: async () => ({ ok: true }),
    },
  };
}

describe("shouldRequireApproval", () => {
  it("requires approval for mutating tools when auto-approve is off", () => {
    expect(shouldRequireApproval(true, false, false)).toBe(true);
  });

  it("does not require approval for mutating tools when auto-approve is enabled and requested", () => {
    expect(shouldRequireApproval(true, true, true)).toBe(false);
  });

  it("does not require approval for non-mutating tools", () => {
    expect(shouldRequireApproval(false, false, false)).toBe(false);
    expect(shouldRequireApproval(false, true, true)).toBe(false);
  });
});

describe("resolveExternalToolName", () => {
  it("resolves exact prefixed names", () => {
    const result = resolveExternalToolName("linear__create_issue", buildTools());
    expect(result).toEqual({ ok: true, toolName: "linear__create_issue" });
  });

  it("resolves normalized exact names", () => {
    const result = resolveExternalToolName("Linear __ Create-Issue", buildTools());
    expect(result).toEqual({ ok: true, toolName: "linear__create_issue" });
  });

  it("resolves unprefixed unique suffix names", () => {
    const result = resolveExternalToolName("list-issues", buildTools());
    expect(result).toEqual({ ok: true, toolName: "linear__list_issues" });
  });

  it("returns suggestions for ambiguous suffix matches", () => {
    const tools: AgentExternalToolSet = {
      notion__create_page: {
        name: "notion__create_page",
        provider: "notion",
        description: "Create a Notion page",
        inputSchema: { type: "object" },
        isMutating: true,
        execute: async () => ({ ok: true }),
      },
      linear__create_page: {
        name: "linear__create_page",
        provider: "linear",
        description: "Create a Linear page",
        inputSchema: { type: "object" },
        isMutating: true,
        execute: async () => ({ ok: true }),
      },
    };

    const result = resolveExternalToolName("create-page", tools);
    expect(result.ok).toBe(false);
    if (result.ok !== false) {
      throw new Error("Expected an ambiguous resolution failure.");
    }
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions?.length).toBeGreaterThan(1);
  });
});

describe("rankExternalTools", () => {
  it("ranks multi-word query matches by relevance", () => {
    const ranked = rankExternalTools("create page", buildTools(), 10);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.name).toBe("notion__create_page");
  });

  it("falls back to alphabetical browse order for empty queries", () => {
    const ranked = rankExternalTools("", buildTools(), 10);
    expect(ranked.map((entry) => entry.name)).toEqual([
      "linear__create_issue",
      "linear__list_issues",
      "notion__create_page",
      "notion__create_project",
    ]);
  });
});
