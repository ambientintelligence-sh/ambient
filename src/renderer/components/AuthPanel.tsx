import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type {
  AuthEvent,
  AuthMethod,
  AuthProvider,
  AuthState,
  DelegationModel,
  LoginNotice,
  LoginPrompt,
} from '@/shared/auth';
import type { LocalContextState } from '@/shared/local-context';
import { useAppStore } from '../store';

const bridge = window.ambient;

const compactNumber = (value: number) => (value >= 1_000_000 ? `${value / 1_000_000}M` : `${Math.round(value / 1000)}K`);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <p className="label-xs px-1 pb-2 text-dimmer">{title}</p>
      <div className="overflow-hidden rounded-2xl bg-panel/80 shadow-[0_1px_3px_rgb(20_22_30/0.06),inset_0_0_0_0.5px_rgb(20_22_30/0.04)]">
        {children}
      </div>
    </section>
  );
}

function Row({ label, value, control, first = false }: { label: string; value?: string; control?: ReactNode; first?: boolean }) {
  return (
    <div className={`flex min-h-[44px] items-center gap-3 px-4 py-2.5 ${first ? '' : 'border-t border-white/[0.05]'}`}>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{label}</span>
      {value && <span className="truncate text-[12px] text-dim">{value}</span>}
      {control}
    </div>
  );
}

function Chevron() {
  return <span className="text-dimmer">›</span>;
}

function Toggle({ on, onChange, disabled = false }: { on: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[24px] w-[54px] shrink-0 overflow-hidden rounded-full transition-[background-color,box-shadow] duration-200 disabled:opacity-30 ${
        on
          ? 'bg-link shadow-[0_2px_8px_rgb(20_22_30/0.22)]'
          : 'bg-white/[0.06] shadow-[inset_0_0_0_0.5px_rgb(20_22_30/0.08)]'
      }`}
    >
      <span
        className={`absolute top-[3px] grid h-[18px] w-[26px] place-items-center rounded-full bg-panel-2 text-[8px] font-semibold uppercase tracking-[0.06em] transition-transform duration-200 ${
          on
            ? 'translate-x-[25px] text-ink shadow-none'
            : 'translate-x-[3px] text-dim shadow-[0_1px_3px_rgb(20_22_30/0.18)]'
        }`}
      >
        {on ? 'On' : 'Off'}
      </span>
    </button>
  );
}

export function AuthPanel(props: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    state,
    setAuth,
    workspace,
    browser,
    network,
    location,
    setLocation,
    chooseWorkspace,
    setBrowserVisible,
    setNetworkEnabled,
  } = useAppStore(useShallow((store) => ({
    state: store.auth,
    setAuth: store.setAuth,
    workspace: store.workspace,
    browser: store.browser,
    network: store.network,
    location: store.location,
    setLocation: store.setLocation,
    chooseWorkspace: store.chooseWorkspace,
    setBrowserVisible: store.setBrowserVisible,
    setNetworkEnabled: store.setNetworkEnabled,
    currentSessionId: store.session?.id ?? null,
  })));
  const [busy, setBusy] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<LoginPrompt | null>(null);
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locationState, setLocationState] = useState<LocalContextState | null>(location);
  const [locationDraft, setLocationDraft] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const publish = (next: AuthState) => {
    setAuth(next);
  };

  const refresh = () => bridge?.getAuthState().then(publish).catch((cause) => setError(String(cause)));

  useEffect(() => {
    if (!props.open) return;
    setModelsOpen(false);
    setLocationState(location);
    setLocationDraft(location?.location ?? '');
  }, [location, props.open]);

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
        setBusyProvider(null);
        setPrompt(null);
        setNotice({ type: 'progress', message: 'Connected.' });
        void refresh();
      } else if (event.type === 'cancelled') {
        setBusy(false);
        setBusyProvider(null);
        setPrompt(null);
        setNotice(null);
      } else {
        setBusy(false);
        setBusyProvider(null);
        setPrompt(null);
        setError(event.message);
      }
    });
  }, []);

  const providers = state?.providers ?? [];
  const connectedProviders = providers.filter((provider) => provider.configured);
  // Once anything is connected, show only those; the full picker only appears
  // when nothing is set up yet.
  const visibleProviders = connectedProviders.length > 0 ? connectedProviders : providers;
  const models = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (state?.models ?? []).filter(
      (model) => !normalized || `${model.providerName} ${model.name} ${model.id}`.toLowerCase().includes(normalized),
    );
  }, [query, state]);

  // One-tap connect: prefer OAuth (browser sign-in), fall back to API key.
  const connect = (provider: AuthProvider) => {
    if (!bridge) return;
    const method: AuthMethod = provider.methods.includes('oauth') ? 'oauth' : 'api_key';
    setBusyProvider(provider.id);
    setBusy(true);
    setError(null);
    setNotice({ type: 'progress', message: method === 'oauth' ? 'Opening sign-in…' : 'Enter your API key…' });
    void bridge.login(provider.id, method).then(publish).catch(() => {
      // The main process emits the useful provider error as an auth event.
    });
  };

  const submitPrompt = (value: string) => {
    if (!bridge || !prompt) return;
    setPrompt(null);
    setNotice({ type: 'progress', message: 'Continuing…' });
    void bridge.answerLogin(prompt.id, value).catch((cause) => setError(String(cause)));
  };

  const selectModel = (model: DelegationModel) => {
    if (!bridge) return;
    setBusy(true);
    void bridge.selectDelegationModel({ provider: model.provider, model: model.id })
      .then((next) => {
        publish(next);
        setModelsOpen(false);
      })
      .catch((cause) => setError(String(cause)))
      .finally(() => setBusy(false));
  };

  const saveLocation = () => {
    if (!bridge) return;
    const location = locationDraft.trim();
    setLocationBusy(true);
    setError(null);
    const request = location
      ? bridge.setLocation({
          location,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        })
      : bridge.clearLocation();
    void request
      .then((next) => {
        setLocationState(next);
        setLocation(next);
        setLocationDraft(next.location ?? '');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLocationBusy(false));
  };

  const clearLocation = () => {
    if (!bridge) return;
    setLocationBusy(true);
    setError(null);
    void bridge.clearLocation()
      .then((next) => {
        setLocationState(next);
        setLocation(next);
        setLocationDraft('');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLocationBusy(false));
  };

  if (!props.open) return null;

  const selectedModel = state?.selection
    ? (state?.models ?? []).find((m) => m.provider === state.selection?.provider && m.id === state.selection?.model)
    : null;

  return (
    <div className="settings-sheet absolute z-40 flex flex-col bg-void/95 backdrop-blur-xl [-webkit-app-region:no-drag]">
      <header className="flex items-center justify-between px-5 pb-3 pt-14">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">Settings</h2>
        <button
          type="button"
          onClick={props.onClose}
          className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.05] text-[13px] text-dim transition-colors duration-150 hover:bg-white/[0.08] hover:text-ink"
          aria-label="Close settings"
        >
          ✕
        </button>
      </header>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-10">
        <Section title="Agent environment">
          <Row
            first
            label="Files"
            value={workspace.name ?? 'Select folder'}
            control={<button type="button" onClick={chooseWorkspace} className="flex items-center gap-1 text-[12px] font-medium text-link">Change <Chevron /></button>}
          />
          <Row
            label="Visible browser"
            control={
              <Toggle
                on={browser.mode === 'visible'}
                disabled={!browser.available}
                onChange={setBrowserVisible}
              />
            }
          />
          <Row
            label="Internet access"
            control={<Toggle on={network.enabled} onChange={setNetworkEnabled} />}
          />
          <p className="border-t border-white/[0.05] px-4 py-2.5 text-[10.5px] leading-4 text-dimmer">
            Applies to the next task you delegate. Running agents keep their current access.
          </p>
        </Section>

        <Section title="Location">
          <form
            className="px-4 py-3"
            onSubmit={(event) => { event.preventDefault(); saveLocation(); }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className={`label-xs ${locationState?.enabled ? 'text-live' : 'text-dimmer'}`}>
                {locationState?.enabled ? 'Saved' : 'Optional'}
              </span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-4 text-dim">Default city or region for local recommendations and searches.</p>
            <div className="mt-2.5 flex gap-2">
              <input
                id="ambient-location"
                value={locationDraft}
                onChange={(event) => setLocationDraft(event.target.value)}
                placeholder="Vancouver, BC, Canada"
                maxLength={160}
                className="min-w-0 flex-1 rounded-full border border-white/[0.09] bg-panel-2 px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-dimmer focus:border-link/50"
              />
              <button disabled={locationBusy} className="rounded-full bg-link px-3.5 py-1.5 text-[11px] font-medium text-void transition-opacity duration-150 disabled:opacity-40">
                Save
              </button>
              {locationState?.enabled && (
                <button
                  type="button"
                  disabled={locationBusy}
                  onClick={clearLocation}
                  className="px-2 text-[11px] font-medium text-dimmer transition-colors duration-150 hover:text-alert disabled:opacity-40"
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </Section>

        <Section title={connectedProviders.length > 0 ? 'Account' : 'Accounts'}>
          {visibleProviders.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-dim">Loading…</p>
          ) : (
            visibleProviders.map((provider, index) => (
              <div
                key={provider.id}
                className={`flex min-h-[52px] items-center gap-3 px-4 py-3 ${index === 0 ? '' : 'border-t border-white/[0.05]'}`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${provider.configured ? 'bg-live' : 'bg-white/[0.15]'}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">{provider.name}</p>
                  <p className="label-xs mt-0.5 text-dimmer">
                    {provider.configured ? (provider.configuredType === 'oauth' ? 'Signed in' : 'API key') : 'Not connected'}
                  </p>
                </div>
                {provider.configured ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => bridge?.logout(provider.id).then(publish)}
                    className="shrink-0 text-[11px] font-medium text-dimmer transition-colors duration-150 hover:text-alert disabled:opacity-40"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => connect(provider)}
                    className="shrink-0 rounded-full bg-link px-3.5 py-1.5 text-[11px] font-medium text-void transition-opacity duration-150 hover:opacity-85 disabled:opacity-40"
                  >
                    {busyProvider === provider.id ? 'Connecting…' : 'Connect'}
                  </button>
                )}
              </div>
            ))
          )}
        </Section>

        {(notice || error) && !prompt && (
          <div className={`mt-4 rounded-2xl px-4 py-3 text-[12.5px] ${error ? 'bg-alert/[0.08] text-alert' : 'bg-link/[0.08] text-ink'}`}>
            {error ?? (notice?.type === 'device_code'
              ? `Enter code ${notice.userCode} at ${notice.verificationUri}`
              : notice?.type === 'auth_url'
                ? notice.instructions ?? 'Continue sign-in in your browser.'
                : notice?.message)}
            {(notice?.type === 'auth_url' || notice?.type === 'device_code') && (
              <button
                className="ml-2 font-medium text-link underline"
                onClick={() => bridge?.openExternal(notice.type === 'device_code' ? notice.verificationUri : notice.url)}
              >
                Open browser
              </button>
            )}
          </div>
        )}

        {prompt && (
          <div className="mt-4 rounded-2xl bg-panel/80 p-4 shadow-[0_1px_3px_rgb(20_22_30/0.06),inset_0_0_0_0.5px_rgb(20_22_30/0.04)]">
            <p className="text-[13px] text-ink">{prompt.message}</p>
            {prompt.type === 'select' ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {prompt.options?.map((option) => (
                  <button key={option.id} onClick={() => submitPrompt(option.id)} className="rounded-full border border-white/[0.09] bg-panel-2 px-3 py-1.5 text-[12px] text-dim transition-colors duration-150 hover:text-ink">
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
                  className="min-w-0 flex-1 rounded-full border border-white/[0.09] bg-panel-2 px-3 py-1.5 text-[13px] text-ink outline-none focus:border-link/50"
                />
                <button className="rounded-full bg-link px-4 py-1.5 text-[11px] font-medium text-void">Continue</button>
              </form>
            )}
            <button onClick={() => bridge?.cancelLogin()} className="mt-3 text-[11px] font-medium text-dimmer transition-colors duration-150 hover:text-alert">Cancel</button>
          </div>
        )}

        <Section title="Primary model">
          <button
            type="button"
            onClick={() => setModelsOpen((open) => !open)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
            aria-expanded={modelsOpen}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-ink">{selectedModel?.name ?? state?.selection?.model ?? 'Select a model'}</p>
              <p className="label-xs mt-0.5 text-dimmer">
                {state?.selection ? `${state.selection.provider}/${state.selection.model}` : 'Powers delegated work'}
              </p>
            </div>
            <span className={`text-dimmer transition-transform duration-200 ${modelsOpen ? 'rotate-90' : ''}`}>›</span>
          </button>

          {modelsOpen && (
            <div className="border-t border-white/[0.05] px-3 py-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter models"
                className="mb-2.5 w-full rounded-full border border-white/[0.09] bg-panel-2 px-3.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-dimmer focus:border-link/50"
              />
              {models.length === 0 ? (
                <p className="px-1 py-3 text-center text-[12px] text-dim">No models — connect a provider above.</p>
              ) : (
                <div className="grid max-h-[300px] gap-1 overflow-y-auto">
                  {models.map((model) => {
                    const chosen = state?.selection;
                    const active = chosen?.provider === model.provider && chosen.model === model.id;
                    return (
                      <button
                        key={`${model.provider}/${model.id}`}
                        disabled={busy}
                        onClick={() => selectModel(model)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 ${active ? 'bg-live/[0.08]' : 'hover:bg-white/[0.03]'} disabled:opacity-40`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] text-ink">{model.name}</p>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-dimmer">{model.provider}/{model.id}</p>
                        </div>
                        <span className="label-xs shrink-0 text-dim">
                          {compactNumber(model.contextWindow)}{model.reasoning ? ' · r' : ''}
                        </span>
                        {active && <span className="shrink-0 text-live">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Section>

        <p className="mt-6 px-1 text-center text-[10.5px] text-dimmer">
          Voice uses OpenAI · The selected model powers delegated work
        </p>
      </div>
    </div>
  );
}
