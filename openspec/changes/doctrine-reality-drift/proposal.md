# Change: doctrine-reality-drift

## Why

**One careful reading of this repo found eleven documented claims the code
contradicts.** They are tabulated in
`docs/research/vnext/R5-internal-attachment-map.md` §8.2. A representative
sample, each verified against the code:

| Claim, and where it is made | What the code does |
|---|---|
| `ROADMAP.md:44-47` — concurrency caps stay `grok=1 codex=1` | `lane-queue.sh:422` ships `grok:3 codex:2` |
| `.foreman/config.toml:48-54` + `SKILL.md:250-259` — `[audit.policy]` is gate policy | `gate-eval.sh` never sources `lib/config.sh` and never reads it |
| `SKILL.md:174-215` — durable lanes read as the normal path | `.foreman/config.toml:29` — `enabled = false`, and nothing reads the key |
| `references/lanes.md:162` — `audit.vendor` empty means auto | `audit-run.sh:35-37` hard-refuses anything but `codex` |
| `wt-new.sh:109`, `lane-run.sh:210`, `lane-queue.sh:422`, `tool-check.sh:83` — `claude` is a worker lane | `lib/worker-cmd.sh` has no `claude` branch; the lane dies at the argv builder |
| `README.md:605`, `maintenance.sh:249` — graphify refresh is automated | `maintenance.yml:23` runs `--stage upstream` only, with an in-file comment saying CI lacks graphify |
| `SKILL.md:276` — "CI remains final authority" | the bats suite runs on no CI platform at all |
| `ROADMAP.md:143-144` — `windows-smoke.yml` guards the Windows install | it runs under `pwsh`; the field failure it exists to catch was `powershell.exe` 5.1-specific |
| `openspec/README.md` — the repo follows OpenSpec conventions | all sixteen pre-existing change packages fail `openspec validate` |
| `lib/eventlog.sh:70` — "mkdir is atomic on Git Bash and WSL" | measured false on Ubuntu 26.04: 57 mutual-exclusion violations per 15 rounds |
| three change folders show 0/N tasks pending | `ROADMAP.md` records all three as shipped in v0.2.0 / v0.2.8 |

**The caps mismatch misled a reader today.** R5 records it as a live
correction, not a historical one. That is the whole argument: this class of
defect is discovered by a human noticing two files disagree, one pair at a
time, and there is no reason to think eleven is the total.

The cost is not hypothetical. `bugeventlog.md` records a full failure class for
it — R5's taxonomy #9, *doctrine/scope mismatches* — and two of its most
expensive entries are doctrine that existed only in prose:

- 2026-07-17, the architect violating the serialised-gates doctrine it had
  written earlier the same session, because the doctrine was a sentence and not
  a mutex: *"the doctrine was written for lanes; I failed to apply it to
  investigation agents."*
- 2026-07-16, the merge-gate semantics round-trip: a `WARNING` verdict against
  a user instruction saying "when approved", resolved by an interactive
  round-trip because the verdict-to-action policy lived in prose.

And it is not only humans who are misled. Foreman's operating model is that
models read `SKILL.md` and `references/` and act on them. Every false claim in
those files is an instruction to do the wrong thing, delivered with the full
authority of the repo's own documentation.

**Nothing in the repo checks a documented claim against the code.**
`docs-check.sh` runs `markdownlint-cli2`, `codespell`, `lychee` and a bash
comment-coverage check — spelling, formatting, dead links, comment density. All
four would pass a document that is beautifully formatted, correctly spelled,
fully linked, and false.

## What changes

- **A claim registry.** `docs/doctrine-claims.tsv` binds each load-bearing
  documentation claim to a deterministic probe over the repository. A row is
  `claim_id`, the doc location that makes the claim, the claim in one line, the
  probe command, the expected result, and the value observed when the row was
  registered.
- **A deterministic checker,** `skills/foreman/scripts/doctrine-check.sh`, that
  runs every probe and fails on any claim whose probe no longer matches. It is
  shell, `jq` and `git` — no model call, cheap enough to run on every commit.
- **A probe that matches nothing is a failure, not a pass.** The commonest way
  a check like this rots is a probe whose target moved, silently matching an
  empty set forever. An empty probe result is a distinct failure naming the
  claim whose probe went stale.
- **Wired into the existing docs gate** (`docs-check.sh`) so it runs where
  documentation checks already run, and into the release gate.
- **The eleven known contradictions are seeded as the initial registry**, each
  either fixed by its owning package in this release or registered as a
  knowingly-false claim with the package that will close it named.
- **Stale change folders are a drift finding.** A package under
  `openspec/changes/` showing 0/N tasks while `ROADMAP.md` records the work as
  shipped is reported. Three exist today.
- **Workarounds carry the model and date they were added for.** R2's P21 —
  *"date-stamp each workaround with the model it was added for and re-test on
  model upgrades"* — plus N1 §8.4's finding that frontier behaviour drifts
  silently under a fixed alias. A workaround with no stamp, or one older than a
  release without a re-test, is reported.
- **Each change package in this release registers the claims its own
  documentation makes.** The registry grows by construction with every change,
  rather than by periodic archaeology.

## Impact

- Affected: `skills/foreman/scripts/docs-check.sh`, `ROADMAP.md`,
  `.foreman/config.toml`, `config/foreman.toml.example`,
  `skills/foreman/SKILL.md`, `skills/foreman/references/lanes.md`,
  `README.md`, `openspec/README.md` — each for the specific claim it makes
  falsely.
- New: `skills/foreman/scripts/doctrine-check.sh`, `docs/doctrine-claims.tsv`,
  `tests/doctrine-check.bats`.
- **This package fixes the checker, not most of the claims.** Each false claim
  is owned by the package that owns the code it describes:
  `round-ownership-default` closes the durable-default and inert-flag claims;
  `three-outcome-verdicts` closes the `[audit.policy]` claim;
  `vendor-adapter-contract` closes the `claude` lane and `audit.vendor` claims;
  `lock-primitive-hardening` closes the mkdir-atomicity comment;
  `wsl-ci-parity` and `test-infrastructure-hardening` close the CI claims. This
  package registers them, seeds the registry, and fails the gate on any that is
  still false at release. It SHALL NOT re-implement any of their fixes.
- **Coordinates with `lock-primitive-hardening` T8** on the OpenSpec
  conformance claim. That task poses the architect decision — migrate the
  sixteen packages to the parseable header shape, or amend `openspec/README.md`
  to describe the documented variant. This package owns neither branch of the
  decision; it owns the rule that the claim and the reality must not be left
  disagreeing, and it registers whichever resolution is chosen.
- **Consumes `test-infrastructure-hardening`'s regression-injection
  discipline.** "A test that cannot fail is not a test" applies to probes too.
  This package adopts that rule rather than building a second mechanism for it.
- Behaviour change: the docs gate can now fail for a reason other than
  spelling, formatting or links. That is the point. It fails with the claim id,
  the doc location, the expected value and the observed value — enough to fix or
  to correct the document, without further investigation.
