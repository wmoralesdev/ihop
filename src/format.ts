import { homedir } from 'node:os';
import { basename } from 'node:path';
import pc from 'picocolors';
import type { KillHistoryEntry, PortRecord } from './types.js';

export function parseElapsed(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dayParts = trimmed.split('-');
  if (dayParts.length > 2) return null;

  const days = dayParts.length === 2 ? Number(dayParts[0]) : 0;
  const clock = (dayParts.at(-1) ?? '').split(':').map(Number);
  if (
    !Number.isFinite(days) ||
    clock.some((part) => !Number.isFinite(part)) ||
    clock.length < 2 ||
    clock.length > 3
  ) {
    return null;
  }

  const [hours, minutes, seconds] =
    clock.length === 3 ? clock : [0, clock[0], clock[1]];
  if (
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined
  ) {
    return null;
  }

  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1_000;
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || milliseconds < 0) return '—';

  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatRelativeTime(
  isoDate: string,
  now = Date.now(),
): string {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) return '—';
  return `${formatDuration(Math.max(0, now - timestamp))} ago`;
}

export function formatEndpoint(address: string, port: number): string {
  const shownAddress = address === '*' ? '*' : address;
  const endpoint = shownAddress.includes(':')
    ? `[${shownAddress}]:${port}`
    : `${shownAddress}:${port}`;
  return endpoint;
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(1, maximum - 1))}…`;
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

export function friendlyProcessName(record: PortRecord): string {
  const command = record.commandLine ?? '';
  const localBin = command.match(
    /[\\/]node_modules[\\/]\.bin[\\/]([^\s"'\\/]+)/i,
  );
  if (localBin?.[1]) return localBin[1];

  const app = (record.executablePath ?? command).match(
    /[\\/]([^\\/]+)\.app[\\/]Contents[\\/](?:MacOS|Frameworks)[\\/]/i,
  );
  if (app?.[1]) return app[1];

  const nodeScript = command.match(
    /(?:^|\s)(?:node|bun|deno)(?:\.exe)?\s+("[^"]+"|'[^']+'|\S+)/i,
  );
  if (nodeScript?.[1]) {
    const scriptName = basename(unquote(nodeScript[1]));
    if (scriptName && !scriptName.startsWith('-')) {
      return scriptName.replace(/\.(?:c|m)?js$/i, '');
    }
  }

  return record.processName ?? 'unknown';
}

export function exposureLabel(address: string): string {
  if (address === '*') return 'all interfaces';
  if (
    address === '::1' ||
    address === 'localhost' ||
    /^127(?:\.\d{1,3}){3}$/.test(address)
  ) {
    return 'local';
  }
  return 'LAN';
}

export function projectLabel(cwd: string | null): string | null {
  if (!cwd) return null;
  const home = homedir();
  if (cwd === home || cwd === '/' || cwd.startsWith('/System/')) return null;
  const name = basename(cwd);
  return name && name !== '.' ? name : null;
}

function homeRelativePath(value: string): string {
  const home = homedir();
  return value.replaceAll(home, '~');
}

export function sanitizeCommandLine(commandLine: string): string {
  return commandLine
    .replace(
      /((?:--)?(?:api[-_]?key|access[-_]?token|token|secret|password|passwd|auth|credential)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,
      '$1[redacted]',
    )
    .replace(/\b(Bearer)\s+\S+/gi, '$1 [redacted]')
    .replace(/(https?:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[redacted]@');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatStartedAt(startedAt: string): string {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatPortRecord(
  record: PortRecord,
  currentUser?: string,
): string {
  const protocol = record.protocol.toUpperCase().padEnd(3);
  const processName = truncate(friendlyProcessName(record), 20);
  const context = [record.launcher, projectLabel(record.cwd)]
    .filter((value): value is string => Boolean(value))
    .join('/');
  const compactContext = context ? truncate(context, 24) : null;
  const exposure = exposureLabel(record.address);
  const compactExposure = exposure === 'all interfaces' ? 'all' : exposure;
  const owner =
    currentUser && record.owner && record.owner !== currentUser
      ? ` · ${record.owner}`
      : '';

  return [
    `${pc.cyan(protocol)} ${pc.bold(String(record.port).padStart(5))}`,
    pc.bold(processName),
    compactContext ? pc.dim(compactContext) : null,
    formatDuration(record.elapsedMs),
    compactExposure === 'all'
      ? pc.yellow(compactExposure)
      : compactExposure,
  ]
    .filter((value): value is string => value !== null)
    .join(' · ')
    .concat(owner);
}

export function formatPortDetails(
  record: PortRecord,
  allRecords: PortRecord[],
): string {
  const processRecords =
    record.pid === null
      ? [record]
      : allRecords.filter((candidate) => candidate.pid === record.pid);
  const endpoints = [
    ...new Set(
      processRecords.map(
        (candidate) =>
          `${candidate.protocol.toUpperCase()} ${formatEndpoint(candidate.address, candidate.port)}`,
      ),
    ),
  ].join(', ');
  const rows: Array<[string, string | null]> = [
    ['Process', friendlyProcessName(record)],
    ['PID', record.pid === null ? '—' : String(record.pid)],
    [
      'Endpoint',
      `${record.protocol.toUpperCase()} ${formatEndpoint(record.address, record.port)} (${exposureLabel(record.address)})`,
    ],
    ['All ports', endpoints || null],
    ['Launcher', record.launcher],
    [
      'Parent',
      record.parentProcessName
        ? `${record.parentProcessName}${record.parentPid === null ? '' : ` (PID ${record.parentPid})`}`
        : null,
    ],
    ['Working dir', record.cwd ? homeRelativePath(record.cwd) : null],
    [
      'Command',
      record.commandLine
        ? truncate(
            homeRelativePath(sanitizeCommandLine(record.commandLine)),
            120,
          )
        : null,
    ],
    [
      'Executable',
      record.executablePath
        ? truncate(homeRelativePath(record.executablePath), 120)
        : null,
    ],
    ['Owner', record.owner],
    ['Started', record.startedAt ? formatStartedAt(record.startedAt) : null],
    ['Running', formatDuration(record.elapsedMs)],
    [
      'CPU',
      record.cpuPercent === null ? null : `${record.cpuPercent.toFixed(1)}%`,
    ],
    [
      'Memory',
      record.memoryBytes === null ? null : formatBytes(record.memoryBytes),
    ],
  ];

  const visibleRows = rows.filter(
    (row): row is [string, string] => row[1] !== null,
  );
  const labelWidth = Math.max(...visibleRows.map(([label]) => label.length));
  return visibleRows
    .map(([label, value]) => `${label.padEnd(labelWidth)}  ${value}`)
    .join('\n');
}

export function formatHistoryEntry(entry: KillHistoryEntry): string {
  const ports = entry.ports
    .map((port) => `${port.protocol.toUpperCase()} ${port.port}`)
    .join(', ');
  return `${ports} · ${entry.processName} · PID ${entry.pid} · ${formatRelativeTime(entry.killedAt)} · ran ${formatDuration(entry.elapsedMs)} · ${entry.mode}`;
}

export function sortPortRecords(records: PortRecord[]): PortRecord[] {
  return [...records].sort(
    (left, right) =>
      left.port - right.port ||
      left.protocol.localeCompare(right.protocol) ||
      (left.pid ?? Number.MAX_SAFE_INTEGER) -
        (right.pid ?? Number.MAX_SAFE_INTEGER) ||
      left.address.localeCompare(right.address),
  );
}
