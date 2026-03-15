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

let codexInstance: Codex | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const threadCache = new Map<string, any>();

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
  options?.onStateChange?.("disconnected");
}

export function isCodexConnected(): boolean {
  return codexInstance !== null;
}

export async function runCodexTask(
  prompt: string,
  options: {
    threadId?: string;
    workingDirectory?: string;
    signal?: AbortSignal;
    onEvent?: (event: CodexEvent) => void;
  },
): Promise<{ threadId: string; result: string; items: CodexTurnItem[] }> {
  if (!codexInstance) throw new Error("Codex not connected");

  const thread = options.threadId && threadCache.has(options.threadId)
    ? threadCache.get(options.threadId)!
    : options.threadId
      ? codexInstance.resumeThread(options.threadId, { workingDirectory: options.workingDirectory, approvalPolicy: "on-failure" })
      : codexInstance.startThread({ workingDirectory: options.workingDirectory, approvalPolicy: "on-failure" });

  const { events } = await thread.runStreamed(prompt, { signal: options.signal });

  const items: CodexTurnItem[] = [];
  let finalResponse = "";
  let threadId = options.threadId ?? "";

  for await (const event of events) {
    const ev = event as CodexEvent;
    if (ev.type === "thread.started" && ev.thread_id) {
      threadId = ev.thread_id;
    }
    if (ev.type === "item.completed" && ev.item) {
      items.push(ev.item);
      if (ev.item.type === "agent_message" && typeof ev.item.text === "string") {
        finalResponse = ev.item.text;
      }
    }
    options.onEvent?.(ev);
  }

  if (threadId) threadCache.set(threadId, thread);

  return { threadId, result: finalResponse, items };
}
