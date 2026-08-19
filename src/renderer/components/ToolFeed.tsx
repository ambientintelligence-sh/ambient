import type { ToolCall } from '../fleet';
import { TINT } from './tints';

export function ToolFeed({ calls }: { calls: readonly ToolCall[] }) {
  if (calls.length === 0) {
    return <p className="label-xs text-dimmer">no tool activity</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {calls.slice(0, 4).map((call) => {
        const tone = TINT[call.status === 'failed' ? 'alert' : call.tint];
        return (
          <li key={call.id} className="flex items-center gap-2 font-mono text-[11px] leading-none">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.fill} ${
                call.status === 'running' ? 'animate-[breathe_1.2s_ease-in-out_infinite]' : 'opacity-45'
              }`}
            />
            <span className={call.status === 'running' ? 'text-ink' : 'text-dim'}>{call.tool}</span>
            <span className="label-xs ml-auto text-dimmer">{call.status}</span>
          </li>
        );
      })}
    </ul>
  );
}
