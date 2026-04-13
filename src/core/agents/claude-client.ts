import { query, AbortError, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderTaskEntry, ProviderTaskEvent } from "@core/types";

type ClaudeState = "disconnected" | "connected";

type ClaudeClientOptions = {
  onStateChange?: (state: ClaudeState) => void;
};

export type ClaudeTaskResult = {
  sessionId: string;
  result: string;
};

export type ProviderTaskEventSink = (event: ProviderTaskEvent) => void;

export type ClaudeRunningTask = {
  taskId: string;
  sessionId: string;
  prompt: string;
  progress: string[];
  entries: ProviderTaskEntry[];
  done: boolean;
  cancelled: boolean;
  result: ClaudeTaskResult | null;
  error: string | null;
  promise: Promise<void>;
  query: Query;
  completedAt: number | null;
  onEvent?: ProviderTaskEventSink;
  toolCallId?: string;
  agentId?: string;
};

let connected = false;
let binaryPath: string | undefined;

const runningTasks = new Map<string, ClaudeRunningTask>();
const MAX_COMPLETED_TASKS = 10;

function evictStaleTasks() {
  const completed = [...runningTasks.entries()]
    .filter(([, t]) => t.completedAt !== null)
    .sort((a, b) => b[1].completedAt! - a[1].completedAt!);
  for (const [id] of completed.slice(MAX_COMPLETED_TASKS)) {
    runningTasks.delete(id);
  }
}

function emit(task: ClaudeRunningTask, kind: ProviderTaskEvent["kind"], extra: Record<string, unknown> = {}): void {
  if (!task.onEvent) return;
  const base = {
    taskId: task.taskId,
    provider: "claude" as const,
    toolCallId: task.toolCallId,
    agentId: task.agentId,
    at: Date.now(),
  };
  try {
    task.onEvent({ kind, ...base, ...extra } as ProviderTaskEvent);
  } catch {
    // swallow
  }
}

export function connectClaude(options?: ClaudeClientOptions & { binaryPath?: string }): { ok: true } | { ok: false; error: string } {
  try {
    binaryPath = options?.binaryPath;
    connected = true;
    options?.onStateChange?.("connected");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export function disconnectClaude(options?: ClaudeClientOptions): void {
  connected = false;
  for (const task of runningTasks.values()) {
    if (!task.done) {
      task.cancelled = true;
      void task.query.interrupt().catch(() => { /* noop */ });
      try {
        task.query.close();
      } catch {
        /* noop */
      }
    }
  }
  runningTasks.clear();
  options?.onStateChange?.("disconnected");
}

export function isClaudeConnected(): boolean {
  return connected;
}

type MaybeContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
};

function extractEntriesFromAssistant(message: SDKMessage): ProviderTaskEntry[] {
  if (message.type !== "assistant") return [];
  const rawContent = (message.message as { content?: unknown })?.content;
  if (!Array.isArray(rawContent)) return [];
  const entries: ProviderTaskEntry[] = [];
  for (const block of rawContent as MaybeContentBlock[]) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      entries.push({ type: "message", text: block.text });
    }
    if (block.type === "tool_use" && typeof block.name === "string") {
      let inputSerialized: string | undefined;
      try {
        inputSerialized = JSON.stringify(block.input);
      } catch {
        inputSerialized = undefined;
      }
      entries.push({ type: "tool-call", toolName: block.name, input: inputSerialized });
    }
  }
  return entries;
}

function extractFinalResult(message: SDKMessage): { result: string; sessionId: string } | null {
  if (message.type !== "result") return null;
  if (message.subtype === "success") {
    return { result: message.result ?? "", sessionId: message.session_id };
  }
  return { result: "", sessionId: message.session_id };
}

/**
 * Start a Claude Code task in the background. Returns as soon as the query
 * has been constructed. The task keeps running and its events stream via
 * `onEvent`.
 */
export async function startClaudeTask(
  prompt: string,
  options: {
    sessionId?: string;
    workingDirectory?: string;
    onEvent?: ProviderTaskEventSink;
    toolCallId?: string;
    agentId?: string;
  },
): Promise<{ taskId: string; sessionId: string }> {
  if (!connected) throw new Error("Claude Code not connected");

  const taskId = crypto.randomUUID();
  const progress: string[] = [];
  const entries: ProviderTaskEntry[] = [];

  // `interrupt()` is a control request, and control requests are only supported
  // when streaming input is used. Pass an async iterable — even a single-message
  // one — to switch the SDK into streaming input mode so Stop actually works.
  async function* promptIterable(): AsyncIterable<SDKUserMessage> {
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: prompt },
    };
  }

  const q = query({
    prompt: promptIterable(),
    options: {
      cwd: options.workingDirectory,
      resume: options.sessionId,
      includePartialMessages: false,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: binaryPath,
    },
  });

  const task: ClaudeRunningTask = {
    taskId,
    sessionId: options.sessionId ?? "",
    prompt,
    progress,
    entries,
    done: false,
    cancelled: false,
    result: null,
    error: null,
    promise: Promise.resolve(),
    query: q,
    completedAt: null,
    onEvent: options.onEvent,
    toolCallId: options.toolCallId,
    agentId: options.agentId,
  };

  emit(task, "started", {
    prompt,
    cwd: options.workingDirectory,
    threadId: options.sessionId,
  });

  task.promise = (async () => {
    try {
      for await (const message of q) {
        if (message.type === "system" && "session_id" in message && message.session_id) {
          if (!task.sessionId) task.sessionId = message.session_id;
        }
        if (message.type === "assistant") {
          if (!task.sessionId && message.session_id) task.sessionId = message.session_id;
          for (const entry of extractEntriesFromAssistant(message)) {
            entries.push(entry);
            if (entry.type === "message") progress.push(entry.text.slice(0, 200));
            if (entry.type === "tool-call") progress.push(`Tool: ${entry.toolName}`);
            emit(task, "progress", { entry });
          }
        }
        if (message.type === "result") {
          const final = extractFinalResult(message);
          if (final) {
            task.result = { sessionId: final.sessionId || task.sessionId, result: final.result };
            task.sessionId = task.result.sessionId;
          }
        }
      }

      task.done = true;
      task.completedAt = Date.now();
      emit(task, "completed", {
        summary: task.result?.result ?? "",
        threadId: task.sessionId,
      });
    } catch (error) {
      task.done = true;
      task.completedAt = Date.now();
      if (error instanceof AbortError || task.cancelled) {
        emit(task, "cancelled", {});
      } else {
        const message = error instanceof Error ? error.message : String(error);
        task.error = message;
        emit(task, "failed", { error: message });
      }
    }
  })();

  runningTasks.set(taskId, task);
  return { taskId, sessionId: task.sessionId };
}

export type ClaudeSnapshot = {
  status: "running" | "completed" | "failed" | "cancelled" | "not_found";
  progress: string[];
  entries: ProviderTaskEntry[];
  result?: ClaudeTaskResult;
  error?: string;
};

export function getClaudeSnapshot(taskId: string): ClaudeSnapshot {
  evictStaleTasks();
  const task = runningTasks.get(taskId);
  if (!task) return { status: "not_found", progress: [], entries: [] };
  if (task.done) {
    if (task.cancelled) return { status: "cancelled", progress: task.progress, entries: task.entries };
    return task.error
      ? { status: "failed", progress: task.progress, entries: task.entries, error: task.error }
      : { status: "completed", progress: task.progress, entries: task.entries, result: task.result! };
  }
  return { status: "running", progress: [...task.progress], entries: [...task.entries] };
}

export async function waitForClaudeTask(
  taskId: string,
  _waitMs?: number,
  _abortSignal?: AbortSignal,
): Promise<ClaudeSnapshot> {
  return getClaudeSnapshot(taskId);
}

export function cancelClaudeTask(taskId: string): boolean {
  const task = runningTasks.get(taskId);
  if (!task || task.done) return false;
  task.cancelled = true;
  // Best-effort graceful interrupt (only works in streaming input mode) —
  // followed by close(), which forcibly terminates the CLI subprocess regardless
  // of mode. close() is the guaranteed kill switch per the SDK docs.
  void task.query.interrupt().catch(() => { /* noop */ });
  try {
    task.query.close();
  } catch {
    /* noop */
  }
  return true;
}

/** Shared type for the claude client passed through the dep chain. */
export type ClaudeClient = {
  isConnected: boolean;
  startTask: typeof startClaudeTask;
  waitForTask: typeof waitForClaudeTask;
  getSnapshot: typeof getClaudeSnapshot;
  cancelTask: typeof cancelClaudeTask;
};

export type GetClaudeClient = () => ClaudeClient | null;
