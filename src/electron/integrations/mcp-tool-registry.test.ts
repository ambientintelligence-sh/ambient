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

import { createMcpToolRegistry, isMutatingToolName } from "./mcp-tool-registry";
import { SecureCredentialStore } from "./secure-credential-store";

describe("isMutatingToolName", () => {
  it("flags known mutating verbs", () => {
    expect(isMutatingToolName("create_issue")).toBe(true);
    expect(isMutatingToolName("update_page")).toBe(true);
    expect(isMutatingToolName("delete_comment")).toBe(true);
  });

  it("does not flag common read-only verbs", () => {
    expect(isMutatingToolName("get_issue")).toBe(false);
    expect(isMutatingToolName("list_projects")).toBe(false);
    expect(isMutatingToolName("search_docs")).toBe(false);
  });
});

describe("createMcpToolRegistry.getStatus", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    encryptionState.available = true;
    await Promise.all(
      tempDirs.splice(0).map((dir) =>
        fs.rm(dir, { recursive: true, force: true }),
      ),
    );
  });

  it("uses the provider config label instead of persisted connection text", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-mcp-"));
    tempDirs.push(tempDir);

    const store = new SecureCredentialStore(
      path.join(tempDir, "integrations.credentials.json"),
    );
    await store.setOAuthTokens("notion", {
      access_token: "token-1",
      token_type: "Bearer",
    });
    await store.setOAuthMetadata("notion", {
      label: "Connected",
      lastConnectedAt: 123,
      lastError: undefined,
    });

    const registry = createMcpToolRegistry({
      enabled: true,
      store,
      openExternal: async () => {},
    });

    const statuses = await registry.getStatus();
    const notion = statuses.find((status) => status.provider === "notion");

    expect(notion).toMatchObject({
      provider: "notion",
      label: "Notion",
      state: "connected",
    });
  });
});
