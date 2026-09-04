export type VoiceOrbState = 'off' | 'connecting' | 'idle' | 'listening' | 'speaking';

const BARS = 23;
const BAR_WIDTH = 3;
const BAR_GAP = 3;
const BAR_MAX = 22;
const BAR_MIN = 3;
const CENTER = (BARS - 1) / 2;
const FALLOFF = 4.6;
const VIEWBOX_HEIGHT = 30;
const WAVE_WIDTH = BARS * (BAR_WIDTH + BAR_GAP) - BAR_GAP;

const fract = (n: number) => n - Math.floor(n);
const seed = (index: number) => fract(Math.sin((index + 1) * 12.9898) * 43758.5453);
const envelope = (index: number) =>
  Math.exp(-(((index - CENTER) ** 2) / (2 * FALLOFF * FALLOFF)));

function Waveform({ state }: { state: VoiceOrbState }) {
  return (
    <svg
      width={WAVE_WIDTH}
      height={VIEWBOX_HEIGHT}
      viewBox={`0 0 ${WAVE_WIDTH} ${VIEWBOX_HEIGHT}`}
      className="wave"
      aria-hidden="true"
    >
      {Array.from({ length: BARS }, (_, index) => {
        const s = seed(index);
        const h = BAR_MIN + (BAR_MAX - BAR_MIN) * envelope(index) * (0.55 + 0.45 * s);
        return (
          <rect
            key={index}
            x={index * (BAR_WIDTH + BAR_GAP)}
            y={(VIEWBOX_HEIGHT - h) / 2}
            width={BAR_WIDTH}
            height={h}
            rx={BAR_WIDTH / 2}
            className="wave-bar"
            fill={state === 'speaking' || state === 'connecting' ? '#0a6cff' : '#1c1c22'}
            style={{
              animationDuration: `${(0.9 + s * 1.1).toFixed(2)}s`,
              animationDelay: `${(-s * 2).toFixed(2)}s`,
            }}
          />
        );
      })}
    </svg>
  );
}

export function VoiceOrb({ state, level = 0 }: { state: VoiceOrbState; level?: number }) {
  const amp = Math.max(0.05, Math.min(1, level));
  return (
    <span
      role="img"
      aria-label={
        state === 'listening' ? 'Listening'
          : state === 'speaking' ? 'Speaking'
          : state === 'connecting' ? 'Connecting voice'
          : state === 'idle' ? 'Voice ready'
          : 'Voice off'
      }
      data-state={state}
      className="orb"
      style={{ '--amp': amp.toFixed(3) } as React.CSSProperties}
    >
      <Waveform state={state} />
    </span>
  );
}
