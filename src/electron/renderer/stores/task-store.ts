import { create } from "zustand";
import type { AppConfig, TaskItem, TaskSize, TaskSuggestion } from "@core/types";

const LIVE_SUGGESTION_MAX_AGE_MS = 5 * 60_000;
const FINISHED_SCAN_CARD_MAX_AGE_MS = 6_000;

function buildAiSuggestionDetails(suggestion: TaskSuggestion): string | undefined {
  const sections = [
    suggestion.details?.trim()
      ? `Context summary:\n${suggestion.details.trim()}`
      : "",
    suggestion.transcriptExcerpt?.trim()
      ? `Original transcript excerpt:\n${suggestion.transcriptExcerpt.trim()}`
      : "",
  ].filter(Boolean);
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function parseAiSuggestionDetails(details?: string): Pick<TaskSuggestion, "details" | "transcriptExcerpt"> {
  const trimmed = details?.trim();
  if (!trimmed) return {};

  const summaryPrefix = "Context summary:\n";
  const excerptPrefix = "Original transcript excerpt:\n";

  if (trimmed.startsWith(summaryPrefix)) {
    const withoutPrefix = trimmed.slice(summaryPrefix.length);
    const excerptIndex = withoutPrefix.indexOf(`\n\n${excerptPrefix}`);
    if (excerptIndex >= 0) {
      return {
        details: withoutPrefix.slice(0, excerptIndex).trim() || undefined,
        transcriptExcerpt: withoutPrefix.slice(excerptIndex + `\n\n${excerptPrefix}`.length).trim() || undefined,
      };
    }
    return { details: withoutPrefix.trim() || undefined };
  }

  if (trimmed.startsWith(excerptPrefix)) {
    return { transcriptExcerpt: trimmed.slice(excerptPrefix.length).trim() || undefined };
  }

  return { details: trimmed };
}

function archivedTaskToSuggestion(task: TaskItem): TaskSuggestion | null {
  if (!task.archived || task.source !== "ai") return null;
  const parsed = parseAiSuggestionDetails(task.details);
  return {
    id: task.id,
    text: task.text,
    details: parsed.details,
    transcriptExcerpt: parsed.transcriptExcerpt,
    kind: task.suggestionKind,
    sessionId: task.sessionId,
    createdAt: task.createdAt,
  };
}

type SuggestionProgress = {
  scanId?: string;
  label?: string;
  busy: boolean;
  wordsUntilNextScan: number;
  liveWordsUntilNextScan?: number;
  scanWordBudget?: number;
  step?: string;
  lastScanEmpty?: boolean;
  error?: string;
};

type SuggestionScanCard = SuggestionProgress & {
  scanId: string;
  agentSteps: string[];
  updatedAt: number;
};

type TaskState = {
  tasks: TaskItem[];
  suggestions: TaskSuggestion[];
  archivedSuggestions: TaskItem[];
  processingTaskIds: string[];
  pendingApprovalTask: TaskItem | null;
  approvingLargeTask: boolean;
  forceWorkTabKey: number;
  transcriptRefs: string[];
  suggestionProgress: SuggestionProgress;
  suggestionScanCards: SuggestionScanCard[];
};

type TaskActions = {
  setTasks: (tasks: TaskItem[]) => void;
  updateTasks: (updater: (prev: TaskItem[]) => TaskItem[]) => void;
  addTask: (task: TaskItem) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string) => void;
  markTaskCompleted: (taskId: string) => void;
  updateTaskText: (id: string, text: string) => void;
  replaceTask: (id: string, task: TaskItem) => void;

  setSuggestionProgress: (progress: SuggestionProgress) => void;

  setSuggestions: (suggestions: TaskSuggestion[]) => void;
  appendSuggestion: (suggestion: TaskSuggestion) => void;
  appendSuggestions: (incoming: TaskSuggestion[]) => void;
  removeSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;

  setArchivedSuggestions: (archived: TaskItem[]) => void;
  hydrateSuggestionsFromArchive: (archived: TaskItem[]) => void;
  acceptArchivedTask: (task: TaskItem) => void;
  deleteArchivedSuggestion: (id: string) => void;

  addProcessingId: (id: string) => void;
  removeProcessingId: (id: string) => void;
  setProcessingTaskIds: (ids: string[]) => void;

  setPendingApprovalTask: (task: TaskItem | null) => void;
  setApprovingLargeTask: (approving: boolean) => void;
  bumpForceWorkTabKey: () => void;

  addTranscriptRef: (text: string) => void;
  removeTranscriptRef: (index: number) => void;
  clearTranscriptRefs: () => void;
  setTranscriptRefs: (refs: string[]) => void;

  resetForSession: () => void;

  persistTask: (params: {
    targetSessionId: string;
    text: string;
    details?: string;
    source: TaskItem["source"];
    size?: TaskSize;
    id?: string;
    createdAt?: number;
    appConfig: AppConfig;
  }) => Promise<{ ok: boolean; task?: TaskItem; error?: string }>;

  acceptSuggestion: (params: {
    suggestion: TaskSuggestion;
    targetSessionId: string;
    appConfig: AppConfig;
  }) => Promise<void>;
};

export const useTaskStore = create<TaskState & TaskActions>()((set, get) => ({
  // State
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

  // Actions
  setSuggestionProgress: (suggestionProgress) =>
    set((s) => {
      const now = Date.now();
      const nextProgress = suggestionProgress.scanId
        ? s.suggestionProgress
        : suggestionProgress;

      let suggestionScanCards = s.suggestionScanCards;
      if (suggestionProgress.scanId) {
        const scanId = suggestionProgress.scanId;
        const existing = s.suggestionScanCards.find((card) => card.scanId === scanId);
        const previousSteps = existing?.agentSteps ?? [];
        const agentSteps = suggestionProgress.busy
          ? suggestionProgress.step && previousSteps[previousSteps.length - 1] !== suggestionProgress.step
            ? [...previousSteps, suggestionProgress.step]
            : previousSteps
          : previousSteps;
        const nextCard: SuggestionScanCard = {
          scanId,
          label: suggestionProgress.label,
          busy: suggestionProgress.busy,
          wordsUntilNextScan: suggestionProgress.wordsUntilNextScan,
          liveWordsUntilNextScan: suggestionProgress.liveWordsUntilNextScan,
          scanWordBudget: suggestionProgress.scanWordBudget,
          step: suggestionProgress.step,
          lastScanEmpty: suggestionProgress.lastScanEmpty,
          error: suggestionProgress.error,
          agentSteps,
          updatedAt: Date.now(),
        };
        suggestionScanCards = [
          nextCard,
          ...s.suggestionScanCards.filter((card) => card.scanId !== scanId),
        ]
          .filter((card) => card.busy || now - card.updatedAt <= FINISHED_SCAN_CARD_MAX_AGE_MS)
          .slice(0, 6);
      } else {
        suggestionScanCards = s.suggestionScanCards
          .filter((card) => card.busy || now - card.updatedAt <= FINISHED_SCAN_CARD_MAX_AGE_MS)
          .slice(0, 6);
      }

      return {
        suggestionProgress: nextProgress,
        suggestionScanCards,
      };
    }),
  setTasks: (tasks) => set({ tasks }),
  updateTasks: (updater) => set((s) => ({ tasks: updater(s.tasks) })),
  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
  deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  toggleTask: (id) => {
    const state = get();
    if (state.processingTaskIds.includes(id)) return;
    set({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, completed: !t.completed, completedAt: !t.completed ? Date.now() : undefined }
          : t,
      ),
    });
    window.electronAPI.toggleTask(id);
  },
  markTaskCompleted: (taskId) => {
    const state = get();
    if (state.processingTaskIds.includes(taskId)) return;
    let shouldPersist = false;
    set({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId || task.completed) return task;
        shouldPersist = true;
        return { ...task, completed: true, completedAt: Date.now() };
      }),
    });
    if (shouldPersist) {
      void window.electronAPI.toggleTask(taskId);
    }
  },
  updateTaskText: (id, text) => {
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, text } : t)) }));
    void window.electronAPI.updateTaskText(id, text);
  },
  replaceTask: (id, task) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) })),

  setSuggestions: (suggestions) => set({ suggestions }),
  appendSuggestion: (suggestion) =>
    set((s) => {
      if (s.suggestions.some((existing) => existing.id === suggestion.id)) return s;
      return { suggestions: [suggestion, ...s.suggestions] };
    }),
  appendSuggestions: (incoming) => {
    if (incoming.length === 0) return;
    set((s) => {
      const existingIds = new Set(s.suggestions.map((item) => item.id));
      const next = [...s.suggestions];
      for (const suggestion of incoming) {
        if (existingIds.has(suggestion.id)) continue;
        next.unshift(suggestion);
        existingIds.add(suggestion.id);
      }
      return { suggestions: next };
    });
  },
  removeSuggestion: (id) =>
    set((s) => ({ suggestions: s.suggestions.filter((item) => item.id !== id) })),

  dismissSuggestion: (id) => {
    const state = get();
    const suggestion = state.suggestions.find((s) => s.id === id);
    if (suggestion) {
      const suggestionDetails = buildAiSuggestionDetails(suggestion);
      const archivedTask: TaskItem = {
        id: suggestion.id,
        text: suggestion.text,
        details: suggestionDetails,
        size: "large",
        completed: false,
        archived: true,
        suggestionKind: suggestion.kind,
        source: "ai",
        createdAt: suggestion.createdAt,
        sessionId: suggestion.sessionId,
      };
      set((s) => ({
        suggestions: s.suggestions.filter((item) => item.id !== id),
        archivedSuggestions: [archivedTask, ...s.archivedSuggestions],
      }));
    } else {
      set((s) => ({ suggestions: s.suggestions.filter((item) => item.id !== id) }));
    }
  },

  setArchivedSuggestions: (archived) => set({ archivedSuggestions: archived }),
  hydrateSuggestionsFromArchive: (archived) => {
    const now = Date.now();
    const suggestions = archived
      .map(archivedTaskToSuggestion)
      .filter((item): item is TaskSuggestion => item !== null)
      .filter((item) => now - item.createdAt < LIVE_SUGGESTION_MAX_AGE_MS);
    const suggestionIds = new Set(suggestions.map((item) => item.id));
    set({
      suggestions,
      archivedSuggestions: archived.filter((item) => !suggestionIds.has(item.id)),
    });
  },
  acceptArchivedTask: (task) => {
    set((s) => ({
      archivedSuggestions: s.archivedSuggestions.filter((t) => t.id !== task.id),
      tasks: [{ ...task, archived: false }, ...s.tasks],
    }));
    void window.electronAPI.unarchiveTask(task.id);
  },
  deleteArchivedSuggestion: (id) => {
    set((s) => ({
      archivedSuggestions: s.archivedSuggestions.filter((item) => item.id !== id),
    }));
    void window.electronAPI.deleteTask(id);
  },

  addProcessingId: (id) =>
    set((s) => ({
      processingTaskIds: s.processingTaskIds.includes(id)
        ? s.processingTaskIds
        : [id, ...s.processingTaskIds],
    })),
  removeProcessingId: (id) =>
    set((s) => ({
      processingTaskIds: s.processingTaskIds.filter((itemId) => itemId !== id),
    })),
  setProcessingTaskIds: (ids) => set({ processingTaskIds: ids }),

  setPendingApprovalTask: (task) => set({ pendingApprovalTask: task }),
  setApprovingLargeTask: (approving) => set({ approvingLargeTask: approving }),
  bumpForceWorkTabKey: () => set((s) => ({ forceWorkTabKey: s.forceWorkTabKey + 1 })),

  addTranscriptRef: (text) =>
    set((s) => ({ transcriptRefs: [...s.transcriptRefs, text] })),
  removeTranscriptRef: (index) =>
    set((s) => ({ transcriptRefs: s.transcriptRefs.filter((_, i) => i !== index) })),
  clearTranscriptRefs: () => set({ transcriptRefs: [] }),
  setTranscriptRefs: (refs) => set({ transcriptRefs: refs }),

  resetForSession: () =>
    set({
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
    }),

  persistTask: async ({ targetSessionId, text, details, source, size = "large", id, createdAt, appConfig }) => {
    const task: TaskItem = {
      id: id ?? crypto.randomUUID(),
      text,
      details,
      size,
      completed: false,
      source,
      createdAt: createdAt ?? Date.now(),
      sessionId: targetSessionId,
    };
    const result = await window.electronAPI.addTask(task, appConfig);
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Unknown error" };
    }
    return { ok: true, task: result.task ?? task };
  },

  acceptSuggestion: async ({ suggestion, targetSessionId, appConfig }) => {
    const suggestionDetails = buildAiSuggestionDetails(suggestion);
    const existingArchivedTask = get().archivedSuggestions.find((task) => task.id === suggestion.id);
    const optimisticTask: TaskItem = {
      id: suggestion.id,
      text: suggestion.text,
      details: suggestionDetails,
      size: "large",
      completed: false,
      source: "ai",
      createdAt: suggestion.createdAt,
      sessionId: targetSessionId,
    };

    set((s) => ({
      suggestions: s.suggestions.filter((item) => item.id !== suggestion.id),
      tasks: [optimisticTask, ...s.tasks.filter((t) => t.id !== suggestion.id)],
      archivedSuggestions: s.archivedSuggestions.filter((task) => task.id !== suggestion.id),
      processingTaskIds: s.processingTaskIds.includes(suggestion.id)
        ? s.processingTaskIds
        : [suggestion.id, ...s.processingTaskIds],
    }));

    const unarchiveResult = await window.electronAPI.unarchiveTask(suggestion.id);
    const result = unarchiveResult.ok
      ? {
          ok: true as const,
          task: {
            ...(existingArchivedTask ?? optimisticTask),
            archived: false,
            text: suggestion.text,
            details: suggestionDetails,
            sessionId: targetSessionId,
          } satisfies TaskItem,
        }
      : await get().persistTask({
          targetSessionId,
          text: suggestion.text,
          details: suggestionDetails,
          source: "ai",
          id: suggestion.id,
          createdAt: suggestion.createdAt,
          appConfig,
        });

    if (!result.ok) {
      set((s) => ({
        processingTaskIds: s.processingTaskIds.filter((id) => id !== suggestion.id),
        tasks: s.tasks.filter((t) => t.id !== suggestion.id),
        suggestions: [suggestion, ...s.suggestions.filter((item) => item.id !== suggestion.id)],
        archivedSuggestions: existingArchivedTask
          ? [existingArchivedTask, ...s.archivedSuggestions.filter((task) => task.id !== suggestion.id)]
          : s.archivedSuggestions,
      }));
      return;
    }

    set((s) => ({
      processingTaskIds: s.processingTaskIds.filter((id) => id !== suggestion.id),
      tasks: s.tasks.map((t) => (t.id === suggestion.id ? result.task! : t)),
    }));
  },
}));
