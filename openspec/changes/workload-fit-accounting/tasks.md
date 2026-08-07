# Tasks — workload-fit-accounting

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [ ] **1. Up-front fit doctrine + fit-ledger seed** — `five-part-spec.md`/
  `roles.md`: add the `## Meta` line `fit: discovery_fraction: high | medium
  | low`; document that WHEN `high`, the architect SHALL warn the operator
  ("poor cost-fit — mostly empirical discovery; the expensive lane will
  dominate; grok offload will be small") and get an explicit proceed before
  continuing; document that the architect records this as the FIRST record
  of the run's fit ledger `$RD/fit.jsonl` —
  `{"phase":"estimate","discovery_fraction":"high"}` — so the ledger exists
  from run start (the ledger is architect-kept because agent lanes emit no
  events; see Task 2).
- [x] **2. `foreman-fit-report.sh` (TDD) — reads the fit ledger, NOT the
  event log (audit correction)** — write the failing bats fixtures first
  against a `$RD/fit.jsonl` fixture (`phase` ∈ `estimate|discover|implement`,
  `discover`/`implement` records carry `lane` + optional `weight`, using the
  real label `worker-grok`, never `grok:1`): a mixed ledger tallies
  `discovery=<d> offload=<o> offload_fraction=<p>% fit_verdict=poor` (33% <
  50% threshold); a healthy hybrid ledger (mostly `implement` weight)
  reports `fit_verdict=good`; an all-`discover` ledger reports `offload=0`,
  `offload_fraction=0%`, `fit_verdict=poor`; a missing ledger refuses with
  `no fit ledger` and a non-zero exit. Implement
  `skills/foreman/scripts/foreman-fit-report.sh RUN_ID`: resolve
  `RD="$(run_dir "$RUN_ID")"`; if `$RD/fit.jsonl` is absent, print `foreman-
  fit-report: no fit ledger for <RUN_ID>` and exit non-zero; else tally
  `weight` (default 1) by `phase` (`discover`→discovery, `implement`→
  offload), compute `offload_fraction` as `round(100 * offload / (discovery +
  offload))` (0 when the denominator is 0), print `foreman-fit report
  RUN_ID=<id> discovery=<d> offload=<o> offload_fraction=<p>%
  fit_verdict=<good|poor>` (`poor` when `offload_fraction < 50`); require
  `jq` (refuse with `foreman-fit-report: jq is required to read the fit ledger
  (see dependencies/README.md)` and non-zero exit when absent — no
  regex/grep/awk/sed fallback);
  shellcheck-clean.
- [x] **3. Wire into Cleanup (resolved wiring point)** — `foreman-cleanup.sh
  RUN_ID` (the confirmed run-close script, `SKILL.md:60`): after the
  existing cleanup, IF `$RD/fit.jsonl` exists, run `foreman-fit-report.sh
  "$RUN_ID"` and append its line to the run summary; skip silently when no
  ledger exists (a plain determined run keeps no ledger and needs no fit
  report).
- [ ] **4. Verify** — bats green under the mutex; shellcheck-clean;
  `docs-check.sh` green; commit per the plan (`docs(fit): up-front
  workload-fit prediction + poor-fit warning + fit-ledger seed` / `feat(fit):
  foreman-fit-report reads the fit ledger; post-run discovery-vs-offload
  split + poor-fit verdict`).

Acceptance: an up-front `fit: discovery_fraction: high` estimate triggers an
explicit operator warning before the run proceeds and seeds `$RD/fit.jsonl`
with an `estimate` record; `foreman-fit-report.sh RUN_ID` reads the fit
ledger (never the event log), tallies `discover`/`implement` weight using
the real `worker-grok`/`worker-codex` labels, prints the exact
`discovery=<d> offload=<o> offload_fraction=<p>% fit_verdict=<good|poor>`
tokens, and refuses cleanly (`no fit ledger`, non-zero) when the ledger is
absent; wired into `foreman-cleanup.sh RUN_ID` so every discovery-touched
run emits it automatically; bats + shellcheck + docs-check green.
