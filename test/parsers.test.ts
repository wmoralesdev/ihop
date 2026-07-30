import { describe, expect, it } from 'vitest';
import { normalizeRecords } from '../src/platform/index.js';
import {
  inferProcessContext,
  parseEndpoint,
  parseLsofOutput,
  parseLsofProcessPaths,
  parseNetstatOutput,
  parseProcessTable,
  parsePsOutput,
  parseSsOutput,
  parseWindowsJson,
} from '../src/platform/parsers.js';

describe('platform parsers', () => {
  it('parses IPv4, IPv6, and wildcard endpoints', () => {
    expect(parseEndpoint('127.0.0.1:3000')).toEqual({
      address: '127.0.0.1',
      port: 3000,
    });
    expect(parseEndpoint('[::1]:5173')).toEqual({
      address: '::1',
      port: 5173,
    });
    expect(parseEndpoint('*:8080')).toEqual({ address: '*', port: 8080 });
    expect(parseEndpoint('*:*')).toBeNull();
    expect(parseEndpoint('127.0.0.1:99999')).toBeNull();
  });

  it('parses lsof fields and excludes connected UDP sockets', () => {
    const output = [
      'p42',
      'cnode',
      'Lwalter',
      'f10',
      'PUDP',
      'n127.0.0.1:5353',
      'f11',
      'PUDP',
      'n127.0.0.1:59015->1.1.1.1:443',
      'f12',
      'PUDP',
      'n*:*',
    ].join('\n');

    expect(parseLsofOutput(output, 'udp')).toEqual([
      expect.objectContaining({
        protocol: 'udp',
        address: '127.0.0.1',
        port: 5353,
        pid: 42,
        processName: 'node',
        owner: 'walter',
      }),
    ]);
  });

  it('parses ss listeners with and without process metadata', () => {
    const output = [
      'tcp LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=42,fd=20))',
      'udp UNCONN 0 0 [::]:5353 [::]:*',
    ].join('\n');

    expect(parseSsOutput(output)).toEqual([
      expect.objectContaining({
        protocol: 'tcp',
        port: 3000,
        pid: 42,
        processName: 'node',
      }),
      expect.objectContaining({
        protocol: 'udp',
        address: '::',
        port: 5353,
        pid: null,
      }),
    ]);
  });

  it('parses ps elapsed time and metadata', () => {
    const now = Date.parse('2026-07-29T12:00:00.000Z');
    expect(
      parsePsOutput(
        '  42 7 01-02:03:04 walter 1.5 12345 /usr/local/bin/node app.js\n',
        now,
      ),
    ).toEqual([
      {
        pid: 42,
        processName: 'node',
        owner: 'walter',
        elapsedMs: 93_784_000,
        startedAt: '2026-07-28T09:56:56.000Z',
        parentPid: 7,
        parentProcessName: null,
        launcher: null,
        commandLine: '/usr/local/bin/node app.js',
        cwd: null,
        executablePath: null,
        cpuPercent: 1.5,
        memoryBytes: 12_641_280,
      },
    ]);
  });

  it('infers the immediate parent and desktop launcher from ancestry', () => {
    const table = parseProcessTable(
      [
        '42 7 node /work/node_modules/.bin/server',
        '7 5 npm exec server',
        '5 1 /Applications/Cursor.app/Contents/MacOS/Cursor',
        '1 0 /sbin/launchd',
      ].join('\n'),
    );
    expect(inferProcessContext(42, table)).toEqual({
      parentProcessName: 'npm',
      launcher: 'Cursor',
    });
  });

  it('parses working directory and executable paths from lsof fields', () => {
    expect(
      parseLsofProcessPaths(
        [
          'p42',
          'fcwd',
          'n/Users/walter/project',
          'ftxt',
          'n/opt/homebrew/bin/node',
          'ftxt',
          'n/usr/lib/libSystem.dylib',
        ].join('\n'),
      ),
    ).toEqual([
      {
        pid: 42,
        cwd: '/Users/walter/project',
        executablePath: '/opt/homebrew/bin/node',
      },
    ]);
  });

  it('parses PowerShell JSON and Windows netstat fallback', () => {
    const now = Date.parse('2026-07-29T12:00:00.000Z');
    const windows = parseWindowsJson(
      JSON.stringify([
        {
          protocol: 'tcp',
          address: '0.0.0.0',
          port: 8080,
          pid: 55,
          processName: 'node',
          startedAt: '2026-07-29T11:00:00.000Z',
        },
      ]),
      now,
    );
    expect(windows[0]).toEqual(
      expect.objectContaining({ pid: 55, port: 8080, elapsedMs: 3_600_000 }),
    );

    const netstat = parseNetstatOutput(
      [
        'TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    55',
        'TCP    127.0.0.1:4000  127.0.0.1:62000 ESTABLISHED 66',
        'UDP    [::]:5353       *:*                      77',
      ].join('\n'),
    );
    expect(netstat).toEqual([
      expect.objectContaining({ protocol: 'tcp', port: 8080, pid: 55 }),
      expect.objectContaining({ protocol: 'udp', port: 5353, pid: 77 }),
    ]);
  });

  it('collapses duplicate wildcard listeners but retains meaningful addresses', () => {
    const base = {
      protocol: 'tcp' as const,
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
      isWebCandidate: false,
    };
    const records = normalizeRecords([
      { ...base, address: '0.0.0.0' },
      { ...base, address: '::' },
      { ...base, address: '127.0.0.1' },
    ]);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.address)).toEqual([
      '*',
      '127.0.0.1',
    ]);
    expect(records.every((record) => record.isWebCandidate)).toBe(true);
  });
});
