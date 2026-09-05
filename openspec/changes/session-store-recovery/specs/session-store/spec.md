# Session store recovery specification

## ADDED Requirements

### Requirement: Recover from the sidecar

WHEN `fm-session recover` runs and `.foreman/session.db` is absent, the
runtime SHALL rebuild the store from `.foreman/session.ndjson`. This is
the baseline behavior of `session-sqlite-bootstrap.ts` and this change
keeps it as a regression check.

#### Scenario: Fresh clone recovers

- **WHEN** a fresh clone runs `fm-session recover`
- **THEN** the store is rebuilt from the sidecar
- **AND** the exit status is 0

### Requirement: Recovery prints the summary

WHEN the store is opened or rebuilt, `recover` SHALL print the durable
facts, the measurements with freshness, and the open obligations.

#### Scenario: Summary printed

- **WHEN** `recover` succeeds
- **THEN** stdout contains the facts section, the measurements section, and the obligations section

### Requirement: No source refusal

IF neither the store nor the sidecar exists, THEN `recover` SHALL exit 2
with `no_session_source`.

#### Scenario: No source at all

- **WHEN** neither file exists
- **THEN** the runtime exits 2 with `no_session_source`

### Requirement: Repair a half-migrated store

WHEN `fm-session repair` runs on a store that carries both schemas, the
runtime SHALL rename the store to `session.db.corrupt-<UTC timestamp>` and
rebuild from the sidecar. The runtime SHALL NOT delete the renamed file.

#### Scenario: Half-migrated store repaired

- **WHEN** `repair` runs on the 2026-09-05 store shape
- **THEN** the old file exists with the `.corrupt-` suffix
- **AND** `recover` exits 0 afterward

#### Scenario: Backup name collision

- **WHEN** a file with the intended `.corrupt-` name already exists
- **THEN** `repair` appends a numeric suffix
- **AND** overwrites nothing

### Requirement: Repair is idempotent on a healthy store

IF the store is healthy, THEN `repair` SHALL make no change and exit 0.

#### Scenario: Healthy store untouched

- **WHEN** `repair` runs on a healthy store
- **THEN** no file changes
- **AND** the exit status is 0

### Requirement: Repair failure is explicit

IF the rebuild from the sidecar fails after the rename, THEN `repair` SHALL
exit 1 with `repair_failed`, SHALL leave the renamed file in place, and
SHALL name the renamed file in the message.

#### Scenario: Sidecar is corrupt

- **WHEN** the sidecar has an unparsable line
- **THEN** `repair` exits 1 with `repair_failed`
- **AND** the renamed file still exists

### Requirement: Refusal names the remedy

IF `recover` refuses because of the store shape, THEN the message SHALL
contain the exact text
`run: node skills/foreman/runtime/dist/fm-session.js repair`.

#### Scenario: Refusal is actionable

- **WHEN** `recover` refuses on a half-migrated store
- **THEN** stderr contains `run: node skills/foreman/runtime/dist/fm-session.js repair`
