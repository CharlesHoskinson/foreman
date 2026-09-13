# Pel semantics in K

Status: **PLANNED**. The TypeScript Pel engine is implemented. The K semantics sprint is specified but has not been implemented or accepted.

The [M7 proposal](../../../openspec/changes/foredi-07-k-semantics/proposal.md) adds an executable description of `pel-paper-v2-foreman-1`. Its [catalog](../../../openspec/changes/foredi-07-k-semantics/catalog.json) maps six features to twenty requirements and planned test scenarios. The [task list](../../../openspec/changes/foredi-07-k-semantics/tasks.md) keeps implementation work unchecked.

The [mapping audit](k-mapping-audit.md) connects every current compatibility row, builtin signature, AST constructor, evaluation operation, and diagnostic to planned K requirements.
Its [source inventory](k-mapping-audit.json) records the audited source hashes and continuation fields.
All destinations remain planned. No executable Pel K mapping or correspondence proof is present.

## What the semantics will describe

K will parse Pel and apply small-step rules to explicit configurations. The planned definition covers tagged values, callable lists, lexical closures, argument defaults, pipes, non-strict branches, scoped loops, dependency-ready work, located errors and limits. Host calls stop at abstract request/receipt boundaries. Continuation tests will compare preserved lexical state, counters and completed-prefix replay with M1.

For example, the unselected branch of an `if` must emit no host request. Repeated caret injection must reuse its pipe value. A one-based list lookup must reject index zero. Restoring a checkpoint must not emit a completed effect again. These are planned distinguishing cases, not reported K execution results.

Provider responses are supplied test data. K will not call a model or grant filesystem, budget or publication authority. Existing Foreman host checks remain necessary. K is a development tool, not another production scheduler.

## How to read the evidence

| Status | What it establishes |
| --- | --- |
| Planned | A definition or claim is specified; execution is not established. |
| Executable | The pinned tool compiled and executed the named definition. |
| Tested | The named finite cases matched independent expectations and the TypeScript engine. |
| Proved | The named scoped claim was discharged with recorded assumptions and exact tool/definition identities. |
| Refuted, unknown or unavailable | A counterexample, incomplete result or missing prerequisite remains visible. |

Matching examples do not prove full TypeScript/K equivalence. Parser translation, continuation projection, numerical encoding and external host assumptions need separate treatment. A changed definition reopens affected results; historical evidence retains its original hashes. The sprint requires two limited claims about receipt consumption and counters, not an invented general correctness theorem.

The design follows Moriarty's distinction between specified semantics, actual traces, explicit assumptions and scoped proof status. Its local reference paths and observed commit are listed in the [M7 design](../../../openspec/changes/foredi-07-k-semantics/design.md). Foreman will use declarative `.k` definitions and strict TypeScript/Node24 tooling; Moriarty's Python wrappers are not adopted.

## Toolchain and next step

The selected starting point is [K v7.1.337](https://github.com/runtimeverification/k/releases/tag/v7.1.337). Exact tool and backend hashes must be recorded before the future compile/run tests. K's [user manual](https://kframework.org/docs/user_manual/) and [configuration tutorial](https://kframework.org/k-distribution/k-tutorial/1_basic/15_configurations/) describe the underlying definition structure. No K implementation is shipped by this planning update.

The first implementation task is a pinned compile-and-run smoke test, independent source parsing and distinguishing numeric cases. Later tasks add the full profile, abstract effects, continuations and differential corpus. The existing M6 production-reduction failure and unresolved numerical-release obligations remain unchanged.

## Full release plan

The [full K release program](../../../openspec/changes/pel-k-release-program/proposal.md) now specifies the implementation sequence and release evidence.
It contains ten required K1 work packages and a separate K2 source-certification track.
K1 targets the complete executable profile, tested runtime correspondence, and ten scoped K proofs.
K2 plans the stronger proof tied to the actual TypeScript source. Both tracks remain proposed and unimplemented.
