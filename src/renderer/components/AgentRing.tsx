import type { Agent, AgentPhase } from '../fleet';
import { TINT, type TintKey } from './tints';

const PHASE_LABEL: Readonly<Record<AgentPhase, string>> = {
  idle: 'standby',
  briefed: 'briefed',
  working: 'working',
  reporting: 'reporting',
  done: 'done',
  blocked: 'blocked',
};

/** One agent, drawn as an air-vent ring. Fill and colour carry the phase. */
export function AgentRing({ agent }: { agent: Agent }) {
  const key: TintKey = agent.phase === 'blocked' ? 'alert' : agent.phase === 'idle' ? 'dim' : agent.tint;
  const tone = TINT[key];
  const live = agent.phase === 'working' || agent.phase === 'briefed';

  return (
    <div className="flex w-[92px] flex-col items-center gap-2">
      <div
        className={`relative grid h-[42px] w-[42px] place-items-center rounded-full border-2 ${tone.border}`}
        style={live ? { boxShadow: `0 0 14px -2px ${tone.hex}` } : undefined}
      >
        <span
          className={`block rounded-full ${tone.fill} ${live ? 'h-2.5 w-2.5 animate-[breathe_1.4s_ease-in-out_infinite]' : 'h-1.5 w-1.5'} ${
            agent.phase === 'idle' ? 'opacity-40' : ''
          }`}
        />
      </div>
      <div className="text-center">
        <div className="label-xs text-ink">{agent.name}</div>
        <div className={`label-xs mt-1 ${tone.text} ${agent.phase === 'idle' ? 'opacity-70' : ''}`}>
          {PHASE_LABEL[agent.phase]}
        </div>
      </div>
    </div>
  );
}
