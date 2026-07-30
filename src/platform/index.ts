import { readlink } from 'node:fs/promises';
import { withWebCandidate } from '../filter.js';
import { sortPortRecords } from '../format.js';
import type {
  DiscoverOptions,
  PortRecord,
  ProcessMetadata,
  ProcessPathDetails,
} from '../types.js';
import { discoverDarwinPorts } from './darwin.js';
import { discoverLinuxPorts } from './linux.js';
import { runCommand } from './command.js';
import {
  inferProcessContext,
  parseLsofProcessPaths,
  parseProcessTable,
  parsePsOutput,
} from './parsers.js';
import { discoverWindowsPorts } from './win32.js';

function canonicalAddress(address: string): string {
  const value = address.trim().replace(/^\[|\]$/g, '');
  if (!value || value === '*' || value === '0.0.0.0' || value === '::') {
    return '*';
  }
  return value;
}

export function normalizeRecords(records: PortRecord[]): PortRecord[] {
  const deduplicated = new Map<string, PortRecord>();

  for (const source of records) {
    const record = { ...source, address: canonicalAddress(source.address) };
    const key = [
      record.protocol,
      record.address,
      record.port,
      record.pid ?? 'unknown',
    ].join(':');
    const existing = deduplicated.get(key);

    if (!existing) {
      deduplicated.set(key, record);
      continue;
    }

    deduplicated.set(key, {
      ...existing,
      processName: existing.processName ?? record.processName,
      owner: existing.owner ?? record.owner,
      startedAt: existing.startedAt ?? record.startedAt,
      elapsedMs: existing.elapsedMs ?? record.elapsedMs,
      parentPid: existing.parentPid ?? record.parentPid,
      parentProcessName:
        existing.parentProcessName ?? record.parentProcessName,
      launcher: existing.launcher ?? record.launcher,
      commandLine: existing.commandLine ?? record.commandLine,
      cwd: existing.cwd ?? record.cwd,
      executablePath: existing.executablePath ?? record.executablePath,
      cpuPercent: existing.cpuPercent ?? record.cpuPercent,
      memoryBytes: existing.memoryBytes ?? record.memoryBytes,
    });
  }

  return sortPortRecords(
    [...deduplicated.values()].map((record) => withWebCandidate(record)),
  );
}

async function enrichPosixRecords(
  records: PortRecord[],
  now: number,
  platform: 'darwin' | 'linux',
): Promise<PortRecord[]> {
  const pids = [
    ...new Set(
      records
        .map((record) => record.pid)
        .filter((pid): pid is number => pid !== null && pid > 0),
    ),
  ];
  if (pids.length === 0) return records;

  let metadata: ProcessMetadata[];
  let processTableOutput = '';
  try {
    const [metadataResult, processTableResult] = await Promise.all([
      runCommand('ps', [
        '-p',
        pids.join(','),
        '-ww',
        '-o',
        'pid=,ppid=,etime=,user=,%cpu=,rss=,args=',
      ]),
      runCommand('ps', ['-axo', 'pid=,ppid=,args=']).catch(() => ({
        stdout: '',
        stderr: '',
      })),
    ]);
    metadata = parsePsOutput(metadataResult.stdout, now);
    processTableOutput = processTableResult.stdout;
  } catch {
    return records;
  }

  const processTable = parseProcessTable(processTableOutput);
  let pathDetails: ProcessPathDetails[] = [];
  if (platform === 'darwin') {
    try {
      const { stdout } = await runCommand(
        '/usr/sbin/lsof',
        ['-a', '-p', pids.join(','), '-d', 'cwd,txt', '-Fn'],
        [0, 1],
      );
      pathDetails = parseLsofProcessPaths(stdout);
    } catch {
      pathDetails = [];
    }
  } else {
    pathDetails = await Promise.all(
      pids.map(async (pid): Promise<ProcessPathDetails> => {
        const [cwd, executablePath] = await Promise.all([
          readlink(`/proc/${pid}/cwd`).catch(() => null),
          readlink(`/proc/${pid}/exe`).catch(() => null),
        ]);
        return { pid, cwd, executablePath };
      }),
    );
  }

  const pathsByPid = new Map(pathDetails.map((item) => [item.pid, item]));
  const byPid = new Map(
    metadata.map((item) => {
      const context = inferProcessContext(item.pid, processTable);
      const paths = pathsByPid.get(item.pid);
      return [
        item.pid,
        {
          ...item,
          ...context,
          cwd: paths?.cwd ?? null,
          executablePath: paths?.executablePath ?? null,
        },
      ] as const;
    }),
  );
  return records.map((record) => {
    const details = record.pid === null ? undefined : byPid.get(record.pid);
    if (!details) return record;
    return {
      ...record,
      processName: record.processName ?? details.processName,
      owner: record.owner ?? details.owner,
      startedAt: details.startedAt,
      elapsedMs: details.elapsedMs,
      parentPid: details.parentPid,
      parentProcessName: details.parentProcessName,
      launcher: details.launcher,
      commandLine: details.commandLine,
      cwd: details.cwd,
      executablePath: details.executablePath,
      cpuPercent: details.cpuPercent,
      memoryBytes: details.memoryBytes,
    };
  });
}

export async function discoverOpenPorts(
  options: DiscoverOptions = {},
): Promise<PortRecord[]> {
  const platform = options.platform ?? process.platform;
  const now = options.now ?? Date.now();
  let records: PortRecord[];

  switch (platform) {
    case 'darwin':
      records = await discoverDarwinPorts();
      records = await enrichPosixRecords(records, now, 'darwin');
      break;
    case 'linux':
      records = await discoverLinuxPorts();
      records = await enrichPosixRecords(records, now, 'linux');
      break;
    case 'win32':
      records = await discoverWindowsPorts(now);
      break;
    default:
      throw new Error(
        `Unsupported platform: ${platform}. IHOP supports macOS, Linux, and Windows.`,
      );
  }

  return normalizeRecords(records);
}
