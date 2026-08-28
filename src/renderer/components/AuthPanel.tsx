import { useEffect, useMemo, useState } from 'react';
import type {
  AuthEvent,
  AuthMethod,
  AuthProvider,
  AuthState,
  DelegationModel,
  LoginNotice,
  LoginPrompt,
} from '@/shared/auth';

const bridge = window.ambient;

const compactNumber = (value: number) => (value >= 1_000_000 ? `${value / 1_000_000}M` : `${Math.round(value / 1000)}K`);

export function AuthPanel(props: {
  open: boolean;
  initialPurpose?: 'delegation' | 'summary' | 'advisor';
  onClose: () => void;
  onState: (state: AuthState) => void;
}) {
  const [state, setState] = useState<AuthState | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelPurpose, setModelPurpose] = useState<'delegation' | 'summary' | 'advisor'>('delegation');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<LoginPrompt | null>(null);
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const publish = (next: AuthState) => {
    setState(next);
    props.onState(next);
  };

  const refresh = () => bridge?.getAuthState().then(publish).catch((cause) => setError(String(cause)));

  useEffect(() => {
    if (props.open) setModelPurpose(props.initialPurpose ?? 'delegation');
  }, [props.open, props.initialPurpose]);

  useEffect(() => {
    void refresh();
    if (!bridge) return;
    return bridge.onAuthEvent((event: AuthEvent) => {
      if (event.type === 'prompt') {
        setPrompt(event.prompt);
        setAnswer('');
      } else if (event.type === 'notice') {
        setNotice(event.notice);
      } else if (event.type === 'complete') {
        setBusy(false);
        setPrompt(null);
        setNotice({ type: 'progress', message: 'Authenticated. Loading models…' });
        void refresh();
      } else if (event.type === 'cancelled') {
        setBusy(false);
        setPrompt(null);
        setNotice(null);
      } else {
        setBusy(false);
        setPrompt(null);
        setError(event.message);
      }
    });
  }, []);

  const providers = state?.providers ?? [];
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const models = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (state?.models ?? []).filter(
      (model) =>
        (!providerId || model.provider === providerId) &&
        (!normalized || `${model.providerName} ${model.name} ${model.id}`.toLowerCase().includes(normalized)),
    );
  }, [providerId, query, state]);

  const startLogin = (provider: AuthProvider, method: AuthMethod) => {
    if (!bridge) return;
    setProviderId(provider.id);
    setBusy(true);
    setError(null);
    setNotice({ type: 'progress', message: `Starting ${method === 'oauth' ? 'account' : 'API key'} login…` });
    void bridge.login(provider.id, method).then(publish).catch(() => {
      // The main process emits the useful provider error as an auth event.
    });
  };

  const submitPrompt = (value: string) => {
    if (!bridge || !prompt) return;
    setPrompt(null);
    setNotice({ type: 'progress', message: 'Continuing authentication…' });
    void bridge.answerLogin(prompt.id, value).catch((cause) => setError(String(cause)));
  };

  const selectModel = (model: DelegationModel) => {
    if (!bridge) return;
    setBusy(true);
    const selection = { provider: model.provider, model: model.id };
    const request = modelPurpose === 'summary'
      ? bridge.selectSummaryModel(selection)
      : modelPurpose === 'advisor'
        ? bridge.selectAdvisorModel(selection)
        : bridge.selectDelegationModel(selection);
    void request.then((next) => {
        publish(next);
        props.onClose();
      })
      .catch((cause) => setError(String(cause)))
      .finally(() => setBusy(false));
  };

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-8 [-webkit-app-region:no-drag]">
      <div className="flex h-[min(680px,88vh)] w-[min(980px,94vw)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-7 py-5">
          <div>
            <p className="label-xs text-link">MODELS & SECOND OPINION</p>
            <h2 className="mt-2 text-2xl font-light text-ink">Choose how Ambient works and reviews.</h2>
          </div>
          <button className="rounded-full border border-white/10 px-4 py-2 label-xs text-dim hover:text-ink" onClick={props.onClose}>
            CLOSE
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
          <aside className="overflow-y-auto border-r border-white/10 p-4">
            <p className="label-xs px-2 py-3 text-dimmer">PROVIDERS</p>
            {providers.map((provider) => (
              <div
                key={provider.id}
                className={`mb-2 rounded-xl border p-3 ${providerId === provider.id ? 'border-link/50 bg-link/10' : 'border-white/[0.07] bg-white/[0.025]'}`}
              >
                <button className="w-full text-left" onClick={() => setProviderId(provider.id)}>
                  <span className="block text-sm text-ink">{provider.name}</span>
                  <span className={`label-xs mt-1.5 block ${provider.configured ? 'text-live' : 'text-dimmer'}`}>
                    {provider.configured ? `CONNECTED · ${provider.configuredType}` : provider.id}
                  </span>
                </button>
                <div className="mt-3 flex gap-2">
                  {provider.methods.map((method) => (
                    <button
                      key={method}
                      disabled={busy}
                      onClick={() => startLogin(provider, method)}
                      className="rounded-lg border border-white/10 px-2.5 py-2 label-xs text-dim hover:border-link/40 hover:text-ink disabled:opacity-40"
                    >
                      {method === 'oauth' ? 'ACCOUNT' : 'API KEY'}
                    </button>
                  ))}
                  {provider.configured && (
                    <button
                      disabled={busy}
                      onClick={() => bridge?.logout(provider.id).then(publish)}
                      className="ml-auto px-2 label-xs text-dimmer hover:text-alert"
                    >
                      LOG OUT
                    </button>
                  )}
                </div>
              </div>
            ))}
          </aside>

          <main className="flex min-h-0 flex-col p-6">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex gap-2">
                  <button
                    onClick={() => setModelPurpose('delegation')}
                    className={`rounded-lg px-3 py-2 label-xs ${modelPurpose === 'delegation' ? 'bg-link/15 text-link' : 'text-dimmer hover:text-ink'}`}
                  >
                    DELEGATION
                  </button>
                  <button
                    onClick={() => setModelPurpose('summary')}
                    className={`rounded-lg px-3 py-2 label-xs ${modelPurpose === 'summary' ? 'bg-deep/15 text-deep' : 'text-dimmer hover:text-ink'}`}
                  >
                    SUMMARY
                  </button>
                  <button
                    onClick={() => setModelPurpose('advisor')}
                    className={`rounded-lg px-3 py-2 label-xs ${modelPurpose === 'advisor' ? 'bg-warn/15 text-warn' : 'text-dimmer hover:text-ink'}`}
                  >
                    ADVISOR
                  </button>
                </div>
                <p className="mt-2 truncate text-sm text-dim">
                  {selectedProvider ? selectedProvider.name : 'All connected providers'}
                </p>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter models"
                className="w-56 rounded-xl border border-white/10 bg-black px-4 py-2.5 text-sm text-ink outline-none placeholder:text-dimmer focus:border-link/50"
              />
            </div>

            {(notice || error) && (
              <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${error ? 'border-alert/30 bg-alert/10 text-alert' : 'border-link/30 bg-link/10 text-ink'}`}>
                {error ?? (notice?.type === 'device_code'
                  ? `Enter code ${notice.userCode} at ${notice.verificationUri}`
                  : notice?.type === 'auth_url'
                    ? notice.instructions ?? 'Continue authentication in your browser.'
                    : notice?.message)}
                {notice?.type === 'auth_url' && (
                  <button className="ml-3 text-link underline" onClick={() => bridge?.openExternal(notice.url)}>Open browser</button>
                )}
                {notice?.type === 'device_code' && (
                  <button className="ml-3 text-link underline" onClick={() => bridge?.openExternal(notice.verificationUri)}>Open browser</button>
                )}
              </div>
            )}

            {prompt && (
              <div className="mt-4 rounded-xl border border-warn/30 bg-warn/5 p-4">
                <p className="text-sm text-ink">{prompt.message}</p>
                {prompt.type === 'select' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {prompt.options?.map((option) => (
                      <button key={option.id} onClick={() => submitPrompt(option.id)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-dim hover:text-ink">
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); submitPrompt(answer); }}>
                    <input
                      autoFocus
                      type={prompt.type === 'secret' ? 'password' : 'text'}
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      placeholder={prompt.placeholder}
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-ink outline-none focus:border-warn/50"
                    />
                    <button className="rounded-lg bg-ink px-4 py-2 label-xs text-black">CONTINUE</button>
                  </form>
                )}
                <button onClick={() => bridge?.cancelLogin()} className="mt-3 label-xs text-dimmer hover:text-alert">CANCEL LOGIN</button>
              </div>
            )}

            <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
              {models.length === 0 ? (
                <div className="grid h-full place-items-center text-center">
                  <div>
                    <p className="text-base text-dim">No models available.</p>
                    <p className="label-xs mt-2 text-dimmer">CONNECT THIS PROVIDER OR PICK ANOTHER</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {models.map((model) => {
                    const chosen = modelPurpose === 'summary'
                      ? state?.summarySelection
                      : modelPurpose === 'advisor'
                        ? state?.advisorSelection
                        : state?.selection;
                    const active = chosen?.provider === model.provider && chosen.model === model.id;
                    return (
                      <button
                        key={`${model.provider}/${model.id}`}
                        disabled={busy}
                        onClick={() => selectModel(model)}
                        className={`rounded-xl border p-4 text-left ${active ? 'border-live/50 bg-live/10' : 'border-white/[0.07] bg-black/30 hover:border-link/40'} disabled:opacity-40`}
                      >
                        <span className="block truncate text-sm text-ink">{model.name}</span>
                        <span className="mt-1 block truncate font-mono text-[10px] text-dimmer">{model.provider}/{model.id}</span>
                        <span className="label-xs mt-3 block text-dim">
                          {compactNumber(model.contextWindow)} CTX {model.reasoning ? '· REASONING' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        </div>

        <footer className="border-t border-white/10 px-7 py-3 label-xs text-dimmer">
          ADVISOR PROVIDES AN INDEPENDENT SECOND OPINION · SUMMARY FILTERS UPDATES · VOICE USES OPENAI
        </footer>
      </div>
    </div>
  );
}
