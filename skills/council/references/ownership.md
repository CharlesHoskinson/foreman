# Council ownership — Foreman, Council, architect

Clear ownership keeps Council advisory and prevents a second release plane.

## Foreman owns

Foreman owns the execution and control surfaces:

- provider dispatch
- credentials
- worktrees
- durable execution
- checkpoints
- merge gates

Foreman also owns `gate-eval.sh`, `merge-gate.sh`, audit verdict files, check
result files, event streams, and graph state.

## Council owns

Council owns the deliberation surfaces:

- typed deliberation
- quorum
- dissent
- abstention
- advisory replay

Council does not launch providers outside Foreman lane ownership.
Council does not write release or merge gate artifacts.

## Architect owns

The architect owns:

- fixing each admissible finding from Council
- deciding when to run the next round
- accepting only advisory signal that still passes independent Foreman
  verification and gates

The architect never treats Council majority as a release gate.

## Decision guide

| Question | Owner |
|---|---|
| Which provider runs, and with which credentials? | Foreman |
| Is the worktree and durable run correct? | Foreman |
| Did quorum and dissent rules hold for this bundle? | Council |
| Is an abstention correct for missing evidence? | Council |
| Must a finding be fixed before the next round? | Architect |
| May the change merge or release? | Foreman gates only |
