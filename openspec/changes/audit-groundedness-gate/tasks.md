# Tasks — audit-groundedness-gate

Ordering: T1 is the doctrine and the check registry and blocks everything. T2
(canary) lands before any check is trusted — deliberately before the checks
themselves. T3 is wave 1, T4 is wave 2, T5 is wave 3 and is separable. T6-T7 are
integration and measurement. T8 is the gate.

**Do not start before `three-outcome-verdicts` has merged.** Every check reads
the verdict artifact, and this package assumes that artifact is always written,
carries provenance, and is bound to the diff under evaluation. Building against
the current three-valued, unbound artifact would encode a contract that is about
to change.

## T1 — the rule, the registry, and the refusal

- [x] Write the two-speed rule into gate doctrine before writing checker code:
      only closed-world checks block; open-world checks warn; the model's verdict
      is one signal and is itself checked.
- [x] Create the check registry: one entry per check with `id`, `tier`, `world`,
      `blocking`, `mode`, the required inputs, and the structural-zero-false-
      positive sentence.
- [x] Implement the refusal: a check declared `world = open` cannot be configured
      enforcing; the checker exits with a named error rather than honouring it.
- [x] Implement the refusal's twin: a check with no promotion record runs in
      shadow regardless of configuration, and says so.
- [x] Add the `[gate.groundedness]` block to `config/foreman.toml.example` and
      `.foreman/config.toml` with every check defaulting to `shadow`.
- [x] Record the declared cap on the number of blocking checks.

## T2 — the canary, before the checks it protects

- [x] Build `tests/fixtures/gate-ground/` — one conforming baseline audit
      artifact plus one mutant per registered check.
- [x] Each fixture declares its expected violation count and the expected focus
      of each violation.
- [ ] The checker evaluates the corpus on every invocation, before trusting its
      own result.
- [x] Assert count and focus, never non-emptiness.
- [x] A short corpus, an unreadable corpus, or a corpus whose shape does not
      match the parsed artifact produces `UNVERIFIED` and a gate failure with its
      own reason string.
- [ ] Prove the canary works by mutation: break one check on purpose, confirm the
      canary catches it, restore. Record the evidence in the test.
- [x] Measure the canary's wall-clock cost; if it is not milliseconds, the corpus
      is too large.

## T3 — wave 1: the checks that need nothing new

- [ ] `gate-ground.sh` skeleton: reads the run directory, writes
      `$RD/gate-ground.json`, emits one addressed record per violation with
      `check`, `focus`, `path`, `message`, `required_evidence[]`, `world`,
      `blocking`.
- [ ] G9a — `APPROVED` with a `critical` or `high` finding.
- [ ] G9b — `BLOCKED` with no `critical`/`high` finding and no declared criterion
      miss.
- [ ] G9c — `WARNING` with no findings.
- [ ] Keep G9a/b/c as three checks with three messages; do not collapse them into
      one disjunctive check.
- [ ] G1 blocking form — cited path resolves nowhere, after consulting the diff's
      old-side names and `git diff --find-renames`.
- [ ] G1 advisory form — cited path exists but is outside the diff; counted.
- [ ] G2 blocking form — cited line beyond the file's line count at `HEAD`.
- [ ] G2 advisory form — cited line outside every changed hunk; counted.
- [ ] `line: 0` treated as a file-level finding, never a line violation.
- [ ] Every check reports `unevaluated` with the named missing input rather than
      passing when an input is absent.

## T4 — wave 2: two prose invariants become enforced

- [ ] Extend the harness-written provenance block with the worker vendor recorded
      for the attempt and with `rubric` + `rubric_version`. Extend it; do not
      restate `three-outcome-verdicts`' fields.
- [ ] Leave `skills/foreman/scripts/adapters/verdict.schema.json` untouched — the
      harness writes provenance, the model does not.
- [ ] G4 — compare recorded worker vendor against recorded audit vendor; blocking
      where policy requires separation, advisory otherwise, unevaluated when
      either is unrecorded.
- [ ] G4 SHALL NOT infer a vendor from a config value or from a config-home path.
- [ ] G5 — rubric identifier and version present, and the version resolves in the
      repository at `BASE_SHA`.
- [ ] Confirm the existing configured-vendor check in `audit-run.sh:318-321` stays
      as-is; it guards intent at audit start and G4 guards the record at the gate.
      Do not delete one for the other.

## T5 — wave 3: the checks that need a spec-format change

Separable from T1-T4. It may land in a later release without invalidating them.

- [ ] Decide the spec-format change with the architect: scope globs and stable
      criterion identifiers in `references/five-part-spec.md`.
- [ ] G6 — every changed path matches a declared scope glob.
- [ ] G3 — every declared criterion identifier discharged by a check result, a
      finding, or an explicit waiver.
- [ ] Both report `unevaluated` while the format does not carry the fields.
- [ ] Do not derive criterion ids from a hash of the criterion text for any
      blocking use; record the reason in the change log.

## T6 — integration with the gate and the record

- [ ] `gate-eval.sh` invokes the checker after the audit returns and before the
      verdict is consulted as a merge signal.
- [ ] Blocking-class violations become gate reasons; advisory violations become
      gate warnings; unevaluated checks are named in the output.
- [ ] Tier ordering and short-circuiting: an earlier blocking failure means the
      groundedness layer does not run, and is recorded as not run rather than as
      passed.
- [ ] Groundedness violations are carried in the `gate_decision` event payload
      defined by `decision-lineage-and-telemetry`; do not define a new event type.
- [ ] `pr-open.sh` states that the layer checks provenance and consistency and
      not correctness, names `checks-result.json` as the correctness signal, and
      says when checks were shadowed or unevaluated.
- [ ] Publish the "what cannot be made symbolic" list beside the checks so the
      gate's silence is not read as coverage.

## T7 — shadow measurement and the promotion protocol

- [ ] Ship every check in `shadow`.
- [ ] Record per-merge: check id, violations produced, and the merge's eventual
      outcome.
- [ ] Declare the promotion threshold and the sample size before reading the
      numbers.
- [ ] Write the promotion record format: threshold, merges measured, violations,
      false positives, decision, date.
- [ ] Name an owner and a release deadline for the wave-1 promotion decision — a
      check parked in shadow forever is theatre, and this task is what prevents
      it.
- [ ] Do not promote any open-world check. Not in this release, not by
      configuration.

## T8 — gate

- [ ] `tests/gate-ground.bats` green: one test per check, plus the mutation proof
      for the canary, plus the unevaluated-not-passed cases.
- [ ] Prove the failure class is caught end to end: a run whose audit output
      cites a nonexistent file is blocked by the checker with an addressed record
      and a required-evidence sentence.
- [ ] Prove the shadow default: with no promotion records, a violating audit
      produces warnings and merges.
- [ ] Prove the canary fails closed: a deliberately no-op check produces
      `UNVERIFIED` and a gate failure naming the self-test.
- [ ] Full suite green on WSL/Ubuntu 26.04 and on Git-Bash/Windows.
- [ ] `shellcheck` clean on `gate-ground.sh` and on the modified `gate-eval.sh`.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate audit-groundedness-gate --strict` passes.
- [ ] `bugeventlog.md` entry appended recording the failure class this package
      closes, with the evidence, root cause, impact and enhancement.
