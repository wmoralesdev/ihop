import { execFile } from 'node:child_process';

export class CommandError extends Error {
  readonly command: string;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(
    command: string,
    exitCode: number | null,
    stderr: string,
    cause?: unknown,
  ) {
    super(
      stderr.trim() || `Command failed: ${command}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'CommandError';
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(
  file: string,
  args: string[],
  allowedExitCodes: number[] = [0],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && 'code' in error && typeof error.code === 'number'
            ? error.code
            : error
              ? null
              : 0;

        if (error && (exitCode === null || !allowedExitCodes.includes(exitCode))) {
          reject(new CommandError(file, exitCode, stderr, error));
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}
