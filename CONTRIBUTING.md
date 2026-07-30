# Contributing to IHOP

Thanks for helping improve IHOP.

## Development setup

IHOP requires Node.js 22 or newer.

```sh
git clone https://github.com/wmoralesdev/ihop.git
cd ihop
npm install
npm run check
```

Run the CLI from source with:

```sh
npm run dev
npm run dev -- list
npm run dev -- details 3000
```

## Making a change

1. Create a focused branch from `main`.
2. Keep behavior consistent across macOS, Linux, and Windows, or document why a
   platform cannot expose the same metadata.
3. Add parser fixtures or behavior tests for changes to port discovery.
4. Never include real tokens, passwords, or sensitive process arguments in
   fixtures, screenshots, issues, or commits.
5. Run `npm run check` before opening a pull request.

The integration test binds temporary localhost TCP and UDP ports and terminates
only its own child fixture:

```sh
IHOP_INTEGRATION=1 npm test -- --run test/integration.test.ts
```

## Reporting issues

Use the GitHub issue templates for bugs and feature requests. Report security
problems privately according to [SECURITY.md](SECURITY.md).
