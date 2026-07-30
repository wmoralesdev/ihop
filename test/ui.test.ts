import { describe, expect, it } from 'vitest';
import { closeRecords } from '../src/ui.js';
import type { PortRecord } from '../src/types.js';

function record(): PortRecord {
  return {
    protocol: 'tcp',
    address: '127.0.0.1',
    port: 3000,
    pid: 42,
    processName: 'node',
    owner: 'walter',
    startedAt: null,
    elapsedMs: null,
    parentPid: null,
    parentProcessName: null,
    launcher: null,
    commandLine: null,
    cwd: null,
    executablePath: null,
    cpuPercent: null,
    memoryBytes: null,
    isWebCandidate: true,
  };
}

describe('kill confirmation', () => {
  it('requires --yes when no interactive terminal is available', async () => {
    const target = record();
    await expect(
      closeRecords([target], [target], { isTTY: false }),
    ).resolves.toBe(2);
  });
});
