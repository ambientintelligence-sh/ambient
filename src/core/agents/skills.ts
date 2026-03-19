import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type SkillMetadata = Readonly<{
  id: string;
  name: string;
  description: string;
  source: "project" | "global";
  filePath: string;
}>;

export function parseSkillFrontmatter(
  content: string
): { name: string; description: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  if (!nameMatch || !descMatch) return null;

  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
  };
}

export function loadSkillContent(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

function scanSkillsDir(
  dir: string,
  source: "project" | "global"
): SkillMetadata[] {
  if (!fs.existsSync(dir)) return [];

  const results: SkillMetadata[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillFile = path.join(dir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;

    let content: string;
    try {
      content = fs.readFileSync(skillFile, "utf-8");
    } catch {
      continue;
    }

    const meta = parseSkillFrontmatter(content);
    if (!meta) continue;

    results.push({
      id: `${source}:${entry.name}`,
      name: meta.name,
      description: meta.description,
      source,
      filePath: skillFile,
    });
  }

  return results;
}

export function discoverSkills(projectDir?: string): SkillMetadata[] {
  const projectSkillsDir = path.join(
    projectDir ?? process.cwd(),
    ".agents",
    "skills"
  );
  const globalSkillsDir = path.join(
    os.homedir(),
    ".config",
    "agents",
    "skills"
  );

  const projectSkills = scanSkillsDir(projectSkillsDir, "project");
  const globalSkills = scanSkillsDir(globalSkillsDir, "global");

  // Project skills take precedence — dedup by dirname
  const seenDirnames = new Set(
    projectSkills.map((s) => s.id.split(":")[1])
  );

  return [
    ...projectSkills,
    ...globalSkills.filter((s) => !seenDirnames.has(s.id.split(":")[1])),
  ];
}
