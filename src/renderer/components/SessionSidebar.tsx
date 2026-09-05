import { useState } from 'react';
import type { SessionSummary } from '@/shared/session';

export function SessionSidebar({ sessions, selectedId, workspace, onSelect, onCreate, onSettings, onClose }: {
  sessions: readonly SessionSummary[];
  selectedId?: string;
  workspace: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).filter(item => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return (
    <aside className="session-sidebar" id="session-sidebar" aria-label="Sessions">
      <header className="sidebar-heading"><span>ambient</span><button className="sidebar-close" onClick={onClose} aria-label="Close sessions">×</button></header>
      <button className="new-session" onClick={() => { setQuery(''); onCreate(); }}><span aria-hidden="true">＋</span>New session</button>
      <label className="session-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><path d="m12 12 5 5" /></svg><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sessions" aria-label="Search sessions" type="search" /></label>
      <div className="session-list-label"><h2>Sessions</h2><span>{sessions.length}</span></div>
      <nav className="session-list app-scroll" aria-label="Saved sessions">
        {filtered.map(item => (
          <button key={item.id} className="session-row" aria-current={item.id === selectedId ? 'page' : undefined} onClick={() => onSelect(item.id)}>
            <span className="session-row-title">{item.title}</span>
            <span className="session-row-meta"><span>{item.jobCount} {item.jobCount === 1 ? 'request' : 'requests'}</span><time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time></span>
          </button>
        ))}
        {filtered.length === 0 && <p className="session-list-empty">{query ? 'No matching sessions' : 'Your sessions will appear here.'}</p>}
      </nav>
      <footer className="sidebar-footer"><div><span>Workspace</span><strong title={workspace ?? undefined}>{workspace ?? 'No folder selected'}</strong></div><button onClick={onSettings} aria-label="Open settings"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" /></svg></button></footer>
    </aside>
  );
}
