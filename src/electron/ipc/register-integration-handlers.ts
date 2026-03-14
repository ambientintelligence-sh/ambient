import { ipcMain } from "electron";
import type { IntegrationManager } from "../integrations/types";

export function registerIntegrationHandlers(integrations: IntegrationManager) {
  ipcMain.handle("get-mcp-integrations-status", async () => {
    return integrations.getStatus();
  });

  ipcMain.handle("connect-mcp-provider", async (_event, providerId: string) => {
    return integrations.connectProvider(providerId);
  });

  ipcMain.handle("disconnect-mcp-provider", async (_event, providerId: string) => {
    return integrations.disconnectProvider(providerId);
  });

  ipcMain.handle("add-custom-mcp-server", async (_event, cfg: { name: string; url: string; transport: "streamable" | "sse"; bearerToken?: string }) => {
    return integrations.addCustomMcpServer(cfg);
  });

  ipcMain.handle("remove-custom-mcp-server", async (_event, id: string) => {
    return integrations.removeCustomMcpServer(id);
  });

  ipcMain.handle("connect-custom-mcp-server", async (_event, id: string) => {
    return integrations.connectCustomMcpServer(id);
  });

  ipcMain.handle("disconnect-custom-mcp-server", async (_event, id: string) => {
    return integrations.disconnectCustomMcpServer(id);
  });

  ipcMain.handle("get-custom-mcp-servers-status", async () => {
    return integrations.getCustomMcpServersStatus();
  });

  ipcMain.handle("get-mcp-tools-info", async () => {
    return integrations.getMcpToolsInfo();
  });
}
