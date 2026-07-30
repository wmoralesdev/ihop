import { userInfo } from 'node:os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { RECENT_DISPLAY_LIMIT } from './constants.js';
import {
  formatHistoryEntry,
  formatPortDetails,
  formatPortRecord,
} from './format.js';
import {
  historyEntriesFromResults,
  impactRecordsForSelection,
  terminateRecords,
} from './killer.js';
import { appendHistory, readHistory } from './history.js';
import { discoverOpenPorts } from './platform/index.js';
import type { KillResult, PortRecord } from './types.js';

function currentUsername(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

function portKey(record: PortRecord, index: number): string {
  return [
    index,
    record.protocol,
    record.address,
    record.port,
    record.pid ?? 'unknown',
  ].join(':');
}

function formatImpact(records: PortRecord[]): string {
  const byPid = new Map<number, PortRecord[]>();
  for (const record of records) {
    if (record.pid === null) continue;
    const existing = byPid.get(record.pid) ?? [];
    existing.push(record);
    byPid.set(record.pid, existing);
  }

  return [...byPid]
    .map(([pid, processRecords]) => {
      const processName = processRecords[0]?.processName ?? 'unknown';
      const ports = processRecords
        .map((record) => `${record.protocol.toUpperCase()} ${record.port}`)
        .join(', ');
      return `${processName} (PID ${pid})\n  ${ports}`;
    })
    .join('\n');
}

function resultLabel(result: KillResult): string {
  const ports = result.requestedRecords
    .map((record) => record.port)
    .filter((port, index, values) => values.indexOf(port) === index)
    .join(', ');
  return `${result.processName} (PID ${result.pid}) · ${ports}`;
}

function reportResults(results: KillResult[]): void {
  for (const result of results) {
    switch (result.status) {
      case 'closed':
        p.log.success(`Closed ${resultLabel(result)}`);
        break;
      case 'survived':
        p.log.warn(`${resultLabel(result)} is still open.`);
        break;
      case 'changed':
        p.log.warn(`${resultLabel(result)} was not touched. ${result.error ?? ''}`);
        break;
      case 'failed':
        p.log.error(`Could not close ${resultLabel(result)}. ${result.error ?? ''}`);
        break;
    }
  }
}

export interface CloseRecordsOptions {
  yes?: boolean;
  force?: boolean;
  interactive?: boolean;
  isTTY?: boolean;
}

export async function closeRecords(
  selected: PortRecord[],
  allRecords: PortRecord[],
  options: CloseRecordsOptions = {},
): Promise<number> {
  const impacts = impactRecordsForSelection(selected, allRecords);
  const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY);
  if (impacts.length === 0) {
    p.log.error('No selectable process owns those ports.');
    return 1;
  }

  p.note(formatImpact(impacts), 'This will close');

  if (!(options.yes ?? false)) {
    if (!isTTY) {
      p.log.error('Confirmation requires a terminal. Retry with --yes.');
      return 2;
    }

    const confirmed = await p.confirm({
      message: `Close ${new Set(impacts.map((record) => record.pid)).size} process${new Set(impacts.map((record) => record.pid)).size === 1 ? '' : 'es'}?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Nothing was closed.');
      return 0;
    }
  }

  const spinner = process.stdout.isTTY ? p.spinner() : null;
  spinner?.start(
    options.force
      ? 'Force-closing ports'
      : process.platform === 'win32'
        ? 'Closing ports'
        : 'Closing ports gracefully',
  );

  const initialResults = await terminateRecords(impacts, {
    force: options.force ?? false,
  });
  spinner?.stop('Port check complete');

  const survivors = initialResults.filter(
    (result) => result.status === 'survived',
  );
  let finalResults = initialResults;

  if (survivors.length > 0 && !(options.force ?? false)) {
    let shouldForce = false;
    if (isTTY && (options.interactive ?? false)) {
      const response = await p.confirm({
        message: `${survivors.length} process${survivors.length === 1 ? '' : 'es'} still holding ports. Force-close?`,
        initialValue: false,
      });
      shouldForce = !p.isCancel(response) && response;
    }

    if (shouldForce) {
      const forceSpinner = process.stdout.isTTY ? p.spinner() : null;
      forceSpinner?.start('Force-closing remaining ports');
      const forcedResults = await terminateRecords(
        survivors.flatMap((result) => result.requestedRecords),
        { force: true },
      );
      forceSpinner?.stop('Force-close complete');
      finalResults = [
        ...initialResults.filter((result) => result.status !== 'survived'),
        ...forcedResults,
      ];
    } else {
      p.log.info('Retry surviving ports with --force to close them immediately.');
    }
  }

  reportResults(finalResults);

  const historyEntries = historyEntriesFromResults(finalResults);
  if (historyEntries.length > 0) {
    try {
      await appendHistory(historyEntries);
    } catch {
      p.log.warn('Ports were closed, but the local history could not be updated.');
    }
  }

  return finalResults.every((result) => result.status === 'closed') ? 0 : 1;
}

async function chooseRecords(
  records: PortRecord[],
  message: string,
): Promise<PortRecord[] | null> {
  if (records.length === 0) {
    p.log.info('No matching open ports.');
    return [];
  }

  const lookup = new Map<string, PortRecord>();
  const options = records.map((record, index) => {
    const key = portKey(record, index);
    lookup.set(key, record);
    const protectedPid =
      record.pid === 0 || record.pid === 1 || record.pid === process.pid;
    return {
      value: key,
      label: formatPortRecord(record, currentUsername()),
      ...(record.pid === null
        ? { disabled: true, hint: 'process unavailable' }
        : protectedPid
          ? { disabled: true, hint: 'protected process' }
          : {}),
    };
  });

  const selected = await p.autocompleteMultiselect({
    message,
    options,
    placeholder: 'Type a port or process name',
    maxItems: 12,
    required: false,
  });
  if (p.isCancel(selected)) return null;

  return selected
    .map((key) => lookup.get(String(key)))
    .filter((record): record is PortRecord => record !== undefined);
}

async function showRecentHistory(): Promise<boolean> {
  const history = (await readHistory()).slice(0, RECENT_DISPLAY_LIMIT);
  if (history.length === 0) {
    p.log.info('Nothing has been killed by IHOP yet.');
  } else {
    p.note(history.map(formatHistoryEntry).join('\n'), 'Recently killed');
  }

  const action = await p.select({
    message: 'What next?',
    options: [
      { value: 'back', label: 'Back to ports' },
      { value: 'exit', label: 'Exit' },
    ],
  });
  return !p.isCancel(action) && action === 'back';
}

async function showPortDetails(records: PortRecord[]): Promise<boolean> {
  if (records.length === 0) {
    p.log.info('No open ports to inspect.');
    return true;
  }

  const lookup = new Map<string, PortRecord>();
  const options = records.map((record, index) => {
    const key = portKey(record, index);
    lookup.set(key, record);
    return {
      value: key,
      label: formatPortRecord(record, currentUsername()),
    };
  });
  const selectedKey = await p.autocomplete({
    message: 'Select a port to inspect',
    options,
    placeholder: 'Type a port, process, project, or launcher',
    maxItems: 12,
  });
  if (p.isCancel(selectedKey)) return true;

  const selected = lookup.get(String(selectedKey));
  if (!selected) return true;
  p.note(formatPortDetails(selected, records), 'Port details');

  const canClose =
    selected.pid !== null &&
    selected.pid > 1 &&
    selected.pid !== process.pid;
  const action = await p.select({
    message: 'What next?',
    options: [
      { value: 'back' as const, label: 'Back to ports' },
      ...(canClose
        ? [{ value: 'close' as const, label: 'Close this process' }]
        : []),
      { value: 'exit' as const, label: 'Exit' },
    ],
  });
  if (p.isCancel(action)) return true;
  if (action === 'close') {
    await closeRecords([selected], records, { interactive: true });
    return true;
  }
  return action === 'back';
}

function parsePromptPorts(value: string): number[] | string {
  const pieces = value.split(/[\s,]+/).filter(Boolean);
  if (pieces.length === 0) return 'Enter at least one port.';
  const ports = pieces.map(Number);
  if (
    ports.some(
      (port) => !Number.isInteger(port) || port < 1 || port > 65_535,
    )
  ) {
    return 'Ports must be whole numbers between 1 and 65535.';
  }
  return [...new Set(ports)];
}

async function promptForPorts(records: PortRecord[]): Promise<PortRecord[] | null> {
  const value = await p.text({
    message: 'Which port?',
    placeholder: '3000',
    validate(input) {
      const result = parsePromptPorts(input ?? '');
      return typeof result === 'string' ? result : undefined;
    },
  });
  if (p.isCancel(value)) return null;
  const ports = parsePromptPorts(value);
  if (typeof ports === 'string') return [];
  return records.filter((record) => ports.includes(record.port));
}

export async function runInteractive(): Promise<number> {
  if (!process.stdin.isTTY) {
    p.log.error('The interactive menu requires a terminal. Try `ihop list`.');
    return 2;
  }

  p.intro(`${pc.bgCyan(pc.black(' IHOP '))} ${pc.dim('I hate open ports.')}`);

  while (true) {
    let records: PortRecord[];
    try {
      records = await discoverOpenPorts();
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      p.outro('Could not inspect local ports.');
      return 1;
    }

    const historyCount = (await readHistory()).length;
    const webCount = records.filter((record) => record.isWebCandidate).length;
    const action = await p.select({
      message: 'What do you want to inspect?',
      options: [
        { value: 'web', label: 'Web apps', hint: String(webCount) },
        { value: 'all', label: 'All open ports', hint: String(records.length) },
        { value: 'details', label: 'Inspect port details' },
        {
          value: 'recent',
          label: 'Recently killed',
          hint: String(historyCount),
        },
        { value: 'port', label: 'Enter a port' },
        { value: 'exit', label: 'Exit' },
      ],
    });

    if (p.isCancel(action) || action === 'exit') {
      p.outro('Your ports are safe. For now.');
      return 0;
    }

    if (action === 'recent') {
      if (!(await showRecentHistory())) {
        p.outro('Your ports are safe. For now.');
        return 0;
      }
      continue;
    }

    if (action === 'details') {
      if (!(await showPortDetails(records))) {
        p.outro('Your ports are safe. For now.');
        return 0;
      }
      continue;
    }

    const candidates =
      action === 'web'
        ? records.filter((record) => record.isWebCandidate)
        : records;
    const selected =
      action === 'port'
        ? await promptForPorts(records)
        : await chooseRecords(
            candidates,
            action === 'web' ? 'Select web apps to close' : 'Select ports to close',
          );

    if (selected === null) {
      p.cancel('Nothing was closed.');
      continue;
    }
    if (selected.length === 0) {
      p.log.info(
        action === 'port'
          ? 'That port is not currently open.'
          : 'Nothing selected.',
      );
      continue;
    }

    await closeRecords(selected, records, { interactive: true });
  }
}
