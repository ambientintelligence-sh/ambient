import { ipcMain } from "electron";
import { discoverSkills } from "@core/agents/skills";

export function registerSkillHandlers() {
  ipcMain.handle("discover-skills", () => discoverSkills(process.cwd()));
}
