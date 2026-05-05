import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, TaskSuggestion } from "@core/types";
import { useTaskStore } from "./task-store";

const mockAppConfig = {} as AppConfig;

function suggestion(overrides: Partial<TaskSuggestion> = {}): TaskSuggestion {
  return {
    id: "suggestion-1",
    surface: "callout",
    text: "Small flag: the cited figure is 38M, not 45M.",
    kind: "flag",
    sessionId: "session-1",
    createdAt: 100,
    ...overrides,
  };
}

function resetStore() {
  useTaskStore.setState({
    tasks: [],
    suggestions: [],
    archivedSuggestions: [],
    processingTaskIds: [],
    pendingApprovalTask: null,
    approvingLargeTask: false,
    forceWorkTabKey: 0,
    transcriptRefs: [],
    suggestionProgress: { busy: false, wordsUntilNextScan: 200, liveWordsUntilNextScan: 200 },
    suggestionScanCards: [],
  });
}

describe("task-store suggestions", () => {
  beforeEach(() => {
    resetStore();
    vi.restoreAllMocks();
    vi.stubGlobal("window", {
      electronAPI: {
        addTask: vi.fn().mockResolvedValue({ ok: true }),
      },
    });
  });

  it("dismisses callouts without archiving a task", () => {
    useTaskStore.getState().setSuggestions([suggestion()]);

    useTaskStore.getState().dismissSuggestion("suggestion-1", mockAppConfig);

    const state = useTaskStore.getState();
    expect(state.suggestions).toEqual([]);
    expect(state.archivedSuggestions).toEqual([]);
    expect(window.electronAPI.addTask).not.toHaveBeenCalled();
  });

  it("archives dispatchable suggestions when dismissed", () => {
    useTaskStore.getState().setSuggestions([
      suggestion({
        surface: "agent_suggestion",
        text: "Compare Datadog vs Grafana Cloud pricing.",
      }),
    ]);

    useTaskStore.getState().dismissSuggestion("suggestion-1", mockAppConfig);

    const state = useTaskStore.getState();
    expect(state.suggestions).toEqual([]);
    expect(state.archivedSuggestions).toMatchObject([
      {
        id: "suggestion-1",
        text: "Compare Datadog vs Grafana Cloud pricing.",
        archived: true,
        size: "large",
      },
    ]);
    expect(window.electronAPI.addTask).toHaveBeenCalledOnce();
  });

  it("accepting a callout only removes it from the live stack", async () => {
    useTaskStore.getState().setSuggestions([suggestion()]);

    await useTaskStore.getState().acceptSuggestion({
      suggestion: suggestion(),
      targetSessionId: "session-1",
      appConfig: mockAppConfig,
    });

    const state = useTaskStore.getState();
    expect(state.suggestions).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(window.electronAPI.addTask).not.toHaveBeenCalled();
  });
});
