import fs from "node:fs";
import path from "node:path";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { log } from "../logger";
import type { Agent, TranscriptBlock } from "../types";
import { generateStructuredObject } from "../ai/structured-output";

export const LEARNING_CATEGORIES = ["Learned User Preferences", "Learned Workspace Facts"] as const;
export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

const learningSchema = z.object({
  learnings: z.array(
    z.object({
      category: z.enum(LEARNING_CATEGORIES),
      text: z.string().describe("A single durable learning — concise, self-contained"),
    }),
  ),
});

function getAgentsMdPath(): string {
  return path.resolve(process.cwd(), "agents.md");
}

export function readAgentsMd(): string {
  const p = getAgentsMdPath();
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8");
}

export function writeAgentsMd(content: string) {
  fs.writeFileSync(getAgentsMdPath(), content, "utf-8");
}

export function parseSections(md: string): Map<LearningCategory, string[]> {
  const sections = new Map<LearningCategory, string[]>();
  for (const cat of LEARNING_CATEGORIES) sections.set(cat, []);

  let current: LearningCategory | null = null;
  for (const line of md.split("\n")) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      const name = headerMatch[1].trim() as LearningCategory;
      if (LEARNING_CATEGORIES.includes(name)) {
        current = name;
      } else {
        current = null;
      }
      continue;
    }
    if (current && line.trim().startsWith("- ")) {
      sections.get(current)!.push(line.trim().slice(2).trim());
    }
  }
  return sections;
}

function formatAgentConversation(agent: Agent): string {
  const lines = [`Task: ${agent.task}`];
  if (agent.taskContext) {
    lines.push(`Context: ${agent.taskContext.slice(0, 500)}`);
  }
  for (const step of agent.steps) {
    if (step.kind === "user") {
      lines.push(`User: ${step.content}`);
    } else if (step.kind === "text") {
      lines.push(`Agent: ${step.content.slice(0, 500)}`);
    } else if (step.kind === "tool-result") {
      lines.push(`Tool result (${step.toolName ?? "unknown"}): ${step.content.slice(0, 300)}`);
    }
  }
  if (agent.result) {
    lines.push(`Final result: ${agent.result}`);
  }
  return lines.join("\n");
}

export function renderAgentsMd(sections: Map<LearningCategory, string[]>): string {
  const lines = ["# Agent Memory", "", "Durable learnings about user preferences and workspace facts. Used to improve future agent behavior.", ""];
  for (const cat of LEARNING_CATEGORIES) {
    lines.push(`## ${cat}`, "");
    const items = sections.get(cat) ?? [];
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function extractAgentLearnings(
  model: LanguageModel,
  agent: Agent,
  recentBlocks: TranscriptBlock[],
): Promise<void> {
  if (!agent.result) return;

  log("INFO", `Learning extraction for agent ${agent.id}`);

  const existingMd = readAgentsMd();
  const existingSections = parseSections(existingMd);
  const existingItems = new Set(
    [...existingSections.values()].flat().map((s) => s.toLowerCase().trim()),
  );

  const conversation = formatAgentConversation(agent);

  const blockContext = recentBlocks
    .slice(-20)
    .map((b) => `[${b.sourceLabel}] ${b.sourceText}${b.translation ? ` → ${b.translation}` : ""}`)
    .join("\n");

  const prompt = `Analyze this agent conversation and extract durable learnings about the user's workspace and preferences.

## Learned User Preferences
Extract when the user:
- Gave explicit workflow instructions (e.g., 'always use pnpm', 'never auto-commit')
- Corrected the agent or overrode its approach
- Expressed a repeated choice or convention (naming, formatting, structure)
- Provided domain-specific terms or glossary corrections

## Learned Workspace Facts
Extract durable facts discovered during the task:
- Tech stack, frameworks, and key dependencies
- Architecture patterns and conventions (file structure, naming, module boundaries)
- Important file locations and what they contain
- Integration points (APIs, services, config files)
- Build/test/deploy commands and workflows

## DO NOT extract:
- Generic knowledge any LLM already has
- One-off task instructions or transient details
- Volatile data (specific versions, dates, counts) that goes stale quickly
- Secrets, tokens, credentials, or API keys
- Anything already captured in existing learnings below

Return an empty array if there are no new durable learnings.

Existing learnings (do NOT duplicate these):
${existingMd || "(none)"}

Recent transcript context:
${blockContext || "(no transcript)"}

Agent conversation:
${conversation}`;

  try {
    const { object } = await generateStructuredObject({
      model,
      schema: learningSchema,
      prompt,

    });

    const newLearnings = object.learnings.filter(
      (l) => !existingItems.has(l.text.toLowerCase().trim()),
    );

    if (newLearnings.length === 0) return;

    for (const learning of newLearnings) {
      existingSections.get(learning.category)!.push(learning.text);
    }

    const rendered = renderAgentsMd(existingSections);
    writeAgentsMd(rendered);
    log("INFO", `Extracted ${newLearnings.length} new learnings to agents.md`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `Learning extraction failed: ${message}`);
  }
}
