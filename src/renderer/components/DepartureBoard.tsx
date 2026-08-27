import { useState } from 'react';
import { isTerminal, type Worker, type WorkerStatus } from '@/shared/worker';

/** Service colours, in the saturated register an LED board actually shows. */
const PALETTE = ['#ff8c1a', '#46e05a', '#35c8f0', '#a98bff'] as const;

const STATUS: Readonly<Record<WorkerStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'dim' }>> = {
  queued: { label: 'DISPATCHED', tone: 'amber' },
  running: { label: 'IN TRANSIT', tone: 'green' },
  idle: { label: 'ONLINE', tone: 'green' },
  failed: { label: 'FAILED', tone: 'red' },
  cancelled: { label: 'STOPPED', tone: 'dim' },
};

const TONE_HEX = { green: '#46e05a', amber: '#ffa32b', red: '#ff5a4d', dim: '#5d6672' } as const;

const GRID = 'grid grid-cols-[142px_64px_minmax(0,1fr)_minmax(0,1.5fr)_104px] items-center gap-x-5';

/** Stable per-worker colour without threading an index through the model. */
const colourOf = (name: string) =>
  PALETTE[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length];

function Row({ worker }: { worker: Worker }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS[worker.status];
  const hex = colourOf(worker.name);
  const settled = isTerminal(worker.status);
  const amber = settled ? '#8b7a52' : '#ffa32b';
  const current = worker.stops.at(-1);

  return (
    <div className="border-b border-white/[0.06]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={`${GRID} w-full py-3 text-left hover:bg-white/[0.025]`}
      >
        <div className="flex w-fit rounded-[3px] border px-2 py-1" style={{ borderColor: hex, color: hex }}>
          <span className="label-xs led">{worker.name}</span>
        </div>

        <div className="font-mono text-[15px] leading-none tracking-tight" style={{ color: amber }}>
          <span className="led">{worker.startedAt}</span>
        </div>

        <div className="min-w-0">
          <div className="truncate font-mono text-[15px] leading-none" style={{ color: amber }}>
            <span className="led">{current?.detail || current?.tool || worker.task}</span>
          </div>
          <div className="label-xs mt-1.5 truncate text-[#5d6672]">{worker.task}</div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {worker.stops.length === 0 && <span className="label-xs text-[#4b535d]">no steps yet</span>}
          {worker.stops.map((stop, index) => {
            const live = !settled && index === worker.stops.length - 1;
            return (
              <span
                key={`${stop.tool}-${index}`}
                className={`rounded-[2px] px-1.5 py-[3px] font-mono text-[10px] leading-none ${live ? 'text-black' : 'border'}`}
                style={
                  live
                    ? { background: hex }
                    : { borderColor: `${hex}55`, color: settled ? '#5d6672' : hex }
                }
              >
                {stop.tool}
              </span>
            );
          })}
        </div>

        <div
          className="led text-right font-mono text-[11px] leading-none tracking-[0.12em]"
          style={{ color: TONE_HEX[status.tone] }}
        >
          {status.label} <span className="text-[#5d6672]">{expanded ? '−' : '+'}</span>
        </div>
      </button>

      {expanded && (
        <div className="grid gap-3 border-t border-white/[0.04] bg-black/40 px-4 py-4 font-mono text-[11px] text-[#8b95a2]">
          <p><span className="label-xs mr-3 text-[#5d6672]">TASK</span>{worker.task}</p>
          {worker.updates.length > 0 && (
            <div className="grid gap-2 border-y border-white/[0.05] py-3">
              {worker.updates.map((update, index) => (
                <p key={`${update.at}-${index}`} className="text-led-pale">
                  <span className="mr-3 text-[#5d6672]">{update.at}</span>{update.text}
                </p>
              ))}
            </div>
          )}
          {worker.stops.map((stop, index) => (
            <div key={`${stop.tool}-detail-${index}`} className="grid grid-cols-[72px_1fr] gap-x-3">
              <span style={{ color: stop.status === 'error' ? '#ff5a4d' : hex }}>{stop.tool}</span>
              <span className="break-all text-[#8b95a2]">{stop.detail || '—'}</span>
              {stop.result && <span className="col-start-2 mt-1 break-all text-[#5d6672]">↳ {stop.result}</span>}
            </div>
          ))}
          {worker.summary && <p className="text-led-green"><span className="label-xs mr-3">RESULT</span>{worker.summary}</p>}
          {worker.error && <p className="text-alert"><span className="label-xs mr-3">ERROR</span>{worker.error}</p>}
        </div>
      )}
    </div>
  );
}

export function DepartureBoard({ workers }: { workers: readonly Worker[] }) {
  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-hairline bg-[#04060a]">
      <div className="board-scan pointer-events-none absolute inset-0 z-10" />

      <div className={`${GRID} relative border-b border-white/[0.07] px-6 pt-4 pb-3`}>
        <span className="label-xs text-[#8b95a2]">WORKER</span>
        <span className="label-xs text-[#5d6672]">TIME</span>
        <span className="label-xs text-[#5d6672]">DOING</span>
        <span className="label-xs text-[#5d6672]">STEPS</span>
        <span className="label-xs text-right text-[#5d6672]">STATUS</span>
      </div>

      <div className="app-scroll relative min-h-0 flex-1 overflow-y-auto px-6 pb-3">
        {workers.length === 0 ? (
          <div className="grid h-full place-items-center">
            <span className="label-xs text-[#4b535d]">no workers dispatched</span>
          </div>
        ) : (
          workers.map((worker) => <Row key={worker.name} worker={worker} />)
        )}
      </div>
    </section>
  );
}
