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
- [ ] Publish counts and shares per class, with the raw records retained.
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
- [ ] Evaluate KC-2, KC-3, KC-8 and KC-10 against the register.

## T5 — shadow-mode Tier-3

- [ ] Run the open-world evidence-sufficiency checks in shadow: record what
      they would have blocked, block nothing.
- [ ] Pre-declare the shadow length (at least 100 merges) and the promotion
      precision threshold, in the register, before the period starts.
- [ ] Pre-declare the demotion rule at the same time.
- [ ] Measure precision on Foreman's own merges; do not inherit a published
      figure.
- [ ] Evaluate KC-4. Promotion is an explicit architect decision recorded with
      the number.

## T6 — the per-vendor serializer and K sweep

- [ ] Sweep serializer variants and served-edge counts per vendor lane.
- [ ] Include both a synthesis-shaped task and a single-fact-lookup task, to
      resolve the grouping-helps-synthesis / grouping-hurts-lookup tension
      rather than assuming it.
- [ ] Report per vendor; flag any vendor without a completed sweep as
      unvalidated in the release report.
- [ ] Evaluate KC-6: a vendor whose best configuration does not beat the
      prompt-only arm is served no context block.
- [ ] Measure citation precision against the deterministic checker, and
      evaluate KC-7.
- [ ] Add the trivial-gaming control: verify that a verbatim-copy-and-self-cite
      response is caught rather than scored well.

## T7 — M5 per vendor pair

- [ ] Define the finding record and confirm GP-1 emits it as a first-class
      object.
- [ ] Compute unique-catch rate per vendor pair from finding telemetry.
- [ ] Implement the offline replay computation: substitute one vendor's
      recorded auditor transcript for another's on the same diffs.
- [ ] Report the companion numbers: overturned blocking verdicts, and the
      deterministic-check catch rate on the same diffs.
- [ ] Evaluate KC-5; strip quality and independence claims from any vendor
      below the threshold.

## T8 — the pre-registration register (authored before T2 runs)

- [ ] Author the register with KC-1 through KC-10, each carrying its metric,
      threshold, evaluating measurement, and exactly one action.
- [ ] Set the numeric thresholds. They are architect decisions and they are
      made now, not after the data arrives.
- [ ] Commit it with a timestamp and record its hash.
- [ ] State the amendment rule in the register itself: no criterion is added,
      amended, or removed after its measurement has run; changes become new
      criteria for the next release.
- [ ] Name the independent owner who audits the metrics themselves — in
      particular whether the first-pass gate rate is rising because specs
      shrank.

## T9 — the report, the off-switch, and the gate

- [ ] Off-switch: disable the graph context block per lane, per vendor, per
      task class, without touching the merge gate, the run record, or the
      deterministic checks.
- [ ] Prove the counterfactual survives shipping: both arms runnable on the
      same task set after the plane is live.
- [ ] Assemble the falsification report: measured numbers, the negative
      evidence it was built against, what the release reproduced, contradicted,
      or left untested.
- [ ] Every metric in the report carries its misreading and its companion
      number; a metric missing either is dropped and recorded as a gap.
- [ ] Strip any hallucination-reduction claim from release notes, README and PR
      bodies.
- [ ] Publish the report regardless of verdict; execute every met criterion's
      registered action in the same release, or record an explicit architect
      override.
- [ ] `openspec validate graph-eval-falsification --strict` passes.
- [ ] Docs gate green (`markdownlint-cli2`, `codespell`, `lychee`).
- [ ] `bugeventlog.md` appended with any workflow failure or friction event
      encountered while running this programme.
