# Change: node-typescript-runtime

## Why

Foreman has product logic in Bash, Python, and Bun-specific TypeScript. This
split makes schemas, errors, process ownership, and recovery behavior disagree
across entry points. It also lets release work add more code to runtimes that
the repository intends to retire.

The project owner has established one architecture rule: all new executable
code runs on Node.js and is written in TypeScript. Foreman will migrate the
existing product incrementally without breaking current command contracts.

## What changes

- Add one Node.js 24 workspace with strict TypeScript compilation and exact
  dependency pins.
- Use Effect where code owns typed failures, resources, cancellation, retries,
  timeouts, or concurrent work.
- Implement new behavior in TypeScript packages. Do not add executable Python,
  shell, PowerShell, CMD, JavaScript, MJS, or CJS source.
- Restrict existing non-TypeScript entry points to thin compatibility adapters.
- Migrate GraphStore, launcher supervision, the event log, release metrics,
  knowledge refresh, SessionDB, doctrine checks, round ownership, preflight,
  and package audits in dependency order.
- Delete each legacy implementation after all callers use its TypeScript
  replacement and parity controls pass.
- Add a policy gate that rejects architecture regressions.

## Impact

- **Runtime:** Node.js 24 is required. Bun is a legacy launcher dependency
  until the launcher migration lands, then it is removed.
- **Language:** TypeScript is the only language for new executable source and
  tests.
- **Compatibility:** Existing public commands and exit codes remain stable
  through thin adapters during migration.
- **Installation:** Compiled Node.js entry points ship inside the Foreman skill
  tree so symlink, junction, and copied installs resolve the same bytes.
- **Release:** `v0.2.9.0` cannot ship while a new release-gap implementation is
  Python, shell, or Bun-only.
- **Affected packages:** `graph-store-port`, `lane-ownership-and-reaping`,
  `decision-lineage-and-telemetry`, `knowledge-plane-refresh`,
  `doctrine-reality-drift`, `round-ownership-default`, `wsl-preflight`,
  `vendor-preflight`, SessionDB, and `v029-release-convergence`.
