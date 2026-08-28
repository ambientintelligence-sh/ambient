import { useEffect, useRef, useState } from 'react';
import type { AuthState } from '@/shared/auth';
import type { BrowserState } from '@/shared/browser';
import { REALTIME_MODEL_ID, REALTIME_VOICE } from '@/shared/config';
import { isActive } from '@/shared/worker';
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
  const [setupPurpose, setSetupPurpose] = useState<'delegation' | 'summary' | 'advisor'>('delegation');
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
      if (!next.selection) {
        setSetupPurpose('delegation');
        setSetupOpen(true);
      }
    }
  };
  const connected = session.status === 'connected';
  const elapsed = useElapsed(connected);

  const statusTint = STATUS_TINT[session.status] ?? 'dim';

  const inFlight = session.workers.filter((each) => isActive(each.status)).length;
  const delegationModel = authState?.selection
    ? `${authState.selection.provider}/${authState.selection.model}`
    : 'SELECT MODEL';
  const advisorModel = authState?.advisorSelection
    ? `${authState.advisorSelection.provider}/${authState.advisorSelection.model}`
    : 'SET ADVISOR';

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-void">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-white/[0.05] to-transparent" />

      <header className="relative flex items-start gap-10 px-9 pt-10 [-webkit-app-region:drag]">
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

        <div className="flex min-h-[154px] min-w-0 flex-1 flex-col">
          <Chip
            label="TRANSCRIPT"
            value={session.speaking ? 'LIVE' : session.transcript ? 'LATEST' : 'READY'}
            tint={session.speaking ? 'link' : session.transcript ? 'live' : 'dim'}
          />
          <p className="mt-4 line-clamp-4 text-[27px] font-light leading-[1.18] tracking-[-0.02em] text-ink">
            {session.transcript || (connected ? 'Listening.' : 'Voice transcript will appear here.')}
          </p>
          <p className="label-xs mt-auto pt-3 text-dimmer">OUTPUT AUDIO TRANSCRIPT</p>
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
            <button
              onClick={() => { setSetupPurpose('delegation'); setSetupOpen(true); }}
              className="label-xs mt-2 block max-w-[170px] truncate text-link hover:text-ink"
            >
              {delegationModel}
            </button>
            <button
              title={authState?.advisorSelection ? `Second opinion: ${advisorModel}` : 'Pick a model for independent second opinions'}
              onClick={() => { setSetupPurpose('advisor'); setSetupOpen(true); }}
              className={`label-xs mt-2 block max-w-[170px] truncate hover:text-ink ${authState?.advisorSelection ? 'text-warn' : 'text-dimmer'}`}
            >
              SECOND OPINION {authState?.advisorSelection ? '· ON' : '· OFF'}
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

      <section className="relative mt-9 flex items-center justify-center gap-3 px-9">
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

        <div className="absolute right-9 flex gap-2">
          <ControlButton
            tint={workspace.path ? 'live' : 'warn'}
            onClick={() => void (workspace.path ? window.ambient?.openWorkspace() : window.ambient?.selectWorkspace())}
          >
            FILES
          </ControlButton>
          <ControlButton tint="warn" onClick={() => { setSetupPurpose('advisor'); setSetupOpen(true); }}>
            ADVISOR
          </ControlButton>
          <ControlButton tint="dim" onClick={() => { setSetupPurpose('delegation'); setSetupOpen(true); }}>
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

      <main className="relative mt-6 flex min-h-0 flex-1 px-9 pb-7">
        <DepartureBoard workers={session.workers} />
      </main>

      <AuthPanel
        open={setupOpen}
        initialPurpose={setupPurpose}
        onClose={() => setSetupOpen(false)}
        onState={handleAuthState}
      />
    </div>
  );
}
