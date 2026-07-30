import { runCommand } from './command.js';
import { parseLsofOutput, parseSsOutput } from './parsers.js';
import type { PortRecord } from '../types.js';

export async function discoverLinuxPorts(): Promise<PortRecord[]> {
  try {
    const { stdout } = await runCommand('ss', ['-H', '-lntup']);
    return parseSsOutput(stdout);
  } catch {
    const [tcp, udp] = await Promise.all([
      runCommand(
        'lsof',
        ['-nP', '-FpcLfnPT', '-iTCP', '-sTCP:LISTEN'],
        [0, 1],
      ),
      runCommand('lsof', ['-nP', '-FpcLfnP', '-iUDP'], [0, 1]),
    ]);

    return [
      ...parseLsofOutput(tcp.stdout, 'tcp'),
      ...parseLsofOutput(udp.stdout, 'udp'),
    ];
  }
}
