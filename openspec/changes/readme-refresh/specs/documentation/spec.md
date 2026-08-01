# Spec delta — README refresh

EARS-phrased. Header shape follows the OpenSpec CLI's parseable form.

Scope note: this delta governs `README.md` — its truth, its structure, and the
rule its prose is held to. It does not own the general docs-contradict-code
check; that belongs to `doctrine-reality-drift`, and every claim-registration
requirement below consumes that mechanism rather than building a second one.

The three edit plans this delta discharges are
`docs/research/vnext/EDIT-readme-structural.md`,
`docs/research/vnext/EDIT-readme-line.md` and
`docs/research/vnext/EDIT-readme-facts.md`. Counts quoted below were measured
against those files at authoring: 30 false-or-stale rows, 10 unverifiable rows
and 15 true-worth-keeping rows (55 claim rows), plus 12 material-omission rows.

## ADDED Requirements

### Requirement: every flagged claim carries a recorded disposition before the prose is rewritten

The fact-check found the README asserting behaviour the code contradicts. The
document SHALL be made true before it is made elegant, because an elegant
sentence is harder to delete than a clumsy one.

WHEN the README refresh begins, the author SHALL create
`docs/research/vnext/README-claim-ledger.tsv` with one row per claim row in
sections 1, 2 and 3 of `EDIT-readme-facts.md` and one row per omission row in
its section 6.
Each row SHALL carry `claim_id`, `source_table`, `readme_lines_at_authoring`,
`disposition`, `resolution_ref`.
`disposition` SHALL be one of `corrected`, `deleted`, `kept-with-evidence`,
`kept-as-doctrine`, `deferred-with-owner`.
WHERE `disposition` is `deferred-with-owner`, `resolution_ref` SHALL name the
change package that closes it.
IF any row has an empty or unrecognised `disposition`, THEN the readme stage of
`docs-check.sh` SHALL exit non-zero and name the row.
The prose rewrite of a section SHALL NOT begin while any claim whose
`readme_lines_at_authoring` falls inside that section is undispositioned.

#### Scenario: the ledger is complete against its source

- WHEN the readme stage runs
- THEN it derives the expected row count from `EDIT-readme-facts.md` itself
  rather than a hardcoded number
- AND fails naming any source row with no ledger row, and any ledger row with
  no source row.

#### Scenario: a blank disposition cannot pass

- WHEN a ledger row is added with `disposition` left empty, or set to a value
  outside the enumerated set
- THEN the readme stage exits non-zero naming that `claim_id`
- AND `tests/readme-structure.bats` proves this by running the stage against a
  fixture ledger containing exactly that defect.

#### Scenario: dispositions are adjudicated, not self-certified

- WHEN the ledger is complete
- THEN the architect reviews every `corrected` and `kept-with-evidence` row
  against the code the row cites, and records the review in
  `docs/research/vnext/README-claim-ledger.md` naming what was compared
- AND a `deleted` row whose claim still appears in the README in other words is
  a review failure, not a pass.

### Requirement: a retained claim of shipped behaviour cites code and is registered with the doctrine checker

WHERE the rebuilt README asserts that Foreman does something today, the
sentence SHALL either cite the file (and line range where the file is long) that
implements it, or SHALL be marked as doctrine, planned, or operator discipline
in its own words.

Every such cited claim SHALL be registered as a row in
`docs/doctrine-claims.tsv` with `doc_ref` beginning `README.md`, under the
registry and probe rules owned by `doctrine-reality-drift`.
This package SHALL NOT introduce a second claim-checking mechanism, a
README-specific probe format, or a duplicate registry.

#### Scenario: the README's claims are in the shared registry

- WHEN `doctrine-check.sh` runs after the refresh
- THEN it evaluates at least one registered claim for each of the README's
  shipped-behaviour assertions
- AND a claim registered with an empty probe result fails as a stale probe under
  `doctrine-reality-drift`'s existing rule, not as a pass.

#### Scenario: no second checker is built

- WHEN the package's diff is reviewed
- THEN it contains no new script, library or test that reads documentation and
  compares it to code outside `doctrine-check.sh`
- AND the readme stage added to `docs-check.sh` checks only document-internal
  properties: ledger completeness, section shape, anchors, relocations, prose
  ceilings, provenance stamps.

### Requirement: safety claims are stated at the strength the code has at release

`README.md:240` calls hard mode "fail-closed at every stage" while
`gate-eval.sh` checks only that an audit file exists with an allowed verdict,
and five `audit-run.sh` paths exit without writing one. This is the document's
central safety claim and it tells a release operator the opposite of the shipped
failure mode.

IF the audit-to-gate freshness defect is closed in this release, THEN the README
SHALL describe the binding that closes it and cite the code that performs it.
IF it is not closed, THEN the README SHALL state the limitation in the hard-mode
section, at the point where the gate is introduced, in the same voice as the
rest of the honest ledger.
The phrase "fail-closed at every stage" SHALL NOT appear unless a registered
claim in `docs/doctrine-claims.tsv` proves it stage by stage.
The same rule SHALL apply to the cross-vendor invariant, the worktree
`git`-write ban, the lock serialisation claim and the dirty-safe claim — each is
enforcement in one place, prompt text, or not enforced at all, and the sentence
SHALL say which.

#### Scenario: the banned phrase cannot return unproven

- WHEN the readme stage runs
- THEN it fails if `fail-closed at every stage` appears in `README.md` while no
  registry row asserts it
- AND `tests/readme-structure.bats` proves the check fails against a fixture
  containing the phrase.

#### Scenario: enforcement strength is stated for each of the five claims

- WHEN the architect reviews the hard-mode and worktree sections
- THEN each of the five named claims reads as enforced-by-code with a citation,
  enforced-in-one-place-only with the place named, or doctrine-only
- AND a sentence that leaves the reader unable to tell which is a review
  failure. Judge of record: the architect, against `EDIT-readme-facts.md`
  section 1 rows for lines 44-46, 78-82, 149-153, 155-157, 225, 240-241 and 501.

### Requirement: the README is twelve named sections in a fixed order

The current fifteen sections interleave three documents — a concept paper, an
operator manual duplicating `USAGE.md` against the README's own charter at lines
17-19, and a release ledger that is stale by construction.

The rebuilt `README.md` SHALL contain exactly these level-two headings, in this
order, unnumbered:

1. `What Foreman is and the problem it solves`
2. `The mental model`
3. `The five-part spec`
4. `Lanes and vendor routing`
5. `Soft mode — the loop`
6. `Setup, Use, Cleanup, and the quickstart`
7. `Worktree isolation`
8. `Reports are claims: evidence, verification, audit, checker soundness`
9. `The record: event log, work-DAG, knowledge plane, store`
10. `Hard mode — status`
11. `Honest capabilities and limits`
12. `Further reading, security, layout, license, lineage`

The five-part spec SHALL precede every section that presumes it, because it is
invoked in the opening paragraph and currently defined at line 409, after the
quickstart that tells the reader to write one.

#### Scenario: the heading sequence is exact

- WHEN the readme stage runs
- THEN it extracts the level-two headings in document order and compares them to
  the list above as an ordered sequence
- AND fails on a missing heading, an extra heading, a renamed heading or a
  reordering, naming the first position that differs.

#### Scenario: no heading carries a number

- WHEN the readme stage runs
- THEN it fails if any heading matches a leading-integer-and-period pattern.

### Requirement: cross-references are named anchors and every one resolves

Numbered cross-references have already lied to the reader: `README.md:223`
cites section 8 for the five-part spec, which is section 9, and `:95` cites
section 7 for WSL setup, which is section 3. Three more are wrong. Numbering
rots under maintenance, and a fifteen-to-twelve restructure would break the
rest.

WHEN one part of the README refers to another, it SHALL do so by a Markdown link
to a heading anchor.
Every internal anchor link SHALL resolve to a heading present in the file.
Every relative link SHALL resolve to a path that exists in the repository.
No prose SHALL refer to a section by number.

#### Scenario: numbered references are gone

- WHEN the readme stage runs
- THEN it fails if `README.md` contains a case-insensitive `section <digit>`
  or `§<digit>` reference
- AND `tests/readme-structure.bats` proves the check fails against a fixture
  containing `(section 6)`.

#### Scenario: every anchor resolves

- WHEN the readme stage runs
- THEN for every `](#slug)` it computes the slug set from the file's own
  headings and fails naming any target with no matching heading
- AND for every relative link it fails naming any path absent from the tree.

### Requirement: reference material lives in USAGE.md, not the README

The README promises at lines 17-19 that every command, every flag and
troubleshooting live in `docs/USAGE.md`, and then reproduces them. Two copies of
reference material always drift; one of these already has.

WHEN the refresh lands, these SHALL have been removed from `README.md` and SHALL
be present in `docs/USAGE.md`: the worktree exit-code table and the per-script
exit codes; the Setup and Cleanup script mechanics (SIGINT ordering, pueued
ownership rules, lock sweeping); the `docs-check.sh` tool and config table; the
codex CLI flag detail, which `references/lanes.md` is already linked for.
The Grok write-cancellation walkthrough SHALL survive as its principle and its
one load-bearing sentence — the model narrates edits while writing nothing,
`DIG_B == DIG_A` — with the flag forensics removed.
The three launcher bullets (nested Job Objects, NTSTATUS byte-masking,
jq-vs-python3) SHALL move to `launcher/README.md` and
`reference-environment.md`, and the limits section SHALL spend the reclaimed
space on limits that decide adoption.

#### Scenario: relocation is checked at both ends

- WHEN the readme stage runs
- THEN for each enumerated item it fails if a matching marker string is still
  present in `README.md`, and fails if the marker is absent from the file it was
  relocated to
- AND the marker strings are listed in the check so a reviewer can see what is
  being detected.

#### Scenario: the boundary itself is judged, not measured

- WHEN new prose is added to the README during the rewrite
- THEN the architect applies the stated rule — the README teaches, `USAGE.md`
  is looked up — and records any contested placement in
  `docs/research/vnext/README-ambiguity-decisions.md`
- AND no automatic check is claimed for this; the rule is a human judgement with
  a named judge.

### Requirement: the release's four homeless bodies have sections and honest framing

v0.2.9 adds material the current structure has no home for.

WHERE the mental model and lane sections describe cross-vendor review, they
SHALL key the invariant on **model family, not CLI name**, because `agy` is a
multi-model gateway serving `gemini-*`, `claude-*` and `gpt-oss-*`, and an agy
lane configured to a `claude-*` model auditing Claude-implemented work is
same-family review wearing a different binary.
The phrase "Four roles, four producers" and the four-box CLI-keyed diagram
SHALL NOT survive.
The record section SHALL state that the event log is the source of truth, that
the work-DAG is a deterministic projection no model writes, that the knowledge
plane runs on two cadences with no model in the per-merge path, that the SQLite
ontology adapter provides a regenerable materialisation behind a `GraphStore`
port with a files-only fallback and never the system of record, and that
consumption is a pre-serialized, content-hashed, token-budgeted context block.
The record section SHALL sell the plane as cross-session provenance and
deterministic gate checks and SHALL NOT sell it as retrieval accuracy or
hallucination reduction.
The evidence section SHALL carry checker soundness as its fourth movement: a
checker whose predicate does not match its claim passes loudly, and a loud pass
is trusted.
The limits section SHALL name the telemetry gap — no tokens, no cost, no model
identity recorded, verdicts outside the lineage store — and SHALL describe the
four Quint models under `formal/specs/` as bounded reachability and
absence-within-depth results, not unbounded correctness.
The lane material SHALL NOT present four lanes as four independent votes.

#### Scenario: the new material is present and the replaced material is gone

- WHEN the readme stage runs
- THEN it fails if `Four roles, four producers` is present, if the record
  section does not name `GraphStore`, the files-only fallback and the work-DAG
  projection, if the limits section does not name the telemetry gap, or if the
  count of `formal/specs/*.qnt` files disagrees with the number the README
  states
- AND the model count is derived from the tree, not hardcoded, so adding a fifth
  model fails the check rather than silently ageing the sentence.

#### Scenario: the framing is judged by a human

- WHEN the record and limits sections are drafted
- THEN the architect checks each against the roadmap's own disconfirming
  evidence — BM-25 beating all nine GraphRAG systems, the ~2 effective
  independent votes, and the withdrawn graph backend's bus factor of one as
  recorded before its 2026-07-30 withdrawal — and rejects any sentence
  that would read as a capability claim the research does not support
- AND the judgement and its outcome are recorded; there is no automatic check
  for overselling.

### Requirement: prose tics are governed by a recorded rule with measurable ceilings

The line pass found four recurring tics: contrastive "X, not Y" (~14),
"silently" as moral intensifier (~7), "never" as sentence engine (~22), and
em-dash cargo-packing. A rule the author applies once beats a list of thirty-two
fixes applied once.

WHEN the refresh lands, `docs/STYLE.md` SHALL record the rule for each tic in
the form: what the tic is, when it earns its place, and what to write instead.
The rebuilt `README.md` SHALL satisfy these ceilings, measured over the whole
file: at most 3 occurrences of `silent`/`silently`, all inside the evidence
section; at most 12 occurrences of `never`; at most 7 occurrences of the
contrastive `, not ` construction; no sentence containing more than two em
dashes; and in the limits section, no sentence containing more than one.
Sentences SHALL be split on `. ` and end-of-line for the purpose of this count,
and the splitting rule SHALL be stated in the check so a disputed count is
reproducible.
IF a ceiling is exceeded deliberately, THEN the exception SHALL be recorded in
`docs/research/vnext/README-ambiguity-decisions.md` with the sentence and the
reason, and the check SHALL read the recorded exceptions rather than being
edited.

#### Scenario: a ceiling breach fails and is diagnosable

- WHEN the readme stage runs
- THEN it prints each measured count against its ceiling and fails naming every
  ceiling exceeded and the line numbers of the offending occurrences
- AND `tests/readme-structure.bats` proves each ceiling check fails against a
  fixture that breaches exactly that ceiling.

#### Scenario: the ceilings are ceilings, not targets

- WHEN the architect reviews the rewritten prose
- THEN a sentence rewritten only to move a count is a review failure, and the
  rule in `docs/STYLE.md` — not the number — is what the review applies
- AND the judge of record is the architect.

### Requirement: the four undeciphered ambiguities are answered by a named human before the sentences that depend on them are rewritten

The line editor could not decipher four passages. Each is a meaning question,
not a prose question. Guessing an answer would manufacture exactly the class of
false claim this package exists to end.

WHEN the refresh begins, `docs/research/vnext/README-ambiguity-decisions.md`
SHALL state these four questions and SHALL record an answer for each, attributed
to a named person, with a date:

1. `README.md:50-51`, "Four roles, four producers" — what is the intended
   census? Does the architect count as a role but not a producer? Do the two
   implementer lanes count as one role or two? The answer determines the
   replacement sentence, which must in any case be re-keyed on model family.
2. `README.md:268-269` — "on top of what v0.2.5 already shipped" inside a
   document that anchors behaviour to v0.2.7.5. Is v0.2.5 the deliberate
   launcher baseline, or a stale pin?
3. `README.md:311-315` — `CMD` and `GATE` in the launcher chain
   `foreman-launch(--detach) → lane-run.sh → foreman-launch (CMD) →
   foreman-launch(GATE)`. Are these process roles to be expanded in place
   ("command child" / "gate child"), left as jargon, or replaced by a pointer to
   `launcher/README.md`?
4. `README.md:293` — "one Claude Code architect session per host identity".
   Does "host identity" mean OS user, machine, `$HOME`, or Claude config path?
   The second half of the sentence is clear; the first is not.

IF any of the four has no recorded answer, THEN the readme stage SHALL exit
non-zero, and the affected sentences SHALL remain unrewritten.
An answer of `TBD`, `unknown`, or an empty attribution SHALL count as no answer.

#### Scenario: an unanswered ambiguity blocks the gate

- WHEN the readme stage runs with one of the four questions unanswered or
  attributed to no one
- THEN it exits non-zero naming that question
- AND `tests/readme-structure.bats` proves it against a fixture whose fourth
  answer is `TBD`.

#### Scenario: the answers are human, and recorded as such

- WHEN an answer is recorded
- THEN it names the person who decided and the date
- AND a model-generated answer is not acceptable for any of the four; this is
  stated in the decisions file.

### Requirement: version-stamped provenance lives in ROADMAP, not the README

The README states what is; `ROADMAP.md` states when it became so. Lines 296,
397 and 485 carry "As of v0.2.7.5 ..." stamps that are guaranteed to rot, and
the release ledger in the hard-mode section is already stale in five places.

WHEN the refresh lands, release-version stamps SHALL NOT appear in `README.md`
outside the lineage subsection.
WHERE a stamp carried information worth keeping, that information SHALL appear
in `ROADMAP.md` under the release that introduced it.
The Shipped / Stub / Partial-stub table format SHALL survive, because the honest
ledger is house identity, but each of its rows SHALL be re-derived from the code
at release rather than carried forward.

#### Scenario: stamps are gone from the body

- WHEN the readme stage runs
- THEN it fails if `As of v` appears anywhere, or if a `v0.<digit>.<digit>`
  version reference appears outside the lineage subsection
- AND names each offending line.

#### Scenario: the ledger rows are re-derived

- WHEN the hard-mode status table is rebuilt
- THEN every row's status is supported by a ledger row whose `disposition` is
  `corrected` or `kept-with-evidence` and whose `resolution_ref` cites the
  script that implements the stage
- AND the architect confirms the mapping row by row.

### Requirement: the rebuilt README passes an independent cross-vendor fact-check

A rewrite that fixes fifty-five claims and introduces five new ones has not
improved. The document that made the false claims cannot be trusted to certify
its own replacement, and neither can the model that rewrote it.

WHEN the rewrite is complete, an audit lane on a **different model family from
the one that performed the rewrite** SHALL re-run the fact-check remit over the
final `README.md` and SHALL produce a verdict file listing every sentence
asserting shipped behaviour that it could not ground in code.
The verdict SHALL be produced from the final text, not the diff summary.
IF the verdict names any ungrounded claim, THEN that claim SHALL be corrected,
marked as doctrine or planned, or registered with a probe, before the gate
passes.
Judge of record on disputed groundings: the architect, with the tie-break
routing this repo already uses.

#### Scenario: the fact-check is cross-family and recorded

- WHEN the gate task runs
- THEN a verdict file exists naming the reviewing model family, the date, and
  the sentences reviewed
- AND a verdict produced by the same model family that wrote the text does not
  satisfy this requirement.

#### Scenario: ungrounded claims block the gate

- WHEN the verdict names an ungrounded shipped-behaviour claim
- THEN the readme gate task is not complete until that claim has a ledger row
  and a disposition
- AND the architect records the resolution against the verdict.
