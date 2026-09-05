import type { CSSProperties } from 'react';

export type VoiceOrbState = 'off' | 'connecting' | 'idle' | 'listening' | 'speaking';

/** A flat, organic voice mark that responds to real audio levels. */
export function VoiceOrb({ state, level = 0 }: { state: VoiceOrbState; level?: number }) {
  return (
    <span className="orb" data-state={state} style={{ '--amp': Math.max(0, Math.min(1, level)) } as CSSProperties}>
      <svg className="voice-blob" viewBox="0 0 100 80" fill="none" aria-hidden="true">
        <path className="blob-body" d="M48 5C61 0 67 15 78 18C96 22 100 36 91 48C85 57 88 71 71 74C57 77 52 67 40 73C25 81 12 72 13 58C14 47 1 43 5 29C9 15 23 20 30 13C36 7 40 8 48 5Z" fill="currentColor" />
        <path d="M37 34V46M49 28V52M61 34V46" stroke="#191919" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
