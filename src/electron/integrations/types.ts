import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpIntegrationStatus, CustomMcpTransport, CustomMcpStatus, McpProviderToolSummary } from "@core/types";
import type { AgentExternalToolSet } from "@core/agents/external-tools";

export type OAuthCredentialRecord = {
  tokensEncrypted?: string;
  clientInformationEncrypted?: string;
  codeVerifierEncrypted?: string;
  pendingState?: string;
  label?: string;
  lastConnectedAt?: number;
  lastError?: string;
};

export type CustomMcpServerRecord = {
  id: string;
  name: string;
  url: string;
  transport: "streamable" | "sse";
  tokenEncrypted?: string;
  label?: string;
  lastConnectedAt?: number;
  lastError?: string;
};

export type IntegrationCredentialsFile = {
  version: 1;
  oauthProviders?: Record<string, OAuthCredentialRecord>;
  customServers?: CustomMcpServerRecord[];
  apiKeys?: Record<string, string>;
  /** @deprecated Old per-provider fields — migrated on first read. */
  notion?: OAuthCredentialRecord;
  /** @deprecated Old per-provider fields — migrated on first read. */
  linear?: OAuthCredentialRecord;
};

export type IntegrationSecretPayload = {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformationMixed;
  codeVerifier?: string;
};

export type IntegrationManager = {
  readonly enabled: boolean;
  getStatus: () => Promise<McpIntegrationStatus[]>;
  connectProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;
  getExternalTools: () => Promise<AgentExternalToolSet>;
  dispose: () => Promise<void>;
  addCustomMcpServer: (cfg: { name: string; url: string; transport: CustomMcpTransport; bearerToken?: string }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  removeCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  connectCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  getCustomMcpServersStatus: () => Promise<CustomMcpStatus[]>;
  getMcpToolsInfo: () => Promise<McpProviderToolSummary[]>;
  connectNativeProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectNativeProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;
  getNativeProvidersStatus: () => McpIntegrationStatus[];
};
