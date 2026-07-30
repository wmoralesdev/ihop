import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { HISTORY_LIMIT } from './constants.js';
import type { KillHistoryEntry } from './types.js';

interface HistoryFile {
  version: 1;
  entries: KillHistoryEntry[];
}

export interface HistoryPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function getHistoryPath(options: HistoryPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();

  switch (platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'ihop', 'history.json');
    case 'win32':
      return join(
        env.LOCALAPPDATA ?? env.APPDATA ?? join(home, 'AppData', 'Local'),
        'ihop',
        'history.json',
      );
    default:
      return join(
        env.XDG_STATE_HOME ?? join(home, '.local', 'state'),
        'ihop',
        'history.json',
      );
  }
}

function isHistoryEntry(value: unknown): value is KillHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<KillHistoryEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.killedAt === 'string' &&
    typeof entry.pid === 'number' &&
    typeof entry.processName === 'string' &&
    Array.isArray(entry.ports) &&
    (entry.elapsedMs === null || typeof entry.elapsedMs === 'number') &&
    (entry.mode === 'graceful' ||
      entry.mode === 'forced' ||
      entry.mode === 'windows') &&
    typeof entry.platform === 'string'
  );
}

export async function readHistory(
  filePath = getHistoryPath(),
): Promise<KillHistoryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<HistoryFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(isHistoryEntry).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export async function appendHistory(
  newEntries: KillHistoryEntry[],
  filePath = getHistoryPath(),
): Promise<KillHistoryEntry[]> {
  if (newEntries.length === 0) return readHistory(filePath);

  const existing = await readHistory(filePath);
  const entries = [...newEntries, ...existing].slice(0, HISTORY_LIMIT);
  const payload: HistoryFile = { version: 1, entries };
  const directory = dirname(filePath);
  const temporaryPath = join(directory, `.history-${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);

  return entries;
}
