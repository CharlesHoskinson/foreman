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
- The compiled `verify-install` command SHALL verify one bundle digest
  manifest before Use for repository, copied, symlink, and junction skill
  roots.
- Runtime plugin-drift (`plugin-drift` on the architecture-policy CLI) SHALL
  compare verified source and installed runtime manifests. Legacy Setup and
  whole-skill `tools/plugin-drift.sh` ports remain open until the
  orchestration sprint.

#### Scenario: a copied skill runs without the repository

- WHEN a built `skills/foreman` tree is copied to a clean vendor skill home
- AND the repository root and root `node_modules` are absent
- THEN the copied command passes its smoke test with Node.js 24
- AND bundle-manifest verification reports no missing or changed runtime file.

### Requirement: destructive actions require typed admission and execution

WHEN Foreman proposes a destructive action, `@foreman/policy` SHALL deny the
action unless one strict current-register entry authorizes the exact action
and a typed executor implements it.

- The canonical register SHALL be one sentinel-delimited canonical JSON block
  in `docs/releases/v0.3.0-destruction-log.md`.
- The decoder SHALL reject missing or duplicate sentinels, unknown fields,
  duplicate IDs, malformed UTF-8, oversized input, glob targets, group
  targets, incomplete owner or recovery evidence, pending values, expired
  approval, and candidate, tree, digest, size, or action mismatch.
- Historical incidents SHALL never authorize current action.
- An `approved` state SHALL be necessary but SHALL NOT be sufficient. The
  executor, exact action identity, current repository identity, and recovery
  contract SHALL also match.
- The first typed executor SHALL support only `artifact_relocate`. Worktree
  removal, branch deletion, tracked-file deletion, artifact deletion, and
  unknown action kinds SHALL remain unsupported and denied.

#### Scenario: current DST-0060 is checked before approval

- WHEN the compiled guard checks the exact `DST-0060` intent while its register
  state is `blocked`
- THEN it emits one canonical `Denied` JSON line
- AND it exits 1
- AND it does not modify the source or recovery target.

#### Scenario: an exact approved artifact is relocated

- WHEN one unexpired `approved` `artifact_relocate` entry binds the current
  candidate, source regular-file identity, byte length, SHA-256 digest,
  recovery owner, and exclusive recovery target
- THEN the Effect executor copies to an exclusive temporary file beside the
  recovery target, flushes it, renames it atomically, verifies the target, and
  only then unlinks the source
- AND interruption preserves at least one verified copy
- AND the command emits one canonical result line without raw paths,
  exceptions, environment values, or input text.

#### Scenario: an approved worktree removal has no executor

- WHEN an entry says `approved` for worktree removal
- THEN the guard returns `Denied` with reason `unsupported_action`
- AND no shell cleanup command runs.

### Requirement: destruction guard command has a closed interface

WHEN Node.js invokes the compiled `foreman-destruction-guard` bundle, the
command SHALL accept only `check` or `relocate-artifact`, read bounded JSON
from stdin, and emit exactly one canonical JSON line.

- Exit 0 SHALL mean `Authorized` for `check` or `Completed` for
  `relocate-artifact`.
- Exit 1 SHALL mean `Denied` or a typed runtime failure.
- Exit 64 SHALL mean invalid invocation.
- Results SHALL contain stable identifiers and closed reason codes. They SHALL
  NOT contain raw paths, provider output, stack traces, or secret text.

#### Scenario: copied install runs the same guard

- WHEN only a copied `skills/foreman` tree and Node.js 24 are available
- THEN manifest verification and the `DST-0060` denial smoke test pass without
  repository siblings or root `node_modules`.
