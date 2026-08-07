# Tasks — council-review-plane

Implementer: grok-4.5 · Audit: a family distinct from the implementer, selected
by `ac_select_auditor`.

Every task is test-first. Every new shell file needs mode `100755` in the git
index — the lane cannot run git, so it reports the need under
`ARCHITECT_ACTIONS` and the architect sets the bit.

## Phase 1 — usable without any Council code

- [x] **1. `lane-review-bundle.sh` (TDD)** — write the failing bats first:
  a bundle built over a worktree holding uncommitted carry-over records the
  round diff and `worktree_dirty=true`; a base ref that is not an ancestor of
  the lane HEAD exits non-zero naming both SHAs and writes no bundle; a base ref
  that does not resolve exits 2. Then implement
  `skills/foreman/scripts/lane-review-bundle.sh WORKTREE BASE_REF OUT_DIR`
  writing `OUT_DIR/bundle.json` with keys `base_sha`, `head_sha`, `round_diff`,
  `files_changed[]`, `worktree_dirty`, `base_is_ancestor_of_release`. Use `jq -n`
  to build the JSON; do not concatenate strings. Add the baseline row.
  shellcheck-clean at `-S warning`.

- [x] **2. `lib/review-quorum.sh` (TDD)** — port `evaluateAutomaticQuorum` from
  `components/council/packages/domain/src/quorum.ts`, defaults
  `minimumProposals = 3`, `minimumDomains = 2`. Failing tests first: three
  admissible verdicts all from `anthropic` yield `QUORUM_NOT_MET domains=1`;
  three across three families yield `QUORUM_MET`; one inadmissible plus two
  admissible yields `QUORUM_NOT_MET admissible=2`; a non-integer threshold is
  refused rather than coerced. `rq_evaluate <verdicts_json>` prints
  `QUORUM_MET|QUORUM_NOT_MET admissible=<n> domains=<n>` and returns 0 only on
  `QUORUM_MET`.

- [ ] **3. `council-advise.sh` (TDD) — refuses gate artifacts by construction**
  — failing tests first: writing to a path whose basename is
  `audit-verdict.json`, `checks-result.json`, or matches `gate-*.json` exits
  non-zero, prints a refusal naming the file, and creates nothing; a normal
  advisory write produces `advisory: true`; a single-family reviewer set yields
  `quorum_not_met` rather than an approval; a reviewer that returns nothing
  reduces the admissible count rather than counting as agreement. Then
  implement: read the bundle, dispatch reviewers through `ac_select_auditor`
  and the existing adapters, collect verdicts, call `rq_evaluate`, write one
  advisory artifact under `docs/evidence/<date>-council-advisory/`.

- [ ] **4. Verdict admissibility** — a reviewer verdict that does not decode
  against `adapters/verdict.schema.json` is excluded with reason
  `schema_invalid` and contributes to neither count. Failing test first, using a
  deliberately malformed verdict fixture.

## Phase 2 — Council decides

- [ ] **5. Bundle decoder in `packages/schema`** — Vitest first: a fixture
  `bundle.json` decodes to a typed value, and a bundle missing `base_sha` fails
  decoding with a named field. Implement `src/bundle.ts` reusing the existing
  `decode.ts` path. No new dependency. `corepack pnpm -s verify` stays green.

- [ ] **6. `review.ts` in `packages/domain`** — Vitest first, covering:
  blinding replaces provider/model/CLI identity with random candidate ids and
  keeps the mapping in a sealed record; a judge does not score its own
  candidate; a decisive comparison run in both orders that disagrees yields
  `judge_unstable`; the typed outcome set is exactly `approved`,
  `changes_requested`, `quorum_not_met`, `judge_unstable`, `schema_invalid`,
  `insufficient_evidence`, `outcome_unknown`. Runtime-free: no Effect import, no
  I/O, pure functions only — the package boundary test in `tests/architecture/`
  enforces this.

- [ ] **7. CLI entry point** — a thin Node entry so `council-advise.sh` can call
  Council without an Effect runtime: reads a bundle path and a verdicts path on
  argv, writes the advisory JSON to stdout, exits non-zero on a typed failure.
  Vitest for argument handling and exit codes.

- [ ] **8. Blinding proof** — a bats test asserting the advisory artifact
  contains no configured vendor name in any candidate field. Grep the artifact
  for each vendor in `[audit] vendors`; any hit fails.

## Phase 3 — reviewer supply

- [ ] **9. Admit the authenticated `agy` lane through Setup** — execute Task 1
  of `docs/superpowers/plans/2026-08-02-council-v030-localization.md` rather than
  duplicating it: `bash env/tool-check.sh --profile soft --lane agy` reports
  `LANE_READY: agy=yes|no`, and `foreman-setup.sh --lane agy` reaches the adapter
  probe. Pin the `agy` model before family classification; cap concurrency at 1
  until OAuth and state isolation are complete.

- [ ] **10. Third-domain proof** — a test asserting `ac_select_auditor` places
  `agy` in a family distinct from `codex` and `grok`, and refuses when the
  candidate family equals a worker family.

## Phase 4 — wire it in without granting authority

- [ ] **11. `gate-eval.sh` reports, never obeys** — failing test first: with an
  advisory record present whose outcome is `changes_requested`, the gate verdict
  is unchanged; with the advisory record absent, the gate verdict is unchanged.
  Then implement reporting only.

- [ ] **12. Dogfood it** — run the plane over one real Grok lane before Council
  v0.3 is declared stable, capture the advisory record under `docs/evidence/`,
  and record in `devlog/` and `bugeventlog.md` every defect the plane itself
  exhibits. The plane reviewing its own introduction is the first honest test
  of it.

## Out of scope, deliberately

Calibrated confidence weighting, critique rounds, minority-blocks-closure and
synthesis. Each requires the Effect application shell, none fixes a measured
defect, and each moves Council from advisory toward decisive — which the release
constraint forbids.
