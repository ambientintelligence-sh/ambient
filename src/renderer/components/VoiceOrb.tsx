import { useEffect, useId, useRef } from 'react';

export type VoiceOrbState = 'off' | 'connecting' | 'idle' | 'listening' | 'speaking';

/** A continuous horizon whose amplitude and contours follow the live audio meter. */
export function VoiceOrb({ state, level = 0 }: { state: VoiceOrbState; level?: number }) {
  const id = useId().replace(/:/g, '');
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const input = useRef({ state, level });
  input.current = { state, level };

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let amplitude = 0;
    const draw = (time: number) => {
      const { state, level } = input.current;
      const active = state !== 'off';
      amplitude += (Math.max(0, Math.min(1, level)) - amplitude) * .18;
      const phase = reduced.matches ? 0 : time / 1500;
      paths.current.forEach((path, layer) => {
        if (!path) return;
        const points = Array.from({ length: 121 }, (_, index) => {
          const x = index / 120;
          const envelope = .22 + .78 * Math.sin(Math.PI * x);
          const wave = Math.sin(x * Math.PI * (4 + layer * .8) - phase * (1 + layer * .15))
            + .35 * Math.sin(x * Math.PI * 11 + phase * 1.7 + layer);
          const height = (active ? 13 : 5) + amplitude * (reduced.matches ? 15 : 57);
          return `${index ? 'L' : 'M'}${(x * 1200).toFixed(1)},${(95 + wave * height * envelope * (1 - layer * .12)).toFixed(1)}`;
        }).join(' ');
        path.setAttribute('d', points);
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="voice-horizon" data-state={state} aria-hidden="true">
      <svg viewBox="0 0 1200 190" preserveAspectRatio="none" fill="none">
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop stopColor="#edab80" /><stop offset=".25" stopColor="#e8a0c9" />
            <stop offset=".5" stopColor="#b5a2f4" /><stop offset=".75" stopColor="#9bdde9" />
            <stop offset="1" stopColor="#edb395" />
          </linearGradient>
          <filter id={`${id}-blur`} x="-10%" y="-100%" width="120%" height="300%"><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
        {[0, 1, 2, 3].map(layer => <path key={layer} ref={node => { paths.current[layer] = node; }} stroke={`url(#${id})`} strokeWidth={layer === 3 ? 18 : 1.5} opacity={layer === 3 ? .45 : 1 - layer * .23} filter={layer === 3 ? `url(#${id}-blur)` : undefined} />)}
      </svg>
    </div>
  );
}
