import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createExaTool, writeBrowserMcpExtension } from './agent-network';
import { SandboxController, createSandboxExtension } from './sandbox-tools';
import { vendorModuleUrl } from './vendor';
import type { SubagentCommand, SubagentLaunch, SubagentMessage } from './subagent-protocol';
import { formatCurrentContext } from '../shared/local-context';

type PiModule = typeof import('@earendil-works/pi-coding-agent');
type AgentSession = Awaited<ReturnType<PiModule['createAgentSession']>>['session'];

// Resolved from the vendored node_modules at runtime so vite never bundles pi.
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

const port = process.parentPort;
const emit = (message: SubagentMessage) => port.postMessage(message);
let session: AgentSession | null = null;
let controller: SandboxController | null = null;
let launched = false;

function detailOf(args: unknown) {
  if (!args || typeof args !== 'object') return '';
  const input = args as Record<string, unknown>;
  const raw = input.command ?? input.path ?? input.pattern ?? input.query ?? '';
  const text = String(raw).replace(/\s+/g, ' ').trim();
  return text.length > 72 ? `${text.slice(0, 71)}…` : text;
}

function resultOf(result: unknown) {
  const value = result as { content?: { type?: string; text?: string }[] } | undefined;
  const text = (value?.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

async function run(input: SubagentLaunch) {
  await mkdir(input.tempDir, { recursive: true, mode: 0o700 });
  const pi = await importEsm<PiModule>(vendorModuleUrl('@earendil-works/pi-coding-agent'));
  const runtime = await pi.ModelRuntime.create({
    authPath: path.join(input.agentDir, 'auth.json'),
    modelsPath: path.join(input.agentDir, 'models.json'),
    modelsStorePath: path.join(input.agentDir, 'models-store.json'),
  });
  const model = runtime.getModel(input.selection.provider, input.selection.model);
  if (!model) throw new Error(`Delegation model not found: ${input.selection.provider}/${input.selection.model}`);

  controller = new SandboxController();
  const policy = { workspace: input.workspace, tempDir: input.tempDir, agentDir: input.agentDir };
  const extensions = [await createSandboxExtension({
    cwd: input.workspace,
    controller,
    getPolicy: () => policy,
    getNetworkEnabled: () => input.networkEnabled,
  })];
  const extensionPaths: string[] = [];
  if (input.networkEnabled) {
    extensionPaths.push(await writeBrowserMcpExtension({
      agentDir: input.agentDir,
      name: `subagent-${process.pid}`,
      browser: input.browser,
      chromeMcpPath: input.chromeMcpPath,
    }));
  }
  const exaTool = input.networkEnabled
    ? await createExaTool({ getNetworkEnabled: () => true, getLocalContext: () => input.localContext })
    : null;
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: input.workspace,
    agentDir: input.agentDir,
    noExtensions: true,
    extensionFactories: extensions,
    additionalExtensionPaths: extensionPaths,
  });
  await resourceLoader.reload();
  const created = await pi.createAgentSession({
    cwd: input.workspace,
    agentDir: input.agentDir,
    model,
    modelRuntime: runtime,
    tools: ['read', 'write', 'edit', 'bash', 'ls', ...(input.networkEnabled ? ['mcp'] : []), ...(exaTool ? ['exa_search'] : [])],
    customTools: exaTool ? [exaTool] : [],
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(),
  });
  session = created.session;
  await session.bindExtensions({ mode: 'print' });
  let summary = '';
  session.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      emit({ type: 'tool', id: event.toolCallId, tool: event.toolName, detail: detailOf(event.args) });
    } else if (event.type === 'tool_execution_end') {
      emit({
        type: 'tool_result',
        id: event.toolCallId,
        tool: event.toolName,
        result: resultOf(event.result),
        isError: event.isError,
      });
    } else if (event.type === 'message_end' && event.message?.role === 'assistant') {
      summary = event.message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim();
      const note = summary.replace(/\s+/g, ' ');
      if (note) emit({ type: 'progress', text: note.length > 600 ? `${note.slice(0, 599)}…` : note });
    }
  });
  emit({ type: 'ready' });
  const policies = [
    input.task,
    formatCurrentContext(input.localContext),
    'Return complete findings, source links, and useful artifact paths to the router.',
    'You cannot publish widgets or speak to the user. Save artifacts inside the selected workspace.',
  ].filter(Boolean).join('\n\n');
  await session.prompt(policies);
  emit({ type: 'done', summary: summary || 'Finished with no closing summary.' });
}

async function shutdown(exitCode: number) {
  session?.dispose();
  session = null;
  await controller?.reset().catch(() => undefined);
  controller = null;
  process.exit(exitCode);
}

port.on('message', (event) => {
  const command = event.data as SubagentCommand;
  if (command.type === 'abort') {
    void session?.abort().finally(() => shutdown(0));
    return;
  }
  if (command.type !== 'launch' || launched) return;
  launched = true;
  void run(command)
    .then(() => shutdown(0))
    .catch((error) => {
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      void shutdown(1);
    });
});

