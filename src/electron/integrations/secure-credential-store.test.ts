import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const encryptionState = vi.hoisted(() => ({ available: true }));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionState.available,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (value: Buffer) => {
      const raw = value.toString("utf8");
      if (!raw.startsWith("enc:")) {
        throw new Error("invalid encrypted value");
      }
      return raw.slice(4);
    },
  },
}));

import { SecureCredentialStore } from "./secure-credential-store";

describe("SecureCredentialStore", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    encryptionState.available = true;
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("round-trips encrypted Notion tokens via generic methods", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-store-"));
    tempDirs.push(tempDir);
    const store = new SecureCredentialStore(path.join(tempDir, "integrations.credentials.json"));

    await store.setOAuthTokens("notion", {
      access_token: "token-1",
      token_type: "Bearer",
      refresh_token: "refresh-1",
    });

    const loaded = await store.getOAuthTokens("notion");
    expect(loaded?.access_token).toBe("token-1");
    expect(loaded?.refresh_token).toBe("refresh-1");
  });

  it("round-trips encrypted Linear tokens via generic methods", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-store-"));
    tempDirs.push(tempDir);
    const store = new SecureCredentialStore(path.join(tempDir, "integrations.credentials.json"));

    await store.setOAuthTokens("linear", {
      access_token: "linear-token-1",
      token_type: "Bearer",
    });

    const loaded = await store.getOAuthTokens("linear");
    expect(loaded?.access_token).toBe("linear-token-1");
    expect(loaded?.token_type).toBe("Bearer");
  });

  it("fails writes when encryption is unavailable", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-store-"));
    tempDirs.push(tempDir);
    const store = new SecureCredentialStore(path.join(tempDir, "integrations.credentials.json"));

    encryptionState.available = false;
    await expect(store.setOAuthTokens("linear", { access_token: "test", token_type: "Bearer" })).rejects.toThrow(
      "Secure keychain encryption is unavailable on this system.",
    );
  });

  it("clearOAuthProvider removes tokens but keeps label", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-store-"));
    tempDirs.push(tempDir);
    const store = new SecureCredentialStore(path.join(tempDir, "integrations.credentials.json"));

    await store.setOAuthTokens("notion", {
      access_token: "token-1",
      token_type: "Bearer",
    });
    await store.setOAuthMetadata("notion", {
      label: "Connected",
      lastConnectedAt: Date.now(),
      lastError: undefined,
    });

    await store.clearOAuthProvider("notion");

    const tokens = await store.getOAuthTokens("notion");
    expect(tokens).toBeUndefined();
  });

  it("migrates legacy top-level notion/linear fields to oauthProviders", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-store-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "integrations.credentials.json");
    const store = new SecureCredentialStore(filePath);

    // Write a legacy-format file directly
    const legacyToken = Buffer.from(`enc:${JSON.stringify({ access_token: "legacy-token", token_type: "Bearer" })}`, "utf8").toString("base64");
    const legacy = {
      version: 1,
      notion: { tokensEncrypted: legacyToken, label: "Connected" },
    };
    await fs.writeFile(filePath, JSON.stringify(legacy), "utf8");

    // Reading should trigger migration
    const data = await store.readFile();
    expect(data.oauthProviders?.notion?.label).toBe("Connected");
    expect(data.notion).toBeUndefined();

    // Should also be able to read the tokens via generic methods
    const tokens = await store.getOAuthTokens("notion");
    expect(tokens?.access_token).toBe("legacy-token");
  });

  it("isolates providers from each other", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-store-"));
    tempDirs.push(tempDir);
    const store = new SecureCredentialStore(path.join(tempDir, "integrations.credentials.json"));

    await store.setOAuthTokens("notion", { access_token: "notion-tok", token_type: "Bearer" });
    await store.setOAuthTokens("linear", { access_token: "linear-tok", token_type: "Bearer" });

    const notion = await store.getOAuthTokens("notion");
    const linear = await store.getOAuthTokens("linear");
    expect(notion?.access_token).toBe("notion-tok");
    expect(linear?.access_token).toBe("linear-tok");

    await store.clearOAuthProvider("notion");
    const notionAfterClear = await store.getOAuthTokens("notion");
    const linearAfterClear = await store.getOAuthTokens("linear");
    expect(notionAfterClear).toBeUndefined();
    expect(linearAfterClear?.access_token).toBe("linear-tok");
  });
});
