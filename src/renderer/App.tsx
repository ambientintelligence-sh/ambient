import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSession } from './use-session';
import { useAppStore } from './store';
import { AuthPanel } from './components/AuthPanel';
import { DepartureBoard } from './components/DepartureBoard';
import { VoiceOrb } from './components/VoiceOrb';
import { WidgetDock } from './components/WidgetDock';

export function App() {
  const session = useSession();
  const { initialize, page, setPage, setupOpen, setSetupOpen, workers, primaryAgent, storedTimelineItems, dismissDisplay } = useAppStore(useShallow((state) => ({
    initialize: state.initialize,
    page: state.page,
    setPage: state.setPage,
    setupOpen: state.setupOpen,
    setSetupOpen: state.setSetupOpen,
    workers: state.workers,
    primaryAgent: state.primaryAgent,
    storedTimelineItems: state.timelineItems,
    dismissDisplay: state.dismissDisplay,
  })));
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const timelineItems = storedTimelineItems.filter((item) => !item.dismissed);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const connected = session.status === 'connected';

  useEffect(() => {
    if (timelineItems.length > 0) timelineEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timelineItems.length]);

  const openSetup = () => setSetupOpen(true);

  const orbState = session.speaking
    ? 'speaking'
    : session.listening
      ? 'listening'
      : connected
        ? 'idle'
        : session.status === 'connecting'
          ? 'connecting'
          : 'off';

  const subtitle = session.error
    ? `Something went wrong — ${session.error}`
    : session.speaking && session.transcript
      ? session.transcript
      : null;

  const orbLevel = session.listening
    ? (session.inTrace[session.inTrace.length - 1] ?? 0)
    : session.speaking
      ? (session.outTrace[session.outTrace.length - 1] ?? 0)
      : 0;

  const togglePower = () => (connected ? session.disconnect() : session.connect());

  return (
    <div className="app-bg relative flex h-full flex-col overflow-hidden text-ink">
      {/* Grain-gradient backdrop */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="blob blob-a" />
        <div className="blob blob-b" />
        <div className="blob blob-c" />
        <div className="grain" />
      </div>

      {/* Draggable window region (frameless) */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 z-30 h-10 [-webkit-app-region:drag]" />

      {/* Quiet floating controls — clear of the traffic lights */}
      <div className="absolute right-3 top-14 z-30 flex items-center gap-1.5">
        <nav className="flex rounded-full bg-black/[0.045] p-0.5 backdrop-blur-sm" aria-label="Main views">
          {(['timeline', 'agents'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPage(item)}
              className={`h-6 rounded-full px-2.5 text-[11px] font-medium transition-colors duration-150 ${
                page === item ? 'bg-white text-ink shadow-[0_1px_3px_rgb(20_22_30/0.12)]' : 'text-dim hover:text-ink'
              }`}
            >
              {item === 'timeline' ? 'Timeline' : `Agents · ${workers.length + (primaryAgent ? 1 : 0)}`}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={openSetup}
          aria-label="Open settings"
          className="grid h-6 w-6 place-items-center rounded-full text-[12px] text-dim transition-colors duration-150 hover:bg-black/[0.05] hover:text-ink"
        >
          ⚙
        </button>
      </div>

      <main className="app-scroll relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-40 pt-24">
        {page === 'timeline' ? (
          <div className="mx-auto grid w-full max-w-[620px] gap-3">
            <WidgetDock
              items={timelineItems}
              hasWorkers={workers.length > 0 || primaryAgent?.status === 'running'}
              onDismiss={dismissDisplay}
              onViewAgents={() => setPage('agents')}
            />
            <div ref={timelineEndRef} />
          </div>
        ) : (
          <div className="mx-auto grid w-full min-w-0 max-w-[620px]">
            <DepartureBoard workers={workers} primaryAgent={primaryAgent} />
          </div>
        )}
      </main>

      {/* Floating voice stage */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4 pb-6">
        {subtitle && (
          <div className="glass subtitle pointer-events-auto shadow-[0_4px_24px_rgb(20_22_30/0.10)]" data-show="true" role="status">
            {subtitle}
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={session.toggleMute}
            disabled={!connected}
            aria-label={session.muted ? 'Unmute microphone' : 'Mute microphone'}
            className={`grid h-9 w-9 place-items-center rounded-full text-[12px] transition-[background-color,color,transform] duration-150 active:scale-95 disabled:opacity-0 ${
              session.muted
                ? 'bg-alert/10 text-alert'
                : 'bg-white/60 text-dim shadow-[0_1px_3px_rgb(20_22_30/0.08)] hover:text-ink'
            }`}
          >
            {session.muted ? '◉' : '○'}
          </button>
          <button
            type="button"
            onClick={togglePower}
            disabled={session.status === 'connecting'}
            aria-busy={session.status === 'connecting'}
            aria-label={connected ? 'Disconnect voice' : 'Connect voice'}
            className="rounded-full transition-transform duration-150 active:scale-95 disabled:cursor-wait"
          >
            <VoiceOrb state={orbState} level={orbLevel} />
          </button>
          <div className="w-9" aria-hidden="true" />
        </div>
      </div>

      <AuthPanel open={setupOpen} onClose={() => setSetupOpen(false)} />
    </div>
  );
}
