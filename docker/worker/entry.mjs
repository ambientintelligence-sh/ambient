/**
 * Runs inside the worker container. Drives one pi session to completion and
 * reports progress as LF-delimited JSON on stdout — the host never sees pi's
 * internals, only this stream.
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { createExaTools } from './exa-tool.mjs';
import { createShowWidgetTool } from './show-widget-tool.mjs';

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

/** One short line describing a tool call, for the departure board. */
function detailOf(toolName, args) {
  if (!args || typeof args !== 'object') return '';
  const raw =
    args.command ?? args.path ?? args.file_path ?? args.filePath ?? args.pattern ?? args.query ?? args.title ?? '';
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
const webToolPolicy = [
  'Web tool policy:',
  'For factual lookups such as model pricing, documentation, comparisons, availability, or current information, use exa_search first.',
  'Do not open Chrome when Exa results answer the question with adequate primary-source evidence.',
  'Use Chrome when search is insufficient, a page is dynamic, live verification matters, or the task requires interaction.',
  'For explicit action requests such as configure, set up, enable, disable, change, fill, or navigate, use Chrome and perform the requested action rather than merely explaining it.',
  'Do not make purchases, delete accounts, or perform other irreversible actions unless the user explicitly requested that exact action.',
].join(' ');
const visibleBrowserPolicy = process.env.PI_BROWSER_MODE === 'visible'
  ? [
      'Visible browser presentation rule:',
      'If you use Chrome, first list the existing pages.',
      'Before each checkpoint, select the single page most relevant to the requested result.',
      'Close intermediate tabs that you opened during this task, but never close tabs that existed before the task.',
      'Do not leave a search page, blank page, login page, or unrelated tab selected when a better result page is available.',
    ].join(' ')
  : '';
const presentationPolicy = [
  'Dashboard presentation policy:',
  'When the user asks for a widget, says to show something as a widget, or asks to put a result on the dashboard, you must call show_widget once near completion.',
  'You may also call show_widget when the final result benefits from visual structure—such as options, comparisons, plans, schedules, tables, or a compact report.',
  'Provide a polished, readable, responsive HTML fragment with semantic markup and inline CSS. Do not use JavaScript, forms, iframes, or event handlers.',
  'Use show_widget only for useful final information, never progress, raw logs, or decorative filler.',
  'After showing a widget, still give a short spoken closing summary that says what is on screen and highlights the most important conclusion.',
  'If no widget was requested and a visual adds no value, return the normal closing summary only.',
].join(' ');
const initialTask = `${task}\n\n${webToolPolicy}${visibleBrowserPolicy ? `\n\n${visibleBrowserPolicy}` : ''}\n\n${presentationPolicy}`;

if (!task) {
  emit({ type: 'error', message: 'no task supplied' });
  process.exit(1);
}

try {
  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel(providerId, modelId);
  if (!model) throw new Error(`delegation model not found: ${providerId}/${modelId}`);

  const exaTools = createExaTools();
  const showWidgetTool = createShowWidgetTool(emit);
  const customTools = [...exaTools, showWidgetTool];
  const resourceLoader = new DefaultResourceLoader({
    cwd: '/work',
    agentDir: '/home/node/.pi/agent',
    additionalExtensionPaths: ['/app/mcp-extension.ts'],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: '/work',
    model,
    tools: ['read', 'write', 'edit', 'bash', 'ls', 'grep', 'find', 'mcp', ...customTools.map((tool) => tool.name)],
    customTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
  });
  await session.bindExtensions({ mode: 'print' });

  let summary = '';
  let failure = '';
  let activeRun = null;
  let initialStarted = false;
  const pendingInstructions = [];

  const runPrompt = (text) => {
    summary = '';
    failure = '';
    const promise = session.prompt(text);
    activeRun = promise;
    void (async () => {
      try {
        await promise;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      } finally {
        activeRun = null;
      }

      if (failure) {
        emit({ type: 'error', message: failure });
        session.dispose();
        process.exit(1);
      }

      // A steer can land after Pi has decided to settle but before prompt()
      // resolves. Recover that stranded queue as a new turn in the same session.
      const queued = session.clearQueue();
      const continuation = [...queued.steering, ...queued.followUp];
      if (continuation.length > 0) {
        runPrompt(continuation.join('\n\n'));
        return;
      }
      emit({ type: 'done', summary: summary || 'Finished with no closing summary.' });
    })();
  };

  const applySteer = (instruction) => {
    if (!initialStarted) {
      pendingInstructions.push(instruction);
      return;
    }
    if (!activeRun && !session.isStreaming) {
      runPrompt(instruction);
      return;
    }
    void session.steer(instruction).then(() => {
      // steer() can successfully enqueue just after the agent loop settles.
      // If so, pull that orphaned message back out and explicitly resume.
      if (!activeRun && session.isIdle && session.pendingMessageCount > 0) {
        const queued = session.clearQueue();
        const continuation = [...queued.steering, ...queued.followUp];
        if (continuation.length > 0) runPrompt(continuation.join('\n\n'));
      }
    }).catch((error) => {
      // The active run can settle between the state check and steer(). Resume
      // the same Pi session with a fresh prompt instead of dropping the update.
      if (!activeRun && !session.isStreaming) runPrompt(instruction);
      else {
        emit({
          type: 'tool',
          tool: 'steer_failed',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  const controlPath = '/tmp/ambient-control.jsonl';
  await writeFile(controlPath, '');
  let controlOffset = 0;
  let controlCarry = '';
  let readingControl = false;
  const controlTimer = setInterval(() => {
    if (readingControl) return;
    readingControl = true;
    void readFile(controlPath)
      .then((content) => {
        if (content.length <= controlOffset) return;
        controlCarry += content.subarray(controlOffset).toString('utf8');
        controlOffset = content.length;
        const lines = controlCarry.split('\n');
        controlCarry = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const command = JSON.parse(line);
            if (command?.type === 'steer' && typeof command.instruction === 'string' && command.instruction.trim()) {
              applySteer(command.instruction.trim());
            } else if (command?.type === 'abort') {
              clearInterval(controlTimer);
              void session.abort().finally(() => {
                session.dispose();
                process.exit(0);
              });
            }
          } catch {
            emit({ type: 'tool', tool: 'steer_failed', detail: 'invalid command from host' });
          }
        }
      })
      .finally(() => {
        readingControl = false;
      });
  }, 200);

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
  runPrompt(initialTask);
  initialStarted = true;
  for (const instruction of pendingInstructions.splice(0)) applySteer(instruction);

  // Keep the Pi session and container online. Later steering messages
  // resume this same conversation, preserving context and browser state.
} catch (error) {
  emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
