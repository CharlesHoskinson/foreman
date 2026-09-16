# Fable correction follow-up

Use test-driven implementation and independent review for one complete correction package.
The user requested “Fix everything”. This is the next bounded correction of the same synthetic package.

## Evidence and scope

Read the full verified audit receipt:
`/root/research/foreman-fable-corrections-retry-EAqkpk/audit.json`.
Fable 5.1 returned WARNING for snapshot
`8e0171adfb9aa0b260d253737e609871515130245312bd2770cb5d533ef5a261`.
All ten original findings have evidence. The receipt contains nine new concerns.
Preserve this receipt and the earlier correction report as historical evidence.

Do not implement the deferred manager, native lifecycle, live migration, or release publication.
No installs, credentials, commits, or concurrent native-login source changes.
OpenBao remains the sole durable authority for managed credentials, without fallback.
Use existing worktree /root/foreman-native-login-20260915, Node 24, TypeScript, Effect, and apply_patch.
Read AGENTS.md and complete AGENT_TRAPS.md before work.

## Ownership

Own the existing OpenBao providers, broker, pilot, helpers, tests, package export metadata,
guide, and manager/pilot/foredi08/09 specs and plans from the previous correction package.
May add focused tests/helpers, a production identity/store composition helper, and a separate
follow-up evidence document. May inspect orchestration index/package and test its actual exports.
Do not change native transports, native qualification, runtime bundles, prior audit records,
the parent's audit driver/config/ledger, or the previous correction evidence/report.

## Required corrections

1. Recovery semantics and authorization: rename the experiment's “authorized” assertion to describe
   only observed recorded-generation conditional recovery. Ordinary KV update does not prove manager
   maintenance authorization. Specify a manager metadata/generation-observation capability and its
   authorization. Specify durable lifecycle/tombstone authority serialized across deletion, recovery,
   and refresh writers, including cross-process races. CAS alone cannot prevent resurrection after a
   soft delete because deletion does not advance the version. A read-before-write check alone is also
   insufficient. Add concrete planned refusal/race scenarios; do not claim these are implemented.
2. Synthetic exposure: parent inspected orchestration/src/index.ts; it does not export openbao-pilot.
   Preserve source-bound synthetic imports for pilot use. Add meaningful source and freshly built
   provider and orchestration default-entry export controls. Prove the synthetic broker/factory is
   absent from production entry reachability, rather than claim package exports stop arbitrary source
   imports. Do not move the synthetic factory back into default exports or use stale dist.
3. Binary launch: reduce the hash/path race by executing an owned private binary snapshot whose bytes
   match the trusted digest, or an equivalently justified binding. Test changing the original binary
   after verification cannot change the launched image. State that same-UID/root tampering with owned
   runtime memory/files remains a host trust boundary; a last-moment rehash does not eliminate races.
4. Provenance test: retain the meaningful stale-dist/source control. Rename or replace the misleading
   unrelated-package.json test so its name and assertions match real build/runtime and cwd behavior.
   Do not add a redundant passing control that cannot distinguish its stated negative condition.
5. Administrative transport: verify the proxy concern with a disposable proxy-enabled Node child and
   a synthetic root-token canary. Official Node documentation confirms default fetch can use env
   proxies; see https://nodejs.org/en/learn/http/enterprise-network-configuration . Use a per-request
   direct loopback transport with explicit agent policy, no global environment mutation. Preserve
   absolute cancellation/timeout bounds, response limits, no redirects, socket cleanup and sanitized
   errors. Prove the proxy receives zero requests after correction; keep known-bad control meaningful.
6. Identity/store composition: provide a validated constructor that snapshots one production backend
   configuration and constructs identity plus store from it, or prove an existing path does so. Tests
   must cover mutation and no token/raw CA leakage. Document separate least-privilege maintenance and
   runtime store instances sharing the same backend identity; callback need not gain operation context
   if separate instances are the explicit design. Actual manager policy enforcement stays deferred.
7. Evidence completeness: include deletion-experiment canaries in the report leak scan without
   persisting values. Preserve complete observed child exit identity (code, signal, spawn-failure)
   in reports. Add negative leakage and signal-exit assertions. Do not promote P11 to complete.
8. Readiness: accept only the explicitly healthy dev-server state; 501 and 503 are not ready.
   Add controllable peer/readiness tests for transient sealed/uninitialized responses and bounded
   timeout. Do not turn an unhealthy response into opaque successful readiness.
9. Built-entry test freshness: make the relevant test build its disposable entry from current source,
   or compare fresh source exports and actual default exports with a known stale-dist negative
   control. The test must not silently pass only because a previous dist happened to be safe.

## Verification and handoff

Run focused RED/GREEN before behavior edits. Run configured combined suites with all pins and zero
skips, default controller tests with an explicit integration skip, full typecheck, strict specs,
tracked and untracked whitespace checks. Execute freshly compiled pilot from /tmp and verify actual
source/bundle/runtime/binary hashes, private mode, full exit evidence, cleanup, and incomplete state.

Pinned binary /root/research/openbao-pilot-20260915-MYD9Qc/bao:
8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00.
Pinned adjacent receipt:
d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef.
These are independently supplied expected values, not self-derived trust inside the verifier.

Report exact tests, artifact hashes, all changed files, and qualified disagreements to
`.superpowers/sdd/fable-followup-report.md`. Freeze the entire package for parent checks and Fable.
No agent may claim complete release acceptance from this bounded correction.
