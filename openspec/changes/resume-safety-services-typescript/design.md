# Design: Effect resume-safety observations

## Selected approach

Add two small Effect services and one composition program.
The process service observes one owned process ID.
The lock service observes one absolute lane-lock path without following links.
The composition program returns the two R5A input states.

## Process observation

The live service uses the Node process signal-zero boundary.
A missing process is `inactive`.
An existing process is `active`.
A permission-denied result is also `active` because existence is proven.
An invalid process ID or an unknown boundary failure is `unknown`.

This slice is conservative.
It does not classify suspended or wedged processes as inactive.
It does not replace the legacy stall classifier.

## Lock observation

The live service uses a no-follow path observation.
A missing path is `free`.
A directory is `held`.
A symbolic link, regular file, special node, invalid path, or read failure is `unknown`.

The result is a snapshot, not mutation authorization.
A later executor must revalidate or acquire the lock before it changes state.

## Effect composition

`observeResumeSafety` requires `ResumeProcessProbe` and `ResumeLockProbe`.
It runs both observations and returns one `ResumeSafetyObservationV1` value.
The live services do not throw untyped exceptions.

## Testable live boundary

The module exposes one live-layer factory with optional low-level seams.
The process seam performs signal-zero and can throw a Node error.
The lock seam returns a no-follow path kind and can throw a Node error.
The factory catches each seam failure at that service boundary and classifies it.
The default factory arguments use the real Node APIs.

This shape lets tests prove `ESRCH`, `EPERM`, `ENOENT`, and unknown failures
without depending on host process ownership or filesystem timing.

## Boundaries

This change does not read event history.
It does not count resume attempts.
It does not restore a worktree.
It does not acquire or remove a lock.
It does not enqueue or start a command.
