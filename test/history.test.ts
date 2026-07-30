import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendHistory,
  getHistoryPath,
  readHistory,
} from '../src/history.js';
import type { KillHistoryEntry } from '../src/types.js';

const temporaryDirectories: string[] = [];

async function temporaryHistoryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ihop-history-'));
  temporaryDirectories.push(directory);
  return join(directory, 'state', 'history.json');
}

function entry(index: number): KillHistoryEntry {
  return {
    id: `entry-${index}`,
    killedAt: new Date(1_700_000_000_000 + index).toISOString(),
    pid: 100 + index,
    processName: 'node',
    ports: [{ protocol: 'tcp', address: '127.0.0.1', port: 3000 + index }],
    elapsedMs: 10_000,
    mode: 'graceful',
    platform: 'linux',
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('history', () => {
  it('uses OS-standard local state locations', () => {
    expect(
      getHistoryPath({ platform: 'linux', env: {}, home: '/home/walter' }),
    ).toBe('/home/walter/.local/state/ihop/history.json');
    expect(
      getHistoryPath({
        platform: 'linux',
        env: { XDG_STATE_HOME: '/state' },
        home: '/home/walter',
      }),
    ).toBe('/state/ihop/history.json');
    expect(
      getHistoryPath({ platform: 'darwin', env: {}, home: '/Users/walter' }),
    ).toBe(
      '/Users/walter/Library/Application Support/ihop/history.json',
    );
  });

  it('writes atomically, newest first, and retains 50 entries', async () => {
    const filePath = await temporaryHistoryPath();
    await appendHistory(
      Array.from({ length: 49 }, (_, index) => entry(index)),
      filePath,
    );
    const result = await appendHistory([entry(99), entry(98)], filePath);
    expect(result).toHaveLength(50);
    expect(result[0]?.id).toBe('entry-99');
    expect(JSON.parse(await readFile(filePath, 'utf8')).version).toBe(1);
  });

  it('recovers safely from corrupt or missing history', async () => {
    const filePath = await temporaryHistoryPath();
    expect(await readHistory(filePath)).toEqual([]);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '{not-json', 'utf8');
    expect(await readHistory(filePath)).toEqual([]);
    expect((await appendHistory([entry(1)], filePath))[0]?.id).toBe('entry-1');
  });
});
