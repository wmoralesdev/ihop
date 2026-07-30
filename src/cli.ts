#!/usr/bin/env node

import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { RECENT_DISPLAY_LIMIT } from './constants.js';
import {
  formatHistoryEntry,
  formatPortDetails,
  formatPortRecord,
} from './format.js';
import { readHistory } from './history.js';
import { discoverOpenPorts } from './platform/index.js';
import { closeRecords, runInteractive } from './ui.js';

const VERSION = '0.1.0';

const HELP = `
${pc.bold('IHOP')} — I Hate Open Ports

${pc.bold('Usage')}
  ihop                         Open the interactive menu
  ihop 3000 [3001 ...]         Close one or more ports
  ihop list                    Show all listening TCP and bound UDP ports
  ihop list --web              Show likely web applications
  ihop details 3000            Show detailed process information
  ihop recent                  Show recently killed ports

${pc.bold('Options')}
  -y, --yes                    Skip the initial confirmation
  -f, --force                  Force termination immediately
  -h, --help                   Show help
  -v, --version                Show version
`.trim();

function printHelp(): void {
  console.log(HELP);
}

function currentUsername(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

function parsePorts(values: string[]): number[] {
  const ports = values.map(Number);
  if (
    ports.length === 0 ||
    ports.some(
      (port) => !Number.isInteger(port) || port < 1 || port > 65_535,
    )
  ) {
    throw new Error('Ports must be whole numbers between 1 and 65535.');
  }
  return [...new Set(ports)];
}

async function listCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    options: {
      web: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (parsed.values.help) {
    console.log('Usage: ihop list [--web]');
    return 0;
  }

  const allRecords = await discoverOpenPorts();
  const records = parsed.values.web
    ? allRecords.filter((record) => record.isWebCandidate)
    : allRecords;

  if (records.length === 0) {
    console.log(
      parsed.values.web
        ? 'No likely web applications are listening.'
        : 'No open local ports found.',
    );
    return 0;
  }

  const username = currentUsername();
  for (const record of records) {
    console.log(formatPortRecord(record, username));
  }
  return 0;
}

async function recentCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (parsed.values.help) {
    console.log('Usage: ihop recent');
    return 0;
  }

  const history = (await readHistory()).slice(0, RECENT_DISPLAY_LIMIT);
  if (history.length === 0) {
    console.log('Nothing has been killed by IHOP yet.');
    return 0;
  }
  for (const entry of history) console.log(formatHistoryEntry(entry));
  return 0;
}

async function detailsCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help) {
    console.log('Usage: ihop details <port...>');
    return 0;
  }

  const ports = parsePorts(parsed.positionals);
  const records = await discoverOpenPorts();
  const selected = records.filter((record) => ports.includes(record.port));
  if (selected.length === 0) {
    p.log.error(
      `Port${ports.length === 1 ? '' : 's'} ${ports.join(', ')} ${ports.length === 1 ? 'is' : 'are'} not open.`,
    );
    return 1;
  }

  for (const [index, record] of selected.entries()) {
    if (index > 0) console.log('');
    console.log(formatPortDetails(record, records));
  }
  return 0;
}

async function directCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    options: {
      yes: { type: 'boolean', short: 'y', default: false },
      force: { type: 'boolean', short: 'f', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (parsed.values.version) {
    console.log(VERSION);
    return 0;
  }
  if (parsed.values.help) {
    printHelp();
    return 0;
  }
  if (parsed.positionals.length === 0) {
    if (parsed.values.yes || parsed.values.force) {
      throw new Error('--yes and --force require at least one port.');
    }
    return runInteractive();
  }

  const ports = parsePorts(parsed.positionals);
  const records = await discoverOpenPorts();
  const selected = records.filter((record) => ports.includes(record.port));
  if (selected.length === 0) {
    p.log.error(
      `Port${ports.length === 1 ? '' : 's'} ${ports.join(', ')} ${ports.length === 1 ? 'is' : 'are'} not open.`,
    );
    return 1;
  }

  return closeRecords(selected, records, {
    yes: parsed.values.yes,
    force: parsed.values.force,
    interactive: process.stdin.isTTY,
  });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const command = args[0];
    if (command === 'list') return await listCommand(args.slice(1));
    if (command === 'details') return await detailsCommand(args.slice(1));
    if (command === 'recent') return await recentCommand(args.slice(1));
    return await directCommand(args);
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main();
