# Change: three-outcome-verdicts

## Why

Foreman's audit vocabulary is `APPROVED | WARNING | BLOCKED`
(`adapters/verdict.schema.json`, `audit-run.sh:107`, `gate-eval.sh:43`). All
three mean the same thing about the *process*: the auditor ran, read the diff,
and formed a judgment. **There is no value that means "no judgment was
produced."**

R2 names this as the highest-value single transfer available
(`docs/research/vnext/R2-anthropic-graph-infra.md` §8, P2):

> "Three-outcome verdicts: CONFIRMED / REFUTED / UNVERIFIED … A codex-auditor
> that dies on a rate limit must produce `unverified`, not a rejection. **This
> is the highest-value single change in the lane** … an errored lane is not a
> dissenting lane."

N1 says why the distinction is load-bearing rather than cosmetic
(`N1-neurosymbolic-foundations.md` §8.1):

> "`codex-auditor` is another LLM. It is not a sound verifier. Its output
> belongs in the evidence graph as a claim with provenance, never as a gate."

A claim with provenance can be absent. An oracle cannot. Foreman currently
models its auditor as an oracle, so it has no way to represent the auditor's
own failure — and the auditor fails in the field. The 2026-07-19 entry records
`codex login --device-auth` falling back to a localhost browser flow on a
headless WSL host, after which *"the run fell back to Opus-in-session as
auditor"* — a whole auditor substitution that no artifact records. The same
day, grok's `--prompt-file` mode exited 0 having written nothing at all.

### What happens today when the auditor does not answer

`audit-run.sh` `die`s. Four distinct paths: `codex exec` non-zero (`:94`),
empty output (`:95`), no JSON object found (`:104`), verdict outside the
enum (`:108`). Plus `:92`, where a worktree mutation invalidates the audit.

**In every one of those paths, `$RD/audit-verdict.json` is never written.**

`$RD` is the per-task run directory — stable across rounds and re-audits.
Nothing in `audit-run.sh` removes a prior `audit-verdict.json` before an audit
starts. So a re-audit that errors on a reworked diff leaves the **previous
round's verdict** sitting in the gate's input directory.

`gate-eval.sh:43-47` then reads that file with **no freshness check of any
kind** — no mtime comparison, no base-sha binding, no attempt binding, no
diff-content binding. It checks that the verdict parses and is not `BLOCKED`,
and passes. A stale `APPROVED` of an old diff is, at the gate, indistinguishable
from a fresh `APPROVED` of the current one.

This is exactly the defect `lane-run.sh --round` already fixed one layer down:
its attempt-freshness predicate exists so that *"a prior round's report never
satisfies the predicate"* (`lane-run.sh:1147-1152`, SC-D). The merge gate has no
equivalent for the artifact that decides whether code ships.

### And the policy that was supposed to govern this is not read

`.foreman/config.toml:48-54` and `SKILL.md:250-259` present `[audit.policy]`
(`warning_low_resolved` / `warning_medium` / `blocked`) as verdict-to-action
policy. `lib/config.sh:62-64` admits the truth in a comment: *"gate-eval.sh does
not read them yet."* Confirmed — `gate-eval.sh` does not source `lib/config.sh`
at all. The policy exists as architect doctrine in prose, which is how the one
recorded gate-semantics round-trip happened (`bugeventlog.md:91-105`: a
`WARNING` verdict against a user instruction that said "when approved", one
blocked command, one interactive round-trip).

### Audit latency, scoped honestly

The audit is the serial critical path of every merge: ~27 min for a full audit
of a 208-line diff, ~24 min even for a scoped 5-finding re-audit
(`bugeventlog.md:44-59`), and it is chronic — failure class #10 in R5's
taxonomy. **v0.4.0 owns the fast-audit work** (effort tiering, sharded parallel
audit, pre-packaged bundles, hunk-hash-scoped re-audits, session reuse). This
package does not touch any of it.

It does close one cheap, safe gap that belongs here and nowhere else:
`audit-run.sh` invokes `codex exec` with **no timeout**. An audit that hangs
hangs the merge gate indefinitely, and there is no artifact recording that it
happened. That is the same missing-third-outcome problem in the time dimension.

## What changes

- **A fourth verdict value, `UNVERIFIED`, written by the harness — never by the
  model.** `audit-run.sh` records `UNVERIFIED` whenever the audit did not
  produce a judgment: non-zero exit, timeout, empty output, unparsable output,
  an out-of-vocabulary verdict, a detected worktree mutation, or a missing or
  unauthenticated CLI. The model-facing `adapters/verdict.schema.json` stays
  three-valued deliberately (see `design.md`).
- **`audit-run.sh` always writes `audit-verdict.json`, and publishes the
  current attempt before the auditor runs.** It never dies without recording.
  Before spawning the auditor it allocates an attempt id from `el_attempt_new`,
  records it in `$RD`, and atomically publishes an `UNVERIFIED` /
  `state:"in_progress"` record, so the prior verdict is replaced at audit start
  rather than surviving until the final rename. Its exit status speaks to its
  caller; the artifact speaks to the gate, and the gate is never left reading a
  stale authorization.
- **Mandatory provenance on every verdict**: vendor, model, effort, verdict,
  `state`, a reason when `UNVERIFIED`, an evidence reference, and
  start/end/duration. This is what turns the verdict into a claim with
  provenance rather than an unexamined gate input.
- **The gate binds the verdict to the current audit attempt and the evaluated
  tree, not to the diff hash alone.** `diff_sha256` does not discriminate
  either property: an audit of an unchanged diff killed before it completes
  would leave a previous `APPROVED` with the same diff hash still gate-valid,
  and a rebase onto a different base can produce a byte-identical patch over a
  different resulting tree and different dependencies. `audit-verdict.json`
  therefore carries `evidence: {diff_sha256, tree_sha256, base_sha, head_sha,
  attempt}` plus `state`, and `gate-eval.sh` requires all four of: matching
  diff hash, matching evaluated-tree identity, `attempt` equal to the currently
  published attempt, and `state == "complete"`. Each failure has its own reason
  string. `tree_sha256` is the git tree object id of `HEAD` combined with a
  canonical content digest over everything
  `git status --porcelain=v1 -z -uall --no-renames` reports, so untracked
  files, uncommitted content, modes, symlinks, deletions and binaries are
  covered. The digest is a fixed-arity record per path — path, state, mode,
  hash — in which absence is a value, so a deletion is canonicalisable rather
  than uncomputable, and it is the single shared function
  `evidence-contracts` also uses for write evidence. Binding is not on `head_sha`, so an amend or re-checkpoint that
  changes neither content nor tree still does not invalidate a good audit. The
  same `{diff_sha256, tree_sha256}` pair binds `checks-result.json` and
  `docs-check.json`; only the verdict carries `attempt`.
- **`UNVERIFIED` fails the gate closed, distinctly.** A separate reason string,
  never conflated with `audit verdict BLOCKED` — in the gate output, in the
  record, and in metrics. And an `UNVERIFIED` gate failure SHALL NOT consume a
  rework round against `limits.max_rework_rounds`: the worker did nothing
  wrong, and charging it a round is how an infrastructure failure gets
  misattributed to an implementer.
- **`[audit.policy]` is read by `gate-eval.sh`**, gaining an `unverified` key.
  The documented policy becomes the executed policy.
- **A bounded audit call.** `audit.timeout_min`, defaulting from
  `limits.round_timeout_min`; a timeout produces `UNVERIFIED` with
  `reason:"timeout"` and a recorded duration, never a hung gate.
- **Findings get stable ids, and consolidation addresses them by id.** Per R2's
  P5 — *"Return decisions about findings BY INDEX — never re-emit finding
  text"* — `wt-consolidate.sh` merges multi-lane audit findings by id and
  chooses a representative; it SHALL NOT rewrite evidence text.

## Impact

- Affected: `skills/foreman/scripts/audit-run.sh`,
  `skills/foreman/scripts/gate-eval.sh`,
  `skills/foreman/scripts/wt-consolidate.sh`,
  `skills/foreman/scripts/lib/config.sh` (one new `[audit.policy]` key),
  `config/foreman.toml.example`, `.foreman/config.toml`,
  `skills/foreman/SKILL.md`,
  `skills/foreman/references/orchestration-hardening.md`,
  `skills/foreman/references/lanes.md`.
- Deliberately **not** affected: `adapters/verdict.schema.json`'s verdict enum.
- New: `tests/audit-verdict.bats`.
- **Depends on `vendor-adapter-contract`** for the audit call's argv shape.
  That package owns *how* an auditor is invoked across vendors; this one owns
  *what the result means* and *what the gate does with it*. Where the two meet
  — the audit invocation site in `audit-run.sh:78-86` — the argv construction
  is theirs and the timeout, exit-status interpretation, and verdict recording
  are this package's. Neither blocks the other; they must not both rewrite that
  block.
- **Prerequisite for `decision-lineage-and-telemetry`.** That package emits the
  `audit_verdict` and `finding` events; their payloads are the provenance block
  and the finding ids defined here. Authoring them in the wrong order would
  freeze an event schema around a verdict vocabulary that is about to change.
- **Explicitly deferred to v0.4.0, and NOT specified here:** effort tiering
  (`xhigh`→`high`), sharded parallel audit with consolidation, pre-packaged
  audit bundles that remove auditor repo recon, hunk-hash-scoped re-audits, and
  session or thread reuse. This package SHALL NOT implement any of them. The
  only latency work it does is bounding the call and recording its duration —
  which is also what gives v0.4.0 a measured baseline instead of two anecdotes.
