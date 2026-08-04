# Foreman v0.3.0 R4C persisted preflight implementation plan

## Goal

Persist one typed vendor-preflight record during Setup. Admit a vendor lane
from that record without a live probe.

## Boundary

Use the existing `vendor-preflight.js` runtime. Add two commands:

- `write-record <vendor> <absolute-path>`
- `lane-gate <vendor> <absolute-path>`

Keep all store, decode, classification, and diagnostic logic in TypeScript.
Keep each shell change as a thin runtime call.

Do not add a time-to-live rule in R4C. The credential-profile package owns
record freshness and configuration identity.

## Work package 1: record store

1. Add RED tests for bounded reads and atomic writes.
2. Add an Effect `PreflightRecordStore` service.
3. Decode every stored record through `decodeVendorPreflightRecordV1`.
4. Write canonical JSON with one trailing line feed.
5. Create the store directory with mode `0700`.
6. Create the record with mode `0600`.
7. Replace the target only after the temporary file is durable.
8. Remove the temporary file after a failed write.

## Work package 2: CLI commands

1. Add RED parser and behavior tests for both commands.
2. Make `write-record` inspect once and persist the same validated record.
3. Return `0` for a ready record and `1` for a valid not-ready record.
4. Return `3` for store, decode, or runtime boundary failures.
5. Make `lane-gate` read only the persisted record.
6. Reject a vendor mismatch.
7. Pass only when all three facts are ready.
8. Emit one recorded reason unchanged for a valid refusal.
9. Prove that `lane-gate` does not use process or path services.

## Work package 3: thin adapters

1. Make Setup write records under `$FOREMAN_HOME/preflight/`.
2. Write only the requested lane when Setup uses `--lane`.
3. Write `grok` and `codex` records for a whole-profile Setup.
4. Make `lane-run.sh` invoke `lane-gate` before lane-lock mutation.
5. Fail closed when Node.js, the runtime, or the record is unavailable.
6. Delete the live tool-check probe from lane admission.
7. Delete the unverified continuation from lane admission.

## Acceptance

1. Run the focused TypeScript tests.
2. Run affected Setup and lane Bats tests under the host mutex.
3. Run `npm run typecheck`.
4. Build twice and compare runtime bytes.
5. Run `npm run verify-runtime`.
6. Run the architecture policy against the package base.
7. Run repository hygiene and `git diff --check`.
8. Commit the exact implementation.
9. Run a Codex cold audit from another model family.
10. Push the approved commit.
11. Require exact Linux, Windows, and formal hosted gates.

## Council status

The current Council runtime cannot produce a release-grade live quorum. Apply
the Council fail-closed rules to this boundary. Do not claim Council quorum.
Use Grok for implementation and Codex for the independent cold audit.
