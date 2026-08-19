import { TINT, type TintKey } from './tints';

type SparklineProps = {
  trace: readonly number[];
  unit: string;
  tint: TintKey;
};

const W = 168;
const H = 34;

export function Sparkline({ trace, unit, tint }: SparklineProps) {
  const hex = TINT[tint].hex;
  const step = W / Math.max(1, trace.length - 1);
  const points = trace.map((value, index) => `${(index * step).toFixed(1)},${(H - value * (H - 3) - 1.5).toFixed(1)}`).join(' ');

  return (
    <div className="relative">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={W}
            y1={H * fraction}
            y2={H * fraction}
            stroke="currentColor"
            className="text-white/5"
            strokeWidth={1}
          />
        ))}
        <polyline points={points} fill="none" stroke={hex} strokeWidth={1.25} strokeLinejoin="round" />
        <line x1={W} x2={W} y1={-2} y2={H + 2} stroke="#ff4d4d" strokeWidth={1} />
      </svg>
      <span className="label-xs absolute -bottom-[18px] right-0 text-dimmer">{unit}</span>
    </div>
  );
}
