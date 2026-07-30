export type Protocol = 'tcp' | 'udp';

export interface PortRecord {
  protocol: Protocol;
  address: string;
  port: number;
  pid: number | null;
  processName: string | null;
  owner: string | null;
  startedAt: string | null;
  elapsedMs: number | null;
  parentPid: number | null;
  parentProcessName: string | null;
  launcher: string | null;
  commandLine: string | null;
  cwd: string | null;
  executablePath: string | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  isWebCandidate: boolean;
}

export interface ProcessMetadata {
  pid: number;
  processName: string | null;
  owner: string | null;
  startedAt: string | null;
  elapsedMs: number | null;
  parentPid: number | null;
  parentProcessName: string | null;
  launcher: string | null;
  commandLine: string | null;
  cwd: string | null;
  executablePath: string | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
}

export interface ProcessTreeEntry {
  pid: number;
  parentPid: number;
  commandLine: string;
}

export interface ProcessPathDetails {
  pid: number;
  cwd: string | null;
  executablePath: string | null;
}

export type TerminationMode = 'graceful' | 'forced' | 'windows';

export interface KillHistoryPort {
  protocol: Protocol;
  address: string;
  port: number;
}

export interface KillHistoryEntry {
  id: string;
  killedAt: string;
  pid: number;
  processName: string;
  ports: KillHistoryPort[];
  elapsedMs: number | null;
  mode: TerminationMode;
  platform: NodeJS.Platform;
}

export interface KillResult {
  pid: number;
  processName: string;
  requestedRecords: PortRecord[];
  closedRecords: PortRecord[];
  status: 'closed' | 'survived' | 'failed' | 'changed';
  mode: TerminationMode;
  error?: string;
}

export interface DiscoverOptions {
  platform?: NodeJS.Platform;
  now?: number;
}

export interface KillDependencies {
  discover: () => Promise<PortRecord[]>;
  signal: (pid: number, signal: NodeJS.Signals) => void;
  wait: (milliseconds: number) => Promise<void>;
  platform: NodeJS.Platform;
}
