# Spec delta: Effect resume-safety observations

## ADDED Requirements

### Requirement: process observation fails safe

`ResumeProcessProbe` SHALL accept a positive safe-integer process ID or `null`.
It SHALL return one `ResumeProcessState` value.

The live service SHALL return `inactive` for `null` and a missing process.
It SHALL return `active` when signal-zero succeeds.
It SHALL return `active` when signal-zero reports permission denied.
It SHALL return `unknown` for an invalid process ID or another boundary failure.
It SHALL NOT send a terminating signal.

#### Scenario: the process exists but access is denied

- WHEN signal-zero reports permission denied
- THEN the process state is `active`
- AND the caller does not receive `inactive`.

### Requirement: lock observation does not follow links

`ResumeLockProbe` SHALL accept one lock path that is absolute on the current
Node platform.
The path SHALL contain no NUL and no more than 32,768 UTF-8 bytes.
The service SHALL return one `ResumeLockState` value.

The live service SHALL use a no-follow path observation.
It SHALL return `unknown` for a foreign-platform path spelling before it calls
the filesystem boundary.
It SHALL return `free` when the path is missing.
It SHALL return `held` when the path is a directory.
It SHALL return `unknown` for a symbolic link, regular file, special node,
invalid path, or boundary failure.

#### Scenario: a link points to a lock directory

- WHEN the lock path is a symbolic link to a directory
- THEN the lock state is `unknown`
- AND the service does not follow the link.

### Requirement: one Effect program collects both observations

`observeResumeSafety` SHALL require `ResumeProcessProbe` and `ResumeLockProbe`.
It SHALL accept `processId` and `lockPath`.
It SHALL return one `ResumeSafetyObservationV1` with `processState` and
`lockState`.

The program SHALL preserve `unknown` results.
It SHALL NOT convert an unknown result to a safe result.
The program and live layers SHALL NOT throw an untyped exception.
The program SHALL convert a defect from either probe to that probe's `unknown`
state.
The program SHALL NOT catch or suppress Fiber interruption.
The live-layer factory SHALL accept injected low-level boundary seams for tests.
The default seams SHALL use the real Node process and no-follow path APIs.
Each live service SHALL catch and classify failures from its own seam.

#### Scenario: the process boundary is unknown

- WHEN process observation returns `unknown`
- AND lock observation returns `free`
- THEN the combined process state remains `unknown`
- AND R5A can return `Wait`.

### Requirement: R5B performs observation only

R5B SHALL use Node.js 24, strict TypeScript, and Effect.
R5B SHALL add no Python, shell, PowerShell, Bun, or Deno code.

R5B SHALL NOT read event history, restore a worktree, acquire or remove a lock,
enqueue a command, or start a worker process.
An observation SHALL NOT authorize a later mutation without revalidation.

#### Scenario: a caller receives a free lock snapshot

- WHEN the lock service returns `free`
- THEN no lock was acquired
- AND a later executor must revalidate or acquire the lock before mutation.
