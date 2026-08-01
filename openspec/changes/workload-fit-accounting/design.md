# Design — workload-fit-accounting

Parent design:
`docs/superpowers/specs/2026-07-19-empirical-workloads-design.md` (C5).
Parent plan: `docs/superpowers/plans/2026-07-19-empirical-workloads.md`
(Package D).

## Approach

1. **Up-front prediction (doctrine).** `five-part-spec.md`/`roles.md` add a
   `## Meta` line `fit: discovery_fraction: high | medium | low`, the
   architect's up-front estimate before work starts. WHEN `high`, the
   architect SHALL warn the operator with the poor-cost-fit message and get
   an explicit proceed before continuing — this automates the operator's
   manual verdict at the point it can still change the plan, not only after
   the fact. The declaration is appended as the FIRST record of the run's
   fit ledger, `$RD/fit.jsonl`: `{"phase":"estimate","discovery_fraction":
   "high"}` — so the ledger exists from run start and the post-run report
   can compare estimate vs. actual.
2. **Post-run split (`foreman-fit-report.sh RUN_ID`) — reads the fit
   ledger, NOT the event log.** This is the load-bearing audit correction:
   agent-dispatched lanes (`foreman-discover`, `foreman-search`,
   `foreman-plan`) emit **zero** `el_emit` entries — `el_emit` is called
   only by host-side scripts (`lane-run.sh`, `lane-supervise.sh`,
   `resume.sh`, `watch.sh`, `worker-run.sh`). A report reading the event
   log's `lane` field for a discovery label would find nothing and
   mis-report a discovery-heavy run as *good* fit (the inverse of its
   purpose). Instead: sources `common.sh`; resolves `RD="$(run_dir
   "$RUN_ID")"`; IF `$RD/fit.jsonl` is missing, prints `foreman-fit-report:
   no fit ledger for <RUN_ID>` and exits non-zero. Else reads the ledger
   (one JSON object per line; `phase` ∈ `estimate | discover | implement`;
   `discover`/`implement` records carry `lane` and optional `weight`,
   default 1) and tallies `weight` grouped by `phase`: `discover` →
   discovery, `implement` → offload. Where the ledger's `implement` records
   reflect real grok/codex lane activity, the canonical label is
   **`worker-grok`** (`worker-run.sh`: `LANE="worker-$VENDOR"`) /
   `worker-codex`, never the illustrative `grok:1`; test fixtures use these
   real labels. Prints exactly: `foreman-fit report RUN_ID=<id>
   discovery=<d> offload=<o> offload_fraction=<p>% fit_verdict=<good|poor>`
   (`offload_fraction = round(100*offload/(discovery+offload))`, 0 when the
   denominator is 0), `poor` when `offload_fraction < 50`.
3. **Wiring.** Wired into `foreman-cleanup.sh RUN_ID` (the confirmed
   run-close script, `SKILL.md:60`) — the Cleanup wiring point is RESOLVED,
   not either/or with "the round close." After the existing cleanup, IF
   `$RD/fit.jsonl` exists, run `foreman-fit-report.sh "$RUN_ID"` and append
   its line to the run summary; skip silently when no ledger exists (a plain
   determined run keeps no ledger and needs no fit report).

## Key decisions

- **Fit ledger, not the event log (audit correction).** The report's
  discovery-side data does NOT come from `eventlog.sh`'s `lane` field or any
  `round_done` event — agent-dispatched lanes emit no events at all, so an
  event-log reader is structurally blind to discovery effort. The fit
  ledger `$RD/fit.jsonl` is a small, explicit, architect-kept file — new,
  separate from the event log, with its own schema (`phase`,
  `lane`, `weight`) — the same posture as the manual verdict the operator
  already practiced, just structured. No event-log schema change.
- **Real implement-side labels.** Where the ledger's `implement` phase
  reflects genuine grok/codex lane completions, the report and its test
  fixtures use the actual worker label `worker-grok` (`worker-run.sh:77`) /
  `worker-codex` — never the illustrative placeholder `grok:1` that
  appeared in the pre-audit draft.
- **Threshold-based verdict, not a hard gate.** A poor-fit verdict
  (`offload_fraction < 50`) is reported, not enforced — the operator decides
  whether to proceed on a workload known up front to be discovery-heavy (per
  the up-front `fit:` warning) or continues despite a post-run poor-fit
  finding. This mirrors the parent design's stance: "the cost premise still
  doesn't pay on ~all-discovery tasks — and that's correct/honest."
- **Missing ledger fails clean, not silent or crashing.** `RUN_ID` with no
  `fit.jsonl` refuses with `no fit ledger` and a non-zero exit — this is
  distinct from Cleanup's own skip-silently behavior when a run never
  touched discovery (no ledger seeded); the script itself is strict when
  invoked directly.
- **Two moments, one signal.** The up-front `fit:` declaration (seeded as
  the ledger's `estimate` record) and the post-run `foreman-fit-report` are
  deliberately the same signal measured twice — predicted, then actual — so
  a mismatch (predicted low, actual poor-fit) is itself informative.
- **Ledger honesty is not policed.** C5's discovery side is a self-kept
  ledger, not an automatic meter (agent lanes can't emit events); a lazy or
  dishonest ledger yields a meaningless split. This is accepted per the
  parent design's Risks — the feature structures and defaults the honesty
  discipline the operator already practiced manually, it does not police it.

## Verification

`tests/fit-report.bats` proves: a fit ledger with `discover`/`implement`
records (real `worker-grok` label, weighted) tallies the exact
`discovery=<d> offload=<o> offload_fraction=<p>% fit_verdict=<good|poor>`
tokens; a healthy hybrid ledger (mostly `implement` weight) reports
`fit_verdict=good`; an all-`discover` ledger reports `offload=0`,
`offload_fraction=0%`, `fit_verdict=poor`; a `RUN_ID` with no `fit.jsonl`
refuses with `no fit ledger` and a non-zero exit. Implementer: Sonnet 5.
Audit: Opus 4.8.
