import { GRACEFUL_WAIT_MS } from './constants.js';
import { discoverOpenPorts } from './platform/index.js';
import type {
  KillDependencies,
  KillHistoryEntry,
  KillResult,
  PortRecord,
  TerminationMode,
} from './types.js';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultDependencies(): KillDependencies {
  return {
    discover: discoverOpenPorts,
    signal: (pid, signal) => process.kill(pid, signal),
    wait,
    platform: process.platform,
  };
}

function groupByPid(records: PortRecord[]): Map<number, PortRecord[]> {
  const groups = new Map<number, PortRecord[]>();
  for (const record of records) {
    if (record.pid === null) continue;
    const existing = groups.get(record.pid) ?? [];
    existing.push(record);
    groups.set(record.pid, existing);
  }
  return groups;
}

function sameEndpoint(left: PortRecord, right: PortRecord): boolean {
  return (
    left.pid === right.pid &&
    left.protocol === right.protocol &&
    left.port === right.port
  );
}

function sameProcess(
  requested: PortRecord[],
  liveForPid: PortRecord[],
): boolean {
  if (liveForPid.length === 0) return false;
  const requestedAnchor = requested[0];
  const liveAnchor = liveForPid[0];
  if (!requestedAnchor || !liveAnchor) return false;

  if (
    requestedAnchor.startedAt &&
    liveAnchor.startedAt &&
    Math.abs(
      Date.parse(requestedAnchor.startedAt) - Date.parse(liveAnchor.startedAt),
    ) > 2_000
  ) {
    return false;
  }

  if (
    requestedAnchor.processName &&
    liveAnchor.processName &&
    requestedAnchor.processName !== liveAnchor.processName
  ) {
    return false;
  }

  return requested.some((record) =>
    liveForPid.some((liveRecord) => sameEndpoint(record, liveRecord)),
  );
}

function errorMessage(error: unknown, platform: NodeJS.Platform): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EPERM'
  ) {
    return platform === 'win32'
      ? 'Permission denied. Retry from an Administrator terminal.'
      : 'Permission denied. Retry from an elevated shell if you trust this process.';
  }
  return error instanceof Error ? error.message : String(error);
}

export function impactRecordsForSelection(
  selected: PortRecord[],
  allRecords: PortRecord[],
): PortRecord[] {
  const pids = new Set(
    selected
      .map((record) => record.pid)
      .filter((pid): pid is number => pid !== null),
  );
  const seen = new Set<string>();
  return allRecords.filter((record) => {
    if (record.pid === null || !pids.has(record.pid)) return false;
    const key = `${record.pid}:${record.protocol}:${record.address}:${record.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface TerminateOptions {
  force?: boolean;
  dependencies?: KillDependencies;
  gracefulWaitMs?: number;
}

export async function terminateRecords(
  records: PortRecord[],
  options: TerminateOptions = {},
): Promise<KillResult[]> {
  const dependencies = options.dependencies ?? defaultDependencies();
  const force = options.force ?? false;
  const mode: TerminationMode =
    dependencies.platform === 'win32'
      ? 'windows'
      : force
        ? 'forced'
        : 'graceful';
  const groups = groupByPid(records);
  const results: KillResult[] = [];
  let liveBefore: PortRecord[];

  try {
    liveBefore = await dependencies.discover();
  } catch (error) {
    return [...groups].map(([pid, requestedRecords]) => ({
      pid,
      processName: requestedRecords[0]?.processName ?? 'unknown',
      requestedRecords,
      closedRecords: [],
      status: 'failed',
      mode,
      error: `Could not verify port ownership: ${errorMessage(error, dependencies.platform)}`,
    }));
  }

  const signaled = new Map<number, PortRecord[]>();

  for (const [pid, requestedRecords] of groups) {
    const processName = requestedRecords[0]?.processName ?? 'unknown';
    if (pid <= 1 || pid === process.pid) {
      results.push({
        pid,
        processName,
        requestedRecords,
        closedRecords: [],
        status: 'failed',
        mode,
        error: 'IHOP refuses to terminate PID 0, PID 1, or itself.',
      });
      continue;
    }

    const liveForPid = liveBefore.filter((record) => record.pid === pid);
    if (!sameProcess(requestedRecords, liveForPid)) {
      results.push({
        pid,
        processName,
        requestedRecords,
        closedRecords: [],
        status: 'changed',
        mode,
        error: 'Port ownership changed or the port already closed. Refresh and try again.',
      });
      continue;
    }

    try {
      const signal: NodeJS.Signals =
        dependencies.platform === 'win32'
          ? 'SIGTERM'
          : force
            ? 'SIGKILL'
            : 'SIGTERM';
      dependencies.signal(pid, signal);
      signaled.set(pid, requestedRecords);
    } catch (error) {
      results.push({
        pid,
        processName,
        requestedRecords,
        closedRecords: [],
        status: 'failed',
        mode,
        error: errorMessage(error, dependencies.platform),
      });
    }
  }

  if (signaled.size === 0) return results;

  await dependencies.wait(
    dependencies.platform === 'win32' || force
      ? 250
      : (options.gracefulWaitMs ?? GRACEFUL_WAIT_MS),
  );

  let liveAfter: PortRecord[];
  try {
    liveAfter = await dependencies.discover();
  } catch (error) {
    for (const [pid, requestedRecords] of signaled) {
      results.push({
        pid,
        processName: requestedRecords[0]?.processName ?? 'unknown',
        requestedRecords,
        closedRecords: [],
        status: 'failed',
        mode,
        error: `Signal sent, but IHOP could not verify the result: ${errorMessage(error, dependencies.platform)}`,
      });
    }
    return results;
  }

  for (const [pid, requestedRecords] of signaled) {
    const closedRecords = requestedRecords.filter(
      (record) =>
        !liveAfter.some((liveRecord) => sameEndpoint(record, liveRecord)),
    );
    const allClosed = closedRecords.length === requestedRecords.length;
    results.push({
      pid,
      processName: requestedRecords[0]?.processName ?? 'unknown',
      requestedRecords,
      closedRecords,
      status: allClosed ? 'closed' : 'survived',
      mode,
      ...(allClosed
        ? {}
        : { error: 'The process is still holding one or more selected ports.' }),
    });
  }

  return results;
}

export function historyEntriesFromResults(
  results: KillResult[],
  platform: NodeJS.Platform = process.platform,
  killedAt = new Date().toISOString(),
): KillHistoryEntry[] {
  return results
    .filter((result) => result.closedRecords.length > 0)
    .map((result) => ({
      id: `${killedAt}-${result.pid}`,
      killedAt,
      pid: result.pid,
      processName: result.processName,
      ports: result.closedRecords.map((record) => ({
        protocol: record.protocol,
        address: record.address,
        port: record.port,
      })),
      elapsedMs: result.requestedRecords[0]?.elapsedMs ?? null,
      mode: result.mode,
      platform,
    }));
}
