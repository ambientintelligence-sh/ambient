export type AgentExternalToolProvider = string;

export type AgentToolExecutionOptions = {
  toolCallId: string;
  abortSignal?: AbortSignal;
};

export type AgentExternalTool = {
  name: string;
  provider: AgentExternalToolProvider;
  description?: string;
  inputSchema: unknown;
  isMutating: boolean;
  execute: (input: unknown, options: AgentToolExecutionOptions) => Promise<unknown>;
};

export type AgentExternalToolSet = Record<string, AgentExternalTool>;
