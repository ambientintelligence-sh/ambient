/** Semantic HUD colours. Full class strings so Tailwind sees every variant. */
export const TINT = {
  live: { text: 'text-live', border: 'border-live', fill: 'bg-live', hex: '#5ee87a' },
  warn: { text: 'text-warn', border: 'border-warn', fill: 'bg-warn', hex: '#ffc93c' },
  link: { text: 'text-link', border: 'border-link', fill: 'bg-link', hex: '#3e9bff' },
  deep: { text: 'text-deep', border: 'border-deep', fill: 'bg-deep', hex: '#a77bff' },
  alert: { text: 'text-alert', border: 'border-alert', fill: 'bg-alert', hex: '#ff4d4d' },
  dim: { text: 'text-dimmer', border: 'border-dimmer', fill: 'bg-dimmer', hex: '#565c63' },
} as const;

export type TintKey = keyof typeof TINT;
