import type { AgentExternalTool, AgentExternalToolSet } from "./external-tools";

const TOOL_NAME_SEPARATOR = "__";

export function shouldRequireApproval(
  isMutating: boolean,
  allowAutoApprove: boolean,
  autoApprove?: boolean,
): boolean {
  return isMutating && !(allowAutoApprove && autoApprove === true);
}

type ResolveExternalToolNameSuccess = {
  ok: true;
  toolName: string;
};

type ResolveExternalToolNameFailure = {
  ok: false;
  code:
    | "tool_name_required"
    | "tool_ambiguous"
    | "tool_not_found"
    | "no_tools_available";
  error: string;
  hint: string;
  suggestions?: string[];
};

export type ResolveExternalToolNameResult =
  | ResolveExternalToolNameSuccess
  | ResolveExternalToolNameFailure;

export type RankedExternalTool = {
  name: string;
  tool: AgentExternalTool;
  score: number;
};

function normalizeForLooseMatch(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function getToolSuffix(toolName: string): string {
  if (!toolName.includes(TOOL_NAME_SEPARATOR)) {
    return toolName;
  }
  return toolName.split(TOOL_NAME_SEPARATOR).slice(1).join(TOOL_NAME_SEPARATOR);
}

function sortAndCapSuggestions(names: string[], max = 8): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).slice(0, max);
}

function resolveFromCandidates(
  requestedName: string,
  candidates: string[],
  reason: "normalized" | "suffix",
): ResolveExternalToolNameResult {
  if (candidates.length === 1) {
    return { ok: true, toolName: candidates[0] };
  }

  const suggestions = sortAndCapSuggestions(candidates);
  const detail =
    reason === "suffix"
      ? "multiple tools share the same suffix"
      : "multiple tools matched after normalization";
  return {
    ok: false,
    code: "tool_ambiguous",
    error: `Tool "${requestedName}" is ambiguous: ${detail}.`,
    hint: "Use searchMcpTools to find the exact tool name, then use getMcpToolSchema.",
    suggestions,
  };
}

export function resolveExternalToolName(
  requestedName: string,
  externalTools: AgentExternalToolSet,
): ResolveExternalToolNameResult {
  const raw = requestedName.trim();
  if (!raw) {
    return {
      ok: false,
      code: "tool_name_required",
      error: "Tool name is required.",
      hint: "Use searchMcpTools to find the exact tool name first.",
    };
  }

  if (externalTools[raw]) {
    return { ok: true, toolName: raw };
  }

  const allNames = Object.keys(externalTools);
  if (allNames.length === 0) {
    return {
      ok: false,
      code: "no_tools_available",
      error: `Tool "${raw}" not found because no MCP tools are currently available.`,
      hint: "Reconnect MCP integrations, then use searchMcpTools before calling callMcpTool.",
    };
  }

  const normalizedRequested = normalizeForLooseMatch(raw);
  const normalizedMatches = allNames.filter(
    (name) => normalizeForLooseMatch(name) === normalizedRequested,
  );
  if (normalizedMatches.length > 0) {
    return resolveFromCandidates(raw, normalizedMatches, "normalized");
  }

  const suffixMatches = allNames.filter(
    (name) => normalizeForLooseMatch(getToolSuffix(name)) === normalizedRequested,
  );
  if (suffixMatches.length > 0) {
    return resolveFromCandidates(raw, suffixMatches, "suffix");
  }

  return {
    ok: false,
    code: "tool_not_found",
    error: `Tool "${raw}" not found.`,
    hint: "Use searchMcpTools to find the exact tool name, then use getMcpToolSchema if needed.",
    suggestions: sortAndCapSuggestions(allNames, 10),
  };
}

function scoreTokenAgainstSet(token: string, candidates: Set<string>): number {
  if (candidates.has(token)) {
    return 2;
  }

  for (const candidate of candidates) {
    if (candidate.startsWith(token) || token.startsWith(candidate)) {
      return 1;
    }
  }

  return 0;
}

export function rankExternalTools(
  query: string,
  externalTools: AgentExternalToolSet,
  limit = 10,
): RankedExternalTool[] {
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeForLooseMatch(trimmedQuery);
  const queryTokens = tokenize(trimmedQuery);
  const hasQuery = queryTokens.length > 0 || normalizedQuery.length > 0;

  const ranked: RankedExternalTool[] = Object.entries(externalTools)
    .map(([name, tool]) => {
      const description = tool.description ?? "";
      const normalizedName = normalizeForLooseMatch(name);
      const normalizedDescription = normalizeForLooseMatch(description);
      const nameTokens = new Set(tokenize(name));
      const descriptionTokens = new Set(tokenize(description));

      let score = 0;
      if (normalizedQuery && normalizedName.includes(normalizedQuery)) {
        score += 8;
      }
      if (normalizedQuery && normalizedDescription.includes(normalizedQuery)) {
        score += 5;
      }

      for (const token of queryTokens) {
        score += scoreTokenAgainstSet(token, nameTokens) * 2;
        score += scoreTokenAgainstSet(token, descriptionTokens);
        if (normalizedName.includes(token)) score += 1;
        if (normalizedDescription.includes(token)) score += 1;
      }

      if (!hasQuery) {
        score = 0;
      }

      return { name, tool, score };
    })
    .filter((entry) => !hasQuery || entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.name.localeCompare(b.name);
    });

  if (ranked.length === 0 && hasQuery) {
    return Object.entries(externalTools)
      .map(([name, tool]) => ({ name, tool, score: 0 }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, Math.max(1, limit));
  }

  return ranked.slice(0, Math.max(1, limit));
}
