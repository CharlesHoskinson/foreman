# Round live runtime specification

## ADDED Requirements

### Requirement: one explicit external state root owns live round state

The `lane-round` runtime SHALL require this command form:

```text
lane-round --state-root ROOT --worktree WORKTREE --run RUN --lane LANE --report REPORT --gate GATE -- CMD [ARG...]
```

The parser SHALL preserve each command argument as one array entry. It SHALL
reject a missing option value, a duplicate option, an unknown option, a
missing `--`, an empty command vector, and trailing data outside this grammar.
It SHALL decode `RUN` and `LANE` with `@foreman/event-log`. It SHALL construct
the request from the decoded identifiers, preserved command vector, exact gate
string, and report path. The existing `RoundRequestV1` decoder SHALL admit that
complete request before a live service starts.

`ROOT`, `WORKTREE`, and `REPORT` SHALL be absolute paths for the current host.
`ROOT` and `WORKTREE` SHALL exist as directories before the runtime starts.
The runtime SHALL resolve both paths through the filesystem. It SHALL reject
`ROOT` when its resolved path equals `WORKTREE` or is below `WORKTREE`. It
SHALL perform this check before it creates or changes run state.

The runtime SHALL use only `ROOT` for its durable attempt counter, journal,
and internal journal lock files. It SHALL NOT create `.harness` or another
runtime-state directory below `WORKTREE`.

#### Scenario: the state root aliases the worktree

- WHEN the resolved state root equals the worktree or is below it
- THEN parsing or preflight fails
- AND no state file is created
- AND the implementation command does not start.

#### Scenario: a later command argument is empty

- WHEN the command vector contains a nonempty first entry and a later empty
  entry
- THEN the parser preserves the empty entry
- AND the implementation process receives that empty entry.

### Requirement: the run journal uses a closed external layout

For one decoded `RunId`, the run journal SHALL use this layout below the
resolved state root:

```text
runs/<runId>/events.ndjson
runs/<runId>/attempts/<laneId>.txt
runs/<runId>/locks/events.lock
runs/<runId>/locks/attempt-<laneId>.lock
```

The runtime SHALL create only missing directories and files within this
layout. Attempt-counter replacement MAY create one same-directory temporary
regular file below `attempts/`. The temporary name SHALL contain a runtime-
generated unpredictable suffix. A finalizer SHALL remove that temporary file
when replacement does not complete. No other transient file is permitted. The
runtime SHALL reject a symlink, junction, non-regular file, or directory at a
required file path. It SHALL reject a path identity change detected during one
operation. Public failures SHALL use a closed reason and SHALL NOT contain an
absolute path, input text, process output, or stack.

Internal journal locks SHALL use exclusive file creation. Acquisition SHALL
retry for no more than 10,000 milliseconds and SHALL fail with `journal_busy`
after that bound. The holder SHALL close and remove only its own lock in a
finalizer. Before removal, the holder SHALL verify that the lock path still
identifies the file that it created. It SHALL NOT remove a changed lock path.
This R3 lock is an internal atomic-write mechanism. It is not the durable round
ownership protocol planned for R4.

#### Scenario: a required journal path is linked

- WHEN a required journal file or lock path is a symbolic link or junction
- THEN the operation fails closed
- AND it does not follow the link
- AND it does not reset an attempt counter or truncate the journal.

### Requirement: attempt allocation is concurrent and monotonic

`@foreman/event-log` SHALL expose a Node 24 TypeScript run-journal port for
attempt allocation. Allocation SHALL acquire the lane attempt lock, read the
strict decimal counter, call the existing `nextAttempt`, and durably replace
the counter with the selected decimal attempt plus one LF.

A missing counter SHALL allocate attempt `1`. An empty, malformed, linked,
oversized, or unreadable counter SHALL fail closed. It SHALL NOT become
attempt `1`. A counter at `Number.MAX_SAFE_INTEGER` SHALL return the existing
typed overflow failure.

The durable replacement SHALL use a same-directory temporary regular file,
file synchronization, rename, and directory synchronization. The runtime MAY
continue without directory synchronization only when Node reports that the
host does not support opening or synchronizing a directory. It SHALL NOT
ignore another directory synchronization failure. A failure before replacement
SHALL leave the prior counter authoritative.

#### Scenario: two processes allocate one lane concurrently

- WHEN two live journal instances allocate the same run and lane concurrently
- THEN both allocations succeed within the lock bound
- AND their attempt IDs are distinct and consecutive
- AND a later allocation is greater than both.

#### Scenario: the counter is corrupt

- WHEN the stored counter is empty or is not strict positive decimal text
- THEN allocation returns a typed failure
- AND the counter is not reset
- AND no prompt event is appended.

### Requirement: event append is concurrent, canonical, and replayable

The run journal SHALL accept an R2 `RoundEventDraft`. Append SHALL acquire the
run event lock, validate the existing journal with `replayNdjson`, select one
sequence greater than the last durable sequence, add one timestamp in exact
`YYYY-MM-DDTHH:mm:ssZ` UTC form, and append one canonical JSON record plus LF.

Canonical JSON SHALL use the existing `@foreman/core` canonicalizer. The
stored record SHALL decode with `decodeStoredEvent`. The complete journal SHALL
replay with `replayNdjson`. Append SHALL enforce the existing event-log line,
line-count, structure, and total-input bounds against the complete candidate
journal before it writes. A corrupt or torn existing journal SHALL fail closed
and SHALL NOT be repaired, truncated, or extended.

The append implementation SHALL open the journal as a regular file, verify
the opened identity, write the complete record while it holds the lock,
synchronize the file, and verify the identity again before success.

#### Scenario: two processes append concurrently

- WHEN two live journal instances append to the same run concurrently
- THEN each complete event occupies one physical line
- AND the assigned sequences are distinct and increasing
- AND replay accepts the complete journal.

#### Scenario: the existing journal has a torn tail

- WHEN replay stops on a torn or corrupt final line
- THEN append returns a typed failure
- AND the journal bytes remain unchanged.

### Requirement: live services bind every R2 transaction boundary

`@foreman/orchestration` SHALL expose one live layer that binds
`AttemptAllocator`, `RoundEventSink`, `ReportSnapshotReader`,
`ImplementationCommand`, `CheckpointCapture`, and `GateCommand` for one
preflighted live-round context.

The allocator and event sink SHALL use the external run journal. The report
reader SHALL open `REPORT` as a regular file, detect identity changes, enforce
the exact 8,388,608-byte bound before it retains excess content, and compute a
lowercase SHA-256 digest of the exact bytes. A missing report SHALL return
`Absent`. An empty regular file SHALL return `Present` with byte length zero
and the SHA-256 digest of empty bytes. Linked, unreadable, or changed report
identity SHALL return `report_read_failed`.

The implementation service SHALL start `commandArgv[0]` with
`commandArgv.slice(1)` and `cwd: WORKTREE`. It SHALL NOT join, split, quote, or
shell-interpret the vector. It SHALL inherit standard streams and SHALL
terminate the owned process on Effect interruption.

The checkpoint service SHALL run `git rev-parse HEAD` with `cwd: WORKTREE`, a
bounded output, and a sanitized Git environment. It SHALL accept exactly one
lowercase 40-hex commit followed by at most one line terminator. It SHALL NOT
read or modify the target worktree.

The gate service SHALL run the exact gate string with `cwd: WORKTREE`. On
Windows it SHALL invoke the absolute `ComSpec` value as
`[ComSpec, "/d", "/s", "/c", gateCommand]`. A missing, non-absolute, or
NUL-containing `ComSpec` SHALL fail closed before process start. On POSIX it
SHALL invoke `["/bin/sh", "-c", gateCommand]`. It SHALL return only an exit
code. It SHALL terminate the owned process on Effect interruption.

#### Scenario: implementation exits nonzero

- WHEN the implementation process exits nonzero
- THEN the live service returns that exit code
- AND the R2 transaction captures the checkpoint
- AND the R2 transaction runs the gate.

#### Scenario: the report exceeds the bound

- WHEN the report grows beyond 8,388,608 bytes
- THEN the reader returns `report_too_large`
- AND it does not retain the complete excess file.

### Requirement: the direct Node runtime executes one exact R2 transaction

The bundled `lane-round.js` entry SHALL target Node.js 24 and SHALL contain no
Bun or Deno dependency. It SHALL preflight CLI input and path separation, make
the live service layer, decode one `RoundRequestV1`, and call the existing
`runRoundTransaction` exactly once.

On a completed outcome, the CLI SHALL write one canonical JSON outcome plus LF
to stdout, write nothing to stderr, and exit `0`. On an incomplete outcome, it
SHALL write one canonical JSON outcome plus LF to stdout, write nothing to
stderr, and exit `1`. A usage or preflight failure SHALL write one fixed
diagnostic to stderr and exit `2`. A typed runtime boundary failure SHALL write
one fixed reason without paths or vendor text and exit `3`. An unexpected
defect SHALL write `lane-round: internal failure` plus LF and exit `1`.

The tracked runtime builder SHALL add `dist/lane-round.js` and one matching
manifest entry. Two clean builds SHALL produce byte-identical bundles and
manifest bytes. Runtime verification SHALL reject a missing, extra, changed,
linked, or unlisted round bundle.

#### Scenario: a completed live round

- WHEN implementation and gate complete and the report is fresh
- THEN the journal stores the exact R2 successful event order
- AND stdout contains the completed outcome
- AND the process exits zero.

#### Scenario: an incomplete live round

- WHEN R2 selects an incomplete reason
- THEN the journal stores `waiting_child` followed by the terminal
  `round_incomplete` alert
- AND stdout contains the incomplete outcome
- AND the process exits one.

### Requirement: R3 proves interruption recovery without implementing resume

R3 tests SHALL interrupt a live transaction after the verifying event is
durable and before a terminal event is appended. Replay SHALL select the exact
attempt. `recoverRoundAttempt` SHALL return `Recoverable` with the stored round
plan and checkpoint identity. The runtime SHALL NOT synthesize a terminal
event.

This slice SHALL NOT implement worktree restore, process-state discovery,
round resume, supervisor enqueue, durable ownership or heartbeat protocol,
credential provisioning, secret scanning, NATS transport, or legacy shell
adapter changes. Those items remain R4 through R8.

#### Scenario: R3 would need resume behavior

- WHEN a test reaches a durable recoverable state
- THEN R3 reports the exact recovery result
- AND it does not restore or enqueue work
- AND it leaves the journal unchanged.
