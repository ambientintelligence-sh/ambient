import { cleanAgentText } from '../shared/live-activity';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createExaTool, writeBrowserMcpExtension } from './agent-network';
import { SandboxController, createSandboxExtension } from './sandbox-tools';
import { vendorModuleUrl } from './vendor';
import type { SubagentCommand, SubagentLaunch, SubagentMessage } from './subagent-protocol';
import { formatCurrentContext } from '../shared/local-context';
import { artifactOf, detailOf, resultOf } from './agent-telemetry';

type PiModule = typeof import('@earendil-works/pi-coding-agent');
type AgentSession = Awaited<ReturnType<PiModule['createAgentSession']>>['session'];

// Resolved from the vendored node_modules at runtime so vite never bundles pi.
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

const port = process.parentPort;
const emit = (message: SubagentMessage) => port.postMessage(message);
let session: AgentSession | null = null;
let controller: SandboxController | null = null;
let launched = false;
let shuttingDown = false;

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
    sessionManager: pi.SessionManager.create(input.workspace, input.sessionDir),
  });
  session = created.session;
  await session.bindExtensions({ mode: 'print' });
  let summary = '';
  session.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      emit({ type: 'tool', id: event.toolCallId, tool: event.toolName, detail: detailOf(event.args) });
      const artifact = artifactOf(event.toolName, event.args, input.workspace);
      if (artifact) emit({ type: 'artifact', artifact });
    } else if (event.type === 'tool_execution_end') {
      emit({
        type: 'tool_result',
        id: event.toolCallId,
        tool: event.toolName,
        result: resultOf(event.result),
        isError: event.isError,
      });
    } else if (event.type === 'message_end' && event.message?.role === 'assistant') {
      summary = cleanAgentText(event.message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim());
      const note = summary.replace(/\s+/g, ' ');
      if (note) emit({ type: 'progress', text: note.length > 600 ? `${note.slice(0, 599)}…` : note });
    }
  });
  emit({
    type: 'ready',
    piSessionId: session.sessionId,
    piSessionFile: session.sessionFile ?? null,
  });
  const policies = [
    input.task,
    formatCurrentContext(input.localContext),
    exaTool
      ? 'Choose the lightest tool that can provide the evidence the request needs. Prefer exa_search for ordinary research, current facts, source discovery, and quick text lookups. Use mcp Chrome DevTools when live visual evidence or page state matters, including webcams, queues, maps, rendered availability, screenshots, interaction, authenticated or JavaScript-only pages, or content Exa could not retrieve. It is often useful to discover the right page or live feed with Exa, then inspect only that page with Chrome. Do not use Chrome merely to repeat text results Exa already answered, but do use it when direct visual verification materially improves the answer.'
      : input.networkEnabled
        ? 'The mcp tool provides Chrome DevTools for browser navigation, interaction, inspection, and screenshots. Inspect and use it before claiming browser work is unavailable.'
      : '',
    'Complete the requested deliverable autonomously. For a simple fact, score, or screenshot, finish as soon as the requested evidence is available; do not keep searching for redundant confirmation. If the best source blocks access, make one focused fallback attempt, then return the strongest available evidence with the limitation instead of trying query variants, proxy URLs, or unrelated sources.',
    'When you use Chrome to inspect information that supports the answer, capture the useful evidence before leaving the page, even if the user did not explicitly request a screenshot. Prefer one or two readable screenshots of the relevant result, price, map, availability, or live view. Reuse screenshots already captured instead of taking duplicates. Save the image files inside the selected workspace, verify that they show the evidence, and return their paths together with the source URL, capture time, and a short explanation of what each image supports. Keep each image under 5 MB for presentation. Avoid irrelevant page areas and unrelated private information. A screenshot documents what was visible; it does not prove facts beyond that view. If capture fails, return the findings with that limitation rather than delaying the answer with repeated attempts.',
    'When asked for a screenshot or other artifact, create and verify it, save it inside the selected workspace, and return its path.',
    'As you work, emit concise progress notes when you reach a meaningful finding, change phase, or encounter a blocker. The router receives your latest note and tool activity automatically about every five seconds and decides whether to update the user. Do not pause for polling, invent progress, or repeat unchanged status. Clearly distinguish provisional findings from verified results.',
    'Return complete findings, source links, and useful artifact paths to the router.',
    'You cannot publish widgets or speak to the user. Save artifacts inside the selected workspace.',
  ].filter(Boolean).join('\n\n');
  await session.prompt(policies);
  emit({ type: 'done', summary: summary || 'Finished with no closing summary.' });
}

async function shutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  session?.dispose();
  session = null;
  await controller?.reset().catch(() => undefined);
  controller = null;
  process.exit(exitCode);
}

port.on('message', (event) => {
  const command = event.data as SubagentCommand;
  if (command.type === 'abort') {
    void (session?.abort() ?? Promise.resolve()).finally(() => shutdown(0));
    return;
  }
  if (command.type === 'shutdown') {
    void shutdown(command.exitCode);
    return;
  }
  if (command.type !== 'launch' || launched) return;
  launched = true;
  void run(command)
    // The parent acknowledges terminal messages before asking us to exit, so
    // process.exit cannot overtake the final IPC delivery.
    .then(() => undefined)
    .catch((error) => {
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
});
