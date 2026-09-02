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
  const box = size === 'lg' ? 'h-[52px] w-[52px] text-[11px]' : 'h-[44px] w-[44px] text-[9px]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={active ? { color: tone.hex, borderColor: tone.hex } : undefined}
      className={[
        box,
        'grid place-items-center rounded-full border transition-[transform,background-color,border-color,color] duration-150 active:scale-95',
        'label-xs disabled:opacity-30',
        active
          ? 'bg-white'
          : 'border-black/[0.08] bg-white/60 text-dim shadow-[0_1px_2px_rgb(20_22_30/0.04)] hover:border-black/[0.14] hover:bg-white hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
