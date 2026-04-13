import { ipcMain } from "electron";
import type { IntegrationManager } from "../integrations/types";
import { connectCodex, disconnectCodex, isCodexConnected, cancelCodexTask } from "@core/agents/codex-client";
import { connectClaude, disconnectClaude, isClaudeConnected, cancelClaudeTask } from "@core/agents/claude-client";
import type { ProviderKind } from "@core/types";

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

  ipcMain.handle("connect-codex", async () => {
    return connectCodex();
  });

  ipcMain.handle("disconnect-codex", async () => {
    disconnectCodex();
    return { ok: true };
  });

  ipcMain.handle("get-codex-status", async () => {
    return { connected: isCodexConnected() };
  });

  ipcMain.handle("connect-claude", async () => {
    return connectClaude();
  });

  ipcMain.handle("disconnect-claude", async () => {
    disconnectClaude();
    return { ok: true };
  });

  ipcMain.handle("get-claude-status", async () => {
    return { connected: isClaudeConnected() };
  });

  ipcMain.handle("cancel-provider-task", async (_event, taskId: string, provider: ProviderKind) => {
    if (provider === "codex") {
      return { ok: cancelCodexTask(taskId) };
    }
    if (provider === "claude") {
      return { ok: cancelClaudeTask(taskId) };
    }
    return { ok: false };
  });
}
