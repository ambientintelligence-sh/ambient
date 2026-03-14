import { promises as fs } from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  CustomMcpServerRecord,
  IntegrationCredentialsFile,
  OAuthCredentialRecord,
} from "./types";

const EMPTY_FILE: IntegrationCredentialsFile = { version: 1 };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Migrate legacy per-provider top-level fields into `oauthProviders`.
 * Returns true if migration occurred (caller should persist).
 */
function migrateIfNeeded(data: IntegrationCredentialsFile): boolean {
  let migrated = false;
  const LEGACY_KEYS = ["notion", "linear"] as const;

  for (const key of LEGACY_KEYS) {
    const legacy = data[key];
    if (!legacy) continue;

    data.oauthProviders ??= {};
    if (!data.oauthProviders[key]) {
      data.oauthProviders[key] = legacy;
    }
    delete data[key];
    migrated = true;
  }

  return migrated;
}

export class SecureCredentialStore {
  constructor(private readonly filePath: string) {}

  encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  ensureEncryptionAvailable(): void {
    if (!this.encryptionAvailable()) {
      throw new Error("Secure keychain encryption is unavailable on this system.");
    }
  }

  private encryptString(value: string): string {
    this.ensureEncryptionAvailable();
    return safeStorage.encryptString(value).toString("base64");
  }

  private decryptString(value?: string): string | undefined {
    if (!value) return undefined;
    this.ensureEncryptionAvailable();
    try {
      const buffer = Buffer.from(value, "base64");
      return safeStorage.decryptString(buffer);
    } catch {
      return undefined;
    }
  }

  private encryptJson(value: unknown): string {
    return this.encryptString(JSON.stringify(value));
  }

  private decryptJson<T>(value?: string): T | undefined {
    const raw = this.decryptString(value);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async readFile(): Promise<IntegrationCredentialsFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as IntegrationCredentialsFile;
      if (!parsed || parsed.version !== 1) {
        return clone(EMPTY_FILE);
      }
      if (migrateIfNeeded(parsed)) {
        await this.writeFile(parsed);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return clone(EMPTY_FILE);
      }
      throw error;
    }
  }

  async writeFile(next: IntegrationCredentialsFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  async mutate(mutator: (current: IntegrationCredentialsFile) => IntegrationCredentialsFile): Promise<void> {
    const current = await this.readFile();
    const next = mutator(clone(current));
    await this.writeFile(next);
  }

  // ── Generic OAuth provider methods ──

  private providerRecord(data: IntegrationCredentialsFile, providerId: string): OAuthCredentialRecord {
    return data.oauthProviders?.[providerId] ?? {};
  }

  private ensureProvider(data: IntegrationCredentialsFile, providerId: string): OAuthCredentialRecord {
    data.oauthProviders ??= {};
    data.oauthProviders[providerId] ??= {};
    return data.oauthProviders[providerId];
  }

  async getOAuthTokens(providerId: string): Promise<OAuthTokens | undefined> {
    const data = await this.readFile();
    return this.decryptJson<OAuthTokens>(this.providerRecord(data, providerId).tokensEncrypted);
  }

  async setOAuthTokens(providerId: string, tokens: OAuthTokens | undefined): Promise<void> {
    await this.mutate((current) => {
      const record = this.ensureProvider(current, providerId);
      record.tokensEncrypted = tokens ? this.encryptJson(tokens) : undefined;
      return current;
    });
  }

  async getOAuthClientInformation(providerId: string): Promise<OAuthClientInformationMixed | undefined> {
    const data = await this.readFile();
    return this.decryptJson<OAuthClientInformationMixed>(this.providerRecord(data, providerId).clientInformationEncrypted);
  }

  async setOAuthClientInformation(providerId: string, info: OAuthClientInformationMixed | undefined): Promise<void> {
    await this.mutate((current) => {
      const record = this.ensureProvider(current, providerId);
      record.clientInformationEncrypted = info ? this.encryptJson(info) : undefined;
      return current;
    });
  }

  async getOAuthCodeVerifier(providerId: string): Promise<string | undefined> {
    const data = await this.readFile();
    return this.decryptString(this.providerRecord(data, providerId).codeVerifierEncrypted);
  }

  async setOAuthCodeVerifier(providerId: string, verifier: string | undefined): Promise<void> {
    await this.mutate((current) => {
      const record = this.ensureProvider(current, providerId);
      record.codeVerifierEncrypted = verifier ? this.encryptString(verifier) : undefined;
      return current;
    });
  }

  async getOAuthPendingState(providerId: string): Promise<string | undefined> {
    const data = await this.readFile();
    return this.providerRecord(data, providerId).pendingState;
  }

  async setOAuthPendingState(providerId: string, state: string | undefined): Promise<void> {
    await this.mutate((current) => {
      const record = this.ensureProvider(current, providerId);
      record.pendingState = state;
      return current;
    });
  }

  async setOAuthMetadata(providerId: string, meta: { label?: string; lastConnectedAt?: number; lastError?: string }): Promise<void> {
    await this.mutate((current) => {
      const record = this.ensureProvider(current, providerId);
      record.label = meta.label;
      record.lastConnectedAt = meta.lastConnectedAt;
      record.lastError = meta.lastError;
      return current;
    });
  }

  async clearOAuthProvider(providerId: string): Promise<void> {
    await this.mutate((current) => {
      const existing = current.oauthProviders?.[providerId];
      if (current.oauthProviders) {
        current.oauthProviders[providerId] = {
          label: existing?.label,
          lastConnectedAt: undefined,
          lastError: undefined,
        };
      }
      return current;
    });
  }

  // ── Custom MCP server methods ──

  encryptToken(token: string): string {
    return this.encryptString(token);
  }

  async getCustomServers(): Promise<CustomMcpServerRecord[]> {
    const data = await this.readFile();
    return data.customServers ?? [];
  }

  async addCustomServer(record: CustomMcpServerRecord): Promise<void> {
    await this.mutate((current) => {
      current.customServers = [...(current.customServers ?? []), record];
      return current;
    });
  }

  async updateCustomServerMetadata(
    id: string,
    meta: { label?: string; lastConnectedAt?: number; lastError?: string },
  ): Promise<void> {
    await this.mutate((current) => {
      const servers = current.customServers ?? [];
      const idx = servers.findIndex((s) => s.id === id);
      if (idx >= 0) {
        servers[idx] = { ...servers[idx], ...meta };
        current.customServers = servers;
      }
      return current;
    });
  }

  async removeCustomServer(id: string): Promise<void> {
    await this.mutate((current) => {
      current.customServers = (current.customServers ?? []).filter((s) => s.id !== id);
      return current;
    });
  }

  async getCustomServerToken(id: string): Promise<string | undefined> {
    const data = await this.readFile();
    const record = (data.customServers ?? []).find((s) => s.id === id);
    return this.decryptString(record?.tokenEncrypted);
  }

  // ── API key methods ──

  async getApiKey(envVar: string): Promise<string | undefined> {
    const data = await this.readFile();
    return this.decryptString(data.apiKeys?.[envVar]);
  }

  async getAllApiKeys(): Promise<Record<string, string>> {
    const data = await this.readFile();
    const entries = data.apiKeys ?? {};
    const result: Record<string, string> = {};
    for (const [envVar, encrypted] of Object.entries(entries)) {
      const decrypted = this.decryptString(encrypted);
      if (decrypted) result[envVar] = decrypted;
    }
    return result;
  }

  async setApiKey(envVar: string, value: string | undefined): Promise<void> {
    await this.mutate((current) => {
      current.apiKeys ??= {};
      if (value) {
        current.apiKeys[envVar] = this.encryptString(value);
      } else {
        delete current.apiKeys[envVar];
        if (Object.keys(current.apiKeys).length === 0) {
          delete current.apiKeys;
        }
      }
      return current;
    });
  }
}
