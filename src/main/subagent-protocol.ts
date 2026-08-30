import type { DelegationSelection } from '../shared/auth';
import type { BrowserMode } from '../shared/browser';
import type { LocalContextState } from '../shared/local-context';

export type SubagentLaunch = Readonly<{
  type: 'launch';
  task: string;
  workspace: string;
  tempDir: string;
  agentDir: string;
  selection: DelegationSelection;
  localContext: LocalContextState;
  networkEnabled: boolean;
  browser: { mode: BrowserMode; browserUrl?: string; executablePath?: string };
  chromeMcpPath: string;
}>;

export type SubagentCommand = SubagentLaunch | Readonly<{ type: 'abort' }>;

export type SubagentMessage =
  | Readonly<{ type: 'ready' }>
  | Readonly<{ type: 'tool'; id: string; tool: string; detail?: string }>
  | Readonly<{ type: 'tool_result'; id: string; tool: string; result?: string; isError: boolean }>
  | Readonly<{ type: 'done'; summary: string }>
  | Readonly<{ type: 'error'; message: string }>;

