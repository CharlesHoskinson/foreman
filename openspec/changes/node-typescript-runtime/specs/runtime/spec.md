# Spec delta — Node.js and TypeScript runtime

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: new executable code is Node.js TypeScript

WHEN a change adds executable source or tests, Foreman SHALL accept only
TypeScript that targets Node.js 24.

- The change SHALL NOT add Python, Bash, shell, PowerShell, CMD, JavaScript,
  MJS, CJS, Deno, or Bun-only executable source.
- TypeScript SHALL compile with strict type checking.
- Product entry points SHALL execute with Node.js.

#### Scenario: a candidate adds a Python helper

- WHEN the architecture policy gate compares the candidate with its merge base
- AND the candidate adds an executable `.py` helper
- THEN the gate fails and names the path and prohibited runtime.

#### Scenario: a TypeScript module runs with Node.js

- WHEN a clean checkout installs the exact locked dependencies, compiles the
  module, and runs its tests with Node.js 24
- THEN type checking and tests pass without invoking Bun, Deno, or Python.

### Requirement: compatibility adapters contain no product logic

WHILE a legacy non-TypeScript command path is still required, Foreman SHALL
limit that file to a thin adapter for one compiled TypeScript entry point.

- The adapter MAY locate Node.js and the repository, forward arguments and
  environment, execute the entry point, and preserve signals, byte streams,
  and exit status.
- The adapter SHALL NOT parse domain records, own state, implement policy,
  retry work, schedule work, or supervise descendants.

#### Scenario: a legacy adapter contains a domain branch

- WHEN a modified legacy adapter parses a readiness record and selects a
  remediation branch
- THEN the architecture policy gate fails and identifies the forbidden logic.

### Requirement: Effect has a bounded role

WHEN a TypeScript module owns fallible effects or resource lifetimes, Foreman
SHALL represent them with Effect and typed domain failures.

- This applies to filesystem handles, atomic publication, child processes,
  cancellation, retries, timeouts, concurrency, and injected services.
- Pure deterministic transforms SHALL remain ordinary TypeScript functions.

#### Scenario: cancellation releases owned resources

- WHEN a running module is interrupted during a bounded subprocess or atomic
  publication operation
- THEN its Effect scope closes owned handles, timers, temporary paths, and
  child processes
- AND the caller receives a typed interruption or domain failure.

### Requirement: migration preserves public contracts

WHEN a legacy implementation is replaced, Foreman SHALL preserve its reviewed
command-line arguments, environment inputs, stdout bytes, stderr bytes, exit
codes, and durable data contract until a separate versioned change modifies
that contract.

#### Scenario: a compatibility caller uses the migrated GraphStore

- WHEN the caller invokes the retained command path with a valid legacy
  argument vector
- THEN the adapter invokes the compiled TypeScript module
- AND the observable result matches the approved parity fixture.

### Requirement: migrated legacy source is deleted

WHEN every caller uses a TypeScript replacement and all parity controls pass,
Foreman SHALL delete the replaced legacy implementation from the repository.

#### Scenario: GraphStore migration completes

- WHEN the TypeScript GraphStore passes its contract, compatibility, and cold
  audit gates
- AND a repository reference scan finds no Python GraphStore consumer
- THEN the Python GraphStore source is deleted
- AND Graphify contains no current-authority edge to the deleted source.

### Requirement: installed modules are self-contained

WHEN Foreman installs by symlink, junction, or copied skill directory, every
migrated command SHALL resolve the same verified Node.js bundle from inside the
installed `skills/foreman` tree.

- A runtime bundle SHALL NOT require a repository sibling or root
  `node_modules` directory.
- Setup and plugin-drift SHALL verify one bundle digest manifest before Use.

#### Scenario: a copied skill runs without the repository

- WHEN a built `skills/foreman` tree is copied to a clean vendor skill home
- AND the repository root and root `node_modules` are absent
- THEN the copied command passes its smoke test with Node.js 24
- AND bundle-manifest verification reports no missing or changed runtime file.
