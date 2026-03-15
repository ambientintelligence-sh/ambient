import { Codex } from "@openai/codex-sdk";

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

export type CodexRunningTask = {
  taskId: string;
  threadId: string;
  prompt: string;
  progress: string[];
  done: boolean;
  result: CodexTaskResult | null;
  error: string | null;
  /** Resolves when the task completes or errors. */
  promise: Promise<void>;
  abort: AbortController;
};

let codexInstance: Codex | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const threadCache = new Map<string, any>();

/** Running/completed tasks keyed by taskId. */
const runningTasks = new Map<string, CodexRunningTask>();

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
 * Start a Codex task in the background. Waits for the threadId from Codex
 * (arrives quickly via `thread.started` event), then returns immediately
 * while the task continues running.
 *
 * Use `waitForCodexTask` to check status when the user asks.
 */
export async function startCodexTask(
  prompt: string,
  options: {
    threadId?: string;
    workingDirectory?: string;
  },
): Promise<{ taskId: string; threadId: string }> {
  if (!codexInstance) throw new Error("Codex not connected");

  const taskId = crypto.randomUUID();
  const abort = new AbortController();
  const progress: string[] = [];

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
    done: false,
    result: null,
    error: null,
    promise: Promise.resolve(),
    abort,
  };

  const codex = codexInstance;

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
        }
      }

      if (threadId) threadCache.set(threadId, thread);

      task.result = { threadId, result: finalResponse, items };
      task.done = true;
    } catch (error) {
      task.error = error instanceof Error ? error.message : String(error);
      task.done = true;
      // Unblock threadId wait if we errored before getting one
      resolveThreadId(task.threadId || taskId);
    }
  })();

  runningTasks.set(taskId, task);

  // Wait for threadId (arrives early), then return
  const threadId = await threadIdReady;
  return { taskId, threadId };
}

/**
 * Wait for a Codex task to finish, up to `waitMs` milliseconds.
 * Returns the current status + result if done.
 */
export async function waitForCodexTask(
  taskId: string,
  waitMs: number,
  abortSignal?: AbortSignal,
): Promise<{
  status: "running" | "completed" | "failed" | "not_found";
  progress: string[];
  result?: CodexTaskResult;
  error?: string;
}> {
  const task = runningTasks.get(taskId);
  if (!task) {
    return { status: "not_found", progress: [] };
  }

  if (task.done) {
    return task.error
      ? { status: "failed", progress: task.progress, error: task.error }
      : { status: "completed", progress: task.progress, result: task.result! };
  }

  // Wait for completion or timeout, whichever comes first
  await Promise.race([
    task.promise,
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
    ...(abortSignal ? [new Promise<void>((_, reject) => {
      if (abortSignal.aborted) { reject(new Error("Cancelled")); return; }
      abortSignal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true });
    })] : []),
  ]).catch(() => {
    // Timeout or abort — return current status below
  });

  if (task.done) {
    return task.error
      ? { status: "failed", progress: task.progress, error: task.error }
      : { status: "completed", progress: task.progress, result: task.result! };
  }

  return { status: "running", progress: [...task.progress] };
}

/**
 * Cancel a running Codex task.
 */
export function cancelCodexTask(taskId: string): boolean {
  const task = runningTasks.get(taskId);
  if (!task || task.done) return false;
  task.abort.abort();
  return true;
}
