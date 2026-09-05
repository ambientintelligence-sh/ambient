import { cleanAgentText } from '@/shared/live-activity';
import { useId, useState, type CSSProperties } from 'react';
import type { PrimaryAgent, PrimaryAgentStatus, Worker, WorkerStatus } from '@/shared/worker';

const PALETTE = ['#8c6450', '#39715f', '#487582', '#78678c'] as const;
const STATUS: Readonly<Record<WorkerStatus, { label: string; color: string }>> = {
  queued: { label: 'Queued', color: '#8c6a3b' },
  running: { label: 'Running', color: '#39715f' },
  complete: { label: 'Done', color: '#39715f' },
  failed: { label: 'Failed', color: '#a44f62' },
  cancelled: { label: 'Stopped', color: '#697980' },
};
const PRIMARY_STATUS: Readonly<Record<PrimaryAgentStatus, { label: string; color: string }>> = {
  initializing: { label: 'Starting', color: '#8c6a3b' },
  idle: { label: 'Ready', color: '#78678c' },
  running: { label: 'Running', color: '#39715f' },
};
const colourOf = (name: string) => PALETTE[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length];

type AgentRow = Readonly<{
  key: string;
  name: string;
  assignment: string;
  status: { label: string; color: string };
  running: boolean;
  queued: boolean;
  startedAt: string;
  currentTask: string | null;
  stops: Worker['stops'];
  updates: Worker['updates'];
  artifacts: Worker['artifacts'];
  piSessionId: string | null;
  summary: string | null;
  error: string | null;
}>;

function Row({ agent, primary = false }: { agent: AgentRow; primary?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const hex = colourOf(agent.name);
  const current = [...agent.stops].reverse().find((stop) => stop.status === 'running') ?? agent.stops.at(-1);
  const activity = agent.queued ? 'Waiting to start' : agent.running
    ? current?.detail || current?.tool || agent.currentTask || 'Working'
    : agent.status.label === 'Done' ? 'Work complete' : agent.status.label === 'Stopped' ? 'Work stopped'
    : agent.status.label === 'Failed' ? agent.error || 'Work failed' : 'Ready';

  return (
    <article className="agent-card" data-expanded={expanded} style={{ '--agent-accent': hex } as CSSProperties}>
      <button type="button" aria-expanded={expanded} aria-controls={detailsId}
        aria-label={`${expanded ? 'Hide' : 'Show'} details for ${agent.name}`}
        onClick={() => setExpanded(value => !value)} className="agent-card-toggle">
        <span className="agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</span>
        <span className="agent-identity">
          <span className="agent-role">{primary ? 'Primary agent' : 'Subagent'} <span>· {agent.startedAt}</span></span>
          <span className="agent-name">{agent.name}</span>
        </span>
        <span className="agent-status" style={{ '--status-color': agent.status.color } as CSSProperties}><i />{agent.status.label}</span>
        <svg className="agent-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m5 6 3 3 3-3" /></svg>
        <span className="agent-task">{agent.currentTask || agent.assignment}</span>
        <span className="agent-card-footer"><span>{agent.stops.length} tool call{agent.stops.length === 1 ? '' : 's'}</span><span>{agent.updates.length} update{agent.updates.length === 1 ? '' : 's'}</span></span>
      </button>
      {expanded && <div id={detailsId} className="agent-details">
        <dl className="agent-facts">
          <div><dt>Assignment</dt><dd>{agent.assignment}</dd></div>
          <div><dt>Current</dt><dd>{activity}</dd></div>
          {agent.piSessionId && agent.piSessionId !== 'pending' && <div><dt>Session ID</dt><dd className="agent-session-id">{agent.piSessionId}</dd></div>}
        </dl>
        {agent.updates.length > 0 && <section className="agent-detail-section">
          <h3>Updates <span>{agent.updates.length}</span></h3>
          <ol className="agent-updates">{agent.updates.map((update, index) => <li key={`${update.at}-${index}`}><time>{update.at}</time><p>{update.text}</p></li>)}</ol>
        </section>}
        {agent.stops.length > 0 && <section className="agent-detail-section">
          <h3>Tool history <span>{agent.stops.length}</span></h3>
          <ol className="agent-tools">{agent.stops.map((stop, index) => <li key={stop.id} data-status={stop.status}>
            <div className="agent-tool-heading"><span className="agent-tool-number">{String(index + 1).padStart(2, '0')}</span><code>{stop.tool}</code><span className="agent-tool-status">{stop.status === 'running' ? 'Running' : stop.status === 'error' ? 'Failed' : 'Finished'}</span></div>
            {(stop.detail || stop.result) && <div className="agent-tool-content">{stop.detail && <p>{stop.detail}</p>}{stop.result && <p className="agent-tool-result">{stop.result}</p>}</div>}
          </li>)}</ol>
        </section>}
        {agent.artifacts.length > 0 && <section className="agent-detail-section"><h3>Files <span>{agent.artifacts.length}</span></h3><ul className="agent-files">{agent.artifacts.map(artifact => <li key={artifact.path}><code>{artifact.path}</code></li>)}</ul></section>}
        {agent.summary && <section className="agent-detail-section agent-result"><h3>Result</h3><p>{agent.summary}</p></section>}
        {agent.error && <p className="agent-error" role="status">{agent.error}</p>}
        {agent.updates.length === 0 && agent.stops.length === 0 && <p className="agent-no-updates">No updates yet</p>}
      </div>}
    </article>
  );
}

const workerRow = (worker: Worker): AgentRow => ({
  key: `${worker.parentJobId}:${worker.name}`,
  name: worker.name,
  assignment: worker.task,
  status: STATUS[worker.status],
  running: worker.status === 'running',
  queued: worker.status === 'queued',
  startedAt: worker.startedAt,
  currentTask: worker.task,
  stops: worker.stops,
  updates: worker.updates.map((update) => ({ ...update, text: cleanAgentText(update.text) })).filter((update) => update.text),
  artifacts: worker.artifacts,
  piSessionId: worker.piSessionId,
  summary: worker.summary,
  error: worker.error,
});

const primaryRow = (agent: PrimaryAgent): AgentRow => ({
  key: `primary:${agent.sessionId}`,
  name: agent.name,
  assignment: 'Persistent primary agent',
  status: PRIMARY_STATUS[agent.status],
  running: agent.status === 'running',
  queued: agent.status === 'initializing',
  startedAt: agent.startedAt,
  currentTask: agent.currentTask,
  stops: agent.stops,
  updates: agent.updates.map((update) => ({ ...update, text: cleanAgentText(update.text) })).filter((update) => update.text),
  artifacts: agent.artifacts,
  piSessionId: agent.piSessionId,
  summary: null,
  error: agent.error,
});

export function DepartureBoard({ workers, primaryAgent }: { workers: readonly Worker[]; primaryAgent: PrimaryAgent | null }) {
  const active = workers.filter(worker => worker.status === 'running' || worker.status === 'queued').length + (primaryAgent?.status === 'running' || primaryAgent?.status === 'initializing' ? 1 : 0);
  return (
    <section className="agent-board widget-enter" aria-label="Agents">
      <header className="agent-board-header"><div><h2>Agents <span>{workers.length + (primaryAgent ? 1 : 0)}</span></h2></div><span className="agent-board-count">{active} active</span></header>
      {!primaryAgent && workers.length === 0 ? <div className="agent-empty"><span aria-hidden="true">◌</span><p>No agents in this session</p></div> : <div className="agent-list">
        {primaryAgent && <Row key={`primary:${primaryAgent.sessionId}`} agent={primaryRow(primaryAgent)} primary />}
        {workers.map(worker => { const agent = workerRow(worker); return <Row key={agent.key} agent={agent} />; })}
      </div>}
    </section>
  );
}
