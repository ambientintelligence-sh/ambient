import { ipcMain } from "electron";
import {
  readAgentsMd,
  writeAgentsMd,
  parseSections,
  renderAgentsMd,
  LEARNING_CATEGORIES,
  type LearningCategory,
} from "@core/agents/learn";

type LearningItem = { category: string; text: string };

export function registerLearningHandlers() {
  ipcMain.handle("get-learnings", (): LearningItem[] => {
    const md = readAgentsMd();
    if (!md.trim()) return [];
    const sections = parseSections(md);
    const items: LearningItem[] = [];
    for (const cat of LEARNING_CATEGORIES) {
      for (const text of sections.get(cat) ?? []) {
        items.push({ category: cat, text });
      }
    }
    return items;
  });

  ipcMain.handle("delete-learning", (_event, category: string, text: string): { ok: boolean } => {
    const md = readAgentsMd();
    if (!md.trim()) return { ok: false };
    const sections = parseSections(md);
    const items = sections.get(category as LearningCategory);
    if (!items) return { ok: false };
    const idx = items.indexOf(text);
    if (idx === -1) return { ok: false };
    items.splice(idx, 1);
    writeAgentsMd(renderAgentsMd(sections));
    return { ok: true };
  });

  ipcMain.handle("clear-learnings", (): { ok: boolean } => {
    const empty = new Map<LearningCategory, string[]>();
    for (const cat of LEARNING_CATEGORIES) empty.set(cat, []);
    writeAgentsMd(renderAgentsMd(empty));
    return { ok: true };
  });
}
