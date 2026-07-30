import { describe, expect, it, vi } from 'vitest';
import {
  historyEntriesFromResults,
  impactRecordsForSelection,
  terminateRecords,
} from '../src/killer.js';
import type { KillDependencies, PortRecord } from '../src/types.js';

function record(
  port: number,
  pid = 42,
  overrides: Partial<PortRecord> = {},
): PortRecord {
  return {
    protocol: 'tcp',
    address: '127.0.0.1',
    port,
    pid,
    processName: 'node',
    owner: 'walter',
    startedAt: '2026-07-29T10:00:00.000Z',
    elapsedMs: 60_000,
    parentPid: 7,
    parentProcessName: 'npm',
    launcher: null,
    commandLine: 'node server.js',
    cwd: '/work/project',
    executablePath: '/usr/bin/node',
    cpuPercent: 0.1,
    memoryBytes: 10_000_000,
    isWebCandidate: true,
    ...overrides,
  };
}

function dependencies(
  snapshots: PortRecord[][],
  platform: NodeJS.Platform = 'linux',
): KillDependencies & { signal: ReturnType<typeof vi.fn> } {
  let call = 0;
  const signal = vi.fn();
  return {
    platform,
    signal,
    wait: vi.fn(async () => undefined),
    discover: vi.fn(async () => snapshots[Math.min(call++, snapshots.length - 1)] ?? []),
  };
}

describe('safe termination', () => {
  it('discloses every port owned by the selected PID', () => {
    const selected = [record(3000)];
    const all = [record(3000), record(5173), record(8000, 99)];
    expect(impactRecordsForSelection(selected, all)).toEqual([
      record(3000),
      record(5173),
    ]);
  });

  it('sends SIGTERM and verifies that ports closed', async () => {
    const target = record(3000);
    const deps = dependencies([[target], []]);
    const results = await terminateRecords([target], {
      dependencies: deps,
      gracefulWaitMs: 0,
    });

    expect(deps.signal).toHaveBeenCalledWith(42, 'SIGTERM');
    expect(results[0]).toEqual(
      expect.objectContaining({ status: 'closed', mode: 'graceful' }),
    );
  });

  it('reports survivors without automatically force-killing', async () => {
    const target = record(3000);
    const deps = dependencies([[target], [target]]);
    const results = await terminateRecords([target], {
      dependencies: deps,
      gracefulWaitMs: 0,
    });
    expect(deps.signal).toHaveBeenCalledTimes(1);
    expect(results[0]?.status).toBe('survived');
  });

  it('uses SIGKILL only when force is requested', async () => {
    const target = record(3000);
    const deps = dependencies([[target], []]);
    const results = await terminateRecords([target], {
      dependencies: deps,
      force: true,
    });
    expect(deps.signal).toHaveBeenCalledWith(42, 'SIGKILL');
    expect(results[0]?.mode).toBe('forced');
  });

  it('treats Windows termination as immediate SIGTERM emulation', async () => {
    const target = record(3000);
    const deps = dependencies([[target], []], 'win32');
    const results = await terminateRecords([target], { dependencies: deps });
    expect(deps.signal).toHaveBeenCalledWith(42, 'SIGTERM');
    expect(results[0]?.mode).toBe('windows');
  });

  it('refuses changed ownership and protected PIDs', async () => {
    const target = record(3000);
    const reused = record(3000, 42, {
      processName: 'python',
      startedAt: '2026-07-29T11:00:00.000Z',
    });
    const deps = dependencies([[reused]]);
    expect(
      (await terminateRecords([target], { dependencies: deps }))[0]?.status,
    ).toBe('changed');

    const protectedTarget = record(3000, 1);
    const protectedDeps = dependencies([[protectedTarget]]);
    expect(
      (
        await terminateRecords([protectedTarget], {
          dependencies: protectedDeps,
        })
      )[0]?.status,
    ).toBe('failed');
    expect(protectedDeps.signal).not.toHaveBeenCalled();
  });

  it('turns permission errors into actionable failures', async () => {
    const target = record(3000);
    const deps = dependencies([[target]]);
    deps.signal.mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    });
    const result = (
      await terminateRecords([target], { dependencies: deps })
    )[0];
    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('elevated shell');
  });

  it('creates local history only for ports verified closed', () => {
    const target = record(3000);
    const entries = historyEntriesFromResults(
      [
        {
          pid: 42,
          processName: 'node',
          requestedRecords: [target],
          closedRecords: [target],
          status: 'closed',
          mode: 'graceful',
        },
      ],
      'linux',
      '2026-07-29T12:00:00.000Z',
    );
    expect(entries[0]).toEqual(
      expect.objectContaining({
        pid: 42,
        ports: [
          { protocol: 'tcp', address: '127.0.0.1', port: 3000 },
        ],
      }),
    );
  });
});
