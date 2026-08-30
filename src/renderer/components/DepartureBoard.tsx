import { useState } from 'react';
import { isTerminal, type Worker, type WorkerStatus } from '@/shared/worker';

const PALETTE = ['#ff8c1a', '#46e05a', '#35c8f0', '#a98bff'] as const;
const STATUS: Readonly<Record<WorkerStatus, { label: string; color: string }>> = {
  queued: { label: 'DUE', color: '#ffa32b' }, running: { label: 'IN TRANSIT', color: '#46e05a' },
  idle: { label: 'ARRIVED', color: '#46e05a' }, failed: { label: 'CANCELLED', color: '#ff5a4d' }, cancelled: { label: 'STOPPED', color: '#5d6672' },
};
const colourOf = (name: string) => PALETTE[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length];

function Row({ worker, onDisplay }: { worker: Worker; onDisplay: (worker: Worker) => void }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS[worker.status];
  const hex = colourOf(worker.name);
  const settled = isTerminal(worker.status);
  const current = worker.stops.at(-1);
  const activity = current?.detail || current?.tool || (worker.status === 'queued'
    ? 'Waiting for the agent runtime to begin work.'
    : worker.status === 'idle'
      ? 'Work complete.'
      : 'Waiting for the next field report.');
  const hasProgress = worker.updates.length > 0 || worker.stops.length > 0;

  return (
    <div className="border-b border-white/[0.06] last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} details for ${worker.name}`}
        onClick={() => setExpanded((value) => !value)}
        className={`w-full cursor-pointer px-3 py-3 text-left transition-colors hover:bg-white/[0.035] ${expanded ? 'bg-white/[0.025]' : ''}`}
      >
        <div className="grid grid-cols-[76px_minmax(0,1fr)_76px] items-start gap-3">
          <div>
            <p className="font-mono text-[13px] text-warn led">{worker.startedAt}</p>
            <span className="mt-2 inline-block rounded-[2px] border px-1.5 py-1 label-xs led" style={{ borderColor: hex, color: hex }}>{worker.name}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] text-led-pale">{current?.detail || current?.tool || worker.task}</p>
            <p className="mt-2 line-clamp-2 font-mono text-[10px] leading-4 text-[#5d6672]">{worker.task}</p>
            {worker.stops.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{worker.stops.slice(-4).map((stop, index) => { const live = !settled && index === Math.min(3, worker.stops.length - 1); return <span key={`${stop.tool}-${index}`} className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[8px] ${live ? 'led' : ''}`} style={{ borderColor: `${hex}55`, color: live ? hex : '#5d6672' }}>{stop.tool}</span>; })}</div>}
          </div>
          <p className="text-right font-mono text-[9px] leading-4 tracking-[0.08em] led" style={{ color: status.color }}>{status.label}<br /><span className={expanded ? 'text-warn' : 'text-[#5d6672]'}>{expanded ? '− CLOSE' : '+ DETAILS'}</span></p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.08] bg-[#07090c] px-4 py-4 font-mono text-[10px] leading-5 text-[#8b95a2]" style={{ borderLeft: `2px solid ${hex}` }}>
          <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-x-3 gap-y-3">
            <span className="label-xs pt-1 text-[#5d6672]">ASSIGNMENT</span>
            <p className="break-words text-led-pale">{worker.task}</p>
            <span className="label-xs pt-1 text-[#5d6672]">CURRENT</span>
            <p className="break-words" style={{ color: worker.status === 'queued' ? '#ffa32b' : '#8b95a2' }}>{activity}</p>
            <span className="label-xs pt-1 text-[#5d6672]">STATE</span>
            <p className="led" style={{ color: status.color }}>{status.label} · {worker.stops.length} TOOL CALL{worker.stops.length === 1 ? '' : 'S'} · {worker.updates.length} REPORT{worker.updates.length === 1 ? '' : 'S'}</p>
          </div>

          {!hasProgress && (
            <div className="mt-4 rounded border border-dashed border-white/10 px-3 py-3 text-center text-[#5d6672]">
              <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
              AWAITING FIRST FIELD REPORT
            </div>
          )}

          {worker.updates.length > 0 && (
            <section className="mt-4 border-t border-white/[0.06] pt-3">
              <p className="label-xs mb-2 text-[#5d6672]">FIELD REPORTS</p>
              <div className="grid gap-2">
                {worker.updates.map((update, index) => <p key={`${update.at}-${index}`}><span className="mr-2 text-warn">{update.at}</span>{update.text}</p>)}
              </div>
            </section>
          )}

          {worker.stops.length > 0 && (
            <section className="mt-4 border-t border-white/[0.06] pt-3">
              <p className="label-xs mb-2 text-[#5d6672]">TOOL TRACE</p>
              <div className="grid gap-2">
                {worker.stops.map((stop, index) => <div key={`${stop.tool}-${index}`} className="grid grid-cols-[64px_1fr] gap-2"><span style={{ color: stop.status === 'error' ? '#ff5a4d' : hex }}>{stop.tool}</span><span className="break-all">{stop.detail || '—'}{stop.result ? ` · ${stop.result}` : ''}</span></div>)}
              </div>
            </section>
          )}

          {worker.summary && <p className="mt-4 border-t border-white/[0.06] pt-3 text-live"><span className="mr-2">RESULT</span>{worker.summary}</p>}
          {worker.displays.length > 0 && <button type="button" onClick={() => onDisplay(worker)} className="mt-4 w-fit rounded border border-warn/40 px-3 py-2 label-xs text-warn hover:bg-warn/10">VIEW LATEST WIDGET</button>}
          {worker.error && <p className="mt-4 text-alert">ERROR · {worker.error}</p>}
        </div>
      )}
    </div>
  );
}

export function DepartureBoard({ workers, onDisplay }: { workers: readonly Worker[]; onDisplay: (worker: Worker) => void }) {
  return (
    <section className="board-scan relative min-h-[300px] overflow-hidden rounded-xl border border-white/[0.09] bg-[#04060a]">
      <div className="grid grid-cols-[76px_minmax(0,1fr)_76px] gap-3 border-b border-white/[0.07] px-3 py-3">
        <span className="label-xs text-[#5d6672]">TIME / AGENT</span><span className="label-xs text-[#5d6672]">DESTINATION / ACTIVITY</span><span className="label-xs text-right text-[#5d6672]">STATUS</span>
      </div>
      {workers.length === 0 ? <div className="grid min-h-[250px] place-items-center text-center"><div><p className="font-mono text-[20px] text-[#333a43]">— — —</p><p className="label-xs mt-3 text-[#4b535d]">NO SERVICES DEPARTED</p></div></div> : workers.map((worker) => <Row key={worker.name} worker={worker} onDisplay={onDisplay} />)}
    </section>
  );
}
