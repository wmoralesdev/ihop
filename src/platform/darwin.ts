import { runCommand } from './command.js';
import { parseLsofOutput } from './parsers.js';
import type { PortRecord } from '../types.js';

export async function discoverDarwinPorts(): Promise<PortRecord[]> {
  const [tcp, udp] = await Promise.all([
    runCommand(
      '/usr/sbin/lsof',
      ['-nP', '-FpcLfnPT', '-iTCP', '-sTCP:LISTEN'],
      [0, 1],
    ),
    runCommand('/usr/sbin/lsof', ['-nP', '-FpcLfnP', '-iUDP'], [0, 1]),
  ]);

  return [
    ...parseLsofOutput(tcp.stdout, 'tcp'),
    ...parseLsofOutput(udp.stdout, 'udp'),
  ];
}
