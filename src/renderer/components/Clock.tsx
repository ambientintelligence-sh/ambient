import { useEffect, useState } from 'react';

/** Minimal analog clock that anchors the top-right of the cluster. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;

  const hand = (angle: number, length: number, width: number, color: string) => {
    const radians = ((angle - 90) * Math.PI) / 180;
    return (
      <line
        x1={50}
        y1={50}
        x2={50 + Math.cos(radians) * length}
        y2={50 + Math.sin(radians) * length}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
    );
  };

  return (
    <div className="rounded-full border border-white/15 bg-white/[0.03] p-1.5">
      <svg viewBox="0 0 100 100" className="h-[74px] w-[74px]">
          {Array.from({ length: 12 }, (_, index) => {
            const radians = ((index * 30 - 90) * Math.PI) / 180;
            return (
              <text
                key={index}
                x={50 + Math.cos(radians) * 37}
                y={50 + Math.sin(radians) * 37 + 3.4}
                textAnchor="middle"
                fill="#7d848b"
                fontSize={9}
                fontFamily="Inter Variable, sans-serif"
              >
                {index === 0 ? 12 : index}
              </text>
            );
          })}
          {hand(hours * 30, 20, 2.6, '#f4f5f6')}
          {hand(minutes * 6, 28, 2, '#f4f5f6')}
          {hand(seconds * 6, 31, 1, '#ff4d4d')}
          <circle cx={50} cy={50} r={2.2} fill="#ff4d4d" />
        </svg>
    </div>
  );
}
