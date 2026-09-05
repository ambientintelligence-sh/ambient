import { cleanAgentText } from '@/shared/live-activity';
import { useId, useState, type CSSProperties } from 'react';
import type { PrimaryAgent, PrimaryAgentStatus, Worker, WorkerStatus } from '@/shared/worker';

const PALETTE = ['#244bd8', '#107d66', '#65277d', '#ac3228'] as const;
const STATUS: Readonly<Record<WorkerStatus, { label: string }>> = {
  queued: { label: 'Queued' }, running: { label: 'Running' }, complete: { label: 'Done' },
  failed: { label: 'Failed' }, cancelled: { label: 'Stopped' },
};
const PRIMARY_STATUS: Readonly<Record<PrimaryAgentStatus, { label: string }>> = {
  initializing: { label: 'Starting' }, idle: { label: 'Ready' }, running: { label: 'Running' },
};
const colourOf = (name: string) => PALETTE[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length];

type AgentRow = Readonly<{
  key: string;
  name: string;
  assignment: string;
  status: { label: string };
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

function Row({ agent }: { agent: AgentRow }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const current = [...agent.stops].reverse().find((stop) => stop.status === 'running') ?? agent.stops.at(-1);
  const activity = agent.running || agent.queued
    ? current?.detail || current?.tool || agent.currentTask || 'Getting started.'
    : agent.summary || (agent.status.label === 'Done' ? 'Work complete.' : agent.status.label === 'Failed' ? agent.error || 'Something went wrong.' : agent.status.label === 'Stopped' ? 'Work stopped.' : 'Ready for the next request.');
  return (
    <article className="agent-folder" style={{ '--agent-color': colourOf(agent.name) } as CSSProperties}>
      <button type="button" className="agent-cover" aria-expanded={expanded} aria-controls={detailsId}
        aria-label={`${expanded ? 'Hide' : 'Show'} details for ${agent.name}`} onClick={() => setExpanded(value => !value)}>
        <div className="agent-folder-tab"><h3>{agent.name}</h3><span aria-hidden="true">{expanded ? '−' : '+'}</span></div>
        <div className="agent-cover-body">
          <div className="agent-cover-meta"><span>{agent.key.startsWith('primary:') ? 'Primary agent' : 'Delegated agent'} · {agent.startedAt}</span><span className="agent-status" data-status={agent.status.label}>{agent.status.label}</span></div>
          <p className="agent-assignment">{agent.currentTask || agent.assignment}</p>
          <div className="agent-cover-bottom"><span>{agent.stops.length} tool calls / {agent.updates.length} updates</span><span>Details {expanded ? '↑' : '↓'}</span></div>
        </div>
      </button>
      {expanded && <div id={detailsId} className="agent-details">
        <dl className="agent-facts">
          <dt>Assignment</dt><dd>{agent.assignment}</dd>
          {agent.currentTask && agent.currentTask !== agent.assignment && <><dt>Task</dt><dd>{agent.currentTask}</dd></>}
          <dt>Current</dt><dd>{activity}</dd>
          {agent.piSessionId && agent.piSessionId !== 'pending' && <><dt>Session</dt><dd className="agent-session-id">{agent.piSessionId}</dd></>}
        </dl>
        {!agent.updates.length && !agent.stops.length && <p className="agent-awaiting">Updates will appear here when work begins.</p>}
        {agent.updates.length > 0 && <section className="agent-detail-section"><h4>Updates <span>{agent.updates.length}</span></h4><ol className="agent-updates">
          {agent.updates.map((update, index) => <li key={`${update.at}-${index}`}><time>{update.at}</time><p>{update.text}</p></li>)}
        </ol></section>}
        {agent.stops.length > 0 && <section className="agent-detail-section"><h4>Tool trace <span>{agent.stops.length}</span></h4><ol className="agent-trace">
          {agent.stops.map(stop => <li key={stop.id}><span className="agent-tool" data-error={stop.status === 'error'}>{stop.tool}</span><p>{stop.detail || '—'}{stop.result ? ` · ${stop.result}` : ''}</p></li>)}
        </ol></section>}
        {agent.artifacts.length > 0 && <section className="agent-detail-section"><h4>Artifacts</h4>{agent.artifacts.map(artifact => <p className="agent-artifact" key={artifact.path}>{artifact.path}</p>)}</section>}
        {agent.summary && <section className="agent-detail-section"><h4>Result</h4><p>{agent.summary}</p></section>}
        {agent.error && <p className="agent-error">Error · {agent.error}</p>}
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
  if (!primaryAgent && workers.length === 0) {
    return (
      <section className="agents-empty">
        <div className="agents-empty-shapes" aria-hidden="true"><span /><span /><span /></div>
        <p>Your team, in motion.</p>
        <h2>A little help.<br />A lot of possibility.</h2>
        <p>Start a conversation. Your agents and their<br />progress will appear here as they work.</p>
      </section>
    );
  }
  return (
    <section className="agent-board widget-enter" aria-label="Agents">
      {primaryAgent && <Row key={`primary:${primaryAgent.sessionId}`} agent={primaryRow(primaryAgent)} />}
      {workers.map((worker) => {
        const agent = workerRow(worker);
        return <Row key={agent.key} agent={agent} />;
      })}
    </section>
  );
}
