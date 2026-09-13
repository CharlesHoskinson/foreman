# Execution hardening and retained obligations

The installed Pel workflow uses registered authority, exact provider selections, bounded resources, host verification, and immutable receipts. Start with [quickstart](../../../docs/guides/pel/quickstart.md), [security](security-model.md), and [durable execution](durable-lanes.md).

## Admission and execution

Check and plan use the same registered configuration as execution. They do not grant authority. Before an external action, the host validates workspace identity, source arguments, provider qualification, tool policy, credential reference, and remaining ledger limits. It records intent before dispatch. Identical completed evidence can be reused without another action debit.

The host runs gates from registered argv and environment references. It checks candidate identity before and after execution. Changed or failed evidence cannot authorize an audit or publication. Provider text is never a gate command.

Task work is confined to admitted workspaces at the immutable base. The host captures present and deleted files, content hashes, and a diff while preserving the branch and index. Nonignored content outside writable paths causes refusal. Race contenders use distinct grants; losing candidates do not replace the shared ledger candidate.

## Ownership and recovery

Use the original run ID and recorded next action. Kernel ownership excludes concurrent execution. Immutable continuation and receipt checks bind recovery to the original source and authority. An unknown provider or publication result does not authorize redispatch. Explicit decisions retain their authority receipt and exact prior/origin identity.

Cancellation and deadlines are finite. A local process exit does not establish remote cancellation. Preserve unknown outcomes until observation or authorized reconciliation supplies evidence.

## Retained development interfaces

The existing compiled launcher, queue admission, worktree safety, historical journal decoder, and Council preflight remain separate tested components. Their presence does not authorize arbitrary legacy workflow restart through Pel. The one-shot supervisor's legacy branch is read-only and returns ActiveLegacyRun when restart would be required.

Do not delete live worktrees, clear ownership locks, bypass pre-resume backups in retained controllers, or weaken repository guards to force progress. Preserve the original controller for active legacy work. An unavailable original controller is an open recovery limitation.

## Obligation disposition

The source program for earlier hardening remains in the repository history and `openspec/changes/`. Historical decoding, owner exclusion, immutable checkpoints, budget history, credential isolation, and independent review keep their original obligations and evidence. The new runtime replaces task dispatch, candidate capture, checks, and review only through their tested Pel host paths. Automatic legacy restore-and-queue is retired explicitly. Container-specific, Windows-specific, unsupported workflow, and unavailable-controller claims are not established by this Linux adoption package.

The fixed release baseline and candidate measurement include whole surviving instruction files. Shorter instructions or a produced archive do not prove a safety obligation or transport qualification.
