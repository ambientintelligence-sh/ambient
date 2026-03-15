import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ApiKeyDefinition,
  CustomMcpStatus,
  McpIntegrationStatus,
  McpProviderToolSummary,
  ProjectMeta,
} from "@core/types";

type IntegrationState = {
  mcpIntegrations: McpIntegrationStatus[];
  customMcpServers: CustomMcpStatus[];
  nativeProviders: McpIntegrationStatus[];
  mcpToolsByProvider: Record<string, McpProviderToolSummary>;
  mcpBusy: boolean;
  apiKeyDefinitions: ApiKeyDefinition[];
  apiKeyStatus: Record<string, boolean>;
  projects: ProjectMeta[];
  activeProjectId: string | null;
};

type IntegrationActions = {
  init: () => Promise<void>;
  refreshMcpIntegrations: () => Promise<void>;
  refreshCustomMcpServers: () => Promise<void>;
  refreshMcpToolsInfo: () => Promise<void>;
  refreshApiKeyStatus: () => Promise<void>;
  connectProvider: (providerId: string) => Promise<{ notice?: string }>;
  disconnectProvider: (providerId: string) => Promise<{ notice?: string }>;
  addCustomServer: (cfg: {
    name: string;
    url: string;
    transport: "streamable" | "sse";
    bearerToken?: string;
  }) => Promise<{ ok: boolean; error?: string; id?: string; notice?: string }>;
  removeCustomServer: (id: string) => Promise<{ ok: boolean; error?: string; notice?: string }>;
  connectCustomServer: (id: string) => Promise<{ ok: boolean; error?: string; notice?: string }>;
  disconnectCustomServer: (id: string) => Promise<{ ok: boolean; error?: string; notice?: string }>;
  refreshNativeProviders: () => Promise<void>;
  connectNativeProvider: (id: string) => Promise<{ notice?: string }>;
  disconnectNativeProvider: (id: string) => Promise<{ notice?: string }>;
  saveApiKey: (envVar: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  deleteApiKey: (envVar: string) => Promise<{ ok: boolean; error?: string }>;
  refreshProjects: () => Promise<ProjectMeta[]>;
  createProject: (name: string, instructions: string, context: string) => Promise<{ ok: boolean; project?: ProjectMeta }>;
  editProject: (project: ProjectMeta) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  selectProject: (id: string | null) => void;
};

export const useIntegrationStore = create<IntegrationState & IntegrationActions>()(
  persist(
    (set, get) => ({
      // State
      mcpIntegrations: [],
      customMcpServers: [],
      nativeProviders: [],
      mcpToolsByProvider: {},
      mcpBusy: false,
      apiKeyDefinitions: [],
      apiKeyStatus: {},
      projects: [],
      activeProjectId: null,

      // Actions
      init: async () => {
        const [integrations, servers, nativeStatuses, toolSummaries, definitions, keyStatus, projects] =
          await Promise.all([
            window.electronAPI.getMcpIntegrationsStatus(),
            window.electronAPI.getCustomMcpServersStatus(),
            window.electronAPI.getNativeProvidersStatus(),
            window.electronAPI.getMcpToolsInfo(),
            window.electronAPI.getApiKeyDefinitions(),
            window.electronAPI.getApiKeyStatus(),
            window.electronAPI.getProjects(),
          ]);

        const byProvider: Record<string, McpProviderToolSummary> = {};
        for (const s of toolSummaries) byProvider[s.provider] = s;

        set({
          mcpIntegrations: integrations,
          customMcpServers: servers,
          nativeProviders: nativeStatuses,
          mcpToolsByProvider: byProvider,
          apiKeyDefinitions: definitions,
          apiKeyStatus: keyStatus,
          projects,
        });
      },

      refreshMcpIntegrations: async () => {
        const statuses = await window.electronAPI.getMcpIntegrationsStatus();
        set({ mcpIntegrations: statuses });
      },

      refreshCustomMcpServers: async () => {
        const servers = await window.electronAPI.getCustomMcpServersStatus();
        set({ customMcpServers: servers });
      },

      refreshMcpToolsInfo: async () => {
        const summaries = await window.electronAPI.getMcpToolsInfo();
        const byProvider: Record<string, McpProviderToolSummary> = {};
        for (const s of summaries) byProvider[s.provider] = s;
        set({ mcpToolsByProvider: byProvider });
      },

      refreshApiKeyStatus: async () => {
        const status = await window.electronAPI.getApiKeyStatus();
        set({ apiKeyStatus: status });
      },

      connectProvider: async (providerId) => {
        set({ mcpBusy: true });
        try {
          const result = await window.electronAPI.connectMcpProvider(providerId);
          const notice = result.ok
            ? `${providerId} MCP connected.`
            : `${providerId} connection failed: ${result.error ?? "Unknown error"}`;
          return { notice };
        } finally {
          const { refreshMcpIntegrations, refreshMcpToolsInfo } = get();
          await Promise.all([refreshMcpIntegrations(), refreshMcpToolsInfo()]);
          set({ mcpBusy: false });
        }
      },

      disconnectProvider: async (providerId) => {
        set({ mcpBusy: true });
        try {
          const result = await window.electronAPI.disconnectMcpProvider(providerId);
          const notice = result.ok
            ? `${providerId} MCP disconnected.`
            : `Could not disconnect ${providerId}: ${result.error ?? "Unknown error"}`;
          return { notice };
        } finally {
          const { refreshMcpIntegrations, refreshMcpToolsInfo } = get();
          await Promise.all([refreshMcpIntegrations(), refreshMcpToolsInfo()]);
          set({ mcpBusy: false });
        }
      },

      addCustomServer: async (cfg) => {
        set({ mcpBusy: true });
        try {
          const result = await window.electronAPI.addCustomMcpServer(cfg);
          const notice = result.ok
            ? undefined
            : `Custom MCP server add failed: ${result.error ?? "Unknown error"}`;
          return { ...result, notice };
        } finally {
          const { refreshCustomMcpServers, refreshMcpToolsInfo } = get();
          await Promise.all([refreshCustomMcpServers(), refreshMcpToolsInfo()]);
          set({ mcpBusy: false });
        }
      },

      removeCustomServer: async (id) => {
        set({ mcpBusy: true });
        try {
          const result = await window.electronAPI.removeCustomMcpServer(id);
          const notice = result.ok
            ? undefined
            : `Could not remove custom server: ${result.error ?? "Unknown error"}`;
          return { ...result, notice };
        } finally {
          const { refreshCustomMcpServers, refreshMcpToolsInfo } = get();
          await Promise.all([refreshCustomMcpServers(), refreshMcpToolsInfo()]);
          set({ mcpBusy: false });
        }
      },

      connectCustomServer: async (id) => {
        set({ mcpBusy: true });
        try {
          const result = await window.electronAPI.connectCustomMcpServer(id);
          const notice = result.ok
            ? undefined
            : `Custom MCP server connect failed: ${result.error ?? "Unknown error"}`;
          return { ...result, notice };
        } finally {
          const { refreshCustomMcpServers, refreshMcpToolsInfo } = get();
          await Promise.all([refreshCustomMcpServers(), refreshMcpToolsInfo()]);
          set({ mcpBusy: false });
        }
      },

      disconnectCustomServer: async (id) => {
        set({ mcpBusy: true });
        try {
          const result = await window.electronAPI.disconnectCustomMcpServer(id);
          const notice = result.ok
            ? undefined
            : `Could not disconnect custom server: ${result.error ?? "Unknown error"}`;
          return { ...result, notice };
        } finally {
          const { refreshCustomMcpServers, refreshMcpToolsInfo } = get();
          await Promise.all([refreshCustomMcpServers(), refreshMcpToolsInfo()]);
          set({ mcpBusy: false });
        }
      },

      refreshNativeProviders: async () => {
        const statuses = await window.electronAPI.getNativeProvidersStatus();
        set({ nativeProviders: statuses });
      },

      connectNativeProvider: async (id) => {
        set({ mcpBusy: true });
        try {
          const result = await window.electronAPI.connectNativeProvider(id);
          const notice = result.ok
            ? `${id} MCP connected.`
            : `${id} connection failed: ${result.error ?? "Unknown error"}`;
          return { notice };
        } finally {
          const { refreshNativeProviders, refreshMcpToolsInfo } = get();
          await Promise.all([refreshNativeProviders(), refreshMcpToolsInfo()]);
          set({ mcpBusy: false });
        }
      },

      disconnectNativeProvider: async (id) => {
        set({ mcpBusy: true });
        try {
          const result = await window.electronAPI.disconnectNativeProvider(id);
          const notice = result.ok
            ? `${id} MCP disconnected.`
            : `Could not disconnect ${id}: ${result.error ?? "Unknown error"}`;
          return { notice };
        } finally {
          const { refreshNativeProviders, refreshMcpToolsInfo } = get();
          await Promise.all([refreshNativeProviders(), refreshMcpToolsInfo()]);
          set({ mcpBusy: false });
        }
      },

      saveApiKey: async (envVar, value) => {
        const result = await window.electronAPI.saveApiKey(envVar, value);
        if (result.ok) {
          await get().refreshApiKeyStatus();
        }
        return result;
      },

      deleteApiKey: async (envVar) => {
        const result = await window.electronAPI.deleteApiKey(envVar);
        await get().refreshApiKeyStatus();
        return result;
      },

      refreshProjects: async () => {
        const list = await window.electronAPI.getProjects();
        set({ projects: list });
        return list;
      },

      createProject: async (name, instructions, context) => {
        const result = await window.electronAPI.createProject(
          name,
          instructions || undefined,
          context || undefined,
        );
        if (result.ok) {
          await get().refreshProjects();
          if (result.project) {
            set({ activeProjectId: result.project.id });
          }
        }
        return { ok: result.ok, project: result.project };
      },

      editProject: async (project) => {
        const result = await window.electronAPI.updateProject(project.id, {
          name: project.name,
          instructions: project.instructions,
          context: project.context,
        });
        if (result.ok) {
          await get().refreshProjects();
        }
      },

      deleteProject: async (id) => {
        await window.electronAPI.deleteProject(id);
        if (get().activeProjectId === id) {
          set({ activeProjectId: null });
        }
        await get().refreshProjects();
      },

      selectProject: (id) => set({ activeProjectId: id }),
    }),
    {
      name: "ambient-integration-store",
      partialize: (state) => ({ activeProjectId: state.activeProjectId }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<IntegrationState>;
        // Migrate from legacy useLocalStorage key
        if (stored.activeProjectId === undefined) {
          try {
            const legacy = localStorage.getItem("ambient-active-project-id");
            if (legacy !== null) {
              stored.activeProjectId = JSON.parse(legacy);
            }
          } catch { /* ignore */ }
        }
        return { ...current, ...stored };
      },
    },
  ),
);
