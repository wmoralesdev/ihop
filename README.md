# IHOP

[![npm version](https://img.shields.io/npm/v/@wmoralesdev/ihop.svg)](https://www.npmjs.com/package/@wmoralesdev/ihop)
[![CI](https://github.com/wmoralesdev/ihop/actions/workflows/ci.yml/badge.svg)](https://github.com/wmoralesdev/ihop/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**I Hate Open Ports.** A small, interactive CLI for finding the local servers
you forgot about and closing their ports safely.

```sh
npx @wmoralesdev/ihop
```

```text
◆  Select ports to close
│
│  ○ TCP  3000 · next-server · Cursor/my-app · 42m · local
│  ○ TCP  5173 · vite · Terminal/dashboard · 2h 5m · all
│  ○ UDP  5353 · Browser Helper · 1d 0h · all
│
└  ↑/↓ navigate · Space select · Enter confirm · Type search
```

## Why IHOP?

- See every listening TCP and locally bound UDP port in one searchable list.
- Focus on likely web apps without losing access to the complete port view.
- Replace generic runtime names such as `node` with the real tool when possible.
- See which app or agent launched a process and which project it belongs to.
- Inspect sanitized process details without exposing likely secrets.
- Close several ports safely with impact disclosure and PID revalidation.
- Keep a private, local history of successful closures.

## Install

IHOP requires Node.js 22 or newer and supports macOS, Linux, and Windows.

```sh
npm install --global @wmoralesdev/ihop
ihop
```

You can also run it without a global install:

```sh
npx @wmoralesdev/ihop
```

## Commands

```text
ihop                         Open the interactive menu
ihop 3000 [3001 ...]         Close one or more ports
ihop list                    Show all local listeners
ihop list --web              Show likely web applications
ihop details 3000            Show detailed process information
ihop recent                  Show recently killed ports
ihop 3000 --yes              Skip the initial confirmation
ihop 3000 --force            Force termination immediately
ihop --help                  Show command help
```

Direct kills require confirmation in a terminal. Scripts and agents must pass
`--yes`. On macOS and Linux, IHOP first sends `SIGTERM`, waits two seconds, and
offers to force-close survivors in an interactive terminal. Windows process
termination is immediate because Windows does not implement POSIX signals.

## What counts as a web app?

The web view includes common development ports and listeners owned by familiar
web runtimes such as Node.js, Bun, Deno, Python, Ruby, PHP, Java, .NET, Vite,
Next.js, Nuxt, Astro, Webpack, Rails, and Docker proxy processes.

The all-ports view includes listening TCP endpoints and unconnected, locally
bound UDP endpoints. It intentionally does not show established outbound
connections.

Compact rows use the real tool name when it can be inferred and add the
launcher, project folder, runtime, and network exposure without showing a raw
command line. Choose **Inspect port details** or run `ihop details <port>` for
the sanitized command, parent process, working directory, executable, exact
start time, CPU, memory, owner, and every endpoint owned by that process.

## Safety and privacy

- IHOP rechecks PID ownership immediately before sending a signal.
- PID 0, PID 1, and IHOP's own process are protected.
- Killing one process can close multiple ports; IHOP shows that impact first.
- IHOP never invokes `sudo`, requests elevation, or sends telemetry.
- Only successful, verified closures are written to local history.
- History is capped at 50 entries in the operating system's standard local
  state directory.

Processes owned by another user may be visible without being killable. Retry
from an elevated shell only when you understand and trust the target process.

## Platform tools

- macOS uses the built-in `lsof` and `ps`.
- Linux prefers `ss` and falls back to `lsof`; install either `iproute2` or
  `lsof` if your distribution omits both.
- Windows uses built-in PowerShell networking cmdlets and falls back to
  `netstat`.

If process age or ownership is unavailable because of platform permissions,
IHOP shows `—` and still displays the endpoint.

## Development

```sh
git clone https://github.com/wmoralesdev/ihop.git
cd ihop
npm install
npm run check
npm run dev -- list
```

The test suite includes parser fixtures for every supported platform and an
integration test that starts, discovers, and safely closes temporary TCP and
UDP servers.

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request. Maintainers can follow [RELEASING.md](RELEASING.md) for
the npm release process.

## License

MIT © wmoralesdev.

IHOP is an independent developer tool and is not affiliated with or endorsed by
IHOP Restaurants LLC.
