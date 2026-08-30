import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthState } from '@/shared/auth';
import type { BrowserState } from '@/shared/browser';
import type { WorkspaceState } from '@/shared/workspace';
import { useSession } from './use-session';
import { AuthPanel } from './components/AuthPanel';
import { ControlButton } from './components/ControlButton';
import { DepartureBoard } from './components/DepartureBoard';
import { WidgetDock } from './components/WidgetDock';
import type { TintKey } from './components/tints';

type Page = 'timeline' | 'agents';
const STATUS_TINT: Readonly<Record<string, TintKey>> = { disconnected: 'dim', connecting: 'warn', connected: 'live', error: 'alert' };

export function App() {
  const session = useSession();
  const [page, setPage] = useState<Page>('timeline');
  const [setupOpen, setSetupOpen] = useState(false);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState>({ path: null, name: null });
  const [browser, setBrowser] = useState<BrowserState>({ mode: 'headless', available: false });
  const [dismissedDisplayIds, setDismissedDisplayIds] = useState<ReadonlySet<string>>(() => new Set());
  const authInitialized = useRef(false);
  const timelineEndRef = useRef<HTMLDivElement>(null);

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
  const statusTint = STATUS_TINT[session.status] ?? 'dim';
  const timelineItems = session.timelineItems
    .filter(({ display }) => !dismissedDisplayIds.has(display.id))
    .sort((a, b) => a.display.createdAt - b.display.createdAt);

  useEffect(() => {
    if (timelineItems.length > 0) timelineEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timelineItems.length]);

  const openSetup = () => setSetupOpen(true);
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-void text-ink">
      <div className="board-scan pointer-events-none absolute inset-0 opacity-40" />

      <header className="relative z-10 shrink-0 border-b border-white/[0.08] bg-[#030507]/95 px-4 pt-8 [-webkit-app-region:drag]">
        <div className="flex items-end justify-between pb-4">
          <div>
            <div className="flex items-center gap-2"><span className="text-warn led">◆</span><h1 className="font-mono text-[15px] font-semibold tracking-[0.14em] text-led-pale">AMBIENT</h1></div>
            <p className="label-xs mt-2 text-[#5d6672]">VOICE OPERATIONS TERMINAL</p>
          </div>
          <button type="button" onClick={openSetup} className="rounded border border-white/10 px-2.5 py-2 label-xs text-[#8b95a2] hover:border-warn/40 hover:text-warn [-webkit-app-region:no-drag]">SET</button>
        </div>
        <nav className="grid grid-cols-2 [-webkit-app-region:no-drag]" aria-label="Main views">
          {(['timeline', 'agents'] as const).map((item) => (
            <button key={item} type="button" onClick={() => setPage(item)} className={`relative h-11 font-mono text-[11px] tracking-[0.12em] ${page === item ? 'text-warn led' : 'text-[#5d6672] hover:text-[#8b95a2]'}`}>
              {item.toUpperCase()}{item === 'agents' ? ` · ${session.workers.length}` : ''}
              {page === item && <span className="absolute inset-x-[18%] bottom-0 h-px bg-warn shadow-[0_0_7px_#ffa32b]" />}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-scroll relative z-10 min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {page === 'timeline' ? (
          <div className="mx-auto grid w-full max-w-[620px] gap-3">
            <section className="flex items-start gap-3 border-b border-white/[0.07] px-1 pb-3">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${connected ? 'bg-live shadow-[0_0_7px_#46e05a]' : 'bg-[#333a43]'}`} />
              <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="label-xs text-[#5d6672]">VOICE</span>
                <span className={`font-mono text-[9px] tracking-[0.1em] ${connected ? 'text-live led' : 'text-[#5d6672]'}`}>{session.status.toUpperCase()}</span>
              </div>
              <p className="mt-2 line-clamp-2 font-mono text-[11px] leading-5 text-[#8b95a2]">{session.error ?? (session.transcript || (connected ? 'Listening for instructions…' : 'Service offline.'))}</p>
              </div>
            </section>
            <WidgetDock items={timelineItems} hasWorkers={session.workers.length > 0} onDismiss={(id) => setDismissedDisplayIds((current) => new Set(current).add(id))} onViewAgents={() => setPage('agents')} />
            <div ref={timelineEndRef} />
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-[760px] gap-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-[#04060a] p-2">
              <MiniControl onClick={openSetup}>MODEL · {authState?.selection?.model ?? 'SELECT'}</MiniControl>
              <MiniControl onClick={() => void window.ambient?.selectWorkspace()}>FILES · {workspace.name ?? 'SELECT'}</MiniControl>
              <MiniControl disabled={!browser.available} onClick={() => void window.ambient?.setBrowserMode(browser.mode === 'headless' ? 'visible' : 'headless').then(setBrowser)}>BROWSER · {browser.mode.toUpperCase()}</MiniControl>
            </div>
            <DepartureBoard workers={session.workers} />
          </div>
        )}
      </main>

      <footer className="relative z-20 shrink-0 border-t border-white/[0.08] bg-[#030507]/95 px-3 py-3">
        <div className="mx-auto flex max-w-[420px] items-center justify-center gap-3">
          <ControlButton active={!session.muted && connected} tint="live" onClick={session.toggleMute} disabled={!connected}>MIC</ControlButton>
          <ControlButton active={session.listening} tint="live" disabled>VAD</ControlButton>
          <ControlButton size="lg" active={connected || session.status === 'connecting'} tint={statusTint} onClick={connected ? session.disconnect : session.connect} disabled={session.status === 'connecting'}><span className="text-[17px] leading-none">{session.status === 'connecting' ? '···' : '⏻'}</span></ControlButton>
          <ControlButton active={session.muted} tint="alert" onClick={session.toggleMute} disabled={!connected}>MUTE</ControlButton>
          <ControlButton active={session.speaking} tint="link" disabled>OUT</ControlButton>
        </div>
      </footer>

      <AuthPanel open={setupOpen} onClose={() => setSetupOpen(false)} onState={handleAuthState} />
    </div>
  );
}

function MiniControl({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="min-w-0 max-w-full truncate rounded border border-white/10 px-2.5 py-2 font-mono text-[9px] tracking-[0.08em] text-[#8b95a2] hover:border-warn/40 hover:text-warn disabled:opacity-30">{children}</button>;
}
