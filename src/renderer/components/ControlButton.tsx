import type { ReactNode } from 'react';
import { TINT, type TintKey } from './tints';

type ControlButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  tint?: TintKey;
  disabled?: boolean;
  size?: 'md' | 'lg';
};

export function ControlButton({
  children,
  onClick,
  active = false,
  tint = 'live',
  disabled = false,
  size = 'md',
}: ControlButtonProps) {
  const tone = TINT[tint];
  const box = size === 'lg' ? 'h-[54px] w-[54px] text-[11px]' : 'h-[46px] w-[46px] text-[9px]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        box,
        'grid place-items-center rounded-full border transition-all duration-150 active:scale-95',
        'label-xs disabled:opacity-30',
        active
          ? `${tone.border} ${tone.text} bg-white/[0.06]`
          : 'border-white/10 bg-white/[0.03] text-dim hover:border-white/25 hover:bg-white/[0.06] hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
