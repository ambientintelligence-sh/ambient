import { TINT, type TintKey } from './tints';

type ChipProps = {
  label: string;
  value: string;
  tint?: TintKey;
};

/** The bordered key/value plate from an instrument cluster: `MODE: LIVE`. */
export function Chip({ label, value, tint = 'dim' }: ChipProps) {
  const tone = TINT[tint];
  return (
    <span
      className={`inline-flex w-fit items-baseline gap-1.5 rounded-[5px] border px-2 py-[5px] label-xs ${tone.border} ${tone.text}`}
    >
      <span className="opacity-50">{label}</span>
      <span>{value}</span>
    </span>
  );
}
