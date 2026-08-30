import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthEvent, AuthMethod, AuthState, DelegationSelection, LoginPrompt } from '../shared/auth';
import type { ModelRuntime as ModelRuntimeType } from '@earendil-works/pi-coding-agent';
import type { AuthPrompt, Model } from '@earendil-works/pi-ai';
import { vendorModuleUrl } from './vendor';

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
  // the import native instead of asking Vite to rewrite pi's import.meta.url,
  // and resolve it from the vendored (asar-unpacked) node_modules at runtime.
  const importEsm = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ ModelRuntime: typeof ModelRuntimeType }>;
  const { ModelRuntime } = await importEsm(vendorModuleUrl('@earendil-works/pi-coding-agent'));
  const runtime = await ModelRuntime.create({
    authPath: path.join(options.agentDir, 'auth.json'),
    modelsPath: path.join(options.agentDir, 'models.json'),
    modelsStorePath: path.join(options.agentDir, 'models-store.json'),
  });

  const selectionPath = path.join(options.agentDir, 'ambient.json');
  let selection: DelegationSelection | null = null;
  try {
    const saved = JSON.parse(await readFile(selectionPath, 'utf8')) as
      | DelegationSelection
      | { delegation?: DelegationSelection };
    // Migrate the original file shape, which stored only the delegation model.
    if ('provider' in saved && saved.provider && saved.model) selection = saved;
    else {
      const configured = saved as {
        delegation?: DelegationSelection;
      };
      if (configured.delegation?.provider && configured.delegation.model) selection = configured.delegation;
    }
  } catch {
    // First launch or a discarded/corrupt preference file.
  }

  const persistSelections = () =>
    writeFile(
      selectionPath,
      `${JSON.stringify({ delegation: selection }, null, 2)}\n`,
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
    return {
      providers,
      models,
      selection: validSelection,
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
      await persistSelections();
      return state();
    },
  };
}
