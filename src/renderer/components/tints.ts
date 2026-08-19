import type { AgentTint } from '../fleet';

/** Full class strings so Tailwind can see every variant at build time. */
export const TINT: Readonly<Record<AgentTint | 'alert' | 'dim', { text: string; border: string; fill: string; hex: string }>> = {
  link: { text: 'text-link', border: 'border-link', fill: 'bg-link', hex: '#3e9bff' },
  live: { text: 'text-live', border: 'border-live', fill: 'bg-live', hex: '#5ee87a' },
  warn: { text: 'text-warn', border: 'border-warn', fill: 'bg-warn', hex: '#ffc93c' },
  deep: { text: 'text-deep', border: 'border-deep', fill: 'bg-deep', hex: '#a77bff' },
  alert: { text: 'text-alert', border: 'border-alert', fill: 'bg-alert', hex: '#ff4d4d' },
  dim: { text: 'text-dimmer', border: 'border-dimmer', fill: 'bg-dimmer', hex: '#3f454b' },
};

export type TintKey = keyof typeof TINT;
