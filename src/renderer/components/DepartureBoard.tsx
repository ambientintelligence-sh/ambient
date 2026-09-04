import { useState } from 'react';
import type { PrimaryAgent, PrimaryAgentStatus, Worker, WorkerStatus } from '@/shared/worker';

const PALETTE = ['#f97316', '#16a34a', '#0891b2', '#7c5af5'] as const;
const STATUS: Readonly<Record<WorkerStatus, { label: string; color: string }>> = {
  queued: { label: 'Queued', color: '#e08300' },
  running: { label: 'Running', color: '#16a34a' },
  complete: { label: 'Done', color: '#16a34a' },
  failed: { label: 'Failed', color: '#e0263c' },
  cancelled: { label: 'Stopped', color: '#abacb6' },
};
const PRIMARY_STATUS: Readonly<Record<PrimaryAgentStatus, { label: string; color: string }>> = {
  initializing: { label: 'Starting', color: '#e08300' },
  idle: { label: 'Ready', color: '#7c5af5' },
  running: { label: 'Running', color: '#16a34a' },
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

function Row({ agent }: { agent: AgentRow }) {
  const [expanded, setExpanded] = useState(false);
  const hex = colourOf(agent.name);
  const current = [...agent.stops].reverse().find((stop) => stop.status === 'running') ?? agent.stops.at(-1);
  const activity = current?.detail || current?.tool || agent.currentTask || (agent.queued
    ? 'Waiting for the agent runtime to begin work.'
    : agent.status.label === 'Done'
      ? 'Work complete.'
      : agent.running ? 'Working on the current request.' : 'Ready for the next request.');
  const hasProgress = agent.updates.length > 0 || agent.stops.length > 0;

  return (
    <div className="min-w-0 border-b border-black/[0.05] last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} details for ${agent.name}`}
        onClick={() => setExpanded((value) => !value)}
        className={`w-full min-w-0 cursor-pointer rounded-xl px-2 py-2.5 text-left transition-colors duration-150 hover:bg-black/[0.03] ${expanded ? 'bg-black/[0.025]' : ''}`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
            style={{ background: `${hex}1a`, color: hex }}
          >
            {agent.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-ink">{current?.detail || current?.tool || agent.currentTask || agent.assignment}</p>
            <p className="mt-px truncate text-[10.5px] text-dimmer">{agent.name} · {agent.startedAt}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium" style={{ color: agent.status.color }}>
            <span className={`h-1.5 w-1.5 rounded-full ${agent.running ? 'animate-pulse' : ''}`} style={{ background: agent.status.color }} />
            {agent.status.label}
          </span>
        </div>
        {agent.stops.length > 0 && (
          <div className="ml-[34px] mt-1.5 flex flex-wrap gap-1">
            {agent.stops.slice(-4).map((stop) => {
              const live = stop.status === 'running';
              return (
                <span
                  key={stop.id}
                  className="rounded-full px-1.5 py-px font-mono text-[9px]"
                  style={live ? { background: `${hex}1a`, color: hex } : { background: 'rgb(20 22 30 / 0.045)', color: '#abacb6' }}
                >
                  {stop.tool}
                </span>
              );
            })}
          </div>
        )}
      </button>

      {expanded && (
        <div className="mb-2 min-w-0 rounded-xl bg-black/[0.02] px-3.5 py-3 text-[12px] leading-5 text-dim" style={{ borderLeft: `2px solid ${hex}33` }}>
          <div className="grid min-w-0 grid-cols-[68px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <span className="label-xs pt-1 text-dimmer">Assignment</span>
            <p className="min-w-0 break-words text-ink">{agent.assignment}</p>
            <span className="label-xs pt-1 text-dimmer">Current</span>
            <p className="min-w-0 break-words" style={{ color: agent.queued ? '#e08300' : '#71717c' }}>{activity}</p>
            <span className="label-xs pt-1 text-dimmer">State</span>
            <p className="min-w-0 break-words" style={{ color: agent.status.color }}>{agent.status.label} · {agent.stops.length} tool call{agent.stops.length === 1 ? '' : 's'} · {agent.updates.length} update{agent.updates.length === 1 ? '' : 's'}</p>
            {agent.piSessionId && agent.piSessionId !== 'pending' && <><span className="label-xs pt-1 text-dimmer">Session</span><p className="min-w-0 truncate font-mono text-[10px]">{agent.piSessionId}</p></>}
          </div>

          {!hasProgress && (
            <div className="mt-3 rounded-lg border border-dashed border-black/[0.1] px-3 py-2.5 text-center text-[11px] text-dimmer">
              <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
              Awaiting first update
            </div>
          )}

          {agent.updates.length > 0 && (
            <section className="mt-3 border-t border-black/[0.05] pt-2.5">
              <p className="label-xs mb-1.5 text-dimmer">Updates</p>
              <div className="grid gap-1.5">
                {agent.updates.map((update, index) => <p key={`${update.at}-${index}`} className="min-w-0 break-words"><span className="mr-2 font-mono text-[10px] text-warn">{update.at}</span>{update.text}</p>)}
              </div>
            </section>
          )}

          {agent.stops.length > 0 && (
            <section className="mt-3 border-t border-black/[0.05] pt-2.5">
              <p className="label-xs mb-1.5 text-dimmer">Tool trace</p>
              <div className="grid gap-1.5 font-mono text-[10px]">
                {agent.stops.map((stop) => (
                  <div key={stop.id} className="grid min-w-0 grid-cols-[60px_minmax(0,1fr)] gap-2">
                    <span style={{ color: stop.status === 'error' ? '#e0263c' : hex }}>{stop.tool}</span>
                    <span className="break-all text-dim">{stop.detail || '—'}{stop.result ? ` · ${stop.result}` : ''}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {agent.artifacts.length > 0 && (
            <section className="mt-3 border-t border-black/[0.05] pt-2.5">
              <p className="label-xs mb-1.5 text-dimmer">Artifacts</p>
              {agent.artifacts.map((artifact) => <p key={artifact.path} className="truncate font-mono text-[10px] text-link">{artifact.path}</p>)}
            </section>
          )}
          {agent.summary && <p className="mt-3 border-t border-black/[0.05] pt-2.5 text-live"><span className="label-xs mr-2">Result</span>{agent.summary}</p>}
          {agent.error && <p className="mt-3 text-alert">Error · {agent.error}</p>}
        </div>
      )}
    </div>
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
  updates: worker.updates,
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
  updates: agent.updates,
  artifacts: agent.artifacts,
  piSessionId: agent.piSessionId,
  summary: null,
  error: agent.error,
});

export function DepartureBoard({ workers, primaryAgent }: { workers: readonly Worker[]; primaryAgent: PrimaryAgent | null }) {
  if (!primaryAgent && workers.length === 0) {
    return (
      <div className="grid place-items-center py-24 text-center">
        <div>
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-black/[0.04] text-[15px] text-dimmer">◌</div>
          <p className="mt-3 text-[13px] font-medium text-ink">No active agents</p>
          <p className="mt-1 text-[11.5px] text-dim">Delegated work will show up here as it runs.</p>
        </div>
      </div>
    );
  }
  return (
    <section className="widget-enter min-w-0 max-w-full px-1 py-1">
      {primaryAgent && <Row key={`primary:${primaryAgent.sessionId}`} agent={primaryRow(primaryAgent)} />}
      {workers.map((worker) => {
        const agent = workerRow(worker);
        return <Row key={agent.key} agent={agent} />;
      })}
    </section>
  );
}
