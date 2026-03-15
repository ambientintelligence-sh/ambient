export type McpNativeProviderConfig = {
  id: string;
  label: string;
  command: string;
  args: string[];
};

export const MCP_NATIVE_PROVIDERS: McpNativeProviderConfig[] = [
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    args: ["mcp-server"],
  },
];

export function getNativeProviderConfig(id: string): McpNativeProviderConfig | undefined {
  return MCP_NATIVE_PROVIDERS.find((p) => p.id === id);
}
