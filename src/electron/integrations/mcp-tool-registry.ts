import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpIntegrationStatus, McpIntegrationConnection, CustomMcpStatus, CustomMcpTransport, McpProviderToolSummary, McpToolInfo } from "@core/types";
import type { AgentExternalToolSet, AgentExternalToolProvider } from "@core/agents/external-tools";
import type { CustomMcpServerRecord } from "./types";
import type { McpOAuthProviderConfig } from "./mcp-oauth-providers";
import { MCP_OAUTH_PROVIDERS, getProviderConfig } from "./mcp-oauth-providers";
import { MCP_NATIVE_PROVIDERS, getNativeProviderConfig } from "./mcp-native-providers";
import type { McpNativeProviderConfig } from "./mcp-native-providers";
import { createOAuthProvider, waitForOAuthAuthorizationCode } from "./mcp-oauth-client";
import { SecureCredentialStore } from "./secure-credential-store";
import { log } from "@core/logger";

const CLIENT_INFO = {
  name: "ambient-mcp-client",
  version: "1.0.0",
};

const MUTATING_NAME_PATTERN = /(create|update|delete|archive|restore|comment|append|move|set|edit|close|complete|assign)/i;

type ProviderRuntime = {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport | StdioClientTransport;
  toolCache?: AgentExternalToolSet;
};

type TransportKind = "streamable" | "sse";

export function isMutatingToolName(name: string): boolean {
  return MUTATING_NAME_PATTERN.test(name);
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function classifyMutatingTool(
  provider: AgentExternalToolProvider,
  tool: ListToolsResult["tools"][number],
): boolean {
  if (tool.annotations?.readOnlyHint === true) return false;
  if (tool.annotations?.destructiveHint === true) return true;

  const name = tool.name.toLowerCase();
  if (provider === "linear") {
    if (name.startsWith("get") || name.startsWith("list") || name.startsWith("search")) {
      return false;
    }
  }
  return isMutatingToolName(name);
}

function isUnauthorizedLike(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/unauthorized/i.test(message)) return true;
  const withStatus = error as { statusCode?: number; status?: number; code?: number } | null;
  return withStatus?.statusCode === 401 || withStatus?.status === 401 || withStatus?.code === 401;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function extractCallToolErrorText(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as { content?: unknown };
  if (!Array.isArray(record.content)) return null;
  const textParts = record.content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const typed = part as { type?: unknown; text?: unknown };
      if (typed.type !== "text" || typeof typed.text !== "string") return "";
      return typed.text.trim();
    })
    .filter(Boolean);
  if (textParts.length === 0) return null;
  return textParts.join("\n");
}

async function closeRuntime(runtime?: ProviderRuntime): Promise<void> {
  if (!runtime) return;
  try {
    await runtime.client.close();
  } catch {
    // no-op
  }
}

export function createMcpToolRegistry(options: {
  enabled: boolean;
  store: SecureCredentialStore;
  openExternal: (url: string) => Promise<void>;
}) {
  const { enabled, store, openExternal } = options;

  const oauthRuntimes = new Map<string, ProviderRuntime>();
  const customRuntimes = new Map<string, ProviderRuntime>();
  const nativeRuntimes = new Map<string, ProviderRuntime>();

  // ── Generic OAuth runtime factories ──

  function createOAuthRuntime(config: McpOAuthProviderConfig, kind: TransportKind): ProviderRuntime {
    const provider = createOAuthProvider(config, store, openExternal);
    const transport = kind === "streamable"
      ? new StreamableHTTPClientTransport(new URL(config.mcpUrl), { authProvider: provider })
      : new SSEClientTransport(new URL(config.sseUrl), { authProvider: provider });
    const client = new Client(CLIENT_INFO);
    return { client, transport };
  }

  async function authenticateOAuthRuntime(
    config: McpOAuthProviderConfig,
    runtime: ProviderRuntime,
    kind: TransportKind,
  ): Promise<ProviderRuntime> {
    try {
      await runtime.client.connect(runtime.transport);
      await runtime.client.listTools();
      return runtime;
    } catch (error) {
      if (!isUnauthorizedLike(error)) {
        throw error;
      }
      log("INFO", `${config.label} ${kind} requested interactive OAuth authorization.`);
    }

    const expectedState = await store.getOAuthPendingState(config.id);
    if (!expectedState) {
      throw new Error("OAuth flow started but no pending state was recorded.");
    }

    const code = await waitForOAuthAuthorizationCode(config, expectedState);
    log("INFO", `${config.label} OAuth callback received for ${kind}. Exchanging authorization code.`);
    await (runtime.transport as StreamableHTTPClientTransport | SSEClientTransport).finishAuth(code);
    await closeRuntime(runtime);

    const authenticatedRuntime = createOAuthRuntime(config, kind);
    await authenticatedRuntime.client.connect(authenticatedRuntime.transport);
    await authenticatedRuntime.client.listTools();
    return authenticatedRuntime;
  }

  async function ensureOAuthRuntime(config: McpOAuthProviderConfig): Promise<ProviderRuntime | undefined> {
    if (!enabled) return undefined;
    const tokens = await store.getOAuthTokens(config.id);
    if (!tokens) return undefined;

    const existing = oauthRuntimes.get(config.id);
    if (existing) return existing;

    const streamableRuntime = createOAuthRuntime(config, "streamable");
    try {
      await streamableRuntime.client.connect(streamableRuntime.transport);
      await streamableRuntime.client.listTools();
      oauthRuntimes.set(config.id, streamableRuntime);
      return streamableRuntime;
    } catch (streamableError) {
      await closeRuntime(streamableRuntime);
      log("WARN", `${config.label} streamable runtime unavailable, trying SSE fallback: ${formatError(streamableError)}`);
    }

    const sseRuntime = createOAuthRuntime(config, "sse");
    await sseRuntime.client.connect(sseRuntime.transport);
    await sseRuntime.client.listTools();
    oauthRuntimes.set(config.id, sseRuntime);
    return sseRuntime;
  }

  async function connectProvider(providerId: string): Promise<{ ok: boolean; error?: string }> {
    if (!enabled) {
      return { ok: false, error: "MCP integrations are disabled. Set MCP_INTEGRATIONS_ENABLED=true (or remove MCP_INTEGRATIONS_ENABLED=false)." };
    }

    const config = getProviderConfig(providerId);
    if (!config) {
      return { ok: false, error: `Unknown MCP OAuth provider: ${providerId}` };
    }

    try {
      store.ensureEncryptionAvailable();
      await closeRuntime(oauthRuntimes.get(providerId));
      oauthRuntimes.delete(providerId);
      await store.setOAuthPendingState(providerId, undefined);
      await store.setOAuthCodeVerifier(providerId, undefined);
      await store.setOAuthTokens(providerId, undefined);
      await store.setOAuthClientInformation(providerId, undefined);
      log("INFO", `Starting ${config.label} MCP connect using streamable transport.`);

      let runtime = createOAuthRuntime(config, "streamable");
      try {
        runtime = await authenticateOAuthRuntime(config, runtime, "streamable");
      } catch (streamableError) {
        await closeRuntime(runtime);
        log("WARN", `${config.label} streamable connect failed, trying SSE fallback: ${formatError(streamableError)}`);
        runtime = createOAuthRuntime(config, "sse");
        runtime = await authenticateOAuthRuntime(config, runtime, "sse");
      }

      await store.setOAuthPendingState(providerId, undefined);
      await store.setOAuthCodeVerifier(providerId, undefined);
      await store.setOAuthMetadata(providerId, {
        label: "Connected",
        lastConnectedAt: Date.now(),
        lastError: undefined,
      });

      oauthRuntimes.set(providerId, runtime);
      return { ok: true };
    } catch (error) {
      const message = formatError(error);
      await store.setOAuthPendingState(providerId, undefined);
      await store.setOAuthCodeVerifier(providerId, undefined);
      await store.setOAuthMetadata(providerId, {
        label: "Disconnected",
        lastConnectedAt: undefined,
        lastError: message,
      });
      log("ERROR", `${config.label} MCP connect failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async function disconnectProvider(providerId: string): Promise<{ ok: boolean; error?: string }> {
    await closeRuntime(oauthRuntimes.get(providerId));
    oauthRuntimes.delete(providerId);
    await store.clearOAuthProvider(providerId);
    return { ok: true };
  }

  // ── Custom MCP server methods ──

  function createCustomRuntime(record: CustomMcpServerRecord, token?: string): ProviderRuntime {
    const requestInit: RequestInit | undefined = token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined;
    const transport = record.transport === "streamable"
      ? new StreamableHTTPClientTransport(new URL(record.url), requestInit ? { requestInit } : {})
      : new SSEClientTransport(new URL(record.url), requestInit ? { requestInit } : {});
    const client = new Client(CLIENT_INFO);
    return { client, transport };
  }

  async function addCustomMcpServer(cfg: {
    name: string;
    url: string;
    transport: CustomMcpTransport;
    bearerToken?: string;
  }): Promise<{ ok: boolean; error?: string; id?: string }> {
    if (!enabled) {
      return { ok: false, error: "MCP integrations are disabled. Set MCP_INTEGRATIONS_ENABLED=true (or remove MCP_INTEGRATIONS_ENABLED=false)." };
    }
    try {
      store.ensureEncryptionAvailable();
      const id = crypto.randomUUID();
      const rawToken = cfg.bearerToken?.trim();
      const tokenEncrypted = rawToken ? store.encryptToken(rawToken) : undefined;
      const record: CustomMcpServerRecord = {
        id,
        name: cfg.name.trim(),
        url: cfg.url.trim(),
        transport: cfg.transport,
        tokenEncrypted,
      };
      await store.addCustomServer(record);
      const runtime = createCustomRuntime(record, rawToken);
      await runtime.client.connect(runtime.transport);
      await runtime.client.listTools();
      customRuntimes.set(id, runtime);
      await store.updateCustomServerMetadata(id, {
        label: cfg.name.trim(),
        lastConnectedAt: Date.now(),
        lastError: undefined,
      });
      return { ok: true, id };
    } catch (error) {
      const message = formatError(error);
      log("ERROR", `Custom MCP server add failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async function removeCustomMcpServer(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await closeRuntime(customRuntimes.get(id));
      customRuntimes.delete(id);
      await store.removeCustomServer(id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  async function connectCustomMcpServer(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!enabled) {
      return { ok: false, error: "MCP integrations are disabled. Set MCP_INTEGRATIONS_ENABLED=true (or remove MCP_INTEGRATIONS_ENABLED=false)." };
    }
    try {
      const records = await store.getCustomServers();
      const record = records.find((r) => r.id === id);
      if (!record) return { ok: false, error: "Custom server not found." };
      await closeRuntime(customRuntimes.get(id));
      customRuntimes.delete(id);
      const token = await store.getCustomServerToken(id);
      const runtime = createCustomRuntime(record, token);
      await runtime.client.connect(runtime.transport);
      await runtime.client.listTools();
      customRuntimes.set(id, runtime);
      await store.updateCustomServerMetadata(id, {
        lastConnectedAt: Date.now(),
        lastError: undefined,
      });
      return { ok: true };
    } catch (error) {
      const message = formatError(error);
      await store.updateCustomServerMetadata(id, {
        lastConnectedAt: undefined,
        lastError: message,
      });
      return { ok: false, error: message };
    }
  }

  async function disconnectCustomMcpServer(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await closeRuntime(customRuntimes.get(id));
      customRuntimes.delete(id);
      await store.updateCustomServerMetadata(id, {
        lastConnectedAt: undefined,
        lastError: undefined,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  async function getCustomMcpServersStatus(): Promise<CustomMcpStatus[]> {
    const records = await store.getCustomServers();
    return records.map((record) => {
      const isConnected = customRuntimes.has(record.id);
      const state: McpIntegrationConnection = record.lastError
        ? "error"
        : isConnected
        ? "connected"
        : "disconnected";
      return {
        id: record.id,
        name: record.name,
        url: record.url,
        transport: record.transport as CustomMcpTransport,
        state,
        error: record.lastError,
        lastConnectedAt: record.lastConnectedAt,
      };
    });
  }

  // ── Native (stdio) MCP provider methods ──

  function createNativeRuntime(config: McpNativeProviderConfig): ProviderRuntime {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env } as Record<string, string>,
    });
    const client = new Client(CLIENT_INFO);
    return { client, transport };
  }

  async function connectNativeProvider(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!enabled) {
      return { ok: false, error: "MCP integrations are disabled. Set MCP_INTEGRATIONS_ENABLED=true (or remove MCP_INTEGRATIONS_ENABLED=false)." };
    }
    const config = getNativeProviderConfig(id);
    if (!config) {
      return { ok: false, error: `Unknown native MCP provider: ${id}` };
    }
    try {
      await closeRuntime(nativeRuntimes.get(id));
      nativeRuntimes.delete(id);
      const runtime = createNativeRuntime(config);
      await runtime.client.connect(runtime.transport);
      await runtime.client.listTools();
      nativeRuntimes.set(id, runtime);
      log("INFO", `${config.label} native MCP provider connected.`);
      return { ok: true };
    } catch (error) {
      const message = formatError(error);
      const isNotFound = /ENOENT|not found|command not found/i.test(message);
      const hint = isNotFound
        ? `${config.command} CLI not found. Install it with: npm install -g @openai/codex`
        : message;
      log("ERROR", `${config.label} native MCP connect failed: ${hint}`);
      return { ok: false, error: hint };
    }
  }

  async function disconnectNativeProvider(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await closeRuntime(nativeRuntimes.get(id));
      nativeRuntimes.delete(id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  function getNativeProvidersStatus(): McpIntegrationStatus[] {
    return MCP_NATIVE_PROVIDERS.map((config) => {
      const isConnected = nativeRuntimes.has(config.id);
      return {
        provider: config.id,
        mode: "native" as const,
        state: isConnected ? ("connected" as const) : ("disconnected" as const),
        enabled,
        label: config.label,
      };
    });
  }

  // ── Shared tool building ──

  async function buildAgentToolsForProvider(
    provider: AgentExternalToolProvider,
    runtime: ProviderRuntime,
  ): Promise<AgentExternalToolSet> {
    if (runtime.toolCache) {
      return runtime.toolCache;
    }

    const { tools } = await runtime.client.listTools();
    const mapped: AgentExternalToolSet = {};

    for (const tool of tools) {
      const prefixedName = `${provider}__${tool.name}`;
      const isMutating = classifyMutatingTool(provider, tool);

      mapped[prefixedName] = {
        name: prefixedName,
        provider,
        description: tool.description ?? `${provider} MCP tool: ${tool.name}`,
        inputSchema: tool.inputSchema,
        isMutating,
        execute: async (input, execOptions) => {
          const result = await runtime.client.callTool(
            {
              name: tool.name,
              arguments: normalizeToolInput(input),
            },
            undefined,
            { signal: execOptions.abortSignal },
          );

          if ("isError" in result && result.isError === true) {
            const detail = extractCallToolErrorText(result);
            throw new Error(
              detail
                ? `MCP tool "${tool.name}" returned an error: ${detail}`
                : `MCP tool "${tool.name}" returned an error.`,
            );
          }

          if ("structuredContent" in result && result.structuredContent != null) {
            return result.structuredContent;
          }
          if ("toolResult" in result) {
            return result.toolResult;
          }
          return result;
        },
      };
    }

    runtime.toolCache = mapped;
    return mapped;
  }

  // ── Status / tools / dispose ──

  async function getStatus(): Promise<McpIntegrationStatus[]> {
    const data = await store.readFile();
    const statuses: McpIntegrationStatus[] = [];

    let encryptionError: string | undefined;
    const tokenResults = new Map<string, boolean>();

    try {
      for (const config of MCP_OAUTH_PROVIDERS) {
        const hasTokens = !!(await store.getOAuthTokens(config.id));
        tokenResults.set(config.id, hasTokens);
      }
    } catch (error) {
      encryptionError = error instanceof Error ? error.message : String(error);
    }

    for (const config of MCP_OAUTH_PROVIDERS) {
      const record = data.oauthProviders?.[config.id];
      const hasTokens = tokenResults.get(config.id) ?? false;

      statuses.push({
        provider: config.id,
        mode: "oauth",
        enabled,
        mcpUrl: config.mcpUrl,
        state: !enabled
          ? "disconnected"
          : encryptionError
          ? "error"
          : record?.lastError
          ? "error"
          : hasTokens
          ? "connected"
          : "disconnected",
        // OAuth provider names are static. Ignore persisted labels so legacy
        // "Connected"/"Disconnected" metadata cannot leak into the UI.
        label: config.label,
        error: encryptionError ?? record?.lastError,
        lastConnectedAt: record?.lastConnectedAt,
      });
    }

    return statuses;
  }

  async function getExternalTools(): Promise<AgentExternalToolSet> {
    if (!enabled) return {};

    const merged: AgentExternalToolSet = {};

    for (const config of MCP_OAUTH_PROVIDERS) {
      try {
        const runtime = await ensureOAuthRuntime(config);
        if (runtime) {
          Object.assign(merged, await buildAgentToolsForProvider(config.id as AgentExternalToolProvider, runtime));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await store.setOAuthMetadata(config.id, {
          label: "Disconnected",
          lastConnectedAt: undefined,
          lastError: message,
        });
        log("WARN", `${config.label} MCP tools unavailable: ${message}`);
      }
    }

    for (const [id, runtime] of customRuntimes) {
      try {
        Object.assign(merged, await buildAgentToolsForProvider(`custom:${id}` as AgentExternalToolProvider, runtime));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await store.updateCustomServerMetadata(id, {
          lastConnectedAt: undefined,
          lastError: message,
        });
        log("WARN", `Custom MCP server ${id} tools unavailable: ${message}`);
      }
    }

    for (const [id, runtime] of nativeRuntimes) {
      try {
        Object.assign(merged, await buildAgentToolsForProvider(id as AgentExternalToolProvider, runtime));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("WARN", `Native MCP provider ${id} tools unavailable: ${message}`);
      }
    }

    return merged;
  }

  async function getMcpToolsInfo(): Promise<McpProviderToolSummary[]> {
    const result: McpProviderToolSummary[] = [];

    async function collectTools(provider: string, runtime: ProviderRuntime): Promise<void> {
      try {
        const { tools } = await runtime.client.listTools();
        const mapped: McpToolInfo[] = tools.map((t) => ({
          name: t.name,
          description: t.description,
          isMutating: classifyMutatingTool(provider, t),
        }));
        result.push({ provider, tools: mapped });
      } catch {
        // runtime disconnected or unresponsive — skip silently
      }
    }

    const runtimePromises = MCP_OAUTH_PROVIDERS.map((config) =>
      ensureOAuthRuntime(config).catch(() => undefined),
    );
    const runtimes = await Promise.all(runtimePromises);

    for (let i = 0; i < MCP_OAUTH_PROVIDERS.length; i++) {
      const runtime = runtimes[i];
      if (runtime) {
        await collectTools(MCP_OAUTH_PROVIDERS[i].id, runtime);
      }
    }

    for (const [id, runtime] of customRuntimes) {
      await collectTools(`custom:${id}`, runtime);
    }

    for (const [id, runtime] of nativeRuntimes) {
      await collectTools(id, runtime);
    }

    return result;
  }

  async function dispose(): Promise<void> {
    for (const [id, runtime] of oauthRuntimes) {
      await closeRuntime(runtime);
      oauthRuntimes.delete(id);
    }
    for (const [id, runtime] of customRuntimes) {
      await closeRuntime(runtime);
      customRuntimes.delete(id);
    }
    for (const [id, runtime] of nativeRuntimes) {
      await closeRuntime(runtime);
      nativeRuntimes.delete(id);
    }
  }

  return {
    enabled,
    connectProvider,
    disconnectProvider,
    getStatus,
    getExternalTools,
    dispose,
    addCustomMcpServer,
    removeCustomMcpServer,
    connectCustomMcpServer,
    disconnectCustomMcpServer,
    getCustomMcpServersStatus,
    getMcpToolsInfo,
    connectNativeProvider,
    disconnectNativeProvider,
    getNativeProvidersStatus,
  };
}
