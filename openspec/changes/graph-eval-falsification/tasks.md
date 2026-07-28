# Tasks — graph-eval-falsification

Ordering note: T1 (census) ships with GP-1 and runs ahead of everything else —
it can freeze GP-6 on its own. T2 (σ) and T3 (baseline lock) are serial and both
precede T4 (graph arm). T5–T7 run after T4. T8 (the register) is authored and
committed **before** T2 runs, not after. T9 is the gate.

Precondition: GP-1 supplies usage, finding and verdict telemetry; GP-5 supplies
the hashed context block. Neither is built here.

## T1 — the query census (ships early, with GP-1)

- [ ] Instrument every graph-plane query issued by an architect or a worker
      lane: timestamp, issuing context, query text or shape.
- [ ] Classifier into point-lookup / single-document / genuine
      multi-hop-cross-run / unclassifiable, with the boundary written down
      before classification starts.
- [ ] Record the unclassifiable share; a share above one tenth fails the census.
- [ ] Run for one full release.
- [ ] Publish counts and shares per class, with the raw records retained, and
      publish the total recorded query count — it is KC-1's denominator and
      KC-14's existence proof.
- [ ] IF fewer than 100 queries are recorded, or the census fails its own
      unclassifiable bound, report KC-1 `UNCOMPUTABLE` rather than computing a
      share over a short or discredited census.
- [ ] Cover the store's time-travel and graph-diff queries in the same
      instrumentation, so KC-14 has a record to read. An absent record is
      `UNCOMPUTABLE`, not a measured zero.
- [ ] Hand the census verdict to the architect as the documented basis for
      landing or freezing GP-6.

## T2 — measure Foreman's own variance

- [ ] Lock the canary task set: 8–12 specs against the fixture repo, with the
      seeded defect classes as ground truth.
- [ ] Pin and record model versions on every arm.
- [ ] N=3 repeats minimum; report mean with a percentile bootstrap confidence
      interval; no bare averages.
- [ ] Publish the measured run-to-run σ and the confidence half-width. This is
      the release's headline output, not an improvement claim.
- [ ] **Lock and hash the half-width, and commit it before T4 runs.** KC-2a,
      KC-2b, KC-6, KC-8 and KC-10 express their thresholds against it, and the
      register's locked-measurement rule only accepts a quantity fixed by an
      earlier measurement. A half-width computed by the run it governs is not a
      threshold.
- [ ] Record the locking commit where the register cites it.
- [ ] IF fewer than three repeats complete, or the canary set is empty, report
      KC-3 `UNCOMPUTABLE` — a bootstrap over fewer than its stated repeats has no
      half-width, and the downstream criteria that cite it are `UNCOMPUTABLE`
      too.
- [ ] Declare the resolution: the smallest difference this harness can call.

## T3 — the locked prompt-only baseline arm

- [ ] Build the baseline arm: one strong model, spec + diff + report in the
      prompt, host-side deterministic checks, merge gate.
- [ ] Cost-match it to the planned graph arm; record tokens and dollars on the
      same basis.
- [ ] Content-hash the prompt, the model version, the task set and the results.
- [ ] Commit the lock with a timestamp. **The graph arm does not run until this
      commit exists.**
- [ ] Record the lock hash where the report will cite it.

## T4 — the graph arm

- [ ] Run the same task set with the GP-5 context block served.
- [ ] Report per census query class, not only in aggregate.
- [ ] Report the with-graph and without-graph arms at matched cost.
- [ ] Report, beside every rate, the denominator it was computed over: completed
      rounds per arm, locked slices measured, merged changes, gate attempts.
- [ ] Evaluate KC-2a, KC-2b, KC-3, KC-8 and KC-10 against the register, each
      returning exactly one of `MET`, `NOT-MET` or `UNCOMPUTABLE`.
- [ ] Return `UNCOMPUTABLE` where the criterion's registered uncomputable rule
      holds — any arm with zero completed rounds, zero locked slices, zero merged
      changes, zero gate attempts, or T2's half-width not yet locked. Never
      report such a case as `NOT-MET`.

## T5 — shadow-mode Tier-3

- [ ] Run the open-world evidence-sufficiency checks in shadow: record what
      they would have blocked, block nothing.
- [ ] Pre-declare the shadow length (at least 100 merges) and the promotion
      precision threshold, in the register, before the period starts.
- [ ] Pre-declare the demotion rule at the same time.
- [ ] Measure precision on Foreman's own merges; do not inherit a published
      figure.
- [ ] Report the precision denominator — the total number of blocks the checks
      would have issued — beside the precision itself.
- [ ] IF the checks would have issued zero blocks over the window, report KC-4
      `UNCOMPUTABLE` with the zero denominator named. Do **not** report 100%
      precision, and do not promote the checks on it: a checker that never fired
      is not thereby precise.
- [ ] Evaluate KC-4. Promotion is an explicit architect decision recorded with
      the number, and is not available on an `UNCOMPUTABLE` outcome.

## T6 — the per-vendor serializer and K sweep

- [ ] Sweep serializer variants and served-edge counts per vendor lane.
- [ ] Include both a synthesis-shaped task and a single-fact-lookup task, to
      resolve the grouping-helps-synthesis / grouping-hurts-lookup tension
      rather than assuming it.
- [ ] Report per vendor; a vendor without a completed sweep is reported
      `UNCOMPUTABLE` for KC-6 and flagged unvalidated — never as passing.
- [ ] Evaluate KC-6 against T2's locked half-width: a vendor whose best
      configuration does not beat the prompt-only arm by more than that
      half-width is served no context block.
- [ ] Measure citation precision against the deterministic checker, and
      evaluate KC-7. Report the claim inventory's citation-required count as the
      denominator; if it is zero, KC-7 is `UNCOMPUTABLE`, never 100%.
- [ ] Add the trivial-gaming control: verify that a verbatim-copy-and-self-cite
      response is caught rather than scored well.

## T7 — M5 per vendor pair

- [ ] Define the finding record and confirm GP-1 emits it as a first-class
      object.
- [ ] Compute unique-catch rate per vendor pair from finding telemetry, and
      report the total gate-blocking-finding count that forms its denominator.
- [ ] Implement the offline replay computation: substitute one vendor's
      recorded auditor transcript for another's on the same diffs.
- [ ] Report the companion numbers: overturned blocking verdicts, and the
      deterministic-check catch rate on the same diffs.
- [ ] IF a pair's corpus contains zero gate-blocking findings, or the pair has no
      completed replay, report KC-5 `UNCOMPUTABLE` rather than 0% or 100%.
- [ ] Evaluate KC-5; strip quality and independence claims from any vendor
      below the threshold, and from any vendor whose KC-5 is `UNCOMPUTABLE`.

## T8 — the pre-registration register (authored before T2 runs)

The register is the release's credibility keystone and it is a plan-time
artifact: it is committed while the plan is still the only artefact, not once
implementation has begun. A threshold chosen after implementation starts is not
pre-registered.

- [ ] Author the register with KC-1, KC-2a, KC-2b, KC-3 through KC-10,
      KC-11a–KC-11d, KC-12, KC-13, KC-14 and KC-15, each carrying its metric,
      its fixed numeric threshold, its evaluating measurement, its measured
      subject, exactly one action, and exactly one uncomputable rule.
- [ ] Transcribe every number that
      `docs/research/vnext/PM-acceptance-criteria.md` §4 already fixed, with
      inline attribution to the criterion it came from: 20% genuine multi-hop
      census share (K-1 A); relation F1 < 0.60, non-isolated share < 70%, any
      false merge, > 40% merged in one pass (K-2); the clean drop-and-rebuild
      (K-3b); zero time-travel or graph-diff queries and the
      files-only-within-2x head-to-head (K-3c); the ~5% unique-catch rate (K-4);
      the 100-merge shadow window with a zero-false-block promotion bar (K-6);
      the >= 50% reduction over >= 30 lane-starts (K-8).
- [ ] Fix the four thresholds PM left open — KC-3 (5.0 pp half-width), KC-7
      (72% citation share), KC-8 (10% cost margin), KC-9 (8 maintenance hours) —
      as architect decisions, each labelled as judgement with the measurement it
      is anchored on. They are made now, not after the data arrives.
- [ ] Check every threshold for **fireability** before registration, against the
      measured or published quantity it is anchored on, and record the achievable
      range in the basis field. Re-baseline or strike any threshold no achievable
      measurement could cross.
- [ ] Re-baseline KC-13's wall-clock input from PM's transcribed 15 minutes to
      **60 seconds**, recording both numbers and the reason: R8's measured ~1,070
      documents per second over ~5,500 documents puts the rebuild near 5.1 s, so
      900 s could not be tripped by any corpus this release will have. Record
      that the amendment was made before the governed measurement ran.
- [ ] Record the action enum in the register itself as
      `revert | descope | keep-off | keep`, with the one-time extension by
      `keep-off` and its justification, and with the rule that `keep` is never a
      met-action. Keep reporting and publication obligations in a separate
      `Report:` field so the action field carries one action and nothing else —
      KC-3 and KC-15 previously carried both.
- [ ] Split every multi-branch source criterion before registration (K-1
      Measurement B into KC-2a/KC-2b; K-2 into KC-11a–d) so no criterion carries
      two conditions or two actions.
- [ ] State the **derived-predicate rule** generally rather than as a KC-8/KC-9
      exception: a predicate over several quantities is one metric only where all
      inputs come from one measurement, the combinator is written out as a total
      boolean function, all inputs share one subject and one action, and the
      report prints each input beside the verdict, naming which input made a
      disjunction true. KC-8, KC-9, KC-13 and KC-15 are registered under it.
- [ ] State the **locked-measurement threshold rule**: a threshold against a
      quantity locked, published and hashed by an earlier registered measurement
      counts as fixed, and the register names the supplying measurement (T2) and
      the locking commit. A threshold against a quantity produced by the same run
      it governs is refused. This is what makes KC-2a, KC-2b, KC-6, KC-8 and
      KC-10 registrable without inventing constants.
- [ ] State the **outcome vocabulary and the uncomputable rule** in the register:
      every evaluation returns exactly one of `MET`, `NOT-MET` or
      `UNCOMPUTABLE`; `UNCOMPUTABLE` is never `NOT-MET`, never a pass, never a
      waiver, and cannot be overridden; the governed component does not ship
      enabled by default, no claim resting on it is published, and the criterion
      carries forward under the same identifier.
- [ ] Give **every** criterion an explicit uncomputable rule naming its
      denominators and its minimum observation counts — 100 recorded queries
      (KC-1), completed rounds per arm (KC-2a/2b/6/10), bootstrap repeats (KC-3),
      predicted blocks (KC-4), gate-blocking findings (KC-5), citation-required
      claims (KC-7), merged changes and gate attempts (KC-8), recorded
      maintenance hours (KC-9), gold-set relations, extracted nodes, gold-sample
      size and merged nodes (KC-11a–d), lane-starts and a non-zero before-window
      (KC-12), an attempted rebuild run (KC-13), an existing instrumentation
      record (KC-14), a run TerminusDB arm with non-zero latency (KC-15).
- [ ] State the **measured-zero rule**: a metric whose inputs were never recorded
      is `UNCOMPUTABLE`, never a measured zero. KC-14's threshold is literally
      zero, so without this rule an uninstrumented release satisfies it.
- [ ] Record the K-1 resolution in the register: KC-1's subject is GP-5 alone,
      the Measurement-A "freeze GP-6" branch is struck, and GP-6 is governed by
      KC-13, KC-14 and KC-15.
- [ ] State the override rule in the register: a same-release override records
      the criterion as FAILED and keeps the affected component off; any rescue
      is a new, prospectively registered criterion in a later release; and an
      `UNCOMPUTABLE` outcome cannot be overridden at all, because there is no
      measured number to override.
- [ ] Commit it with a timestamp and record its hash.
- [ ] State the amendment rule in the register itself: no criterion is added,
      amended, or removed after its measurement has run; changes become new
      criteria for the next release.
- [ ] Name the independent owner who audits the metrics themselves — in
      particular whether the first-pass gate rate is rising because specs
      shrank.
- [ ] Architect follow-up outside this package: `ROADMAP.md`'s "ten
      pre-registered criteria" sentence is now nineteen registered criteria, and
      `round-ownership-default` must carry the requirement and task that emits
      KC-12's occurrence telemetry (RECONCILE R3). Neither file is edited here.

## T9 — the report, the off-switch, and the gate

- [ ] Off-switch: disable the graph context block per lane, per vendor, per
      task class, without touching the merge gate, the run record, or the
      deterministic checks.
- [ ] Prove the counterfactual survives shipping: both arms runnable on the
      same task set after the plane is live.
- [ ] Assemble the falsification report: measured numbers, the negative
      evidence it was built against, what the release reproduced, contradicted,
      or left untested.
- [ ] Publish an outcome table covering **all nineteen** registered criteria,
      each as `MET`, `NOT-MET` or `UNCOMPUTABLE`; for every `UNCOMPUTABLE`,
      name the missing input or zero denominator, the component left off, and
      the release in which the input is expected. A criterion omitted from the
      table counts as `UNCOMPUTABLE`.
- [ ] Every metric in the report carries its misreading and its companion
      number; a metric missing either is dropped and recorded as a gap.
- [ ] Strip any hallucination-reduction claim from release notes, README and PR
      bodies.
- [ ] Publish the report regardless of verdict; execute every met criterion's
      registered action in the same release, or record an explicit architect
      override — which records the criterion as FAILED and leaves the component
      off, never as a pass. An override against an `UNCOMPUTABLE` criterion is
      refused rather than recorded.
- [ ] Do not ship enabled by default any component whose governing criterion
      returned `UNCOMPUTABLE`, and state in the release notes which components
      that covers and why.
- [ ] `openspec validate graph-eval-falsification --strict` passes.
- [ ] Docs gate green (`markdownlint-cli2`, `codespell`, `lychee`).
- [ ] `bugeventlog.md` appended with any workflow failure or friction event
      encountered while running this programme.

## T10 — extraction quality (KC-11a–d), the criterion nothing else owned

PM K-2 fixes four numbers and no package carried them. This package owns their
registration and their evaluation; `knowledge-plane-refresh`'s slow cadence is
the measured subject.

- [ ] Build the gold set over Foreman's own corpus **before** the extraction
      under test is scored, and record its size and construction method.
- [ ] Report entity P/R/F1; relation P/R/F1 with predicate scoring; the
      false-merge count; the non-isolated-node share; and the share of nodes
      merged in a single resolution pass.
- [ ] Report each denominator beside its rate: gold-set relation count,
      extracted relation count, extracted node count, gold-sample size, and
      merged-node count.
- [ ] Evaluate KC-11a (relation F1 < 0.60), KC-11b (non-isolated < 70%), KC-11c
      (any false merge), KC-11d (> 40% merged in one pass) independently; one
      being met does not suppress the others.
- [ ] Return `UNCOMPUTABLE` on a zero denominator rather than a favourable
      number: an F1 of 0.0 over an empty gold set, a share over zero nodes, zero
      false merges over an empty sample, and a 0% one-pass share over zero merges
      are absent measurements — and two of them would otherwise read as passes.
- [ ] Report the compression ratio alongside the false-merge rate and the
      component-count delta, and never optimise it.
- [ ] Enforce the two hard rules as rules, not thresholds: no LLM decides an
      edge's domain, range, cardinality or disjoint status; no LLM infers relations
      between opaque Foreman-generated identifiers.

## T11 — round-mode occurrence reduction (KC-12), the other ownerless criterion

- [ ] Consume the round-ownership occurrence telemetry; do not count class-1
      background-and-stop events by recollection or by re-reading
      `bugeventlog.md` after the fact.
- [ ] Require at least 30 lane-starts in the before-window and at least 30 in
      the after-window; report both counts.
- [ ] Evaluate KC-12 (< 50% reduction) and, if met, revert the claim that the
      round-mode default fixes class-1 from `ROADMAP.md`, the release notes and
      the README.
- [ ] If either window is short, report KC-12 `UNCOMPUTABLE` — a short window is
      not a pass, and the vocabulary is the register's general one rather than
      this criterion's private "not evaluated".
- [ ] If the before-window records zero class-1 occurrences, report KC-12
      `UNCOMPUTABLE`: the reduction's denominator is that rate, and a reduction
      from zero has no value. Do not report it as 0% or 100%.

T9 remains the final gate for this package, and its checklist also covers T10
and T11.
