# Change: profile-use-leasing

## Why

R7B2 admits a lane against one verified credential profile. It does not stop
two worktrees from using the same profile at the same time. Concurrent vendor
processes can race on one credential store and corrupt shared session state.

## What changes

- Add a TypeScript and Effect profile-use lease service.
- Add a tracked Node.js 24 lease-holder runtime.
- Make the holder admit the profile before it acquires the lease.
- Hold one external lease for the complete live lane lifecycle.
- Make `lane-run.sh` keep the holder alive through an anonymous pipe.
- Release the lease on normal exit, refusal, signal, timeout, and parent death.
- Fail closed on a holder crash. Do not reclaim an unproved stale lease.

## Scope

Complete Sprint 3 R7C only. Do not migrate the remaining lane runtime. Do not
read or copy credential files. Do not add Python. Keep the existing `admit`
command compatible.
