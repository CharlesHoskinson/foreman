# Change: readme-refresh

## Why

Three editorial passes were run over `README.md` — structural, line, and
fact-check. All three delivered. None of them owns any work, and the release is
shipping a fourth vendor lane, a two-plane graph architecture and a
checker-soundness doctrine into a document that has no place to put them.

**The fact-check is the reason this cannot wait.** It flagged 55 claims across
three tables and 12 material omissions, each with a `file:line` contradiction.
The headline is the document's central safety sentence:

> `README.md:240` — "Hard mode's loop is `INIT → PLAN → IMPLEMENT → CHECK →
> EVIDENCE → AUDIT → GATE → PR`, **fail-closed at every stage**"

`gate-eval.sh:43-47` checks only that `audit-verdict.json` exists and holds an
allowed enum value. It has no timestamp, round, commit or diff-digest binding.
`audit-run.sh:90-112` has five ordinary failure paths that exit without
replacing that file. After a rework round, a stale `APPROVED` can gate a
different diff. "Fail-closed" tells a release operator precisely the opposite of
the shipped failure mode.

It is not an isolated error. `worker-run.sh` is described as a stub while it
implements two profiles; `pr-open.sh` is a "partial stub" that pushes and runs
`gh pr create --draft`; "the main checkout is never the implementer target" is
false under `soft_mode.target=live`; "enforces audit vendor ≠ worker vendor"
compares a config key the hard worker does not read; `./install.sh` cannot be
executed from a clean checkout because the index marks it `100644`; and
"change-folder conventions follow OpenSpec" is false for every pre-existing
package in the tree.

**The structure is failing under maintenance, provably.** The README declares at
lines 17-19 that it is the teaching document and that every command and flag
lives in `docs/USAGE.md` — then ships an exit-code table, the Setup/Cleanup
script mechanics and a docs-tool config table. And its numbered
cross-references have already rotted: `:223` sends the reader to section 8 for
the five-part spec, which is section 9; `:95` sends them to section 7 for WSL
setup, which is section 3. Three more are wrong. That is the argument against
numbering, made by the document itself.

**And the release's centre of gravity has nowhere to live.** The fourth lane and
the model-family invariant, the graph plane, the checker-soundness workstream,
the four Quint models and the telemetry gap have no home in the current fifteen
sections — and the one section that could host the graph frames it as
repo-maintenance trivia, which is the single framing v0.2.9 makes untenable.

**Why this package's acceptance criteria matter more than its edits.** A README
change is trivially satisfiable by "we edited the README". This release has
already spent two audit rounds on predicates that could not discriminate what
they claimed. Every requirement here therefore carries a check that can fail,
and where a property is genuinely not mechanical the package names the human who
judges it and the thing they judge against, rather than dressing a judgement up
as a script.

## What changes

- **A claim ledger, first.** `docs/research/vnext/README-claim-ledger.tsv` gives
  every flagged claim a disposition — `corrected`, `deleted`,
  `kept-with-evidence`, `kept-as-doctrine`, `deferred-with-owner` — before the
  prose of the section containing it is touched. Truth precedes elegance,
  because an elegant false sentence is the hardest kind to delete.
- **Claims register with `doctrine-reality-drift`, which already owns this.**
  Retained shipped-behaviour claims become rows in `docs/doctrine-claims.tsv`
  with probes. This package builds no second checker and no README-specific
  registry.
- **Fifteen sections become twelve, unnumbered, in a fixed order**, with the
  five-part spec moved from position 9 to position 3 — it is the contract every
  later section presumes and it is invoked in the opening paragraph.
- **Named anchors replace numbered cross-references** everywhere, and every
  internal anchor and relative link is checked to resolve.
- **Reference material goes to `docs/USAGE.md`**: the exit-code tables, the
  Setup/Cleanup script mechanics, the docs-tool config table, the codex CLI flag
  detail. The Grok write-cancellation war story keeps its one load-bearing
  sentence and loses the flag forensics. Three launcher bullets move to
  `launcher/README.md` and `reference-environment.md`.
- **Two new sections carry v0.2.9**: "Reports are claims" absorbs evidence,
  verification, audit and checker soundness into one doctrine; "The record"
  carries the event log, the work-DAG projection, the knowledge plane, and the
  SQLite ontology adapter behind a `GraphStore` port with a files-only fallback.
- **The cross-vendor invariant is re-keyed on model family, not CLI name**,
  because `agy` is a multi-model gateway and an agy lane on a `claude-*` model
  auditing Claude-written work is same-family review in a different binary.
  "Four roles, four producers" does not survive.
- **A prose rule, not a list of fixes.** `docs/STYLE.md` records the rule for
  each of the four tics; the README is held to measured ceilings with a recorded
  exception mechanism.
- **Version stamps leave for `ROADMAP.md`.** The README states what is; ROADMAP
  states when it became so.
- **The four undeciphered ambiguities are escalated to a named human** and block
  the gate until answered. A model-generated answer is explicitly not
  acceptable — guessing a meaning question is how false claims are made.
- **A `readme` stage in `docs-check.sh`** implements every mechanical check, and
  `tests/readme-structure.bats` proves each check fails against a known-bad
  fixture, per this release's checker-soundness rule.
- **An independent cross-family fact-check of the final text** gates the
  package, because the model that rewrote the document cannot certify it.

## Impact

- Affected: `README.md` (rewritten), `docs/USAGE.md` (receives the relocated
  reference material), `ROADMAP.md` (receives the provenance stamps),
  `launcher/README.md` and `reference-environment.md` (receive the launcher
  limits), `skills/foreman/scripts/docs-check.sh` (new `readme` stage),
  `docs/doctrine-claims.tsv` (README rows).
- New: `docs/STYLE.md`, `docs/research/vnext/README-claim-ledger.tsv`,
  `docs/research/vnext/README-claim-ledger.md`,
  `docs/research/vnext/README-ambiguity-decisions.md`,
  `tests/readme-structure.bats`.
- **Consumes `doctrine-reality-drift`; does not duplicate it.** That package
  owns the registry format, the probe rules, the empty-probe-is-a-failure rule
  and the docs-gate wiring. This package supplies README rows and the
  document-internal checks that a claim registry cannot express — section shape,
  anchors, relocations, prose ceilings, stamps. Both packages edit
  `docs-check.sh`; they land serially, `doctrine-reality-drift` first, so the
  `readme` stage is added to a file that already has the doctrine stage.
- **Consumes the checker-soundness rule** from the release's test-infrastructure
  workstream rather than restating it: every check introduced here is
  demonstrated to fail against a known-bad fixture before it is trusted.
- **Depends on the truth of other packages' outcomes, not their code.** Whether
  the README says the gate is diff-bound depends on whether
  `audit-groundedness-gate` lands; whether it says locks are safe depends on
  `lock-primitive-hardening`; whether it says the `claude` lane works depends on
  `vendor-adapter-contract`. Every such requirement here is written `IF ... THEN
  ...` so it passes under either outcome and fails only on a sentence that does
  not match the outcome that occurred.
- **Lands late in the release**, after the packages whose behaviour it
  describes, and after the ambiguity answers exist. Behaviour change: the docs
  gate can now fail because the README's shape, anchors or prose ceilings
  regressed — not only because a word was misspelled.
