import path from "node:path";
import { shell } from "electron";
import { SecureCredentialStore } from "./secure-credential-store";
import { createMcpToolRegistry } from "./mcp-tool-registry";
import type { IntegrationManager } from "./types";

export function createIntegrationManager(
  userDataPath: string,
  existingStore?: SecureCredentialStore,
): IntegrationManager {
  const store = existingStore ?? new SecureCredentialStore(
    path.join(userDataPath, "integrations.credentials.json"),
  );

  const enabled = process.env.MCP_INTEGRATIONS_ENABLED !== "false";

  const registry = createMcpToolRegistry({
    enabled,
    store,
    openExternal: async (url: string) => {
      await shell.openExternal(url);
    },
  });

  return {
    enabled,
    getStatus: registry.getStatus,
    connectProvider: registry.connectProvider,
    disconnectProvider: registry.disconnectProvider,
    getExternalTools: registry.getExternalTools,
    dispose: registry.dispose,
    addCustomMcpServer: registry.addCustomMcpServer,
    removeCustomMcpServer: registry.removeCustomMcpServer,
    connectCustomMcpServer: registry.connectCustomMcpServer,
    disconnectCustomMcpServer: registry.disconnectCustomMcpServer,
    getCustomMcpServersStatus: registry.getCustomMcpServersStatus,
    getMcpToolsInfo: registry.getMcpToolsInfo,
  };
}
