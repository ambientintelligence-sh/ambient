const CALLSIGNS = [
  'KESTREL', 'MERIDIAN', 'AURORA', 'LANTERN', 'HARRIER', 'OBSIDIAN',
  'CASCADE', 'VESPER', 'PELICAN', 'QUARRY', 'TIDEWAY', 'FALCON',
  'JUNIPER', 'MARLIN', 'ZEPHYR', 'CINDER', 'BEACON', 'THISTLE',
  'CORVID', 'SABLE', 'PLOVER', 'GANTRY', 'ORIOLE', 'FLINT',
] as const;

/** A short, speakable callsign. Falls back to a numeric suffix once names run out. */
export function nextWorkerName(taken: ReadonlySet<string>): string {
  const free = CALLSIGNS.filter((name) => !taken.has(name));
  if (free.length > 0) {
    return free[Math.floor(Math.random() * free.length)];
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
