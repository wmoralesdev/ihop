import { parseElapsed } from '../format.js';
import { basename } from 'node:path';
import type {
  PortRecord,
  ProcessMetadata,
  ProcessPathDetails,
  ProcessTreeEntry,
  Protocol,
} from '../types.js';

function emptyRecord(
  protocol: Protocol,
  address: string,
  port: number,
  pid: number | null,
  processName: string | null,
  owner: string | null,
): PortRecord {
  return {
    protocol,
    address,
    port,
    pid,
    processName,
    owner,
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
}

export function parseEndpoint(
  endpoint: string,
): { address: string; port: number } | null {
  const local = endpoint.trim();
  if (!local || local.endsWith(':*')) return null;

  if (local.startsWith('[')) {
    const bracketed = local.match(/^\[([^\]]+)\]:(\d+)$/);
    if (!bracketed) return null;
    const port = Number(bracketed[2]);
    return Number.isInteger(port) && port > 0 && port <= 65_535
      ? { address: bracketed[1] ?? '*', port }
      : null;
  }

  const separator = local.lastIndexOf(':');
  if (separator < 0) return null;
  const address = local.slice(0, separator) || '*';
  const port = Number(local.slice(separator + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  return { address, port };
}

export function parseLsofOutput(
  output: string,
  protocol: Protocol,
): PortRecord[] {
  const records: PortRecord[] = [];
  let pid: number | null = null;
  let processName: string | null = null;
  let owner: string | null = null;
  let socketProtocol = protocol;

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const field = line[0];
    const value = line.slice(1);

    switch (field) {
      case 'p':
        pid = Number.isInteger(Number(value)) ? Number(value) : null;
        processName = null;
        owner = null;
        break;
      case 'c':
        processName = value || null;
        break;
      case 'L':
        owner = value || null;
        break;
      case 'f':
        socketProtocol = protocol;
        break;
      case 'P':
        socketProtocol = value.toLowerCase().startsWith('udp') ? 'udp' : 'tcp';
        break;
      case 'n': {
        // Connected UDP sockets are outbound connections, not local listeners.
        if (value.includes('->')) break;
        const endpoint = parseEndpoint(value);
        if (!endpoint) break;
        records.push(
          emptyRecord(
            socketProtocol,
            endpoint.address,
            endpoint.port,
            pid,
            processName,
            owner,
          ),
        );
        break;
      }
    }
  }

  return records;
}

export function parseSsOutput(output: string): PortRecord[] {
  const records: PortRecord[] = [];

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(
      /^(tcp|udp)\S*\s+\S+\s+\d+\s+\d+\s+(\S+)\s+\S+(?:\s+(.*))?$/i,
    );
    if (!match) continue;

    const protocol: Protocol = match[1]?.toLowerCase().startsWith('udp')
      ? 'udp'
      : 'tcp';
    const endpoint = parseEndpoint(match[2] ?? '');
    if (!endpoint) continue;

    const processDetails = match[3] ?? '';
    const processes = [
      ...processDetails.matchAll(/\("([^"]+)",pid=(\d+)/g),
    ];

    if (processes.length === 0) {
      records.push(
        emptyRecord(protocol, endpoint.address, endpoint.port, null, null, null),
      );
      continue;
    }

    for (const processMatch of processes) {
      records.push(
        emptyRecord(
          protocol,
          endpoint.address,
          endpoint.port,
          Number(processMatch[2]),
          processMatch[1] ?? null,
          null,
        ),
      );
    }
  }

  return records;
}

export function parsePsOutput(
  output: string,
  now = Date.now(),
): ProcessMetadata[] {
  const metadata: ProcessMetadata[] = [];

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(.+?)\s*$/,
    );
    if (!match) continue;

    const pid = Number(match[1]);
    const elapsedMs = parseElapsed(match[3] ?? '');
    const commandLine = match[7] || null;
    metadata.push({
      pid,
      processName:
        commandLine === null
          ? null
          : basename(commandLine.trim().split(/\s+/)[0] ?? '') || null,
      owner: match[4] || null,
      startedAt:
        elapsedMs === null ? null : new Date(now - elapsedMs).toISOString(),
      elapsedMs,
      parentPid: Number(match[2]),
      parentProcessName: null,
      launcher: null,
      commandLine,
      cwd: null,
      executablePath: null,
      cpuPercent: Number.isFinite(Number(match[5])) ? Number(match[5]) : null,
      memoryBytes: Number.isFinite(Number(match[6]))
        ? Number(match[6]) * 1_024
        : null,
    });
  }

  return metadata;
}

export function parseProcessTable(output: string): ProcessTreeEntry[] {
  const entries: ProcessTreeEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    entries.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      commandLine: match[3] ?? '',
    });
  }
  return entries;
}

export function processNameFromCommand(commandLine: string): string | null {
  const appMatch = commandLine.match(
    /(?:^|\/)([^/]+)\.app\/Contents\/(?:MacOS|Frameworks)\//i,
  );
  if (appMatch?.[1]) return appMatch[1];
  const firstToken = commandLine.trim().split(/\s+/)[0];
  return firstToken ? basename(firstToken) : null;
}

export function inferProcessContext(
  pid: number,
  processTable: ProcessTreeEntry[],
): { parentProcessName: string | null; launcher: string | null } {
  const byPid = new Map(processTable.map((entry) => [entry.pid, entry]));
  const processEntry = byPid.get(pid);
  const parent = processEntry ? byPid.get(processEntry.parentPid) : undefined;
  const parentProcessName = parent
    ? processNameFromCommand(parent.commandLine)
    : null;

  let current = parent;
  const visited = new Set<number>();
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (visited.has(current.pid)) break;
    visited.add(current.pid);
    const command = current.commandLine;

    if (
      /ChatGPT\.app|(?:^|\/)codex\b.*app-server|features\.code_mode_host/i.test(
        command,
      )
    ) {
      return { parentProcessName, launcher: 'ChatGPT/Codex' };
    }
    if (/Cursor\.app|Cursor Helper/i.test(command)) {
      return { parentProcessName, launcher: 'Cursor' };
    }
    if (/Visual Studio Code\.app|Code Helper/i.test(command)) {
      return { parentProcessName, launcher: 'VS Code' };
    }
    if (/Warp\.app/i.test(command)) {
      return { parentProcessName, launcher: 'Warp' };
    }
    if (/iTerm(?:2)?\.app/i.test(command)) {
      return { parentProcessName, launcher: 'iTerm' };
    }
    if (/Terminal\.app/i.test(command)) {
      return { parentProcessName, launcher: 'Terminal' };
    }

    current = byPid.get(current.parentPid);
  }

  return { parentProcessName, launcher: null };
}

export function parseLsofProcessPaths(output: string): ProcessPathDetails[] {
  const byPid = new Map<number, ProcessPathDetails>();
  let pid: number | null = null;
  let descriptor: string | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      pid = Number.isInteger(Number(value)) ? Number(value) : null;
      descriptor = null;
      if (pid !== null && !byPid.has(pid)) {
        byPid.set(pid, { pid, cwd: null, executablePath: null });
      }
    } else if (field === 'f') {
      descriptor = value;
    } else if (field === 'n' && pid !== null) {
      const existing = byPid.get(pid);
      if (!existing) continue;
      if (descriptor === 'cwd') existing.cwd = value || null;
      if (descriptor === 'txt' && existing.executablePath === null) {
        existing.executablePath = value || null;
      }
    }
  }

  return [...byPid.values()];
}

interface WindowsRecord {
  protocol?: unknown;
  address?: unknown;
  port?: unknown;
  pid?: unknown;
  processName?: unknown;
  startedAt?: unknown;
  parentPid?: unknown;
  parentProcessName?: unknown;
  launcher?: unknown;
  commandLine?: unknown;
  cwd?: unknown;
  executablePath?: unknown;
  cpuPercent?: unknown;
  memoryBytes?: unknown;
}

export function parseWindowsJson(
  output: string,
  now = Date.now(),
): PortRecord[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  let parsed: WindowsRecord | WindowsRecord[];
  try {
    parsed = JSON.parse(trimmed) as WindowsRecord | WindowsRecord[];
  } catch {
    return [];
  }

  const values = Array.isArray(parsed) ? parsed : [parsed];
  const records: PortRecord[] = [];

  for (const value of values) {
    const protocol: Protocol =
      String(value.protocol).toLowerCase() === 'udp' ? 'udp' : 'tcp';
    const port = Number(value.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;

    const rawPid = Number(value.pid);
    const pid = Number.isInteger(rawPid) && rawPid >= 0 ? rawPid : null;
    const startedAt =
      typeof value.startedAt === 'string' &&
      Number.isFinite(Date.parse(value.startedAt))
        ? new Date(value.startedAt).toISOString()
        : null;

    records.push({
      protocol,
      address:
        typeof value.address === 'string' && value.address
          ? value.address
          : '*',
      port,
      pid,
      processName:
        typeof value.processName === 'string' && value.processName
          ? value.processName
          : null,
      owner: null,
      startedAt,
      elapsedMs:
        startedAt === null ? null : Math.max(0, now - Date.parse(startedAt)),
      parentPid: Number.isInteger(Number(value.parentPid))
        ? Number(value.parentPid)
        : null,
      parentProcessName:
        typeof value.parentProcessName === 'string' && value.parentProcessName
          ? value.parentProcessName
          : null,
      launcher:
        typeof value.launcher === 'string' && value.launcher
          ? value.launcher
          : null,
      commandLine:
        typeof value.commandLine === 'string' && value.commandLine
          ? value.commandLine
          : null,
      cwd:
        typeof value.cwd === 'string' && value.cwd ? value.cwd : null,
      executablePath:
        typeof value.executablePath === 'string' && value.executablePath
          ? value.executablePath
          : null,
      cpuPercent: Number.isFinite(Number(value.cpuPercent))
        ? Number(value.cpuPercent)
        : null,
      memoryBytes: Number.isFinite(Number(value.memoryBytes))
        ? Number(value.memoryBytes)
        : null,
      isWebCandidate: false,
    });
  }

  return records;
}

export function parseNetstatOutput(output: string): PortRecord[] {
  const records: PortRecord[] = [];

  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    const protocolName = columns[0]?.toUpperCase();
    if (protocolName !== 'TCP' && protocolName !== 'UDP') continue;

    const protocol: Protocol = protocolName === 'UDP' ? 'udp' : 'tcp';
    if (protocol === 'tcp' && columns[3]?.toUpperCase() !== 'LISTENING') {
      continue;
    }

    const endpoint = parseEndpoint(columns[1] ?? '');
    const pidValue = protocol === 'tcp' ? columns[4] : columns[3];
    const parsedPid = Number(pidValue);
    if (!endpoint) continue;

    records.push(
      emptyRecord(
        protocol,
        endpoint.address,
        endpoint.port,
        Number.isInteger(parsedPid) ? parsedPid : null,
        null,
        null,
      ),
    );
  }

  return records;
}
