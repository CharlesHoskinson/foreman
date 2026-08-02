# Foreman Node.js and TypeScript Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. Use `superpowers:test-driven-development` for
> every behavior change and `superpowers:verification-before-completion`
> before every acceptance claim.

**Goal:** Implement the remaining v0.2.9.0 product modules on Node.js 24 in
TypeScript, migrate the existing Python/Bash/Bun product cores, and prevent new
legacy-runtime debt.

**Architecture:** Use a strict npm workspace with bounded product packages.
Grok implements one package in an isolated Foreman worktree. Codex verifies and
cold-audits complete diffs. Claude uses the TypeScript LSP plugin at commitment
boundaries. Council reviews immutable candidate commits. Effect owns typed
failures and resource lifetimes; pure transforms remain plain TypeScript.

**Tech stack:** Node.js 24, TypeScript, Effect, `node:test`, npm lockfiles,
OpenSpec, Foreman, Grok, Codex, Claude TypeScript LSP, Council, and Graphify.

## Global constraints

- Apply `AGENTS.md` and `openspec/changes/node-typescript-runtime/` to every
  package.
- Do not add executable Python, shell, PowerShell, CMD, JavaScript, MJS, CJS,
  Deno, or Bun-only source.
- Existing non-TypeScript files can become thin adapters only.
- Write TypeScript tests first and preserve the RED evidence.
- Compile and test with Node.js. Do not accept a test that passes only in Bun.
- Use exact locked dependencies and strict type checking.
- Preserve public command and data contracts until a versioned spec changes
  them.
- Preserve `.harness/`, `SPEC.md`, reports, and user files outside commits.
- Commit and push only after host verification and a cross-family cold audit.
- Rebuild the current Graphify unit after every accepted migration tranche.
- Do not tag v0.2.9.0 until all final gates pass at one unchanged commit.

## Work package 1: workspace and policy gate

**Add:** root `package.json`, `package-lock.json`, `tsconfig.base.json`,
`packages/core/`, `packages/policy/`, `skills/foreman/runtime/dist/`, and a
TypeScript runtime-policy checker.

- Add Node.js 24 engine enforcement and exact TypeScript, Node type, and Effect
  pins.
- Bundle runtime entry points and production dependencies into deterministic
  self-contained ESM under the installed skill tree. Record and verify digests.
- Add strict compiler settings and project references.
- Add closed typed errors, canonical JSON, and injectable filesystem, clock,
  process, and Git service interfaces.
- Add fail-capable policy fixtures for each prohibited source type, Bun-only
  imports, and adapters with domain logic.
- Add Linux and Windows CI gates.

## Work package 2: GraphStore

**Replace:** `skills/foreman/graph_store/` with
`packages/graph-store/src/` and TypeScript contract tests.

- Port the behavior contract, not the Python implementation shape.
- Reject unknown/missing schema fields, corrupt generations, links, external
  hard links, unsafe paths, and concurrent generation forks.
- Bind every snapshot to one immutable predecessor under a scoped lock.
- Make list/read fail closed on corruption.
- Run TypeScript parity fixtures against approved Python outputs, then remove
  the Python package and its runtime commands.

## Work package 3: launcher supervision

**Replace:** the Bun runtime in `launcher/` with Node.js package entry points.

- Preserve CLI, heartbeat, timeout, stream, and exit-code contracts.
- Remove Bun FFI and Bun spawn APIs.
- Use scoped child ownership, timers, streams, and cancellation.
- Add sustained short-child tests that detect zombie accumulation while the
  worker remains alive.
- Report an unsupported ownership capability before dispatch instead of
  claiming a guarantee the host cannot provide.

## Work package 4: event log

**Replace:** domain decoding in `skills/foreman/scripts/lib/eventlog.sh` with
`packages/event-log/`.

- Implement one closed decoder, bounded NDJSON replay, cursor rules, and
  attempt identity.
- Reject duplicate keys, non-finite values, trailing documents, invalid UTF-8,
  and torn records.
- Make SessionDB, metrics, and orchestration consume this module.

## Work package 5: SessionDB

**Replace:** `skills/foreman/scripts/fm-session.py` and freshness-sweep domain
logic with `packages/session/`.

- Preserve facts, measurements, obligations, recovery, freshness, sidecar,
  hydration, and graph projection.
- Add typed fact retraction and existing-successor supersession.
- Keep the canonical NDJSON sidecar lossless and add a separate derived current
  view that cannot hydrate the store.
- Migrate hourly checkpoints and release gates, then delete the Python core.

## Work package 6: release evidence

**Add:** `packages/release/`.

- Implement strict metrics event parsing, rollup, and release sigma.
- Implement package matrix and immutable package audits in TypeScript.
- Bind outputs to commit, tree, source digest, definition, denominator, and
  command.
- Refuse duplicate keys, non-finite values, suffix data, torn records, stale
  cursors, mixed definitions, and mutable sources.

## Work package 7: knowledge and doctrine

**Add:** `packages/knowledge/`.

- Implement Graphify refresh and freshness from immutable captured inputs.
- Use descriptor-bound reads and publications. Reject symlink/hard-link races,
  Git errors, executable mutation, warning-bearing version probes, overflow,
  timeout, and detached descendants.
- Implement the doctrine registry and current-authority export.
- Keep canonical SessionDB lineage lossless. Exclude retired facts only from a
  separate non-hydratable current view.

## Work package 8: orchestration and preflight

**Add:** `packages/orchestration/`.

- Implement round ownership and crash recovery with unique identities, closed
  provenance, trusted events, durable transactions, and typed sync failures.
- Implement vendor and WSL preflight with byte-exact process boundaries,
  bounded outputs, and scoped cleanup.
- Convert Setup, lane-run, and tool-check scripts to compatibility adapters.

## Work package 9: stale knowledge and legacy deletion

- Delete superseded live plans, status snapshots, duplicate evidence, and
  obsolete records after updating current references.
- Correct current commands and workspace paths against executable source.
- Delete each legacy implementation after parity and inbound-reference gates.
- Rebuild Graphify and require zero missing sources, dangling references, stale
  locations, and current-authority edges to deleted paths.

## Work package 10: convergence

- Run clean npm install, strict type checks, Node tests, runtime policy, legacy
  compatibility gates, docs checks, and strict OpenSpec validation.
- Run independent cold audits per package and rework every finding.
- Build one immutable final Council bundle from committed base and head.
- Refresh release notes and evidence from accepted commits only.
- Push the candidate and tag only after every release predicate passes.
