export type McpOAuthProviderConfig = {
  id: string;
  label: string;
  mcpUrl: string;
  sseUrl: string;
  callbackPort: number;
  callbackPath: string;
};

export const MCP_OAUTH_PROVIDERS: readonly McpOAuthProviderConfig[] = [
  {
    id: "notion",
    label: "Notion",
    mcpUrl: "https://mcp.notion.com/mcp",
    sseUrl: "https://mcp.notion.com/sse",
    callbackPort: 43199,
    callbackPath: "/oauth/notion/callback",
  },
  {
    id: "linear",
    label: "Linear",
    mcpUrl: "https://mcp.linear.app/mcp",
    sseUrl: "https://mcp.linear.app/sse",
    callbackPort: 43200,
    callbackPath: "/oauth/linear/callback",
  },
];

const CALLBACK_HOST = "127.0.0.1";

export function getCallbackUrl(config: McpOAuthProviderConfig): string {
  return `http://${CALLBACK_HOST}:${config.callbackPort}${config.callbackPath}`;
}

export function getProviderConfig(id: string): McpOAuthProviderConfig | undefined {
  return MCP_OAUTH_PROVIDERS.find((p) => p.id === id);
}
