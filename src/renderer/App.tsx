import { useEffect, useState } from 'react';
import { REALTIME_MODEL_ID, REALTIME_VOICE } from '@/shared/config';
import { activeAgent, activeTool } from './fleet';
import { useSession } from './use-session';
import { DepartureBoard } from './components/DepartureBoard';
import { Chip } from './components/Chip';
import { Clock } from './components/Clock';
import { ControlButton } from './components/ControlButton';
import { Sparkline } from './components/Sparkline';
import type { TintKey } from './components/tints';

const NOTICE =
  'SIMULATED DELEGATION — no tools are registered with the realtime session yet, ' +
  'but every stop advances on a real session event.';

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
  const connected = session.status === 'connected';
  const elapsed = useElapsed(connected);

  const agent = activeAgent(session.fleet);
  const tool = activeTool(session.fleet);
  const statusTint = STATUS_TINT[session.status] ?? 'dim';

  const mode = session.speaking ? 'SPEAKING' : session.listening ? 'LISTENING' : connected ? 'IDLE' : 'OFFLINE';
  const modeTint: TintKey = session.speaking ? 'link' : session.listening ? 'live' : 'dim';

  return (
    <div className="grid h-full place-items-center bg-void p-5 [-webkit-app-region:drag]">
      <div className="bezel w-full max-w-[1080px]">
        <div className="relative overflow-hidden rounded-[28px] bg-void px-9 pt-8 pb-8">
          {/* glass sheen across the top of the panel */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.045] to-transparent" />

          {/* ── cluster ───────────────────────────────────────────── */}
          <header className="relative flex items-start gap-10">
            <div className="flex w-[122px] shrink-0 flex-col items-start gap-3 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[15px] leading-none text-ink">◇</span>
                <span className="label-xs text-ink">AMBIENT</span>
              </div>
              <Chip label="LINK" value={session.status.toUpperCase()} tint={statusTint} />
              <div className="label-xs leading-[1.9] text-dimmer">
                <div>{elapsed} ELAPSED</div>
                <div>{session.turns} TURNS</div>
                <div>{session.fleet.calls.filter((call) => call.status === 'ok').length} TOOLS RUN</div>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-5">
              <div>
                <Chip label="MODE" value={mode} tint={modeTint} />
                <p className="mt-2.5 truncate text-[38px] font-light leading-none tracking-[-0.02em] text-ink">
                  {agent?.name ?? 'ORCHESTRATOR'}
                </p>
                <p className="label-xs mt-2 text-dim">{agent ? agent.role : 'holding the floor'}</p>
              </div>

              <div>
                <Chip label="CALLING" value={tool ? 'ACTIVE' : 'IDLE'} tint={tool ? 'warn' : 'dim'} />
                <p className="mt-2.5 truncate font-mono text-[32px] font-light leading-none tracking-[-0.03em] text-ink">
                  {tool ?? '—'}
                </p>
                <p className="label-xs mt-2 text-dim">
                  {agent && agent.tool
                    ? `${agent.id} · step ${agent.step + 1} of 3`
                    : 'no tool in flight'}
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
                  {session.fleet.agents.filter((each) => each.phase !== 'idle').length}
                  <span className="text-dimmer">/{session.fleet.agents.length}</span>
                </p>
                <p className="label-xs mt-1.5 text-dim">FLEET ENGAGED</p>
                <p className="label-xs mt-5 text-dimmer">{REALTIME_MODEL_ID}</p>
              </div>
              <Clock />
            </div>
          </header>

          {/* ── controls ──────────────────────────────────────────── */}
          <section className="relative mt-10 flex items-center justify-center gap-3">
            <ControlButton active={!session.muted && connected} tint="live" onClick={session.toggleMute} disabled={!connected}>
              MIC
            </ControlButton>
            <ControlButton active={session.listening} tint="live" disabled>
              VAD
            </ControlButton>
            <ControlButton
              size="lg"
              active={connected}
              tint={statusTint}
              onClick={connected ? session.disconnect : session.connect}
            >
              <span className="text-[17px] leading-none">⏻</span>
            </ControlButton>
            <ControlButton active={session.muted} tint="alert" onClick={session.toggleMute} disabled={!connected}>
              MUTE
            </ControlButton>
            <ControlButton active={session.speaking} tint="link" disabled>
              OUT
            </ControlButton>

            <div className="absolute right-0">
              <ControlButton tint="dim" onClick={session.disconnect} disabled={!connected}>
                END
              </ControlButton>
            </div>
          </section>
          <p className={`label-xs relative mt-3 text-center ${session.error ? 'text-alert' : 'text-dimmer'}`}>
            {session.error ?? 'REALTIME SESSION'}
          </p>

          {/* ── delegation ────────────────────────────────────────── */}
          <DepartureBoard agents={session.fleet.agents} notice={NOTICE} />

        </div>
      </div>
    </div>
  );
}
