# Tasks — readme-refresh

Ordering is the design, not a preference. T1 escalates the four ambiguities and
runs first because it has human latency. T2 builds the ledger; T3 builds the
checks; T2 and T3 can run in parallel. T4-T8 are the rewrite and may not begin
on a section while a claim inside it is undispositioned. T9 is the cross-family
fact-check over the final text. T10 gates.

Depends on `doctrine-reality-drift` for the claim registry and the docs-gate
wiring — this package supplies rows and consumes the mechanism. Lands after the
packages whose behaviour the README describes.

## T1 — escalate the four ambiguities (human, blocks the rewrite of the affected sentences)

- [ ] Create `docs/research/vnext/README-ambiguity-decisions.md` stating the
      four questions verbatim, each with an `Answer:`, `Decided by:` and
      `Date:` field.
- [ ] **Q1 — the census.** `README.md:50-51`, "Four roles, four producers".
      Does the architect count as a role but not a producer? Do the two
      implementer lanes count as one role or two? What is the intended count
      now that a fourth vendor lane exists?
- [ ] **Q2 — the baseline version.** `README.md:268-269`, "on top of what
      v0.2.5 already shipped", inside a document that anchors everything else
      to v0.2.7.5. Deliberate launcher baseline, or stale pin?
- [ ] **Q3 — `CMD` and `GATE`.** `README.md:311-315`,
      `foreman-launch(--detach) → lane-run.sh → foreman-launch (CMD) →
      foreman-launch(GATE)`. Expand in place as process roles, keep as jargon,
      or replace with a pointer to `launcher/README.md`?
- [ ] **Q4 — "host identity".** `README.md:293`, "one Claude Code architect
      session per host identity". OS user, machine, `$HOME`, or Claude config
      path?
- [ ] Record in the file that a model-generated answer is not acceptable for any
      of the four, and why: each is a meaning question, and a confident guess
      manufactures a new false claim.
- [ ] Add the recorded-exception section the prose-ceiling check reads.

## T2 — the claim ledger (truth before prose)

- [ ] Create `docs/research/vnext/README-claim-ledger.tsv` with columns
      `claim_id`, `source_table`, `readme_lines_at_authoring`, `disposition`,
      `resolution_ref`.
- [ ] Seed one row per claim row in `EDIT-readme-facts.md` sections 1 (30), 2
      (10) and 3 (15), and one row per omission row in section 6 (12). Derive
      the counts from the file; do not transcribe these numbers as constants.
- [ ] Disposition every row: `corrected`, `deleted`, `kept-with-evidence`,
      `kept-as-doctrine`, or `deferred-with-owner` with the owning package
      named.
- [ ] For each claim whose truth depends on another package landing (gate
      freshness, lock primitive, `claude` lane, OpenSpec conformance, launcher
      build), record both branches so the sentence can be written either way.
- [ ] Architect review pass: re-read every `corrected` and `kept-with-evidence`
      row against the code it cites. Record the review in
      `docs/research/vnext/README-claim-ledger.md` naming what was compared.
- [ ] Register every retained shipped-behaviour claim as a row in
      `docs/doctrine-claims.tsv` under `doctrine-reality-drift`'s format. Do not
      invent a README-specific probe format.

## T3 — the `readme` stage in `docs-check.sh`, proven able to fail

- [ ] Add a `readme` stage to `skills/foreman/scripts/docs-check.sh`. Shell,
      `jq`, `git` only; offline; no model call. shdoc headers; shellcheck clean.
- [ ] Ledger checks: expected row count derived from `EDIT-readme-facts.md`;
      fail on any source row with no ledger row, any ledger row with no source
      row, and any empty or unrecognised `disposition`.
- [ ] Structure checks: exact ordered level-two heading sequence, failing at the
      first differing position; no numbered heading.
- [ ] Reference checks: no `section <digit>` or `§<digit>` in prose; every
      `](#slug)` resolves against slugs computed from the file's own headings;
      every relative link resolves against the tree.
- [ ] Relocation checks, both ends: each enumerated item absent from `README.md`
      **and** present at its destination. List the marker strings in the check
      so a reviewer can see what is being detected.
- [ ] Content checks: `fail-closed at every stage` absent unless a registry row
      proves it; `Four roles, four producers` absent; `GraphStore`, the
      files-only fallback, the work-DAG projection and the telemetry gap
      present; the stated Quint-model count equal to the count of
      `formal/specs/*.qnt` in the tree.
- [ ] Prose ceilings: `silent`/`silently` ≤ 3 and all inside the evidence
      section; `never` ≤ 12; contrastive `, not ` ≤ 7; no sentence with more
      than two em dashes, and none with more than one in the limits section.
      Print each measured count against its ceiling and the offending line
      numbers. Print the sentence-splitting rule.
- [ ] Read deliberate exceptions from `README-ambiguity-decisions.md`; never by
      editing the ceilings.
- [ ] Provenance checks: `As of v` absent; no `v0.<digit>.<digit>` outside the
      lineage subsection.
- [ ] Ambiguity check: fail unless all four questions have a non-`TBD` answer
      with a named decider and a date.
- [ ] Create `tests/readme-structure.bats`. **Every check above gets a fixture
      that breaches exactly that check and a test asserting the stage fails on
      it** — per this release's checker-soundness rule. A check with no
      known-bad fixture is not done.
- [ ] Verify the stage passes on a compliant fixture, so the suite is not
      merely proving that everything fails.

## T4 — restructure to twelve named sections

- [ ] Reorder to the twelve unnumbered level-two headings named in the spec,
      moving the five-part spec from position 9 to position 3.
- [ ] Merge Setup/Use/Cleanup with the quickstart; merge the evidence contract,
      verification and the docs stage into "Reports are claims"; fold the
      graphify query material into "The record" and the maintenance paragraph
      into further reading.
- [ ] Replace every numbered cross-reference with a named anchor link,
      including the five already-broken ones at `:95`, `:134`, `:223`, `:228`
      and `:591`.
- [ ] Run the structure and reference checks; iterate until clean.

## T5 — relocate the reference material

- [ ] Move to `docs/USAGE.md`: the worktree exit-code table and per-script exit
      codes; the Setup/Cleanup script mechanics (SIGINT ordering, pueued
      ownership, lock sweeping); the `docs-check.sh` tool and config table; the
      codex CLI flag detail.
- [ ] Move the three launcher bullets (nested Job Objects, NTSTATUS
      byte-masking, jq-vs-python3) to `launcher/README.md` and
      `reference-environment.md`.
- [ ] Reduce the Grok write-cancellation walkthrough to its principle and its
      one load-bearing sentence — the model narrates edits while writing
      nothing, `DIG_B == DIG_A` — and drop the flag forensics.
- [ ] Move the version-stamped provenance to `ROADMAP.md` under the release that
      introduced it.
- [ ] Run the relocation and provenance checks; iterate until clean.

## T6 — write the truth back in

- [ ] Rewrite each section against its ledger rows. A section whose ledger rows
      are undispositioned is not ready to be written.
- [ ] State enforcement strength explicitly for the five safety claims:
      cross-vendor invariant, git-write ban, lock serialisation, dirty-safety,
      and the gate. Each reads as enforced-by-code with a citation,
      enforced-in-one-place with the place named, or doctrine-only.
- [ ] Write the gate sentence against whichever outcome `audit-groundedness-gate`
      produced, and cite the code either way.
- [ ] Re-derive every row of the shipped/stub table from the code, not from the
      previous table.
- [ ] Architect review: can a reader tell, for each safety claim, what is
      enforcing it? Record the review.

## T7 — the release's four homeless bodies

- [ ] Re-key the cross-vendor invariant on **model family, not CLI name**, in
      the mental model and lanes sections; retire "Four roles, four producers"
      and the CLI-keyed four-box diagram; add the agy row with its honest
      caveats routed to the limits section, not the table.
- [ ] Write "The record": event log as source of truth, work-DAG as a
      deterministic projection no model writes, knowledge plane on two cadences
      with no model in the per-merge path, the SQLite ontology adapter as a
      regenerable materialisation behind a `GraphStore` port with a files-only
      fallback and never the system of record, consumption as a pre-serialized,
      content-hashed, token-budgeted context block.
- [ ] Frame the plane as cross-session provenance and deterministic gate checks.
      Do not frame it as retrieval accuracy or hallucination reduction.
- [ ] Add checker soundness as the fourth movement of "Reports are claims": a
      checker whose predicate does not match its claim passes loudly, and a loud
      pass is trusted.
- [ ] Add to the limits section: the telemetry gap (no tokens, no cost, no model
      identity; verdicts outside the lineage store) and the Quint models as
      bounded reachability and absence-within-depth results, with the count
      derived from `formal/specs/`.
- [ ] Do not present four lanes as four independent votes.
- [ ] Architect review against the roadmap's disconfirming evidence — BM-25 over
      all nine GraphRAG systems, ~2 effective independent votes, and
      TerminusDB's bus factor 1 as recorded before its 2026-07-30
      withdrawal. Record the review.

## T8 — the prose rule

- [ ] Write `docs/STYLE.md`: for each of the four tics — contrastive "X, not Y",
      "silently" as moral intensifier, "never" as sentence engine, em-dash
      cargo-packing — state what it is, when it earns its place, and what to
      write instead. Use the line pass's 32 edits as worked examples, not as the
      deliverable.
- [ ] Apply the rule to the rewritten README.
- [ ] Run the ceiling checks; record any deliberate exception in the decisions
      file with the sentence and the reason.
- [ ] Architect review: was any sentence rewritten only to move a count? That is
      a review failure, not a pass.

## T9 — independent cross-family fact-check of the final text

- [ ] Route the finished `README.md` to an audit lane on a **different model
      family from the one that performed the rewrite**, with the fact-check
      remit: list every sentence asserting shipped behaviour that cannot be
      grounded in code.
- [ ] The lane reviews the final text, not the diff summary.
- [ ] Record the verdict file with the reviewing model family, the date, and the
      sentences reviewed.
- [ ] For every ungrounded claim named: correct it, mark it as doctrine or
      planned, or register it with a probe. Add a ledger row for each.
- [ ] Architect adjudicates disputed groundings and records the resolution.

## T10 — gate

- [ ] All four ambiguity answers recorded, attributed, non-`TBD`.
- [ ] Ledger complete; no empty or unrecognised disposition; architect review
      recorded.
- [ ] `docs-check.sh` readme stage passes; `tests/readme-structure.bats` passes,
      including every known-bad fixture.
- [ ] `doctrine-check.sh` passes with the README rows registered; no stale-probe
      failures.
- [ ] Cross-family fact-check verdict recorded with no unresolved ungrounded
      claim.
- [ ] Every human review named in T2, T6, T7 and T8 has a written artefact
      naming what was compared against what. A checkbox is not a judgement.
- [ ] `openspec validate readme-refresh --strict` passes.
