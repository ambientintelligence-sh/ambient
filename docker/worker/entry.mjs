/**
 * Runs inside the worker container. Drives one pi session to completion and
 * reports progress as LF-delimited JSON on stdout — the host never sees pi's
 * internals, only this stream.
 */
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

/** One short line describing a tool call, for the departure board. */
function detailOf(toolName, args) {
  if (!args || typeof args !== 'object') return '';
  const raw =
    args.command ?? args.path ?? args.file_path ?? args.filePath ?? args.pattern ?? args.query ?? '';
  const text = String(raw).replace(/\s+/g, ' ').trim();
  return text.length > 72 ? `${text.slice(0, 71)}…` : text;
}

function resultOf(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

function textOf(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

const task = process.env.PI_TASK ?? '';
const providerId = process.env.PI_PROVIDER ?? 'openai';
const modelId = process.env.PI_MODEL ?? 'gpt-5.3-codex';

if (!task) {
  emit({ type: 'error', message: 'no task supplied' });
  process.exit(1);
}

try {
  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel(providerId, modelId);
  if (!model) throw new Error(`delegation model not found: ${providerId}/${modelId}`);

  const { session } = await createAgentSession({
    cwd: '/work',
    model,
    tools: ['read', 'write', 'edit', 'bash', 'ls', 'grep', 'find'],
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
  });

  let summary = '';
  let failure = '';
  let promptStarted = false;
  const pendingInstructions = [];

  const applySteer = (instruction) => {
    if (!promptStarted) {
      pendingInstructions.push(instruction);
      return;
    }
    void session.steer(instruction).catch((error) => {
      emit({
        type: 'tool',
        tool: 'steer_failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    });
  };

  let inputBuffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    inputBuffer += chunk;
    const lines = inputBuffer.split('\n');
    inputBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const command = JSON.parse(line);
        if (command?.type === 'steer' && typeof command.instruction === 'string' && command.instruction.trim()) {
          applySteer(command.instruction.trim());
        } else if (command?.type === 'abort') {
          void session.abort().finally(() => process.exit(0));
        }
      } catch {
        emit({ type: 'tool', tool: 'steer_failed', detail: 'invalid command from host' });
      }
    }
  });

  session.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      emit({
        type: 'tool',
        id: event.toolCallId,
        tool: event.toolName,
        detail: detailOf(event.toolName, event.args),
      });
      return;
    }
    if (event.type === 'tool_execution_end') {
      emit({
        type: 'tool_result',
        id: event.toolCallId,
        tool: event.toolName,
        result: resultOf(event.result),
        isError: event.isError,
      });
      return;
    }
    if (event.type === 'message_end') {
      // pi reports model/transport failures on the message rather than throwing,
      // so prompt() resolves normally after an auth error. Without this the
      // worker would cheerfully report success on a 401.
      const message = event.message;
      if (message?.role === 'assistant' && (message.errorMessage || message.stopReason === 'error')) {
        failure = message.errorMessage || 'model call failed';
      }
      const text = textOf(message);
      if (text) summary = text;
    }
  });

  emit({ type: 'ready' });
  const promptPromise = session.prompt(task);
  promptStarted = true;
  for (const instruction of pendingInstructions.splice(0)) applySteer(instruction);
  await promptPromise;

  if (failure) {
    emit({ type: 'error', message: failure });
    process.exit(1);
  }

  emit({ type: 'done', summary: summary || 'Finished with no closing summary.' });
  process.exit(0);
} catch (error) {
  emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
