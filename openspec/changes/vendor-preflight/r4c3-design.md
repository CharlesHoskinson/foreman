# R4C3 design: persisted vendor-lane admission

## Decision

Use the shipped TypeScript `lane-gate` command as the only readiness authority.
Keep `lane-run.sh` as a temporary legacy caller.
Limit its new behavior to argument forwarding and exit-code handling.

## Considered approaches

### Exact migration seam

Replace the live probe with one direct call to `lane-gate`.
Pin the complete legacy remainder in TypeScript policy.
Validate the forwarding block with an exact closed grammar.

This is the selected approach.
It ships persisted admission without coupling this package to later orchestration ports.

### Complete `lane-run` port

Port all current `lane-run.sh` behavior to TypeScript now.
This approach also requires event-log, lock, checkpoint, watchdog, telemetry, and cleanup boundaries.
Those boundaries belong to later Sprint 3 and Sprint 14 packages.
This approach is not selected for R4C3.

### General policy exception

Permit modified legacy shell files or permit arbitrary changes to `lane-run.sh`.
This approach weakens the TypeScript migration gate.
This approach is rejected.

## Data flow

1. Setup writes `$FOREMAN_HOME/preflight/<vendor>.json`.
2. `lane-run.sh` validates the closed vendor identifier.
3. `lane-run.sh` resolves Node and the tracked `vendor-preflight.js` runtime.
4. `lane-run.sh` refuses a missing boundary with `EXIT_MISSING_CLI`.
5. `lane-run.sh` calls the tracked `vendor-preflight.js` runtime.
6. `lane-gate` reads and decodes the stored record.
7. `lane-gate` returns success only when all three stored facts are ready.
8. `lane-run.sh` exits with `EXIT_CONFIG` after any nonzero gate result.
9. The lane lock and vendor command remain untouched after a refusal.

The shell does not capture output.
The shell does not parse JSON.
The shell does not start a vendor probe.
The shell does not create an unverified state.

## Architecture-policy transition

The existing policy accepts only complete thin shell adapters.
That rule cannot distinguish a narrow strangler change from new shell product logic.

Add a closed validator for the one approved `lane-run.sh` migration artifact.
The validator accepts the exact forwarding block.
The validator hashes a normalized remainder of the complete file.
The validator compares that hash with one compiled constant.

Any changed byte outside the forwarding block changes the remainder digest.
Any changed byte inside the forwarding block fails the exact grammar.
All other legacy shell files still use the existing thin-adapter grammar.

## Failure behavior

The TypeScript gate owns all stored-record diagnostics.
The shell forwards standard output and standard error without rewriting them.
The shell maps every nonzero gate result to `EXIT_CONFIG`.

A missing Node executable emits one fixed diagnostic and stops the lane.
A missing runtime emits one fixed diagnostic and stops the lane.
A missing or invalid record stops the lane.
A valid not-ready record prints its selected recorded reason unchanged.

## Test strategy

Use TypeScript tests for the closed migration validator.
Use Bats tests for the process boundary and ordering.

The tests must prove these properties:

- A ready stored record starts the lane command.
- A not-ready stored record does not start the lane command.
- A missing record does not start the lane command.
- No case starts a live vendor probe.
- A refusal does not create the lane lock.
- A refusal does not emit an event.
- The unset vendor path remains unchanged.
- One changed byte inside the forwarding block fails policy.
- One changed byte outside the forwarding block fails policy.

## Scope boundary

This package does not add record freshness.
This package does not add credential profiles.
This package does not port the lane lock.
This package does not port event emission.
This package does not change the Grok secret scan.
