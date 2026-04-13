import { Codex } from "@openai/codex-sdk";
import type { ProviderTaskEntry, ProviderTaskEvent } from "@core/types";

type CodexState = "disconnected" | "connected";

type CodexClientOptions = {
  onStateChange?: (state: CodexState) => void;
};

type CodexEventItem = {
  type: string;
  [key: string]: unknown;
};

type CodexEvent = {
  type: string;
  thread_id?: string;
  item?: CodexEventItem;
};

type CodexTurnItem = CodexEventItem;

export type CodexTaskResult = {
  threadId: string;
  result: string;
  items: CodexTurnItem[];
};

export type ProviderTaskEventSink = (event: ProviderTaskEvent) => void;

export type CodexRunningTask = {
  taskId: string;
  threadId: string;
  prompt: string;
  progress: string[];
  entries: ProviderTaskEntry[];
  done: boolean;
  cancelled: boolean;
  result: CodexTaskResult | null;
  error: string | null;
  /** Resolves when the task completes or errors. */
  promise: Promise<void>;
  abort: AbortController;
  /** Timestamp when the task completed (for eviction). */
  completedAt: number | null;
  onEvent?: ProviderTaskEventSink;
  toolCallId?: string;
  agentId?: string;
};

let codexInstance: Codex | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const threadCache = new Map<string, any>();

/** Running/completed tasks keyed by taskId. */
const runningTasks = new Map<string, CodexRunningTask>();

const MAX_COMPLETED_TASKS = 10;

function evictStaleTasks() {
  const completed = [...runningTasks.entries()]
    .filter(([, t]) => t.completedAt !== null)
    .sort((a, b) => b[1].completedAt! - a[1].completedAt!);

  for (const [id] of completed.slice(MAX_COMPLETED_TASKS)) {
    runningTasks.delete(id);
  }
}

function emit(task: CodexRunningTask, kind: ProviderTaskEvent["kind"], extra: Record<string, unknown> = {}): void {
  if (!task.onEvent) return;
  const base = {
    taskId: task.taskId,
    provider: "codex" as const,
    toolCallId: task.toolCallId,
    agentId: task.agentId,
    at: Date.now(),
  };
  try {
    task.onEvent({ kind, ...base, ...extra } as ProviderTaskEvent);
  } catch {
    // never let downstream handlers break the task loop
  }
}

function mapItemToEntry(item: CodexEventItem): ProviderTaskEntry | null {
  if (item.type === "command_execution") {
    return {
      type: "command",
      command: String(item.command ?? ""),
      exitCode: typeof item.exit_code === "number" ? item.exit_code : undefined,
    };
  }
  if (item.type === "file_change" && Array.isArray(item.changes)) {
    const changes = (item.changes as Array<{ kind: string; path: string }>).map((c) => ({
      kind: c.kind,
      path: c.path,
    }));
    return { type: "file-change", changes };
  }
  if (item.type === "reasoning" && typeof item.text === "string") {
    return { type: "reasoning", text: item.text };
  }
  if (item.type === "agent_message" && typeof item.text === "string") {
    return { type: "message", text: item.text };
  }
  return null;
}

export function connectCodex(options?: CodexClientOptions): { ok: true } | { ok: false; error: string } {
  try {
    codexInstance = new Codex();
    options?.onStateChange?.("connected");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export function disconnectCodex(options?: CodexClientOptions): void {
  codexInstance = null;
  threadCache.clear();
  for (const task of runningTasks.values()) {
    task.abort.abort();
  }
  runningTasks.clear();
  options?.onStateChange?.("disconnected");
}

export function isCodexConnected(): boolean {
  return codexInstance !== null;
}

/**
 * Start a Codex task in the background. Returns as soon as the Codex
 * thread has started (usually <1s). The task keeps running; its
 * lifecycle events stream through `onEvent` if provided.
 *
 * Use `getCodexSnapshot` (or `waitForCodexTask`) to read current state.
 */
export async function startCodexTask(
  prompt: string,
  options: {
    threadId?: string;
    workingDirectory?: string;
    onEvent?: ProviderTaskEventSink;
    toolCallId?: string;
    agentId?: string;
  },
): Promise<{ taskId: string; threadId: string }> {
  if (!codexInstance) throw new Error("Codex not connected");

  const taskId = crypto.randomUUID();
  const abort = new AbortController();
  const progress: string[] = [];
  const entries: ProviderTaskEntry[] = [];

  // Deferred resolve for threadId — lets us return early once we have it
  let resolveThreadId!: (id: string) => void;
  const threadIdReady = new Promise<string>((resolve) => {
    resolveThreadId = resolve;
  });

  const task: CodexRunningTask = {
    taskId,
    threadId: options.threadId ?? "",
    prompt,
    progress,
    entries,
    done: false,
    cancelled: false,
    result: null,
    error: null,
    promise: Promise.resolve(),
    abort,
    completedAt: null,
    onEvent: options.onEvent,
    toolCallId: options.toolCallId,
    agentId: options.agentId,
  };

  const codex = codexInstance;

  emit(task, "started", {
    prompt,
    cwd: options.workingDirectory,
    threadId: options.threadId,
  });

  task.promise = (async () => {
    try {
      const thread = options.threadId && threadCache.has(options.threadId)
        ? threadCache.get(options.threadId)!
        : options.threadId
          ? codex.resumeThread(options.threadId, { workingDirectory: options.workingDirectory, approvalPolicy: "on-failure" })
          : codex.startThread({ workingDirectory: options.workingDirectory, approvalPolicy: "on-failure" });

      const { events } = await thread.runStreamed(prompt, { signal: abort.signal });

      const items: CodexTurnItem[] = [];
      let finalResponse = "";
      let threadId = options.threadId ?? "";

      for await (const event of events) {
        const ev = event as CodexEvent;
        if (ev.type === "thread.started" && ev.thread_id) {
          threadId = ev.thread_id;
          task.threadId = threadId;
          resolveThreadId(threadId);
        }
        if (ev.type === "item.completed" && ev.item) {
          items.push(ev.item);
          if (ev.item.type === "agent_message" && typeof ev.item.text === "string") {
            finalResponse = ev.item.text;
          }
          if (ev.item.type === "command_execution") {
            progress.push(`Ran: ${String(ev.item.command)} (exit ${String(ev.item.exit_code)})`);
          } else if (ev.item.type === "file_change" && Array.isArray(ev.item.changes)) {
            const changes = (ev.item.changes as Array<{ kind: string; path: string }>)
              .map((c) => `${c.kind} ${c.path}`)
              .join(", ");
            progress.push(`Files: ${changes}`);
          } else if (ev.item.type === "reasoning" && typeof ev.item.text === "string") {
            progress.push(`Thinking: ${ev.item.text.slice(0, 200)}`);
          }

          const entry = mapItemToEntry(ev.item);
          if (entry) {
            entries.push(entry);
            emit(task, "progress", { entry });
          }
        }
      }

      if (threadId) threadCache.set(threadId, thread);

      task.result = { threadId, result: finalResponse, items };
      task.done = true;
      task.completedAt = Date.now();
      emit(task, "completed", { summary: finalResponse, threadId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task.error = message;
      task.done = true;
      task.completedAt = Date.now();
      if (task.cancelled || abort.signal.aborted) {
        emit(task, "cancelled", {});
      } else {
        emit(task, "failed", { error: message });
      }
      // Unblock threadId wait if we errored before getting one
      resolveThreadId(task.threadId || taskId);
    }
  })();

  runningTasks.set(taskId, task);

  // Wait for threadId (arrives early) with a 30s safety timeout
  const threadId = await Promise.race([
    threadIdReady,
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("Codex thread start timed out after 30s")), 30_000),
    ),
  ]);
  return { taskId, threadId };
}

export type CodexSnapshot = {
  status: "running" | "completed" | "failed" | "cancelled" | "not_found";
  progress: string[];
  entries: ProviderTaskEntry[];
  result?: CodexTaskResult;
  error?: string;
};

/**
 * Read the current state of a Codex task without blocking.
 * Returns immediately with whatever has arrived so far.
 */
export function getCodexSnapshot(taskId: string): CodexSnapshot {
  evictStaleTasks();

  const task = runningTasks.get(taskId);
  if (!task) {
    return { status: "not_found", progress: [], entries: [] };
  }

  if (task.done) {
    if (task.cancelled) {
      return { status: "cancelled", progress: task.progress, entries: task.entries };
    }
    return task.error
      ? { status: "failed", progress: task.progress, entries: task.entries, error: task.error }
      : { status: "completed", progress: task.progress, entries: task.entries, result: task.result! };
  }

  return { status: "running", progress: [...task.progress], entries: [...task.entries] };
}

/**
 * Legacy wrapper retained for callers that expect the old shape.
 * The `waitMs` and `abortSignal` parameters are accepted but ignored —
 * this always returns an instant snapshot.
 */
export async function waitForCodexTask(
  taskId: string,
  _waitMs?: number,
  _abortSignal?: AbortSignal,
): Promise<CodexSnapshot> {
  return getCodexSnapshot(taskId);
}

/**
 * Cancel a running Codex task.
 */
export function cancelCodexTask(taskId: string): boolean {
  const task = runningTasks.get(taskId);
  if (!task || task.done) return false;
  task.cancelled = true;
  task.abort.abort();
  return true;
}

/** Shared type for the codex client passed through the dep chain. */
export type CodexClient = {
  isConnected: boolean;
  startTask: typeof startCodexTask;
  waitForTask: typeof waitForCodexTask;
  getSnapshot: typeof getCodexSnapshot;
  cancelTask: typeof cancelCodexTask;
};

export type GetCodexClient = () => CodexClient | null;
