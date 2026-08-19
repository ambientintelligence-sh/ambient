import type { Agent, AgentPhase, LineColor } from '../fleet';

/** Service colours, in the saturated register an LED board actually shows. */
const SERVICE_HEX: Readonly<Record<LineColor, string>> = {
  chuo: '#ff8c1a',
  yamanote: '#46e05a',
  keihin: '#35c8f0',
  hanzomon: '#a98bff',
};

const STATUS: Readonly<Record<AgentPhase, { label: string; tone: 'green' | 'amber' | 'red' | 'dim' }>> = {
  idle: { label: 'STANDBY', tone: 'dim' },
  briefed: { label: 'DEPARTING', tone: 'amber' },
  working: { label: 'IN TRANSIT', tone: 'green' },
  reporting: { label: 'ARRIVING', tone: 'green' },
  done: { label: 'ARRIVED', tone: 'dim' },
  blocked: { label: 'DELAYED', tone: 'red' },
};

const TONE_HEX = { green: '#46e05a', amber: '#ffa32b', red: '#ff5a4d', dim: '#5d6672' } as const;

const GRID = 'grid grid-cols-[142px_64px_minmax(0,1fr)_minmax(0,1.5fr)_104px] items-center gap-x-5';

function Row({ agent }: { agent: Agent }) {
  const status = STATUS[agent.phase];
  const hex = SERVICE_HEX[agent.tint];
  const idle = agent.phase === 'idle';
  const held = agent.phase === 'blocked';
  const running = agent.phase === 'working' || agent.phase === 'briefed';
  const amber = idle ? '#4b535d' : '#ffa32b';

  return (
    <div className={`${GRID} border-t border-white/[0.06] py-3`}>
      <div
        className="flex w-fit rounded-[3px] border px-2 py-1"
        style={{ borderColor: idle ? '#39414b' : hex, color: idle ? '#5d6672' : hex }}
      >
        <span className={`label-xs ${idle ? '' : 'led'}`}>{agent.name}</span>
      </div>

      <div className="font-mono text-[15px] leading-none tracking-tight" style={{ color: amber }}>
        <span className={idle ? '' : 'led'}>{agent.departedAt ?? '--:--'}</span>
      </div>

      <div className="min-w-0">
        <div className="truncate font-mono text-[15px] leading-none" style={{ color: amber }}>
          <span className={idle ? '' : 'led'}>{agent.tool ?? (idle ? '—' : agent.route[agent.route.length - 1])}</span>
        </div>
        <div className="label-xs mt-1.5 truncate text-[#5d6672]">{agent.role}</div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {agent.route.map((stop, index) => {
          const passed = agent.phase === 'done' || index < agent.step;
          const here = (running || held) && index === agent.step;

          if (here) {
            return (
              <span
                key={stop}
                className="rounded-[2px] px-1.5 py-[3px] font-mono text-[10px] leading-none text-black"
                style={{ background: held ? '#ff5a4d' : hex }}
              >
                {stop}
              </span>
            );
          }
          return (
            <span
              key={stop}
              className="rounded-[2px] border px-1.5 py-[3px] font-mono text-[10px] leading-none"
              style={{ borderColor: passed ? `${hex}66` : '#2c333c', color: passed ? hex : '#4b535d' }}
            >
              {stop}
            </span>
          );
        })}
      </div>

      <div
        className={`text-right font-mono text-[11px] leading-none tracking-[0.12em] ${idle ? '' : 'led'}`}
        style={{ color: TONE_HEX[status.tone] }}
      >
        {status.label}
      </div>
    </div>
  );
}

export function DepartureBoard({ agents, notice }: { agents: readonly Agent[]; notice: string }) {
  return (
    <section className="relative mt-8 overflow-hidden rounded-2xl border border-hairline bg-[#04060a]">
      <div className="board-scan pointer-events-none absolute inset-0 z-10" />

      <div className="relative px-6 pt-4 pb-3">
        <div className={`${GRID} pb-2.5`}>
          <span className="label-xs text-[#8b95a2]">SERVICE</span>
          <span className="label-xs text-[#5d6672]">TIME</span>
          <span className="label-xs text-[#5d6672]">DESTINATION</span>
          <span className="label-xs text-[#5d6672]">STOPS</span>
          <span className="label-xs text-right text-[#5d6672]">STATUS</span>
        </div>

        {agents.map((agent) => (
          <Row key={agent.id} agent={agent} />
        ))}
      </div>

      <div className="relative flex h-7 items-center overflow-hidden border-t border-white/[0.06] bg-[#02040a]">
        <div className="flex w-max animate-[marquee_32s_linear_infinite] whitespace-nowrap will-change-transform">
          {[0, 1].map((copy) => (
            <span key={copy} className="led px-8 font-mono text-[11px] leading-none text-led-green">
              {notice}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
