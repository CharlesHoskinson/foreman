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
- provider health canaries
- ready-review token lifetime and retry counters
- process timeout, cancellation, and replacement

Foreman also owns `gate-eval.sh`, `merge-gate.sh`, audit verdict files, check
result files, event streams, and graph state.

Infrastructure retries remain under Foreman. They do not consume an architect
rework round.

## Council owns

Council owns the deliberation surfaces:

- Council ACE Profile 1 compile and semantic lint
- typed deliberation
- terminal-first review admission classification
- quorum
- dissent
- completed abstention recording
- advisory replay

Council does not launch providers outside Foreman lane ownership.
Council does not write release or merge gate artifacts.
Council does not treat preflight or transport failure as abstention or dissent.

## Architect owns

The architect owns:

- fixing each admissible finding from Council
- deciding when to run the next round
- accepting only advisory signal that still passes independent Foreman
  verification and gates

The architect never treats Council majority as a release gate.
The architect does not burn a rework round on infrastructure retries.

## Decision guide

| Question | Owner |
|---|---|
| Which provider runs, and with which credentials? | Foreman |
| Did the canary and ready token succeed? | Foreman (execution) + Council (classification types) |
| Is the worktree and durable run correct? | Foreman |
| Did ACE compile and admission rules hold? | Council |
| Did quorum and dissent rules hold for this bundle? | Council |
| Is a completed abstention correct for missing evidence? | Council |
| Is a cancelled interim body a failure or an abstention? | Council classifier: failure |
| Must a finding be fixed before the next round? | Architect |
| May the change merge or release? | Foreman gates only |
