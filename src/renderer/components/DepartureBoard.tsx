import { useState } from 'react';
import { isTerminal, type Worker, type WorkerStatus } from '@/shared/worker';

const PALETTE = ['#f97316', '#16a34a', '#0891b2', '#7c5af5'] as const;
const STATUS: Readonly<Record<WorkerStatus, { label: string; color: string }>> = {
  queued: { label: 'Queued', color: '#e08300' },
  running: { label: 'Running', color: '#16a34a' },
  complete: { label: 'Done', color: '#16a34a' },
  failed: { label: 'Failed', color: '#e0263c' },
  cancelled: { label: 'Stopped', color: '#abacb6' },
};
const colourOf = (name: string) => PALETTE[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length];

function Row({ worker }: { worker: Worker }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS[worker.status];
  const hex = colourOf(worker.name);
  const settled = isTerminal(worker.status);
  const current = worker.stops.at(-1);
  const activity = current?.detail || current?.tool || (worker.status === 'queued'
    ? 'Waiting for the agent runtime to begin work.'
    : worker.status === 'complete'
      ? 'Work complete.'
      : 'Waiting for the next update.');
  const hasProgress = worker.updates.length > 0 || worker.stops.length > 0;

  return (
    <div className="border-b border-black/[0.05] last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} details for ${worker.name}`}
        onClick={() => setExpanded((value) => !value)}
        className={`w-full cursor-pointer rounded-xl px-2 py-2.5 text-left transition-colors duration-150 hover:bg-black/[0.03] ${expanded ? 'bg-black/[0.025]' : ''}`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
            style={{ background: `${hex}1a`, color: hex }}
          >
            {worker.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-ink">{current?.detail || current?.tool || worker.task}</p>
            <p className="mt-px truncate text-[10.5px] text-dimmer">{worker.name} · {worker.startedAt}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium" style={{ color: status.color }}>
            <span className={`h-1.5 w-1.5 rounded-full ${worker.status === 'running' ? 'animate-pulse' : ''}`} style={{ background: status.color }} />
            {status.label}
          </span>
        </div>
        {worker.stops.length > 0 && (
          <div className="ml-[34px] mt-1.5 flex flex-wrap gap-1">
            {worker.stops.slice(-4).map((stop, index) => {
              const live = !settled && index === Math.min(3, worker.stops.length - 1);
              return (
                <span
                  key={`${stop.tool}-${index}`}
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
        <div className="ml-[34px] mb-2 rounded-xl bg-black/[0.02] px-3.5 py-3 text-[12px] leading-5 text-dim" style={{ borderLeft: `2px solid ${hex}33` }}>
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <span className="label-xs pt-1 text-dimmer">Assignment</span>
            <p className="break-words text-ink">{worker.task}</p>
            <span className="label-xs pt-1 text-dimmer">Current</span>
            <p className="break-words" style={{ color: worker.status === 'queued' ? '#e08300' : '#71717c' }}>{activity}</p>
            <span className="label-xs pt-1 text-dimmer">State</span>
            <p style={{ color: status.color }}>{status.label} · {worker.stops.length} tool call{worker.stops.length === 1 ? '' : 's'} · {worker.updates.length} report{worker.updates.length === 1 ? '' : 's'}</p>
          </div>

          {!hasProgress && (
            <div className="mt-3 rounded-lg border border-dashed border-black/[0.1] px-3 py-2.5 text-center text-[11px] text-dimmer">
              <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
              Awaiting first update
            </div>
          )}

          {worker.updates.length > 0 && (
            <section className="mt-3 border-t border-black/[0.05] pt-2.5">
              <p className="label-xs mb-1.5 text-dimmer">Updates</p>
              <div className="grid gap-1.5">
                {worker.updates.map((update, index) => <p key={`${update.at}-${index}`}><span className="mr-2 font-mono text-[10px] text-warn">{update.at}</span>{update.text}</p>)}
              </div>
            </section>
          )}

          {worker.stops.length > 0 && (
            <section className="mt-3 border-t border-black/[0.05] pt-2.5">
              <p className="label-xs mb-1.5 text-dimmer">Tool trace</p>
              <div className="grid gap-1.5 font-mono text-[10px]">
                {worker.stops.map((stop, index) => (
                  <div key={`${stop.tool}-${index}`} className="grid grid-cols-[60px_1fr] gap-2">
                    <span style={{ color: stop.status === 'error' ? '#e0263c' : hex }}>{stop.tool}</span>
                    <span className="break-all text-dim">{stop.detail || '—'}{stop.result ? ` · ${stop.result}` : ''}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {worker.summary && <p className="mt-3 border-t border-black/[0.05] pt-2.5 text-live"><span className="label-xs mr-2">Result</span>{worker.summary}</p>}
          {worker.error && <p className="mt-3 text-alert">Error · {worker.error}</p>}
        </div>
      )}
    </div>
  );
}

export function DepartureBoard({ workers }: { workers: readonly Worker[] }) {
  if (workers.length === 0) {
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
    <section className="widget-enter px-1 py-1">
      {workers.map((worker) => <Row key={worker.name} worker={worker} />)}
    </section>
  );
}
