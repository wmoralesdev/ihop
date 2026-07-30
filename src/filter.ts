import { COMMON_WEB_PORTS, WEB_PROCESS_PATTERN } from './constants.js';
import type { PortRecord } from './types.js';

export function isLikelyWebApp(
  port: number,
  processName: string | null,
): boolean {
  return (
    COMMON_WEB_PORTS.has(port) ||
    (processName !== null && WEB_PROCESS_PATTERN.test(processName))
  );
}

export function withWebCandidate(record: PortRecord): PortRecord {
  return {
    ...record,
    isWebCandidate: isLikelyWebApp(record.port, record.processName),
  };
}

export function webAppRecords(records: PortRecord[]): PortRecord[] {
  return records.filter((record) => record.isWebCandidate);
}
