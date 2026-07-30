import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { terminateRecords } from '../src/killer.js';
import { discoverOpenPorts } from '../src/platform/index.js';

let child: ChildProcess | null = null;

function startFixtureServer(): Promise<{
  pid: number;
  tcpPort: number;
  udpPort: number;
}> {
  const source = String.raw`
const net = require('node:net');
const dgram = require('node:dgram');
const tcp = net.createServer();
const udp = dgram.createSocket('udp4');
tcp.listen(0, '127.0.0.1', () => {
  udp.bind(0, '127.0.0.1');
});
udp.on('listening', () => {
  process.stdout.write(JSON.stringify({
    tcpPort: tcp.address().port,
    udpPort: udp.address().port
  }) + '\n');
});
process.on('SIGTERM', () => {
  tcp.close();
  udp.close();
  setTimeout(() => process.exit(0), 25);
});
setInterval(() => {}, 1000);
`;

  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['-e', source], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const pid = child.pid;
    if (!pid || !child.stdout || !child.stderr) {
      reject(new Error('Could not start fixture server.'));
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const line = stdout.split(/\r?\n/)[0];
      if (!line) return;
      try {
        const ports = JSON.parse(line) as { tcpPort: number; udpPort: number };
        resolve({ pid, ...ports });
      } catch {
        reject(new Error(`Invalid fixture output: ${line}`));
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!stdout) reject(new Error(`Fixture exited ${code}: ${stderr}`));
    });
  });
}

async function findFixturePorts(
  pid: number,
  tcpPort: number,
  udpPort: number,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const records = await discoverOpenPorts();
    const found = records.filter(
      (record) =>
        record.pid === pid &&
        (record.port === tcpPort || record.port === udpPort),
    );
    if (
      found.some(
        (record) => record.protocol === 'tcp' && record.port === tcpPort,
      ) &&
      found.some(
        (record) => record.protocol === 'udp' && record.port === udpPort,
      )
    ) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

afterEach(() => {
  if (child?.pid && child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // The fixture may already be gone.
    }
  }
  child = null;
});

describe('platform integration', () => {
  it.runIf(process.env.IHOP_INTEGRATION === '1')(
    'discovers and safely closes a real TCP/UDP fixture process',
    async () => {
      const fixture = await startFixtureServer();
      const records = await findFixturePorts(
        fixture.pid,
        fixture.tcpPort,
        fixture.udpPort,
      );
      expect(records).toHaveLength(2);
      expect(records.every((record) => record.elapsedMs !== null)).toBe(true);
      expect(records.every((record) => record.commandLine !== null)).toBe(true);
      expect(records.every((record) => record.executablePath !== null)).toBe(
        true,
      );
      expect(records.every((record) => record.memoryBytes !== null)).toBe(true);

      const results = await terminateRecords(records, {
        gracefulWaitMs: 500,
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe('closed');
    },
    60_000,
  );
});
