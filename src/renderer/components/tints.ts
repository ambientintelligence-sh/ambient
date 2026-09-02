/** Semantic status colours (light mode). Full class strings so Tailwind sees every variant. */
export const TINT = {
  live: { text: 'text-live', border: 'border-live', fill: 'bg-live', hex: '#16a34a' },
  warn: { text: 'text-warn', border: 'border-warn', fill: 'bg-warn', hex: '#e08300' },
  link: { text: 'text-link', border: 'border-link', fill: 'bg-link', hex: '#0a6cff' },
  deep: { text: 'text-deep', border: 'border-deep', fill: 'bg-deep', hex: '#7c5af5' },
  alert: { text: 'text-alert', border: 'border-alert', fill: 'bg-alert', hex: '#e0263c' },
  dim: { text: 'text-dimmer', border: 'border-dimmer', fill: 'bg-dimmer', hex: '#abacb6' },
} as const;

export type TintKey = keyof typeof TINT;
