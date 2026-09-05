# Change: session-store-recovery

## Purpose

`fm-session recover` is the only durable record of where the project stands.
On 2026-09-05 it refused to open `.foreman/session.db` because the file
carries both the legacy and the port schema. The runbook's only checkpoint
command failed, and the operator had to answer the roadmap question from
the OpenSpec ledger instead. This change makes recovery always possible from
the tracked sidecar.

## Scope

- In scope: a `repair` command that moves a half-migrated store aside and
  rebuilds it from `.foreman/session.ndjson`.
- In scope: `recover` on a fresh clone with no `session.db` succeeds by
  rebuilding from the sidecar.
- In scope: a refusal that names the exact command to run.
- In scope: closing BW-008.

## Exclusions

- Out of scope: any change to the sidecar format.
- Out of scope: repairing a corrupt sidecar. That remains a refusal.

## Acceptance Evidence

- Evidence: `fm-session.js recover` exits 0 on a fresh clone.
- Evidence: `fm-session.js repair` on the 2026-09-05 half-migrated store exits 0 and a following `recover` exits 0.
- Evidence: the moved-aside file keeps a `.corrupt-<utc>` suffix and is never deleted.
