import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalContextState, LocalContextUpdate } from '../shared/local-context';

const normalizeLocation = (value: string) => value.replace(/\s+/g, ' ').trim();
const validLocation = (value: unknown): value is string =>
  typeof value === 'string' && normalizeLocation(value).length > 0 && normalizeLocation(value).length <= 160;

const validTimeZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

export type LocalContextService = Awaited<ReturnType<typeof createLocalContextService>>;

export async function createLocalContextService(stateDir: string, countryCode: string | null) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(stateDir, 'location.json');
  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let current: LocalContextState = {
    enabled: false,
    location: null,
    countryCode,
    timeZone: systemTimeZone,
    updatedAt: null,
  };

  try {
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as Partial<LocalContextState>;
    if (
      saved.enabled === true &&
      validLocation(saved.location) &&
      validTimeZone(saved.timeZone)
    ) {
      current = {
        enabled: true,
        location: normalizeLocation(saved.location),
        countryCode,
        timeZone: saved.timeZone,
        updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : null,
      };
    }
  } catch {
    // First launch or discarded preference.
  }

  const persist = () => writeFile(statePath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });

  return {
    state: (): LocalContextState => current,

    async set(input: LocalContextUpdate): Promise<LocalContextState> {
      if (!validLocation(input.location)) throw new Error('Enter a location between 1 and 160 characters');
      if (!validTimeZone(input.timeZone)) throw new Error('Invalid time zone');
      current = {
        enabled: true,
        location: normalizeLocation(input.location),
        countryCode,
        timeZone: input.timeZone,
        updatedAt: new Date().toISOString(),
      };
      await persist();
      return current;
    },

    async clear(): Promise<LocalContextState> {
      current = {
        enabled: false,
        location: null,
        countryCode,
        timeZone: systemTimeZone,
        updatedAt: null,
      };
      await persist();
      return current;
    },
  };
}
