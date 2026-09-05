# Session store recovery specification

## ADDED Requirements

### Requirement: Recover from the sidecar

WHEN `fm-session recover` runs and `.foreman/session.db` is absent, the
runtime SHALL rebuild the store from `.foreman/session.ndjson` and then
print the recovery summary. IF the sidecar is also absent, THEN the runtime
SHALL refuse with `no_session_source`.

#### Scenario: Fresh clone recovers

- **WHEN** a fresh clone runs `fm-session recover`
- **THEN** the store is rebuilt from the sidecar
- **AND** the summary lists the durable facts

#### Scenario: No source at all

- **WHEN** neither the store nor the sidecar exists
- **THEN** the runtime exits 2 with `no_session_source`

### Requirement: Repair a half-migrated store

WHEN `fm-session repair` runs on a store that carries both schemas, the
runtime SHALL rename the store to `session.db.corrupt-<UTC timestamp>` and
rebuild from the sidecar. The runtime SHALL NOT delete the renamed file.
IF the store is healthy, THEN `repair` SHALL make no change and exit 0.

#### Scenario: Half-migrated store repaired

- **WHEN** `repair` runs on the 2026-09-05 store shape
- **THEN** the old file exists with the `.corrupt-` suffix
- **AND** `recover` exits 0 afterward

#### Scenario: Healthy store untouched

- **WHEN** `repair` runs on a healthy store
- **THEN** no file changes
- **AND** the exit status is 0

### Requirement: Refusal names the remedy

IF `recover` refuses because of the store shape, THEN the message SHALL
contain the exact command `fm-session repair` and nothing that requires the
operator to compose a path.

#### Scenario: Refusal is actionable

- **WHEN** `recover` refuses on a half-migrated store
- **THEN** stderr contains `run: node skills/foreman/runtime/dist/fm-session.js repair`
