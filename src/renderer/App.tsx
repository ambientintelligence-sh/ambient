import { useEffect, useRef, useState } from 'react';
import type { AuthState } from '@/shared/auth';
import type { BrowserState } from '@/shared/browser';
import { REALTIME_MODEL_ID, REALTIME_VOICE } from '@/shared/config';
import { isActive, type Worker } from '@/shared/worker';
import type { WorkspaceState } from '@/shared/workspace';
import { useSession } from './use-session';
import { AuthPanel } from './components/AuthPanel';
import { Chip } from './components/Chip';
import { Clock } from './components/Clock';
import { ControlButton } from './components/ControlButton';
import { DepartureBoard } from './components/DepartureBoard';
import { Sparkline } from './components/Sparkline';
import type { TintKey } from './components/tints';


const STATUS_TINT: Readonly<Record<string, TintKey>> = {
  disconnected: 'dim',
  connecting: 'warn',
  connected: 'live',
  error: 'alert',
};

const activeWorker = (workers: readonly Worker[]): Worker | null =>
  workers.find((worker) => worker.status === 'running') ??
  workers.find((worker) => worker.status === 'queued') ??
  null;

function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function App() {
  const session = useSession();
  const [setupOpen, setSetupOpen] = useState(false);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState>({ path: null, name: null });
  const [browser, setBrowser] = useState<BrowserState>({ mode: 'headless', available: false });
  const authInitialized = useRef(false);

  useEffect(() => {
    const bridge = window.ambient;
    if (!bridge) return;
    void bridge.getWorkspace().then(setWorkspace);
    void bridge.getBrowserState().then(setBrowser);
    return bridge.onWorkspaceChanged(setWorkspace);
  }, []);

  const handleAuthState = (next: AuthState) => {
    setAuthState(next);
    if (!authInitialized.current) {
      authInitialized.current = true;
      if (!next.selection) setSetupOpen(true);
    }
  };
  const connected = session.status === 'connected';
  const elapsed = useElapsed(connected);

  const worker = activeWorker(session.workers);
  const step = worker?.stops.at(-1) ?? null;
  const statusTint = STATUS_TINT[session.status] ?? 'dim';

  const mode = session.speaking ? 'SPEAKING' : session.listening ? 'LISTENING' : connected ? 'IDLE' : 'OFFLINE';
  const modeTint: TintKey = session.speaking ? 'link' : session.listening ? 'live' : 'dim';
  const inFlight = session.workers.filter((each) => isActive(each.status)).length;
  const delegationModel = authState?.selection
    ? `${authState.selection.provider}/${authState.selection.model}`
    : 'SELECT MODEL';

  return (
    <div className="app-scroll grid h-full place-items-start justify-items-center overflow-y-auto bg-void p-5">
      <div className="bezel w-full max-w-[1080px]">
        <div className="relative overflow-hidden rounded-[28px] bg-void px-9 pt-8 pb-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.045] to-transparent" />

          <header className="relative flex items-start gap-10 [-webkit-app-region:drag]">
            <div className="flex w-[122px] shrink-0 flex-col items-start gap-3 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[15px] leading-none text-ink">◇</span>
                <span className="label-xs text-ink">AMBIENT</span>
              </div>
              <Chip label="LINK" value={session.status.toUpperCase()} tint={statusTint} />
              <div className="label-xs leading-[1.9] text-dimmer">
                <div>{elapsed} ELAPSED</div>
                <div>{session.turns} TURNS</div>
                <div>{session.workers.length} DISPATCHED</div>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-5">
              <div>
                <Chip label="MODE" value={mode} tint={modeTint} />
                <p className="mt-2.5 truncate text-[38px] font-light leading-none tracking-[-0.02em] text-ink">
                  {worker?.name ?? 'ORCHESTRATOR'}
                </p>
                <p className="label-xs mt-2 truncate text-dim">
                  {worker ? worker.task : 'holding the floor'}
                </p>
              </div>

              <div>
                <Chip label="STEP" value={step ? 'ACTIVE' : 'IDLE'} tint={step ? 'warn' : 'dim'} />
                <p className="mt-2.5 truncate font-mono text-[32px] font-light leading-none tracking-[-0.03em] text-ink">
                  {step?.tool ?? '—'}
                </p>
                <p className="label-xs mt-2 truncate text-dim">
                  {step?.detail || (worker ? 'starting up' : 'no worker running')}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-6 pt-2">
              <Sparkline trace={session.inTrace} unit="mic" tint="live" />
              <Sparkline trace={session.outTrace} unit="voice" tint="link" />
            </div>

            <div className="flex shrink-0 items-start gap-6 pt-1">
              <div className="text-right">
                <p className="text-[21px] font-medium leading-none text-ink">{REALTIME_VOICE.toUpperCase()}</p>
                <p className="label-xs mt-1.5 text-dim">VOICE</p>
                <p className="mt-5 text-[21px] font-medium leading-none text-ink">
                  {inFlight}
                  <span className="text-dimmer">/{session.workers.length || 0}</span>
                </p>
                <p className="label-xs mt-1.5 text-dim">IN FLIGHT</p>
                <p className="label-xs mt-5 text-dimmer">{REALTIME_MODEL_ID}</p>
                <button onClick={() => setSetupOpen(true)} className="label-xs mt-2 block max-w-[170px] truncate text-link hover:text-ink">
                  {delegationModel}
                </button>
                <button
                  title={workspace.path ?? 'Choose workspace'}
                  onClick={() => void window.ambient?.selectWorkspace()}
                  className={`label-xs mt-2 block max-w-[170px] truncate hover:text-ink ${workspace.path ? 'text-live' : 'text-warn'}`}
                >
                  {workspace.name ?? 'NO WORKSPACE'}
                </button>
                <button
                  title="Applies to newly dispatched workers"
                  disabled={!browser.available}
                  onClick={() => void window.ambient
                    ?.setBrowserMode(browser.mode === 'headless' ? 'visible' : 'headless')
                    .then(setBrowser)}
                  className="label-xs mt-2 block max-w-[170px] truncate text-dim hover:text-ink disabled:opacity-30"
                >
                  BROWSER {browser.mode.toUpperCase()}
                </button>
              </div>
              <Clock />
            </div>
          </header>

          <section className="relative mt-10 flex items-center justify-center gap-3">
            <ControlButton active={!session.muted && connected} tint="live" onClick={session.toggleMute} disabled={!connected}>
              MIC
            </ControlButton>
            <ControlButton active={session.listening} tint="live" disabled>
              VAD
            </ControlButton>
            <ControlButton
              size="lg"
              active={connected || session.status === 'connecting'}
              tint={statusTint}
              onClick={connected ? session.disconnect : session.connect}
              disabled={session.status === 'connecting'}
            >
              <span className="text-[17px] leading-none">{session.status === 'connecting' ? '···' : '⏻'}</span>
            </ControlButton>
            <ControlButton active={session.muted} tint="alert" onClick={session.toggleMute} disabled={!connected}>
              MUTE
            </ControlButton>
            <ControlButton active={session.speaking} tint="link" disabled>
              OUT
            </ControlButton>

            <div className="absolute right-0 flex gap-2">
              <ControlButton
                tint={workspace.path ? 'live' : 'warn'}
                onClick={() => void (workspace.path ? window.ambient?.openWorkspace() : window.ambient?.selectWorkspace())}
              >
                FILES
              </ControlButton>
              <ControlButton tint="dim" onClick={() => setSetupOpen(true)}>
                MODEL
              </ControlButton>
              <ControlButton tint="dim" onClick={session.disconnect} disabled={!connected}>
                END
              </ControlButton>
            </div>
          </section>
          <p className={`label-xs relative mt-3 text-center ${session.error ? 'text-alert' : 'text-dimmer'}`}>
            {session.error ?? 'REALTIME SESSION'}
          </p>

          <DepartureBoard workers={session.workers} />
        </div>
      </div>
      <AuthPanel open={setupOpen} onClose={() => setSetupOpen(false)} onState={handleAuthState} />
    </div>
  );
}
