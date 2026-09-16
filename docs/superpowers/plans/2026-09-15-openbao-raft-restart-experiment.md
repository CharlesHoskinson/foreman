# OpenBao isolated Raft restart experiment

> **For agentic workers:** Use superpowers:subagent-driven-development after parent and independent brief review.

**Goal:** Check acknowledged managed state across graceful and forced restarts of one disposable OpenBao server process.

**Architecture:** Use one private single-node Raft directory and the accepted managed adapter. Keep generated unseal material only in parent memory.

**Tech Stack:** Node.js 24, TypeScript, Effect, existing esbuild, and verified OpenBao 2.6.2.

## Global constraints

- OpenBao is the sole durable credential and lifecycle authority. WSL and Linux are equal production targets.
- Do not modify product source, installed runtime, package exports, dependencies, services, or host configuration.
- Do not read live credentials, execute vendor CLIs, reboot hosts, shut down WSL, or modify the index or commits.
- All data belongs to this disposable experiment. Synthetic credentials enter only its disposable OpenBao storage and private memory or transport.
- Keep credential values outside logs, reports, command arguments, and the Obsidian vault. Exclude all live credentials.
- This is not production qualification, multi-node availability, backup restoration, power-loss testing, or a host restart.
- Do not infer acceptance of the unresolved administrative-erasure policy.
- Use Effect for resource lifetime, cancellation, and bounded execution. Do not add a scheduler or daemon.

## Admission and ownership

Status: Independent admission review approved with the clarifications incorporated below. Require source review before execution.
This experiment is an isolated subset of PROD02 and Task 2 restart evidence, not full acceptance of either.

Create only these scratch files:

- `.superpowers/sdd/openbao-raft-restart-probe.ts`: isolated server, state transitions, restart sequence, and sanitized receipt.
- `.superpowers/sdd/openbao-raft-restart-checks.ts`: pure complete-evidence predicate.
- `.superpowers/sdd/openbao-raft-restart-checks.test.ts`: negative controls before implementation.
- `.superpowers/sdd/production-raft-restart-report.md`: test commands, results, hashes, and limits.

Reuse `runWithRuntimeCleanup` and `confirmAbsent` from `openbao-managed-write-probe-cleanup.ts`.
Reuse `bindBinaryReceipt`, `snapshotBinary`, `observeChild`, `request`, `waitReady`, and `confirmListenerClosed` from existing pilot helpers.
Reuse `planTransition` and `makeSyntheticOpenBaoManagedStore`. Do not replace them with raw credential writes.

## Verified binary and private storage

Use binary `/root/research/openbao-pilot-20260915-MYD9Qc/bao`.
Require binary SHA256 `8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00`.
Require adjacent receipt SHA256 `d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef`.
Verify and snapshot the binary before starting it.
Create a private runtime with mkdtemp under /tmp. Create its Raft data directory with mode 0700.
Choose two different ephemeral loopback ports for the API and cluster listeners.
Close the reservation listeners before spawning. Bind failure is a failed experiment, never a retry against another service.

Generate this configuration in the private runtime with mode 0600, substituting only generated paths and ports:

```hcl
storage "raft" {
  path = "GENERATED_RUNTIME/raft"
  node_id = "synthetic-restart-node"
}
listener "tcp" {
  address = "127.0.0.1:GENERATED_API_PORT"
  cluster_address = "127.0.0.1:GENERATED_CLUSTER_PORT"
  tls_disable = true
}
api_addr = "http://127.0.0.1:GENERATED_API_PORT"
cluster_addr = "https://127.0.0.1:GENERATED_CLUSTER_PORT"
```

These substitutions are executable fixture inputs, not operator defaults. Never copy this plaintext-loopback fixture into production deployment examples.
Do not add obsolete disable_mlock configuration. OpenBao removed mlock in version 2.0.
Spawn the snapshot with `server -config=GENERATED_CONFIG_PATH`, never `-dev`.
Set private HOME and minimal PATH/LANG. Drain server stdout and stderr without displaying their contents.
Attach the existing child supervisor immediately. Track every spawned server until exit.

## Initialization and bounds

Use a 90-second experiment AbortSignal and bounded requests. Cap each readiness wait at ten seconds.
Pass that signal through each operation explicitly. The existing runtime helper does not propagate it automatically.
Use an independent 20-second cleanup budget and signal, never the expired experiment signal, for final cleanup.
Attempt shutdown of every tracked child even when another shutdown fails, then attempt runtime removal.
Use the supervisor's bounded stop. Bound cleanup confirmation and filesystem completion without converting timeouts into successful cleanup.
Poll GET /v1/sys/init until HTTP 200 with a boolean initialized field, while checking child exit and cancellation.
Require initialized=false before the only initialization POST. After restarts, require initialized=true and never initialize again.
Initialize once with POST /v1/sys/init and `{ "secret_shares": 1, "secret_threshold": 1 }`.
This one-share configuration is for disposable testing only.
Require a nonempty root_token and exactly one nonempty keys_base64 entry. Keep both in memory only.
Use POST /v1/sys/unseal with that key. Require sealed=false, then waitReady.
Use only the generated root token for this isolated server. Never resolve an environment or native credential fallback.
Create a dedicated KV v2 mount and require CAS at the mount.

## Exact experiment sequence

1. Import synthetic active material with CAS 0 through the managed adapter. Require acknowledgement generation 1 and exact private readback.
2. Stop the first server gracefully. Require `{ code: 0, signal: null, spawnFailed: false }`. Confirm both listener ports close.
3. Start a new server process with the same configuration and Raft directory. Require initialized=true without repeating initialization.
4. Require GET /v1/sys/seal-status HTTP 200 with sealed=true before unseal. A managed observation must fail with closed Unavailable while sealed.
5. Unseal from the parent-held key. Construct a new managed adapter. Require generation 1 and exact active material after restart.
6. Prepare and retain a CAS-1 refresh proposal from this fresh generation-1 observation. Then plan removal from the same observation.
   Commit the material-free tombstone with CAS 1 and require acknowledgement generation 2.
7. Send SIGKILL only to the owned server process. Require its observed exit signal SIGKILL and both listeners closed.
8. Start another server process with the same directory. Require initialized=true and seal-status HTTP 200 with sealed=true, then unseal.
9. Construct another new managed adapter. Require exact generation 2, tombstoned state, and no material property.
10. Submit the previously prepared stale active-generation refresh proposal with CAS 1. Require Conflict, then reobserve the unchanged generation 2 tombstone.
11. Stop the final server and remove the owned runtime. Require all tracked children exited, both listeners closed, and ENOENT for the runtime.

Never use a cached observation as proof of post-restart state. Do not claim provider refresh occurred.
For every readback, check metadata version, wire data version, and the complete expected envelope before private material comparison.
The initializedAfterRestart field covers both restarts. The listenersClosed field covers every required shutdown, not only final cleanup.
Shutdown and cleanup failures must prevent any passing receipt. Runtime removal must still be attempted after shutdown failure.

## Evidence predicate and TDD

Export `validateRestartEvidence(input: unknown): boolean` from the checks module.
Require exactly these boolean fields, all true:

```typescript
const success = {
  activeBeforeRestart: true, gracefulExit: true, initializedAfterRestart: true,
  sealedReadRefused: true, activeAfterRestart: true, tombstoneAcknowledged: true,
  forcedExit: true, tombstoneAfterForcedRestart: true, staleWriteConflict: true,
  finalTombstoneUnchanged: true, allChildrenExited: true, listenersClosed: true,
  runtimeRemoved: true,
};
```

- [ ] Add tests before the checks implementation. Require the exact success record to pass.
- [ ] For each field, require false, omission, and string "true" to fail.
- [ ] Require extra fields, null, arrays, accessors, symbols, and nonplain records to fail without executing accessors.
- [ ] Record RED, then implement the predicate and record GREEN.
- [ ] Implement the probe. Set evidence fields only after their corresponding assertions execute.
- [ ] Run parent verification and independent source review before the real-server experiment.

Write a private receipt only after the complete predicate passes and cleanup is confirmed.
Use mode 0600 in a private mode 0700 report directory created after successful runtime cleanup.
Include scope, binary pins, source/bundle hashes, the evidence booleans, and productionQualified=false.
Keep platformHostQualified=false, backupRestoreQualified=false, and powerLossQualified=false.
Reject the generated root token, unseal key, and synthetic material as canaries before writing the receipt.
Emit only its path and a passed Boolean. On failure emit a closed phase label, never exception details.

## Verification

Run `node --import tsx --test .superpowers/sdd/openbao-raft-restart-checks.test.ts`.
Compile the probe and tests with esbuild into a fresh private /tmp directory. Run compiled tests from /tmp.
Run a focused strict TypeScript check on all three files. Do not run the root runtime build.
After source review, execute the compiled probe with Node.js from /tmp.
Verify report modes, hashes, predicate result, child cleanup, and unchanged product hashes independently.
Record command exit codes and actual evidence. A failed or unexecuted experiment is not a pass.

## Primary references

- https://openbao.org/docs/configuration/storage/raft/
- https://openbao.org/docs/configuration/listener/tcp/
- https://openbao.org/docs/api/system/init/
- https://openbao.org/docs/api/system/unseal/
- https://openbao.org/docs/release-notes/2-0-0/
