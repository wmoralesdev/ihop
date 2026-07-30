import { describe, expect, it } from 'vitest';
import { isLikelyWebApp } from '../src/filter.js';
import {
  exposureLabel,
  formatDuration,
  formatPortDetails,
  formatPortRecord,
  formatRelativeTime,
  friendlyProcessName,
  parseElapsed,
  sanitizeCommandLine,
} from '../src/format.js';
import type { PortRecord } from '../src/types.js';

function describedRecord(): PortRecord {
  return {
    protocol: 'tcp',
    address: '*',
    port: 4723,
    pid: 89905,
    processName: 'node',
    owner: 'walter',
    startedAt: '2026-07-29T15:50:42.000Z',
    elapsedMs: 10_800_000,
    parentPid: 89323,
    parentProcessName: 'npm',
    launcher: 'ChatGPT/Codex',
    commandLine:
      'node /Users/walter/project/node_modules/.bin/react-grab-mcp --token secret-value --stdio',
    cwd: '/Users/walter/project',
    executablePath: '/opt/homebrew/bin/node',
    cpuPercent: 0.1,
    memoryBytes: 24 * 1_024 * 1_024,
    isWebCandidate: true,
  };
}

describe('web filtering and time formatting', () => {
  it('matches known ports and common runtimes', () => {
    expect(isLikelyWebApp(5173, 'anything')).toBe(true);
    expect(isLikelyWebApp(60_000, '/usr/local/bin/node')).toBe(true);
    expect(isLikelyWebApp(60_000, 'docker-proxy')).toBe(true);
    expect(isLikelyWebApp(60_000, 'rapportd')).toBe(false);
  });

  it('parses ps elapsed formats', () => {
    expect(parseElapsed('01:30')).toBe(90_000);
    expect(parseElapsed('02:01:30')).toBe(7_290_000);
    expect(parseElapsed('2-02:01:30')).toBe(180_090_000);
    expect(parseElapsed('nope')).toBeNull();
  });

  it('formats durations and relative timestamps compactly', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(5_000)).toBe('5s');
    expect(formatDuration(65_000)).toBe('1m');
    expect(formatDuration(7_500_000)).toBe('2h 5m');
    expect(formatDuration(180_000_000)).toBe('2d 2h');
    expect(
      formatRelativeTime(
        '2026-07-29T10:00:00.000Z',
        Date.parse('2026-07-29T12:05:00.000Z'),
      ),
    ).toBe('2h 5m ago');
  });

  it('builds a compact identity and exposure-aware main row', () => {
    const record = describedRecord();
    expect(friendlyProcessName(record)).toBe('react-grab-mcp');
    expect(exposureLabel(record.address)).toBe('all interfaces');

    const row = formatPortRecord(record, 'walter');
    const plainRow = row.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plainRow).toContain('react-grab-mcp');
    expect(plainRow).toContain('ChatGPT/Codex');
    expect(plainRow).toContain('project');
    expect(plainRow).toContain('· all');
    expect(plainRow).not.toContain('secret-value');
    expect(plainRow).not.toContain('*:4723');
  });

  it('redacts sensitive command arguments in optional details', () => {
    const record = describedRecord();
    expect(sanitizeCommandLine(record.commandLine ?? '')).toContain(
      '--token [redacted]',
    );
    const details = formatPortDetails(record, [record]);
    expect(details).toContain('react-grab-mcp');
    expect(details).toContain('ChatGPT/Codex');
    expect(details).toContain('24 MB');
    expect(details).toContain('[redacted]');
    expect(details).not.toContain('secret-value');
  });
});
