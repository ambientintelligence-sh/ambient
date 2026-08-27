import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthEvent, AuthMethod, AuthState, DelegationSelection, LoginPrompt } from '../shared/auth';
import type { ModelRuntime as ModelRuntimeType } from '@earendil-works/pi-coding-agent';
import type { AuthPrompt, Model } from '@earendil-works/pi-ai';

export type AuthService = Awaited<ReturnType<typeof createAuthService>>;

type PendingPrompt = {
  id: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export async function createAuthService(options: {
  agentDir: string;
  fallback: DelegationSelection;
  emit: (event: AuthEvent) => void;
  openExternal: (url: string) => void;
}) {
  await mkdir(options.agentDir, { recursive: true, mode: 0o700 });
  // pi is ESM-only while Electron Forge emits this main process as CJS. Keep
  // the import native instead of asking Vite to rewrite pi's import.meta.url.
  const importEsm = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ ModelRuntime: typeof ModelRuntimeType }>;
  const { ModelRuntime } = await importEsm('@earendil-works/pi-coding-agent');
  const runtime = await ModelRuntime.create({
    authPath: path.join(options.agentDir, 'auth.json'),
    modelsPath: path.join(options.agentDir, 'models.json'),
    modelsStorePath: path.join(options.agentDir, 'models-store.json'),
  });

  const selectionPath = path.join(options.agentDir, 'ambient.json');
  let selection: DelegationSelection | null = null;
  let summarySelection: DelegationSelection | null = null;
  let advisorSelection: DelegationSelection | null = null;
  try {
    const saved = JSON.parse(await readFile(selectionPath, 'utf8')) as
      | DelegationSelection
      | { delegation?: DelegationSelection; summary?: DelegationSelection; advisor?: DelegationSelection };
    // Migrate the original file shape, which stored only the delegation model.
    if ('provider' in saved && saved.provider && saved.model) selection = saved;
    else {
      const configured = saved as {
        delegation?: DelegationSelection;
        summary?: DelegationSelection;
        advisor?: DelegationSelection;
      };
      if (configured.delegation?.provider && configured.delegation.model) selection = configured.delegation;
      if (configured.summary?.provider && configured.summary.model) summarySelection = configured.summary;
      if (configured.advisor?.provider && configured.advisor.model) advisorSelection = configured.advisor;
    }
  } catch {
    // First launch or a discarded/corrupt preference file.
  }

  const persistSelections = () =>
    writeFile(
      selectionPath,
      `${JSON.stringify({ delegation: selection, summary: summarySelection, advisor: advisorSelection }, null, 2)}\n`,
      { mode: 0o600 },
    );

  let controller: AbortController | null = null;
  let pending: PendingPrompt | null = null;

  const modelSummary = (model: Model<any>) => ({
    provider: model.provider,
    providerName: runtime.getProvider(model.provider)?.name ?? model.provider,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
  });

  async function state(): Promise<AuthState> {
    const models = [...(await runtime.getAvailable())]
      .map(modelSummary)
      .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name));
    const available = new Set(models.map((model) => `${model.provider}/${model.id}`));

    const providers = runtime
      .getProviders()
      .flatMap((provider) => {
        const methods: AuthMethod[] = [];
        if (provider.auth.oauth) methods.push('oauth');
        if (provider.auth.apiKey?.login) methods.push('api_key');
        if (methods.length === 0) return [];
        const status = runtime.getProviderAuthStatus(provider.id);
        return [{
          id: provider.id,
          name: provider.name,
          configured: status.configured,
          configuredType: status.configured
            ? (runtime.isUsingOAuth(provider.id) ? 'oauth' : 'api_key') as AuthMethod
            : null,
          methods,
        }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const validSelection = selection && available.has(`${selection.provider}/${selection.model}`) ? selection : null;
    const effectiveSummary = summarySelection ?? validSelection;
    const effectiveAdvisor = advisorSelection ?? validSelection;
    return {
      providers,
      models,
      selection: validSelection,
      summarySelection:
        effectiveSummary && available.has(`${effectiveSummary.provider}/${effectiveSummary.model}`)
          ? effectiveSummary
          : null,
      advisorSelection:
        effectiveAdvisor && available.has(`${effectiveAdvisor.provider}/${effectiveAdvisor.model}`)
          ? effectiveAdvisor
          : null,
    };
  }

  async function prompt(input: AuthPrompt): Promise<string> {
    if (controller?.signal.aborted) throw new Error('Login cancelled');
    const id = randomUUID();
    const serialized: LoginPrompt = {
      id,
      type: input.type,
      message: input.message,
      ...('placeholder' in input && input.placeholder ? { placeholder: input.placeholder } : {}),
      ...(input.type === 'select' ? { options: input.options } : {}),
    };

    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        if (pending?.id === id) pending = null;
        reject(new Error('Login cancelled'));
      };
      const signals = [controller?.signal, input.signal].filter(Boolean) as AbortSignal[];
      signals.forEach((signal) => signal.addEventListener('abort', onAbort, { once: true }));
      const cleanup = () => signals.forEach((signal) => signal.removeEventListener('abort', onAbort));
      pending = { id, resolve, reject, cleanup };
      options.emit({ type: 'prompt', prompt: serialized });
    });
  }

  return {
    agentDir: options.agentDir,
    runtime,
    state,
    currentSelection: () => selection ?? options.fallback,

    async select(next: DelegationSelection) {
      const model = (await runtime.getAvailable(next.provider)).find((item) => item.id === next.model);
      if (!model) throw new Error(`Model is not available: ${next.provider}/${next.model}`);
      selection = next;
      await persistSelections();
      return state();
    },

    async selectSummary(next: DelegationSelection) {
      const model = (await runtime.getAvailable(next.provider)).find((item) => item.id === next.model);
      if (!model) throw new Error(`Summary model is not available: ${next.provider}/${next.model}`);
      summarySelection = next;
      await persistSelections();
      return state();
    },

    async selectAdvisor(next: DelegationSelection) {
      const model = (await runtime.getAvailable(next.provider)).find((item) => item.id === next.model);
      if (!model) throw new Error(`Advisor model is not available: ${next.provider}/${next.model}`);
      advisorSelection = next;
      await persistSelections();
      return state();
    },

    async askAdvisor(question: string, context?: string): Promise<string> {
      const selected = advisorSelection ?? selection ?? options.fallback;
      const model = runtime.getModel(selected.provider, selected.model);
      if (!model) throw new Error('The advisor model is not available');
      const promptText = [
        'You are the expert advisor behind a concise voice assistant.',
        'Answer the concrete question directly and accurately.',
        'Give a recommendation and the key reason. Mention uncertainty when material.',
        'Do not discuss hidden reasoning or chain-of-thought. Keep the answer under 180 words.',
        `Question: ${question.slice(0, 4_000)}`,
        context?.trim() ? `Relevant context: ${context.slice(0, 8_000)}` : '',
      ].filter(Boolean).join('\n');
      const response = await runtime.completeSimple(
        model,
        { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
        { reasoning: 'medium', signal: AbortSignal.timeout(30_000) },
      );
      const text = response.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) throw new Error('The advisor returned no answer');
      return text;
    },

    async summarizeProgress(input: {
      task: string;
      activity: string;
      recentSteps: string;
      previousSummary: string | null;
      mandatory: boolean;
    }): Promise<string | null> {
      const selected = summarySelection ?? selection ?? options.fallback;
      const model = runtime.getModel(selected.provider, selected.model);
      if (!model) return null;
      const promptText = [
        'You are a progress filter for a Jarvis-style voice assistant.',
        input.mandatory
          ? 'This is an early orientation update. You MUST return a useful update, never SKIP.'
          : 'This is a later update. Return SKIP unless something user-meaningful changed.',
        'This is operational progress, never an interim answer to the user’s question.',
        'Describe the action or source being checked, not facts discovered in search snippets or page content.',
        'For research, prices, ratings, availability, names, counts, and conclusions are provisional until the final report.',
        'Say “I found the official listing and am verifying it,” not “I confirmed it costs $16.50.”',
        'For later updates, return SKIP for startup, waiting, repetition, or raw inspection commands.',
        'Otherwise return one natural first-person sentence of at most twenty-four words.',
        'When telemetry supports it, include both completed progress and current activity:',
        '“I found the official product page; now I’m validating its live purchase controls.”',
        'If blocked, state the blocker and the workaround being attempted.',
        'Be specific about files, tests, pages, or operations, but do not expose hidden reasoning.',
        'Never use “confirmed” for a factual claim; the final report is the only authoritative answer.',
        'Never say worker, agent, subagent, callsign, waiting, or still working.',
        `Task: ${input.task}`,
        `Current activity: ${input.activity}`,
        `Recent tool steps: ${input.recentSteps || '(none)'}`,
        `Previous spoken update: ${input.previousSummary ?? '(none)'}`,
      ].join('\n');
      const response = await runtime.completeSimple(
        model,
        { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
        { reasoning: 'minimal', signal: AbortSignal.timeout(12_000) },
      );
      const text = response.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^['“”]|['“”]$/g, '');
      const researchTelemetry = /\b(exa_search|mcp|browser|website|web|price|rating|availability)\b/i.test(
        `${input.task}\n${input.activity}\n${input.recentSteps}`,
      );
      const claimsResearchFact = researchTelemetry && (
        /(?:[$€£]|\b(?:cad|usd)\b|\b\d+(?:\.\d+)?%)/i.test(text) ||
        /\b(?:sold out|in stock|costs?|priced?|rated?|confirmed\s+(?:that\s+)?.+\s+is)\b/i.test(text)
      );
      const invalid =
        !text ||
        /^skip[.!]?$/i.test(text) ||
        /\b(wait(?:ing)?|still working|worker|subagent|agent)\b/i.test(text) ||
        claimsResearchFact ||
        (!input.mandatory && text.toLowerCase() === input.previousSummary?.toLowerCase());
      if (claimsResearchFact) {
        return input.mandatory ? 'I found a relevant source; now I’m validating it against the live page.' : null;
      }
      if (invalid) {
        return input.mandatory
          ? researchTelemetry
            ? 'I’m checking the strongest sources and validating the latest evidence.'
            : 'I’m reviewing the current results and preparing the next concrete action.'
          : null;
      }
      return text.slice(0, 220);
    },

    async login(providerId: string, method: AuthMethod) {
      if (controller) throw new Error('Another login is already in progress');
      const provider = runtime.getProvider(providerId);
      if (!provider || (method === 'oauth' ? !provider.auth.oauth : !provider.auth.apiKey?.login)) {
        throw new Error(`Login method is unavailable for ${providerId}`);
      }

      controller = new AbortController();
      try {
        await runtime.login(providerId, method, {
          signal: controller.signal,
          prompt,
          notify: (notice) => {
            options.emit({ type: 'notice', notice });
            if (notice.type === 'auth_url') options.openExternal(notice.url);
            if (notice.type === 'device_code') options.openExternal(notice.verificationUri);
          },
        });
        await runtime.refresh({ providers: [providerId], signal: AbortSignal.timeout(15_000) });
        options.emit({ type: 'complete', providerId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (controller.signal.aborted || message === 'Login cancelled') options.emit({ type: 'cancelled' });
        else options.emit({ type: 'error', message });
        throw error;
      } finally {
        pending?.cleanup();
        pending = null;
        controller = null;
      }
      return state();
    },

    answer(promptId: string, value: string) {
      if (!pending || pending.id !== promptId) throw new Error('That login prompt is no longer active');
      const current = pending;
      pending = null;
      current.cleanup();
      current.resolve(value);
    },

    cancel() {
      pending?.cleanup();
      pending?.reject(new Error('Login cancelled'));
      pending = null;
      controller?.abort();
    },

    async logout(providerId: string) {
      await runtime.logout(providerId);
      if (selection?.provider === providerId) selection = null;
      if (summarySelection?.provider === providerId) summarySelection = null;
      if (advisorSelection?.provider === providerId) advisorSelection = null;
      await persistSelections();
      return state();
    },
  };
}
