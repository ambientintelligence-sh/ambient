import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import type { WorkspaceState } from '../shared/workspace';

export type WorkspaceService = Awaited<ReturnType<typeof createWorkspaceService>>;

export async function createWorkspaceService(stateDir: string) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(stateDir, 'workspace.json');
  let workspacePath: string | null = null;

  const acceptDirectory = async (candidate: unknown): Promise<string | null> => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return null;
    try {
      const resolved = await realpath(candidate);
      if (!(await stat(resolved)).isDirectory()) return null;
      return resolved;
    } catch {
      return null;
    }
  };

  try {
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as { path?: unknown };
    workspacePath = await acceptDirectory(saved.path);
  } catch {
    // First launch, removed folder, or corrupt preference.
  }

  const state = (): WorkspaceState => ({
    path: workspacePath,
    name: workspacePath ? path.basename(workspacePath) : null,
  });

  return {
    state,
    getPath: () => workspacePath,

    async select(parent?: BrowserWindow) {
      const options = {
        title: 'Choose Ambient workspace',
        message: 'Workers will have full read and write access to this folder.',
        buttonLabel: 'Use as Workspace',
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
        ...(workspacePath ? { defaultPath: workspacePath } : {}),
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return state();
      const selected = await acceptDirectory(result.filePaths[0]);
      if (!selected) throw new Error('The selected workspace is not an accessible directory');
      workspacePath = selected;
      await writeFile(statePath, `${JSON.stringify({ path: workspacePath }, null, 2)}\n`, { mode: 0o600 });
      return state();
    },

    async open() {
      if (!workspacePath) throw new Error('Select a workspace first');
      const error = await shell.openPath(workspacePath);
      if (error) throw new Error(error);
      return state();
    },
  };
}
