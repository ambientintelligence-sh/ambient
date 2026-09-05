import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSession } from './use-session';
import { useAppStore } from './store';
import { SessionSidebar } from './components/SessionSidebar';
import { AuthPanel } from './components/AuthPanel';
import { DepartureBoard } from './components/DepartureBoard';
import { VoiceOrb } from './components/VoiceOrb';
import { WidgetDock } from './components/WidgetDock';

export function App() {
  const session = useSession();
  const { initialize, page, setPage, setupOpen, setSetupOpen, workers, primaryAgent, storedTimelineItems, dismissDisplay, sessions, selectedSession, createSession, selectSession, workspace, jobs, error } = useAppStore(useShallow((state) => ({
    sessions: state.sessions,
    selectedSession: state.session,
    createSession: state.createSession,
    selectSession: state.selectSession,
    workspace: state.workspace,
    jobs: state.jobs,
    error: state.error,
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const timelineItems = storedTimelineItems.filter((item) => !item.dismissed);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const connected = session.status === 'connected';

  useEffect(() => {
    if (timelineItems.length > 0) timelineEndRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'end' });
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

  const orbLevel = session.speaking
    ? (session.outTrace[session.outTrace.length - 1] ?? 0)
    : connected && !session.muted
      ? (session.inTrace[session.inTrace.length - 1] ?? 0)
      : 0;

  const results = timelineItems.filter(item => item.display.format !== 'activity');
  const activities = timelineItems.filter(item => item.display.format === 'activity');

  const togglePower = () => (connected ? session.disconnect() : session.connect());

  return (
    <div className="app-bg workspace-shell" data-voice={orbState} data-page={page} data-sidebar-open={sidebarOpen}>
      <div aria-hidden="true" className="window-drag" />
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sessions" onClick={() => setSidebarOpen(false)} />}
      <SessionSidebar sessions={sessions} selectedId={selectedSession?.id} workspace={workspace.name}
        onSelect={(id) => { selectSession(id); setSidebarOpen(false); }}
        onCreate={() => { createSession(); setSidebarOpen(false); }}
        onSettings={openSetup} onClose={() => setSidebarOpen(false)} />
      <div className="session-canvas">
        <header className="canvas-header">
          <div className="canvas-title"><button className="sidebar-toggle" aria-label="Show sessions" aria-controls="session-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button><div><p>{selectedSession ? 'Session' : 'Workspace'}</p><h1>{selectedSession?.title ?? 'New session'}</h1></div></div>
          <span className="connection-state"><i />{connected ? 'Connected' : session.status === 'connecting' ? 'Connecting' : 'Offline'}</span>
        </header>
        <div className="canvas-toolbar">
        <nav className="view-switch" aria-label="Main views">
          {(['timeline', 'agents'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPage(item)}
              aria-current={page === item ? 'page' : undefined}
              className="view-tab"
            >
              {item === 'timeline' ? 'Overview' : `Agents ${workers.length + (primaryAgent ? 1 : 0)}`}
            </button>
          ))}
        </nav>
          <span className="canvas-date">{selectedSession && new Date(selectedSession.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}</span>
        </div>
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <main className="workspace-content app-scroll">
          {page === 'timeline' ? (
            <div className="overview-layout">
              <section className="results-column" aria-label="Results">
                <div className="column-heading"><h2>Results</h2><span>{results.length}</span></div>
                <WidgetDock items={results} hasWorkers={false} onDismiss={dismissDisplay} onViewAgents={() => setPage('agents')} />
                <div ref={timelineEndRef} />
              </section>
              <aside className="activity-column" aria-label="Session activity">
                <div className="column-heading"><h2>Live activity</h2><span>{activities.length}</span></div>
                {activities.length > 0 ? <WidgetDock items={activities} hasWorkers={false} onDismiss={dismissDisplay} onViewAgents={() => setPage('agents')} /> : <p className="quiet-status">No activity in progress</p>}
                <section className="session-context"><h2>Session details</h2><dl><div><dt>Workspace</dt><dd>{workspace.name ?? 'Not selected'}</dd></div><div><dt>Requests</dt><dd>{jobs.length}</dd></div><div><dt>Agents</dt><dd>{workers.length + (primaryAgent ? 1 : 0)}</dd></div></dl></section>
              </aside>
            </div>
          ) : <DepartureBoard workers={workers} primaryAgent={primaryAgent} />}
        </main>
      {/* Floating voice stage */}
      <div className="voice-stage">
        <VoiceOrb state={orbState} level={orbLevel} />
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
            aria-pressed={session.muted}
            className={`mute-button ${session.muted ? 'is-muted' : ''}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" />{session.muted && <path d="m3 3 18 18" />}</svg>
          </button>
          <button
            type="button"
            onClick={togglePower}
            disabled={session.status === 'connecting'}
            aria-busy={session.status === 'connecting'}
            aria-label={connected ? 'End voice' : 'Start voice'}
            className="voice-button"
          >
            <span className="voice-action">{session.status === 'connecting' ? 'Connecting…' : !connected ? 'Start voice' : 'End voice'}</span>
          </button>
          <div className="voice-balance" aria-hidden="true" />
        </div>
        <p className="voice-hint" role="status">{connected ? session.speaking ? 'Speaking' : session.muted ? 'Microphone muted' : session.listening ? 'Listening' : 'Ready' : session.status === 'connecting' ? 'Connecting…' : ''}</p>
      </div>


      </div>
      <AuthPanel open={setupOpen} onClose={() => setSetupOpen(false)} />
    </div>
  );
}
