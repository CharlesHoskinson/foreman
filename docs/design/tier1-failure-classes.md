# Tier 1 Failure Classes and Transcript Format

Tier 1 replays recorded vendor responses without network access and judges only
the resulting decision trace. This document defines the transcript record and
assigns every dated `bugeventlog.md` entry to one dominant failure class.

The initial taxonomy contains **10 failure classes**. There are **87 dated
entries**, all **87 are assigned exactly once**, no entry is unassigned, and no
entry is counted twice. A compound entry stays in its dominant class; its table
note names any material secondary class.

Only one exemplar round is seeded by this foundation task:
`stall-no-output-undefined-predicate`. It demonstrates the transcript and round
layout; it is **not corpus coverage** for the other nine classes.

## Coverage arithmetic

| Measure | Count |
| --- | ---: |
| Dated source entries | 87 |
| Assigned citations below | 87 |
| Unassigned entries | 0 |
| Entries cited more than once | 0 |
| Failure classes | 10 |

The counting unit is a top-level heading matching `^## 20` in
`bugeventlog.md`. Sub-events and addenda inside one dated entry do not create
extra source entries. Corrections and resolution entries do count because they
have their own dated headings.

## Failure classes

### FC-01 — Monitor predicate cannot fire or measures the wrong signal

Stable id: `FC-01-monitor-predicate-cannot-fire`.

A liveness monitor is absent, exits before arming, evaluates a predicate that
cannot fire, or treats a surface that does not move during healthy work as the
property of liveness. Stale artifacts, file mtimes, process existence, and
completion-only transcripts merge here because every incident makes the same
bad decision: monitor silence or noise is trusted without a demonstrated
known-positive predicate.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-16 — file-mtime stall watchdogs false-alarm on read-heavy and completed lanes | Primary. |
| 2026-07-17 — lane watchdog false-fired on a STALE report artifact | Primary. |
| 2026-07-17 — watchdog false-stall during a lane's final full-suite gate phase | Primary; its background-and-stop addendum is secondary to FC-03. |
| 2026-07-28 — Monitor watchdog died instantly (exit 127) arming a WSL lane watchdog | Primary; the immediate MSYS path conversion is secondary to FC-06. |
| 2026-07-29 — Monitor watchdog died on the Git Bash path trap | Primary; the immediate path conversion is secondary to FC-06. |
| 2026-07-29 — Stall watchdog fired a false positive on both cleanup lanes | Primary. |
| 2026-07-30 · Wave-1 dispatch, Project Feynman | Primary; its `repos` exclusion sub-event is secondary to FC-07. |
| 2026-07-30 — Event 2: architect killed three lanes at 18 minutes, repeating the immediately preceding entry's lesson | Primary. |

### FC-02 — Checker reports a verdict without establishing the claim

Stable id: `FC-02-checker-verdict-unestablished`.

A check is green, red, or otherwise decisive even though its predicate did not
execute, bound to a proxy, sampled an uncontrolled baseline, ignored content,
or was nondeterministic. Syntax-only checks, vacuous lint, status digests,
sentinel writes, unrun gates, and substring guards merge because their verdict
does not establish the property named by the checker.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-17 — bash-n-only architect edit broke the T3 gate (found on resume) | Primary. |
| 2026-07-17 — perf bundle force-merged to main WITHOUT a clean full-suite gate | Primary. |
| 2026-07-17 — deferred v0.2.0 merge gate closed GREEN on main | Closure of the preceding missing-gate incident; it does not define a separate success class. |
| 2026-07-27 — Pattern retrospective: five failures, one shape (architect-side, not foreman's) | Primary. |
| 2026-07-28 — the write-evidence digest itself returned a false negative | Primary. |
| 2026-07-28 — ROOT CAUSE of the write-evidence false negative: the digest is structurally blind | Primary. |
| 2026-07-29 — terminusdb-schema (s9-tdbschema) package authoring | Primary: zero-file lint and a pipeline-masked failure both emitted misleading success. |
| 2026-07-30 — Event 1: `grok-multiround` reported success for a lane that implemented nothing | Primary. |
| 2026-07-30 — Event 5: eight test files were merged registered in neither policy file | Primary. |
| 2026-07-30 — Event 10: a GATING formal control is nondeterministic, and nobody could have known | Primary. |
| 2026-07-31 — Event 16: a guard fired on its own documentation | Primary. |

### FC-03 — Lane reaches a terminal state without its deliverable

Stable id: `FC-03-lane-terminal-without-deliverable`.

A vendor or wrapper stops normally, backgrounds and stops, exhausts a burst,
or reports exit zero while the required artifact is missing or incomplete.
Permission cancellation, research-budget exhaustion, multi-deliverable overload,
and notification waiting merge because callers face the same terminal
condition: the lane ended without the artifact that defines success.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-16 — background-and-stop is a recurring cross-model attractor, not a one-off | Primary. |
| 2026-07-17 — background-and-stop attractor, occurrence #5 (T5 Sonnet rework lane) | Primary. |
| 2026-07-18 — the auto-resume lane itself hit the background-and-stop attractor | Primary; its leaked lock is secondary to FC-04. |
| 2026-07-19 — grok headless --prompt-file: single short burst, writes NOTHING on exploration-heavy specs | Primary. |
| 2026-07-28 — grok-implementer agent backgrounds its run, then stops (strands the round) | Primary. |
| 2026-07-28 — grok --prompt-file is SINGLE-TURN; a round can exit 0 having written nothing | Primary. |
| 2026-07-28 — Codex audit lane reached a verdict but exhausted its turn before writing the report | Primary. |
| 2026-07-28 — Second lane in one session ended without its deliverable, different vendor | Primary. |
| 2026-07-28 — grok empty burst traced to permission flags, not model behaviour | Primary. |
| 2026-07-28 — grok empty burst traced to PermissionCancelled in one lane (SUPERSEDED IN PART — see the correction below) | Primary; its universal diagnosis is corrected under FC-08. |
| 2026-07-30 — Event 6: single-turn grok cannot read-then-write, so "go read the spec" lanes always empty-burst | Primary. |
| 2026-07-30 — Event 7: grok lane success is a step function in spec closure — one deliverable per dispatch | Primary. |
| 2026-07-30 — Event 8: "one deliverable" is necessary but NOT sufficient — a counterexample | Primary. |

### FC-04 — Child process or lock outlives its owning round

Stable id: `FC-04-process-ownership-leak`.

A timeout or wrapper transition loses output, strands a child, leaks a lock, or
reaps the wrong process. API death, swallowed summaries, orphan test storms,
and PID reuse merge because round ownership is not end-to-end: the lifecycle of
the work and the lifecycle recorded by the caller diverge.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-16 — implementer lane died to a mid-response API server error with zero progress signal | Primary. |
| 2026-07-16 — Grok CLI 600s subprocess timeout swallowed the worker's closing message | Primary. |
| 2026-07-16 — implementer wrapper stopped while its CLI subprocess kept running | Primary. |
| 2026-07-16 — unreaped grok subprocess blocked the T3 lane for ~70 minutes | Primary. |
| 2026-07-17 — audit agent's verification bats orphaned, blocked the release gate ~1hr | Primary. |
| 2026-07-31 — Event 15: the watchdog fix took two rounds, and the first round leaked twice | Primary. |

### FC-05 — Environment capability gap is treated as a product failure

Stable id: `FC-05-environment-capability-gap`.

The host lacks, relocates, contends for, or exposes a capability differently
from the environment assumed by the check. PATH scope, host load, authentication,
install shape, platform-specific tools, and detached-host constraints merge
because the observed failure belongs to the execution environment but is
reported as product behavior or readiness.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-16 — tool-check.ps1 durable profile reports coreutils missing despite Git Bash stdbuf | Primary. |
| 2026-07-17 — concurrent bats suites on one host corrupt wall-clock tests | Primary. |
| 2026-07-17 — architect-induced concurrent-suite contention (self-inflicted) | Primary; its background-and-stop addendum is secondary to FC-03. |
| 2026-07-17 — WATCH_VTICK virtual-clock refactor is a multi-layer rabbit hole; deferred to v0.2.5 | Primary. |
| 2026-07-18/19 — v0.2.7.5 AFK end-to-end run: two recurring process failures | Dominant host-load and compound-exit misread; background-and-stop is secondary to FC-03. |
| 2026-07-19 — codex `login --device-auth` falls back to localhost:1455 browser flow (no device code) on codex-cli 0.144.6 | Primary. |
| 2026-07-27 — Skill installed as a detached copy: `env/` absent, Setup stage unrunnable | Primary. |
| 2026-07-27 — `foreman-setup.sh` reports `NOT-READY` without saying why | Primary. |
| 2026-07-27 — Dual-home install: a Windows-side install leaves WSL unprovisioned (and vice versa) | Primary. |
| 2026-07-27 — Post-fix positives, and two small friction points worth keeping | Primary: the remaining friction conflates install shape with unusable capability. |
| 2026-07-28 — codex-auditor agent cannot start in a detached-HEAD host repo | Primary. |
| 2026-07-30 — Event 3: the 41-file suite had never completed, and was masking six failures | Primary: four failures lacked platform capability guards; incomplete integration is secondary to FC-02. |
| 2026-07-30 — Event 4: `tests/run.sh` returns a different verdict for the same tree depending on how it was launched | Primary. |

### FC-06 — Cross-boundary representation corrupts the command or artifact

Stable id: `FC-06-cross-boundary-representation`.

Line endings, encodings, quoting, environment variables, symlink paths, argv,
and shell metacharacters change meaning while crossing Windows, WSL, MSYS,
PowerShell, or native-process boundaries. These merge because correct content
on one side is parsed or materialized differently on the other side.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-16 — tool-check.sh unrunnable from WSL on a CRLF checkout | Primary. |
| 2026-07-18 — stdbuf LD_PRELOAD poisons MSYS CMDs through the native launcher (caught by merge gate) | Primary. |
| 2026-07-18 — pueue-Windows loses argv quoting; live-daemon kill test was racing an instant failure | Primary; fake-vs-real checker coverage is secondary to FC-02. |
| 2026-07-19 — install.ps1 fails to parse on Windows PowerShell (mklink line) | Primary. |
| 2026-07-19 — install.ps1 (and 2 more .ps1) unparsable under Windows PowerShell 5.1 — BOM-less UTF-8 + em-dashes | Primary. |
| 2026-07-27 — CRLF recurrence: every `*.sh` unrunnable from WSL despite `.gitattributes` | Primary. |
| 2026-07-27 — `SCRIPT_DIR` uses logical `pwd`, so `REPO_ROOT` breaks through install.sh's own symlink | Primary. |
| 2026-07-27 — `pwd -P` fix applied to 1 of 25 scripts sharing the idiom (deliberate, needs follow-up) | Primary. |
| 2026-07-28 — backticks in a heredoc eaten by the outer double-quoted wsl -lc wrapper | Primary. |
| 2026-07-28 — architect hit the documented WSL inline-heredoc trap while logging the entry above | Primary. |
| 2026-07-29 — PowerShell ate `$(...)` and a fixture built into the repo root | Primary. |
| 2026-07-29 — PowerShell rejects `<` at parse time, before WSL is reached | Primary. |

### FC-07 — Isolation or artifact-safety boundary is violated

Stable id: `FC-07-isolation-artifact-safety`.

Work lands in the wrong history, worktree, report set, output path, or live
record; evidence is overwritten, deleted, or left deliberately sabotaged.
Merge and cleanup faults join unsafe reviewer and editor actions because the
boundary meant to preserve provenance and recoverability did not hold.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-16 — wt-merge.sh aborts when FOREMAN_REPORT files are gitignored | Primary. |
| 2026-07-16 — remote lane produced an unmergeable parallel git history | Primary. |
| 2026-07-16 — finisher lane's cwd silently reset to a DIFFERENT lane's worktree | Primary. |
| 2026-07-17 — wt-cleanup archives only FOREMAN_REPORT.md, lost V2/V3/V4 audit reports | Primary. |
| 2026-07-27 — `run-audit.sh` exits 0 on a nonexistent brief; an agent then inferred a task and DESTROYED an artifact | Primary; the launcher's false-zero input check is secondary to FC-02. |
| 2026-07-30 — Event 9: a lane left sabotaged code in the worktree after a destructive proof and reported success | Primary; the incomplete report is secondary to FC-03. |
| 2026-07-31 — Event 14: a review agent wrote to, and then deleted from, the live store it was reviewing | Primary. |
| 2026-07-31 — Event 17: two silent file-edit corruptions, in two different tools | Primary. |

### FC-08 — Record or diagnosis disagrees with the state it describes

Stable id: `FC-08-record-state-disagreement`.

A correction, checkpoint, measurement, ledger row, or task brief states a
cause or state contradicted by controlled evidence, the current tree, or the
authoritative store. These merge because the durable record is stale, overbroad,
or simply wrong even when the underlying implementation may be correct.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-28 — CORRECTION to the entry above: the empty burst has at least two distinct causes | Primary. |
| 2026-07-30 — Event 11: three-lens adversarial review corrected the architect on both open blockers | Primary. |
| 2026-07-31 — Event 12: the shims were the cause, not the deadlock — measurement 2 was right, the checkpoint's advice was wrong | Primary. |
| 2026-07-31 — Event 13: the obligations ledger held three closed items open | Primary. |
| 2026-07-31 — Event 18: the architect relayed an unverified claim, and the implementer refused it | Primary. |

### FC-09 — Decision policy is ambiguous or does not converge

Stable id: `FC-09-decision-policy-nonconvergent`.

The available evidence does not map to one authorized action, multiple auditors
disagree without a resolver, or rework consumes rounds without a progress
criterion. Warning semantics, verdict divergence, tie-breaking, and net-progress
checks merge because the defect is in how decisions are resolved, not in the
implementation being reviewed.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-16 — merge gate semantics: user condition "when approved" vs WARNING verdict | Primary. |
| 2026-07-27 — Two auditors returned different verdicts; no reconciliation protocol exists | Primary. |
| 2026-07-27 — A rework round closed 8 findings and introduced 3 new ones; no net-progress check | Primary. |
| 2026-07-27 — RESOLUTION for the divergent-verdict gap: Fable as tie-breaker (operator ruling) | Resolution of the same decision-policy failure; it does not define a separate success class. |

### FC-10 — Orchestration shape does not fit the work

Stable id: `FC-10-orchestration-task-mismatch`.

The selected fan-out, worktree model, wrapper, or review rigor cannot provide
the state, observability, concurrency, or economics the task requires. Slow
audits, serialized vendors, live targets, untracked work, and hand-rolled
launchers merge because the orchestration abstraction is the wrong shape for
the work, even when each component behaves as designed.

| Source entry | Assignment note |
| --- | --- |
| 2026-07-16 — audit wall-clock serializes every merge (27 min full, 24 min scoped) | Primary. |
| 2026-07-16 — 4-way parallel Grok fan-out appears to serialize at the CLI | Primary. |
| 2026-07-19 — soft-mode worktree fan-out doesn't fit a stateful live-network target (env not clean-checkout-able) | Primary. |
| 2026-07-27 — Doctrine gap: worktree-default is inapplicable when the work product is UNTRACKED | Primary. |
| 2026-07-27 — Implement lane invoked via a hand-rolled launcher rather than `grok-implementer` | Primary. |
| 2026-07-27 — Process cost exceeded the work it was gating | Primary. |
| 2026-07-27 — Hand-rolled launcher used for a third consecutive round (recurrence) | Primary. |

## Recorded transcript format

The transcript is immutable replay input, not a verdict. `response_text` keeps
the full recorded vendor response, while assertions in later Tier 1 work must
consume only the paired decision traces. Paths are repository-relative and
resolve from the repository root. `recorded_version` identifies the repository
or recorder state that captured the response; vendor-specific version data
belongs in `vendor.version`.

The following JSON Schema sketch defines version 1 of the record:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://foreman.local/schemas/tier1-transcript-v1.json",
  "title": "Tier 1 recorded vendor transcript",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "round_id",
    "failure_class",
    "vendor",
    "input_context",
    "response_text",
    "recorded_at",
    "recorded_version",
    "defective_trace",
    "corrected_trace"
  ],
  "properties": {
    "round_id": { "type": "string", "minLength": 1 },
    "failure_class": { "type": "string", "minLength": 1 },
    "vendor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "model", "interface", "version"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "model": { "type": "string", "minLength": 1 },
        "interface": { "type": "string", "minLength": 1 },
        "version": { "type": "string", "minLength": 1 }
      }
    },
    "input_context": {
      "type": "object",
      "required": ["prompt", "repository_state", "network_access"],
      "properties": {
        "prompt": { "type": "string" },
        "repository_state": { "type": "string", "minLength": 1 },
        "network_access": { "const": false }
      }
    },
    "response_text": { "type": "string", "minLength": 1 },
    "recorded_at": { "type": "string", "format": "date-time" },
    "recorded_version": { "type": "string", "minLength": 1 },
    "defective_trace": { "type": "string", "minLength": 1 },
    "corrected_trace": { "type": "string", "minLength": 1 }
  }
}
```

## Worked transcript example

This is the seeded exemplar's transcript. Its response is the complete recorded
comparison used for the round: the defective implementation returned the same
healthy line for unchanged and changed inputs; the corrected implementation
separated unchanged, changed, and uncomputable outcomes.

```json
{
  "round_id": "stall-no-output-undefined-predicate",
  "failure_class": "FC-01-monitor-predicate-cannot-fire",
  "vendor": {
    "name": "OpenAI Codex",
    "model": "GPT-5.6 Sol",
    "interface": "codex agent",
    "version": "not recorded"
  },
  "input_context": {
    "prompt": "Repair and demonstrate the NO_OUTPUT stall predicate against unchanged, changed, and uncomputable inputs.",
    "repository_state": "defective 4ff8959f0eddebe051f9b8dbfb226bd18b0357fe; corrected 5af3f34abd7753f7e3e7b46100cb3932f05e02c5",
    "network_access": false
  },
  "response_text": "Defective demonstration:\nnothing changed:  OK evidence=content hash changed before=SOME_BASELINE after=\nreal change made: OK evidence=content hash changed before=SOME_BASELINE after=\n\nCorrected demonstration:\nunchanged: STALL NO_OUTPUT evidence=content hash unchanged hash=6caba305...\nchanged: OK evidence=content hash changed before=6caba305... after=1d3298b8...\nuncomputable: UNVERIFIED evidence=content digest unavailable EVIDENCE_STATUS=INCONCLUSIVE EVIDENCE_REASON=non-git-work-root:...",
  "recorded_at": "2026-08-01T01:30:16-06:00",
  "recorded_version": "stall-fix/5af3f34abd7753f7e3e7b46100cb3932f05e02c5",
  "defective_trace": "tests/golden-rounds/stall-no-output-undefined-predicate/defective-trace.json",
  "corrected_trace": "tests/golden-rounds/stall-no-output-undefined-predicate/corrected-trace.json"
}
```

The exemplar records an unknown vendor-interface version explicitly rather than
inventing one. Future recordings must capture the real CLI or API version at
recording time.

## Seed scope

`tests/golden-rounds/stall-no-output-undefined-predicate/` is the **only seeded
round** in this task. It demonstrates FC-01's absent-predicate variant from the
recorded `lib/stall.sh` defect: four referenced `ev_*` functions had no
definitions, so unchanged and changed inputs both fell through to the same
`OK` decision. The corrected trace uses the repository's real content-digest
API and distinguishes `STALL NO_OUTPUT` from `OK`.

No replay harness, trace assertions, coverage gate, process rule, Tier 1 runner,
or actor definitions are created here. Those remain tasks 2.3 through 2.7, 2.9,
and 2.10.
