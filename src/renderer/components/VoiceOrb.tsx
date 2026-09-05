import { useId, type CSSProperties } from 'react';

export type VoiceOrbState = 'off' | 'connecting' | 'idle' | 'listening' | 'speaking';

/** Layered light surfaces keep their shape while real audio modulates their height. */
export function VoiceOrb({ state, level = 0 }: { state: VoiceOrbState; level?: number }) {
  const id = useId().replace(/:/g, '');
  const gradient = `${id}-spectrum`;
  const glow = `${id}-glow`;
  const haze = `${id}-haze`;
  return (
    <span className="orb" data-state={state} style={{ '--amp': Math.max(0, Math.min(1, level)) } as CSSProperties}>
      <svg className="light-ribbon" viewBox="0 0 360 180" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradient} x1="40" y1="100" x2="310" y2="75" gradientUnits="userSpaceOnUse">
            <stop stopColor="#427aff" stopOpacity="0" />
            <stop offset=".23" stopColor="#536aff" />
            <stop offset=".48" stopColor="#b58dff" />
            <stop offset=".64" stopColor="#f2c8f3" />
            <stop offset=".8" stopColor="#86eeed" />
            <stop offset="1" stopColor="#6adbdc" stopOpacity="0" />
          </linearGradient>
          <filter id={glow} x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="5" /></filter>
          <filter id={haze} x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="16" /></filter>
        </defs>
        <g className="ribbon-energy">
          <path d="M28 104C85 111 100 42 161 57C222 72 228 128 332 86C255 146 215 128 169 105C112 79 76 122 28 104Z" fill={`url(#${gradient})`} filter={`url(#${haze})`} opacity=".8" />
          <g className="ribbon-back">
            <path d="M26 104C89 115 102 39 161 57C219 75 239 118 335 85C270 126 223 131 167 93C112 60 84 120 26 104Z" fill={`url(#${gradient})`} opacity=".55" />
            <path d="M26 104C89 115 102 39 161 57C219 75 239 118 335 85" stroke={`url(#${gradient})`} strokeWidth="1.2" />
          </g>
          <g className="ribbon-front">
            <path d="M25 105C89 88 115 128 168 109C226 88 238 67 335 85C258 80 242 117 181 126C115 135 91 98 25 105Z" fill={`url(#${gradient})`} opacity=".8" />
            <path d="M25 105C89 88 115 128 168 109C226 88 238 67 335 85" stroke={`url(#${gradient})`} strokeWidth="3" filter={`url(#${glow})`} />
            <path d="M25 105C89 88 115 128 168 109C226 88 238 67 335 85" stroke={`url(#${gradient})`} strokeWidth="1.5" />
          </g>
        </g>
      </svg>
    </span>
  );
}
