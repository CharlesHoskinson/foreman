# OpenBao Cross-Process Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development after this brief receives review acceptance. The main agent applies separate task gates.

**Goal:** Measure real OpenBao CAS across two compiled Node processes and observe the retained tombstone from a fresh client process.

**Architecture:** A scratch harness owns one disposable OpenBao server and three client processes across two phases. Two concurrent contenders submit identical tombstones. A fresh observer verifies current state, submits a previously prepared stale refresh proposal, and verifies current state again.

**Tech Stack:** Node.js 24, strict TypeScript, Effect, Node IPC, Node test runner, existing TypeScript compiler, OpenBao 2.6.2.

## Status and authority

Status: Draft for review. This document does not record an executed experiment.
Review this brief before implementation. Keep implementation and experiment execution separate from this planning task.

The user authorized continued synthetic work. No live account selection or provider operation belongs to this experiment.
The erasure policy remains undecided. This experiment makes no historical erasure decision.

Read these controlling documents before implementation:

- `AGENTS.md` and the complete `AGENT_TRAPS.md`.
- `docs/superpowers/specs/2026-09-15-openbao-production-platforms-design.md`.
- `docs/superpowers/specs/2026-09-15-openbao-production-contracts.md`.
- `docs/superpowers/plans/2026-09-15-openbao-production-sprint.md`.

## Global constraints

- Use Node.js 24 and strict TypeScript for all new executable source.
- Use Effect for resource ownership, typed failures, deadlines, cancellation, and concurrent operations.
- Keep deterministic evidence validation in ordinary TypeScript.
- Preserve accepted Store 2B2 and Store 2B3 without edits.
- Import accepted source directly. Do not add runtime or package exports.
- Do not add dependencies, services, commits, index writes, or installed runtime changes.
- Do not invoke vendor CLIs or read native credential files.
- Use only generated synthetic values beginning with `foreman-synthetic-`.
- Keep secrets outside argv, stdout, stderr, reports, model inputs, and public digests.
- Use bounded private IPC for client bootstrap and material transfer.
- Run one attempt. Do not retry a mutation, restart a failed client, or select another server port after failure.
- Keep one disposable dev server alive throughout the observation sequence.
- Do not test persistent storage, server restart, host interruption, restoration, erasure, pruning, destruction, or fresh recovery.

The dev server is permitted only for this synthetic experiment. It cannot satisfy the production deployment contract.
The three client children are trusted scratch host clients. They are not provider workers or a proposed production authority channel.

## Exact file ownership

Create only these implementation source files after review acceptance:

| File | Responsibility |
| --- | --- |
| `.superpowers/sdd/openbao-cross-process-probe.ts` | Own server, runtime, client supervision, barrier, evidence checks, and sanitized report |
| `.superpowers/sdd/openbao-cross-process-worker.ts` | Execute contender or fresh-observer protocol using accepted store source |
| `.superpowers/sdd/openbao-cross-process-contract.ts` | Define private frames, decode closed frames, and validate evidence |
| `.superpowers/sdd/openbao-cross-process-probe.test.ts` | Test evidence rejection and parent supervision with compiled fixture children |
| `.superpowers/sdd/openbao-cross-process-fixture.ts` | Produce controlled child protocol, stream, timeout, and exit failures without OpenBao |

Reserve `.superpowers/sdd/cross-process-build/` for compiler output.
Write the execution report to a fresh `/root/research/openbao-cross-process-probe-` directory.
Create that directory with `mkdtemp`. Write `report.json` using mode `0600` and exclusive creation.
Do not edit historical reports or the accepted probe.

Reuse these files without modification:

- `packages/providers/src/credential-lifecycle.ts`.
- `packages/providers/src/openbao-managed-store.ts` and their accepted dependencies.
- `scripts/openbao-pilot/binary-receipt.ts`.
- `scripts/openbao-pilot/lifecycle.ts`.
- `.superpowers/sdd/openbao-managed-write-probe-cleanup.ts`.
- `.superpowers/sdd/openbao-managed-write-probe-cleanup.test.ts`.

Use `.superpowers/sdd/openbao-managed-write-probe.ts` as setup reference only.
Its same-process result is not evidence for this experiment.

## Accepted source contracts

Use `planTransition(key, current, transition): Result<CasWrite>` to prepare proposals.
Use `makeSyntheticOpenBaoManagedStore(config)` in each actual client process.
Use the accepted `observeMetadata`, `observeData`, and `write` methods.

The accepted store has separate metadata and data observations. Do not implement the earlier proposed aggregate `observe` port.
Require `metadataPresent` followed by `managed` data for existing state.
Require metadata current version, data version, and envelope generation to agree.

Use key `{ provider: 'codex', account: 'synthetic' }` and mount `cross-process-probe`.
Import from explicit metadata absence with CAS 0. Require acknowledged generation 1 and exact private material comparison.
Prepare both removal and stale refresh proposals from this same active generation 1 observation before starting contenders.
Require both proposals to contain `expectedVersion: 1` and envelope generation 2.
The removal envelope must contain only provider, account, schemaVersion, generation, and state.
The stale refresh envelope contains synthetic material wrapped with `Redacted.make` inside the receiving process.

The observer must submit the retained stale proposal to `store.write` after observing the tombstone.
Do not replace this write with a local `planTransition` refusal.
Require the actual write result to be the closed `ManagedFailure` code `Conflict`.

## Private protocol

Use `fork` with an absolute compiled worker path and `execPath: process.execPath`.
Set `execArgv: []`. Use `serialization: 'json'` and `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`.
Set each child environment to its isolated `HOME`, `PATH: '/usr/bin:/bin'`, and `LANG: 'C'` only.
Use a separate mode-0700 child directory under the owned runtime for each HOME and cwd.

The parent sends JSON text through IPC. Check UTF-8 byte length before sending and before parsing received text.
Reject non-string messages, messages larger than 8192 bytes, malformed JSON, extra fields, and invalid field values.
Limit each direction to four frames per child and 32768 cumulative bytes.
Reject extra messages after a terminal frame. Treat an IPC send callback error as failure.

Define these closed frame variants in `openbao-cross-process-contract.ts`:

| Direction | Variant | Exact fields |
| --- | --- | --- |
| Parent to contender | `initialize-contender` | `kind`, `runId`, `slot`, `endpoint`, `mount`, `token`, `proposal` |
| Contender to parent | `ready` | `kind`, `runId`, `slot`, `pid`, `expectedVersion`, `generation`, `state` |
| Parent to contender | `go` | `kind`, `runId`, `slot`, `deadline` |
| Contender to parent | `write-result` | `kind`, `runId`, `slot`, `pid`, `result` |
| Parent to observer | `initialize-observer` | `kind`, `runId`, `slot`, `endpoint`, `mount`, `token`, `staleProposal`, `deadline` |
| Observer to parent | `observation-result` | `kind`, `runId`, `slot`, `pid`, `before`, `staleResult`, `after` |
| Child to parent | `failed` | `kind`, `runId`, `slot`, `pid`, `code` |

Use a random 16-byte hexadecimal `runId` without credential content.
Use slots `a`, `b`, and `observer`. Bind each received frame to its assigned slot and parent-recorded child PID.
Require the endpoint to equal the parent-owned loopback origin. Require the exact mount and account defined above.
Require token and material strings to have the synthetic prefix and lengths from 1 through 256 characters.
Validate proposal fields exactly. Transfer only plain JSON wire values across IPC.
Convert active proposal material to `Redacted` only inside the observer.

Define `result` and `staleResult` as `{ kind: 'written', generation: number }` or `{ kind: 'refused', code: FailureCode }`.
Do not emit a failure cause, HTTP response, envelope, material field, or diagnostic string.
Use closed failure codes `InvalidFrame`, `InvalidEvidence`, `InvalidProvenance`, `SpawnFailed`, `ChildFailed`, `Timeout`, `LeakDetected`, `CleanupFailed`, and `OperationFailed`.
Map unknown failures to `OperationFailed`. Keep managed failure codes only inside the defined refusal result.
Use stages `setup`, `create`, `barrier`, `race`, `observer`, `independent`, `cleanup`, and `report`.
Define each observation as `{ metadataVersion, dataVersion, generation, state, materialPresent }`.
Check material presence with `Object.hasOwn(envelope, 'material')` inside the observing process.
Require all observation versions to equal 2, state to equal `tombstoned`, and material presence to equal false.

Contenders construct their store and validate the identical proposal before sending `ready`.
Neither contender writes before receiving its one matching `go` frame.
The parent waits for both ready frames before sending either go frame.
The parent records both sends before waiting for either write result.
This barrier establishes concurrent eligibility. It does not prove simultaneous packet arrival.

Require two distinct contender PIDs, both different from the harness PID.
Wait for both terminal messages, normal zero exits, stream closure, and IPC closure before starting the observer.
Require a distinct observer PID and a newly constructed store.
Do not send the active observation or either contender result to the observer.
Send only private connection bootstrap and the retained stale proposal.
The observer reads current state, attempts the stale write once, and reads current state again.

## Bounded process and secret handling

Use a 60000 ms operation deadline and a separate bounded cleanup phase.
Cap each store operation at 5000 ms or the remaining operation time, whichever is shorter.
Cap contender initialization and each client terminal wait at 10000 ms.
Cap the complete observer operation at 20000 ms within the global deadline.
Use accepted `waitReady` with its 10000 ms maximum.
Its bounded health polling is readiness observation, not a retry of credential operations.

Call `observeChild` synchronously after every spawn.
Own the runtime through `runWithRuntimeCleanup` and its Effect finalizer.
Attempt all child stops even when one stop fails. Then let the runtime finalizer attempt removal.
Use each recorded child's `stop` method. Never use process-name matching for cleanup.
Each stop has the accepted 2000 ms TERM and 2000 ms KILL waits.
Do not use the expired operation signal to cancel cleanup.
Fail the experiment if any stop, runtime removal, or cleanup confirmation fails.

Capture worker stdout and stderr privately with a 4096-byte maximum per stream.
Require both worker streams to be empty. Never forward their contents or interpolate them into errors.
Reject overflow immediately. Match synthetic canaries across chunk boundaries before discarding captured buffers.
Drain OpenBao stdout and stderr without forwarding, reporting, or persistent capture.
OpenBao dev output can contain bootstrap data. Do not treat that private stream as public evidence.

Generate root token, initial material, and stale refresh material in memory.
Use `BAO_DEV_ROOT_TOKEN_ID` only in the private server environment, as the accepted probe does.
Use the same minimal server environment and `-dev-no-store-token` argument.
Do not inherit operator environment variables into any child.
Check client argv and environment construction with canary tests.
Inspect only newly owned runtime files for canaries before removal. Emit Boolean results, never file contents.
Do not claim memory erasure or protection against same-UID/root inspection.

## OpenBao provenance and server setup

Use these existing pins exactly:

```text
binary=/root/research/openbao-pilot-20260915-MYD9Qc/bao
binarySha256=8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00
receiptSha256=d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef
```

Call `bindBinaryReceipt` before starting OpenBao. Call `snapshotBinary` into the owned private runtime.
Execute only that snapshot. Refuse missing or changed provenance without downloading or selecting another binary.
Select one ephemeral loopback port with a temporary listener, as the accepted probe does.
Treat a port handover collision as failure. Do not retry.
Mount KV v2 once. Set `cas_required: true` once and read configuration back to confirm it.
Use accepted bounded `request` for setup and direct independent verification.

After observer completion, independently request current KV metadata and current data from the parent.
Require metadata version 2, data version 2, tombstone generation 2, and the exact material-free envelope field set.
Require no deletion time or destruction flag for the current record.
This independent wire check corroborates the worker/store observation. Keep response bodies private.

## Task 1: Reject false evidence and process failures

**Files:** The contract, test, fixture, and exported scratch supervision functions in the probe.
**Produces:** Closed frame decoders and an evidence checker used by the actual harness.

- [ ] Define `checkEvidence(input: unknown): { ok: true } | { ok: false, code: 'InvalidEvidence' }`.
- [ ] Define `decodeFrame(text: unknown): { ok: true, value: Frame } | { ok: false, code: 'InvalidFrame' }`.
- [ ] Define `Frame` as the exact union specified in the private protocol section.
- [ ] Record parent-observed events separately from child-supplied fields.
- [ ] Test the checker against a complete valid fixture and each invalid case below.
- [ ] Test the real parent supervision path using the compiled fixture executable.
- [ ] Observe failing tests before implementing the missing checks.
- [ ] Run the compiled tests successfully before any OpenBao experiment.

Use these exact evidence types in the scratch contract:

```typescript
type WriteResult =
  | { readonly kind: 'written'; readonly generation: number }
  | { readonly kind: 'refused'; readonly code: FailureCode };
type Observation = {
  readonly metadataVersion: number;
  readonly dataVersion: number;
  readonly generation: number;
  readonly state: 'active' | 'tombstoned';
  readonly materialPresent: boolean;
};
type ExitEvidence = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnFailed: boolean;
};
type ClosureEvidence = {
  readonly exit: ExitEvidence;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly streamsClosed: boolean;
  readonly ipcClosed: boolean;
  readonly closedSequence: number;
};
type ContenderEvidence = {
  readonly pid: number;
  readonly slot: 'a' | 'b';
  readonly readyRunId: string;
  readonly readyPid: number;
  readonly readySequence: number;
  readonly expectedVersion: number;
  readonly generation: number;
  readonly state: 'tombstoned';
  readonly proposalMatches: boolean;
  readonly goSequence: number;
  readonly resultRunId: string;
  readonly resultPid: number;
  readonly resultSequence: number;
  readonly result: WriteResult;
  readonly closure: ClosureEvidence;
};
type ObserverEvidence = {
  readonly pid: number;
  readonly slot: 'observer';
  readonly spawnSequence: number;
  readonly resultRunId: string;
  readonly resultPid: number;
  readonly resultSequence: number;
  readonly before: Observation;
  readonly staleResult: WriteResult;
  readonly after: Observation;
  readonly closure: ClosureEvidence;
};
type Evidence = {
  readonly runId: string;
  readonly harnessPid: number;
  readonly a: ContenderEvidence;
  readonly b: ContenderEvidence;
  readonly observer: ObserverEvidence;
  readonly independent: {
    readonly observation: Observation;
    readonly exactEnvelopeFields: boolean;
    readonly deleted: boolean;
    readonly destroyed: boolean;
    readonly sequence: number;
  };
  readonly cleanup: {
    readonly workersStopped: boolean;
    readonly serverExit: ExitEvidence;
    readonly listenerClosed: boolean;
    readonly runtimeRemoved: boolean;
    readonly sequence: number;
  };
};
```

Import `FailureCode` from the accepted lifecycle source.
Reject unknown fields in these types recursively, including each union arm.
Require positive safe integers for PIDs and sequence numbers, and nonnegative safe integers for byte counts.
Require zero stream bytes, true closure flags, zero client exit codes, null client signals, and false spawn failures.
Require each reported PID and run ID to match the parent binding.
Set `proposalMatches` from comparison against the parent-created removal proposal before sending bootstrap.
Require both proposalMatches values to be true. Validate each ready tuple as CAS 1, generation 2, and tombstoned.
Require independent verification after observer closure and cleanup after independent verification.
Require cleanup flags true and server spawnFailed false. A recorded server termination signal is valid cleanup evidence.
Require server exit code non-null or termination signal non-null.

The parent assigns monotonically increasing sequence numbers. Child messages cannot supply parent evidence.
Require both ready receives before either go send, both go sends before result acceptance, and contender closure before observer spawn.
Require exactly one `written` generation 2 and one `refused` Conflict across contenders.
Require both observer reads and the independent read to satisfy the tombstone predicate.
Require stale refusal `Conflict` and successful cleanup. Reject missing or unknown fields at every evidence level.

Required negative cases:

| Group | Cases that must fail |
| --- | --- |
| Race | Two winners, two conflicts, zero results, duplicate slot, winner generation 1 or 3, non-Conflict refusal |
| Identity | Same PIDs, harness PID used by child, observer PID reused, wrong runId, wrong slot, forged PID |
| Ordering | Write before go, go before both ready, observer before contender closure, duplicate ready, duplicate terminal frame |
| Observation | Active state, missing materialPresent, materialPresent true, mismatched versions, stale write success, absent independent result |
| Child outcome | Exit 0 without terminal message, success frame then nonzero exit, signal exit, spawn error, early disconnect |
| Protocol | Malformed JSON, non-string IPC, unknown fields, oversized frame, cumulative overflow, send failure, messages after terminal |
| Bounds | Child never ready, child never exits, observer hangs, operation deadline expires, stream overflow |
| Leakage | Canary in stdout, stderr, rejected frame, failure cause, report candidate, argv, or client environment |
| Cleanup | One stop fails, another child still needs stop, removal fails, listener remains open, EACCES or EIO during absence check |

Use fixture modes supplied through private IPC. The fixture must not contact OpenBao or invoke another program.
Timeout fixtures may use injected short deadline values. Exercise the same supervision functions as the real harness.
Keep assertion output free of secret-bearing actual values. Assert Boolean leak checks with fixed failure messages.

## Task 2: Implement the worker and disposable harness

**Files:** Worker and probe. Preserve the accepted source files.
**Consumes:** Accepted store ports, closed frames, tested supervision, and tested evidence checker.
**Produces:** One synthetic cross-process attempt and one sanitized result after cleanup.

- [ ] Implement the contender state machine with initialize, ready, go, write-result, and clean exit states.
- [ ] Implement the observer sequence with fresh store construction and two current-state reads.
- [ ] Implement private parent bootstrap and the two-contender barrier.
- [ ] Add the independent current metadata/data check.
- [ ] Route every operation failure through a closed stage and code pair.
- [ ] Test worker decoding, refusal, and lifecycle handling through the compiled fixture tests.
- [ ] Run strict compilation and all compiled controls.
- [ ] Execute the actual harness once only after every control passes.
- [ ] Inspect the sanitized report content and its cleanup evidence.

## Exact verification commands

Run build commands from `/root/foreman-native-login-20260915` after review and implementation.
Each command must complete successfully before the next command starts.

```text
node --version
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2024 --module NodeNext --moduleResolution NodeNext --types node .superpowers/sdd/openbao-cross-process-probe.ts .superpowers/sdd/openbao-cross-process-worker.ts .superpowers/sdd/openbao-cross-process-contract.ts .superpowers/sdd/openbao-cross-process-probe.test.ts .superpowers/sdd/openbao-cross-process-fixture.ts .superpowers/sdd/openbao-managed-write-probe-cleanup.test.ts
./node_modules/.bin/esbuild .superpowers/sdd/openbao-cross-process-probe.ts .superpowers/sdd/openbao-cross-process-worker.ts .superpowers/sdd/openbao-cross-process-probe.test.ts .superpowers/sdd/openbao-cross-process-fixture.ts .superpowers/sdd/openbao-managed-write-probe-cleanup.test.ts --bundle --packages=bundle --alias:@foreman/core=./packages/core/src/index.ts --platform=node --target=node24 --format=esm --outdir=.superpowers/sdd/cross-process-build --metafile=.superpowers/sdd/cross-process-build/meta.json
cd /tmp && node --test /root/foreman-native-login-20260915/.superpowers/sdd/cross-process-build/openbao-cross-process-probe.test.js /root/foreman-native-login-20260915/.superpowers/sdd/cross-process-build/openbao-managed-write-probe-cleanup.test.js
cd /tmp && node /root/foreman-native-login-20260915/.superpowers/sdd/cross-process-build/openbao-cross-process-probe.js
cd /root/foreman-native-login-20260915
git diff --check
```

Require Node major version 24. Refuse another major version.
Compilation must exit zero with no diagnostics. Tests must pass with no skips or cancellations.
Bundle dependencies privately. Do not execute unresolved package imports or shared runtime entry points.
Inspect `meta.json` before execution. Require external imports to be Node built-ins only.
Reject inputs beneath `skills/foreman/runtime/` or package `dist/` directories.
The command explicitly maps `@foreman/core` to its source entry point.
Stop if another package resolves to a shared runtime artifact. Resolve that build discrepancy during task review.
Do not change package exports or installed artifacts to make bundling work.
Record the exact resolved build command in the execution report.
The harness must locate the compiled worker beside its own emitted file using `import.meta.url`.
Guard the probe entry point so test imports do not start OpenBao.
Before execution, bind SHA-256 values for all listed source files, accepted imports, and emitted harness/worker artifacts into the report.
Check those bytes again before reporting success. Refuse changed inputs.
Do not publish digests of token or material values.

## Report and success proof limits

Publish success only after all clients and the server exit, the listener closes, and runtime absence returns ENOENT.
Call `confirmListenerClosed` and `confirmAbsent` for those checks.
Scan the serialized report with `assertNoReportLeaks` using all generated secret canaries before exclusive report creation.
Permit stdout to contain only `{ "report": absoluteReportPath, "passed": true }` on success.
Permit stderr to contain only a closed `{ "failed": true, "stage": stage, "code": code }` object on failure.
Do not print caught exceptions or partially decoded messages.

The report must include the checked binary pins, source/artifact hashes, actual platform label, and parent-observed process evidence.
Include the two race results, both fresh-process observations, stale refusal, independent verification, and cleanup results.
Set `scope` to `disposable-openbao-2.6.2-cross-process-cas-client-restart`.
Set `productionQualified`, `persistenceQualified`, `authorizationQualified`, and `providerRefreshOwnershipQualified` to false.
Set `erasurePolicySelected` and `historicalErasureProven` to false.
Record `serverRestartTested: false` and `freshRecoveryTested: false`.

Success proves one real cross-process CAS race and fresh-client visibility on the measured disposable server.
Success also proves refusal of one retained stale generation 1 durable refresh proposal.
It does not prove persistent-server restart, crash durability, provider refresh exclusion, delivery revocation, historical erasure, or platform production readiness.
The tombstone lacks current material. Older KV versions may retain material until the disposable server terminates.
Neither this fact nor runtime cleanup chooses the product erasure policy.

## Review handoff

- [ ] Confirm exact ownership excludes accepted Store 2B2/2B3 and runtime exports.
- [ ] Confirm known-bad evidence and worker-failure controls precede actual execution.
- [ ] Confirm both contenders use separate compiled Node processes and identical CAS 1 proposals.
- [ ] Confirm the fresh observer starts after both contenders close.
- [ ] Confirm stale refusal comes from actual OpenBao CAS, not local validation alone.
- [ ] Confirm no persistent-server restart or erasure policy decision entered this brief.
- [ ] Record review disposition before admitting implementation.
