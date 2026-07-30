import { runCommand } from './command.js';
import { parseNetstatOutput, parseWindowsJson } from './parsers.js';
import type { PortRecord } from '../types.js';

const DISCOVERY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Get-Command Get-NetTCPConnection | Out-Null
Get-Command Get-NetUDPEndpoint | Out-Null
$processCache = @{}
function Get-IhopProcess([int]$ProcessId) {
  if (-not $processCache.ContainsKey($ProcessId)) {
    $value = $null
    try {
      $process = Get-Process -Id $ProcessId -ErrorAction Stop
      $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
      $startedAt = $null
      try { $startedAt = $process.StartTime.ToUniversalTime().ToString('o') } catch {}
      $parentPid = $null
      $parentProcessName = $null
      $launcher = $null
      if ($null -ne $cim) {
        $parentPid = $cim.ParentProcessId
        $current = $cim
        for ($depth = 0; $depth -lt 8; $depth++) {
          if ($null -eq $current -or $current.ParentProcessId -le 0) { break }
          $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)" -ErrorAction SilentlyContinue
          if ($null -eq $parent) { break }
          if ($depth -eq 0) { $parentProcessName = $parent.Name }
          $ancestor = "$($parent.Name) $($parent.CommandLine)"
          if ($ancestor -match 'ChatGPT|codex.*app-server') { $launcher = 'ChatGPT/Codex'; break }
          if ($ancestor -match 'Cursor') { $launcher = 'Cursor'; break }
          if ($ancestor -match 'Code.exe|Visual Studio Code') { $launcher = 'VS Code'; break }
          if ($ancestor -match 'WindowsTerminal') { $launcher = 'Windows Terminal'; break }
          if ($ancestor -match 'PowerShell') { $launcher = 'PowerShell' }
          $current = $parent
        }
      }
      $value = [pscustomobject]@{
        processName = $process.ProcessName
        startedAt = $startedAt
        parentPid = $parentPid
        parentProcessName = $parentProcessName
        launcher = $launcher
        commandLine = if ($null -ne $cim) { $cim.CommandLine } else { $null }
        executablePath = if ($null -ne $cim) { $cim.ExecutablePath } else { $process.Path }
        memoryBytes = $process.WorkingSet64
      }
    } catch {}
    $processCache[$ProcessId] = $value
  }
  return $processCache[$ProcessId]
}
$records = @()
Get-NetTCPConnection -State Listen | ForEach-Object {
  $process = Get-IhopProcess $_.OwningProcess
  $records += [pscustomobject]@{
    protocol = 'tcp'
    address = $_.LocalAddress
    port = $_.LocalPort
    pid = $_.OwningProcess
    processName = if ($null -ne $process) { $process.processName } else { $null }
    startedAt = if ($null -ne $process) { $process.startedAt } else { $null }
    parentPid = if ($null -ne $process) { $process.parentPid } else { $null }
    parentProcessName = if ($null -ne $process) { $process.parentProcessName } else { $null }
    launcher = if ($null -ne $process) { $process.launcher } else { $null }
    commandLine = if ($null -ne $process) { $process.commandLine } else { $null }
    executablePath = if ($null -ne $process) { $process.executablePath } else { $null }
    memoryBytes = if ($null -ne $process) { $process.memoryBytes } else { $null }
  }
}
Get-NetUDPEndpoint | ForEach-Object {
  $process = Get-IhopProcess $_.OwningProcess
  $records += [pscustomobject]@{
    protocol = 'udp'
    address = $_.LocalAddress
    port = $_.LocalPort
    pid = $_.OwningProcess
    processName = if ($null -ne $process) { $process.processName } else { $null }
    startedAt = if ($null -ne $process) { $process.startedAt } else { $null }
    parentPid = if ($null -ne $process) { $process.parentPid } else { $null }
    parentProcessName = if ($null -ne $process) { $process.parentProcessName } else { $null }
    launcher = if ($null -ne $process) { $process.launcher } else { $null }
    commandLine = if ($null -ne $process) { $process.commandLine } else { $null }
    executablePath = if ($null -ne $process) { $process.executablePath } else { $null }
    memoryBytes = if ($null -ne $process) { $process.memoryBytes } else { $null }
  }
}
ConvertTo-Json -InputObject @($records) -Compress
`.trim();

async function runPowerShell(script: string): Promise<string> {
  try {
    return (
      await runCommand('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ])
    ).stdout;
  } catch {
    return (
      await runCommand('pwsh.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ])
    ).stdout;
  }
}

async function enrichFallbackRecords(
  records: PortRecord[],
  now = Date.now(),
): Promise<PortRecord[]> {
  const pids = [
    ...new Set(
      records
        .map((record) => record.pid)
        .filter((pid): pid is number => pid !== null),
    ),
  ];
  if (pids.length === 0) return records;

  const script = String.raw`
$records = @()
Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object {
  $startedAt = $null
  try { $startedAt = $_.StartTime.ToUniversalTime().ToString('o') } catch {}
  $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue
  $records += [pscustomobject]@{
    protocol = 'tcp'
    address = '*'
    port = 1
    pid = $_.Id
    processName = $_.ProcessName
    startedAt = $startedAt
    parentPid = if ($null -ne $cim) { $cim.ParentProcessId } else { $null }
    commandLine = if ($null -ne $cim) { $cim.CommandLine } else { $null }
    executablePath = if ($null -ne $cim) { $cim.ExecutablePath } else { $_.Path }
    memoryBytes = $_.WorkingSet64
  }
}
ConvertTo-Json -InputObject @($records) -Compress
`.trim();

  try {
    const metadataRecords = parseWindowsJson(await runPowerShell(script), now);
    const metadata = new Map(
      metadataRecords
        .filter((record) => record.pid !== null)
        .map((record) => [record.pid, record] as const),
    );

    return records.map((record) => {
      const details = record.pid === null ? undefined : metadata.get(record.pid);
      return details
        ? {
            ...record,
            processName: details.processName,
            startedAt: details.startedAt,
            elapsedMs: details.elapsedMs,
            parentPid: details.parentPid,
            parentProcessName: details.parentProcessName,
            launcher: details.launcher,
            commandLine: details.commandLine,
            executablePath: details.executablePath,
            cpuPercent: details.cpuPercent,
            memoryBytes: details.memoryBytes,
          }
        : record;
    });
  } catch {
    return records;
  }
}

export async function discoverWindowsPorts(
  now = Date.now(),
): Promise<PortRecord[]> {
  try {
    return parseWindowsJson(await runPowerShell(DISCOVERY_SCRIPT), now);
  } catch {
    const { stdout } = await runCommand('netstat.exe', ['-ano']);
    return enrichFallbackRecords(parseNetstatOutput(stdout), now);
  }
}
