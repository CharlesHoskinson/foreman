# Change: round-resume-typescript

## Why

The legacy supervisor loses round ownership during automatic resume.
It reads one joined command string from a prompt event.
It then starts `bash -c` in plain mode.
The resumed command loses its original argument vector, gate command, and report path.

The typed round core already stores `RoundPlanV1` in each current prompt event.
It also recovers one exact attempt from stored events.
Sprint 3 needs a typed decision module before it can replace the legacy supervisor.

## What changes

- Add a pure resume-decision module to `@foreman/orchestration`.
- Select one current attempt from typed prompt events.
- Reuse `recoverRoundAttempt` as the recovery authority.
- Return a closed resume decision.
- Preserve `commandArgv`, `gateCommand`, `reportPath`, and checkpoint identity exactly.
- Refuse legacy unbound prompts and invalid history.
- Refuse resume when liveness or lock state is not safe.
- Enforce the configured resume-attempt limit.

## Impact

- Add TypeScript source and tests only.
- Do not modify a shell script in this change.
- Do not read the filesystem or start a process in this change.
- Prepare the pure authority for later Effect live services and a thin Node adapter.
