# Spec delta — council review plane

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.
Header shape follows the OpenSpec CLI's parseable form.

## ADDED Requirements

### Requirement: a review reads one round, never a worktree

Foreman SHALL build a review bundle describing exactly one round of lane work,
containing the base SHA, the head SHA, the diff between them, the list of
changed paths, and whether the worktree was dirty when the bundle was built.

The bundle builder SHALL refuse when the base ref is not an ancestor of the lane
HEAD, and SHALL name the two SHAs in the refusal.

A reviewer SHALL receive the bundle and MUST NOT receive the worktree path.

#### Scenario: a stale base is refused rather than reviewed

- **WHEN** the bundle builder is given a base ref that is not an ancestor of the
  lane HEAD
- **THEN** it exits non-zero, names both SHAs, and writes no bundle

#### Scenario: carry-over is distinguishable from the round's change

- **GIVEN** a lane worktree holding uncommitted changes from an earlier round
- **WHEN** a bundle is built for the current round
- **THEN** the bundle records the round diff and reports `worktree_dirty` true,
  so a reviewer can attribute each changed path to a round

### Requirement: reviewer count never substitutes for domain diversity

Council SHALL close a review automatically only when at least three admissible
reviewer verdicts arrive from at least two independent failure domains.

The failure domain SHALL be the reviewer's **model family** as classified by
`ac_model_family`, never the CLI name and never the process count.

IF the admissible verdicts come from fewer than two families, THEN the outcome
SHALL be `quorum_not_met` with the admissible count and the domain count.

#### Scenario: three reviewers from one family do not close a review

- **GIVEN** three admissible verdicts, all from the `anthropic` family
- **WHEN** quorum is evaluated
- **THEN** the outcome is `quorum_not_met` with `domains=1`

#### Scenario: inadmissible verdicts count toward neither total

- **GIVEN** one inadmissible verdict and two admissible ones from two families
- **WHEN** quorum is evaluated
- **THEN** the outcome is `quorum_not_met` with `admissible=2`

### Requirement: deterministic checks precede deliberation

Council SHALL run schema and scope checks over every reviewer verdict before any
ranking, and SHALL exclude invalid verdicts with a machine-readable reason.

A verdict that does not decode against the verdict schema SHALL be excluded as
`schema_invalid` and MUST NOT contribute to any count.

#### Scenario: a malformed verdict is excluded, not counted

- **WHEN** a reviewer returns output that does not decode
- **THEN** the verdict is excluded with reason `schema_invalid`, and the
  admissible count reflects the exclusion

### Requirement: candidate identity is blinded before judging

Council SHALL replace provider, model, CLI and author identity in every
candidate with a random candidate identifier before any judge sees it, and SHALL
retain the mapping in a sealed record not passed to judges.

The advisory artifact SHALL contain no provider, model or CLI name in its
candidate fields.

#### Scenario: the advisory record names no vendor in candidate fields

- **WHEN** an advisory record is written
- **THEN** grepping its candidate fields for the configured vendor names returns
  nothing

### Requirement: judges are non-authors and comparisons are order-checked

A reviewer MUST NOT judge a candidate it authored.

Every decisive pairwise comparison SHALL be run in both candidate orders with an
identical rubric and identical evidence, and IF the two orders disagree, THEN
the outcome SHALL be `judge_unstable`.

#### Scenario: order sensitivity is reported rather than averaged

- **GIVEN** a decisive comparison whose result changes when candidate order is
  reversed
- **WHEN** the outcome is computed
- **THEN** it is `judge_unstable`, and no winner is declared

### Requirement: the review plane is advisory and cannot become an authority

Council MUST NOT write `audit-verdict.json`, `checks-result.json`, or any file
consumed by `gate-eval.sh` or `merge-gate.sh` as a release input.

The advisory writer SHALL refuse, by filename, any attempt to write such a file,
and SHALL exit non-zero.

The advisory artifact SHALL carry `advisory: true`.

`gate-eval.sh` MAY read the advisory artifact for reporting and SHALL NOT change
its verdict on the basis of it.

#### Scenario: the bridge refuses to write a gate artifact

- **WHEN** the advisory writer is given an output path whose basename is
  `audit-verdict.json`
- **THEN** it exits non-zero, prints a refusal naming the file, and creates
  nothing

#### Scenario: an unreachable quorum does not block the release gate

- **GIVEN** an advisory outcome of `quorum_not_met`
- **WHEN** the release gate runs
- **THEN** the gate verdict is unchanged by the advisory record

### Requirement: outcomes are typed and name the unmet condition

Council SHALL emit one of `approved`, `changes_requested`, `quorum_not_met`,
`judge_unstable`, `schema_invalid`, `insufficient_evidence`, or
`outcome_unknown`, and SHALL state the unmet condition and the available next
action.

An outcome MUST NOT be inferred from an absent reviewer response; a missing
response SHALL reduce the admissible count.

#### Scenario: silence is not consent

- **GIVEN** a reviewer that times out and returns nothing
- **WHEN** the outcome is computed
- **THEN** the admissible count excludes it, and the outcome names the reduced
  count rather than treating the silence as agreement
