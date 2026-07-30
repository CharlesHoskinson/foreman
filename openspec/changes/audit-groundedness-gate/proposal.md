# Change: audit-groundedness-gate

## Why

**Foreman's merge gate has six checks. Five are deterministic. The sixth reads
the diff, and nothing verifies it.**

`skills/foreman/scripts/gate-eval.sh` accumulates `REASONS[]` and fails closed
on: forbidden paths, hash drift in protected files, `checks-result.json`, the
audit verdict, `docs-check.json`, and `merge-gate.sh`'s merge-base ancestry.
Only the audit verdict is a semantic reading of the change, and the gate's
entire treatment of it is:

```bash
if ! jq -e '.verdict | IN("APPROVED","WARNING","BLOCKED")' "$RD/audit-verdict.json" >/dev/null 2>&1; then
  REASONS+=("audit verdict missing or schema-invalid")
elif [[ "$(jq -r .verdict "$RD/audit-verdict.json")" == "BLOCKED" ]]; then
  REASONS+=("audit verdict BLOCKED")
fi
```

The verdict parses and is not `BLOCKED`, so the change ships. **Nothing checks
that the auditor looked at the right thing, cited real locations, was coherent
with itself, covered the acceptance criteria, or used the rubric it claims.**

N1 §8.1 names why that is a structural error rather than an omission:

> "`codex-auditor` is another LLM. It is not a sound verifier. Its output
> belongs in the evidence graph as a claim with provenance, never as a gate."

A claim with provenance can be checked. Foreman consumes the claim unexamined.
The RAND Judge Reliability Harness (arXiv:2603.05399) puts a number on the
risk: *"No judge that we evaluated is uniformly reliable across benchmarks"*,
and point agreement on a small validation set gives *"limited assurance about
how a judge will respond to realistic variations in inputs, such as changes in
formatting, paraphrasing, verbosity, or sampling parameters."* Foreman's
verdict is one sample, from one judge, on one formatting of one diff.

### The failure class nothing catches today

N4 §7.7 names it: **hallucinated and self-contradictory audit output.** Today
every one of the following passes `gate-eval.sh` without comment:

- a finding citing `src/retry_handler.go` when no such path exists anywhere in
  the repository — a hallucinated citation;
- a finding citing line 412 of a file whose only changed hunk is lines 10-24 —
  the signature of an auditor that reviewed the file instead of the diff;
- a finding citing line 900 of a 130-line file — a line that cannot exist;
- `"verdict": "APPROVED"` alongside a `critical` finding, which the audit
  checklist forbids in prose (*"APPROVED: criteria met; no critical/high
  issues"*) and nothing enforces;
- `"verdict": "BLOCKED"` with `"findings": []` — a rejection with no
  addressable justification, which costs a rework round nobody can act on;
- an audit whose evaluator and worker are the same vendor, defeating the
  cross-vendor separation the release exists to provide.

Each is closed-world: answering it needs only data Foreman already produced —
the diff, the run record, the verdict artifact, the repository at a known sha.
None needs a model, a graph store, or a new runtime dependency.

### The cross-vendor invariant is checked at the wrong time

`audit-run.sh:318-321` compares the **configured** `audit.vendor` against the
**configured** `worker.vendor` and dies if they match. That is a check on
intent, at audit start. It says nothing about which vendor actually produced
the diff, and nothing about which auditor actually ran. `bugeventlog.md`
(2026-07-19) records exactly the case it misses: a `codex login --device-auth`
failure on a headless WSL host, after which *"the run fell back to
Opus-in-session as auditor"* — an entire auditor substitution that no artifact
recorded and no check noticed. The invariant has to be re-asserted at the gate
against what was recorded to have run, not against configuration.

### Why only closed-world checks may block

The tempting next step — asking whether the evidence actually supports each
finding — is measured, and the numbers forbid it as a gate:

| Measurement | Value | Source |
|---|---|---|
| KG-statement validation against retrieved evidence | **P 87.7% / R 44.4%**, ~12% FP; authors: *"requires human oversight"* | Adam & Kliegr 2025, arXiv:2409.07507 |
| KG-only grounded fact-checking | **P 0.944 / R 0.734** | Kolli et al., WiNLP 2025 |
| Full hybrid, web fallback firing on 23% of cases | **P 0.932 / R 0.931** | same |
| Adding "not enough information" as a third label | accuracy **0.931 → 0.702** | same |
| Human inter-annotator agreement on evidence sufficiency | **Fleiss' κ 0.385** | same |

At Foreman's merge volume (~40 merges/week) a 93%-precision blocking check
false-blocks roughly three correct merges per week. N4 §7.4 states the real
cost: not the three respawns, but that **the operator learns to route around
the gate** — which §9 of the same lane documents as the actual mechanism by
which constraint enforcement dies in production systems. SYNTHESIS §0.6
settles it as doctrine: *only closed-world checks block; open-world evidence
checks warn; the model's verdict is one signal among several and is itself
verified.*

### A gate that cannot fail is worse than no gate

N4 §6.6 ran the provenance shapes rather than only writing them, and the most
important result is a negative one. The same shapes file, against the same
violating data, without pySHACL's advanced-mode flag:

```text
$ pyshacl -s shapes2.ttl -f human data2.ttl
Validation Report
Conforms: True
```

No warning, no error, exit 0, on data violating every provenance invariant.
§8.6 records four further independent instances of the same class across five
tools, and notes that **none of them is a bug** — each is documented, intended
behaviour. The conclusion is a design constraint, not a caution:

> A validator that fails open is worse than no validator, because the agents
> trust its verdict.

`gate-eval.sh` already understands this in one place: it fails closed when
`docs-check.json` is *missing*. It has no defence at all against the state no
exit code distinguishes from success — **the validator ran and checked
nothing.**

## What changes

- **A new Tier-2 groundedness checker**,
  `skills/foreman/scripts/gate-ground.sh`, run by `gate-eval.sh` after the
  audit returns and before the verdict is consulted. It validates the *audit
  artifact*, never the code. Implementation is `jq` + `git` over JSON: no RDF,
  no SHACL engine, no Datalog engine, no graph store, no new runtime
  dependency.
- **Wave 1 — the checks that need nothing new** (`G9`, `G1`, `G2`):
  verdict/finding coherence, finding-file groundedness, finding-line
  groundedness. Every input already exists at gate time.
- **Wave 2 — two prose invariants become enforced** (`G4`, `G5`): cross-vendor
  separation asserted against the vendors *recorded to have run*, and rubric
  identification with the named rubric version resolvable in the repository at
  `BASE_SHA`. These need two harness-written fields added to the verdict
  artifact's provenance block.
- **Wave 3 — the checks that need a spec-format change** (`G6`, `G3`): scope
  containment against machine-readable scope globs, and acceptance-criterion
  coverage against stable criterion identifiers. Wave 3 lands only once the
  five-part spec carries them, and is explicitly not in wave 1.
- **A single declaration table.** Every check declares `id`, `tier`, `world`
  (`closed` or `open`), `blocking`, and the sentence that argues its
  false-positive rate is structurally zero. **A check whose specification
  cannot state that argument SHALL NOT be blocking, in any wave.** No blocking
  check in this package carries a percentage false-positive rate; checks that
  would are demoted to warnings by construction, not by configuration.
- **Shadow mode first, for every check, including the closed-world ones.**
  Each check ships `shadow` — evaluated, recorded, reported, non-blocking —
  and is promoted to `enforce` only against a pre-declared threshold measured
  over real merges. Promotion is a committed record, not a config edit.
- **A validator canary that runs on every invocation.** A fixture corpus of
  known-violating and known-conforming audit artifacts, with at least one
  mutant per check. The checker asserts the expected violation set before its
  own verdict is trusted. A canary that under-reports, or that cannot be read,
  produces `UNVERIFIED` groundedness and fails the gate closed with its own
  distinct reason — never a silent pass.
- **Reified violation output.** One addressed record per violation carrying
  `check`, `focus`, `path`, `message`, `required_evidence[]`, `world` and
  `blocking`, written to `$RD/gate-ground.json` and folded into
  `gate-decision.json` as reasons (blocking) or warnings (advisory). The output
  *shape* is copied from N4 §6.5; the SHACL engine that produced it is not.
- **Tier 3 evidence sufficiency is specified as warn-only and shadow-only** for
  this release, with its promotion protocol written down before it ships.
- **A written list of what stays model-judged**, published beside the checks,
  so the gate's silence is not read as coverage.
- **The gate says what it checks.** The gate output and the PR body state that
  the groundedness layer checks provenance and internal consistency, not
  correctness — because the most expensive failure available here is a gate
  people trust for something it does not do.

## Impact

- Affected: `skills/foreman/scripts/gate-eval.sh` (invocation, reasons,
  warnings), `skills/foreman/scripts/pr-open.sh` (the scope sentence in the PR
  body), `config/foreman.toml.example` and `.foreman/config.toml` (a
  `[gate.groundedness]` block), `skills/foreman/SKILL.md`,
  `skills/foreman/references/orchestration-hardening.md`,
  `skills/foreman/references/five-part-spec.md` (wave 3 only).
- New: `skills/foreman/scripts/gate-ground.sh`, `tests/gate-ground.bats`,
  `tests/fixtures/gate-ground/**` (the canary corpus).
- **Requires no graph store and no graphify.** This package is deliverable in
  full whether or not `knowledge-plane-refresh`, `work-dag-projection` or
  `graph-store-port` land. If the graph plane slips, the gate improvements do
  not slip with it. `G7`/`G8` — the provenance invariants over a real graph —
  are deliberately **not** in this package; they belong to `graph-store-port`.
- **Depends on `three-outcome-verdicts`.** That package owns the
  `APPROVED | WARNING | BLOCKED | UNVERIFIED` vocabulary, the rule that an
  errored audit always writes an artifact, the binding of the verdict to the
  diff's content hash, the audit timeout, and stable finding ids. This package
  consumes all five and **SHALL NOT redefine any of them**. In particular the
  missing freshness check at `gate-eval.sh:43-47` is that package's fix, not
  this one's; groundedness checks assume they read a verdict already bound to
  the diff under evaluation.
- **Extends, rather than redefines, the harness-written provenance block.**
  Wave 2 adds exactly two things to it — the worker vendor actually recorded
  for the attempt, and the rubric identifier plus rubric version. The
  model-facing `skills/foreman/scripts/adapters/verdict.schema.json` enum stays
  untouched, per `three-outcome-verdicts`' deliberate decision that the harness
  writes provenance and the model does not.
- **Depends on `decision-lineage-and-telemetry`** for the `audit_verdict`,
  `finding` and `gate_decision` events. This package adds groundedness
  violations to the gate decision's recorded payload; it does not define those
  event types, their payload shape, or the usage block.
- **Depends on `vendor-adapter-contract` transitively** for the recorded vendor
  and model identity that `G4` compares. `G4` cannot speak where either vendor
  is unrecorded; in that case it SHALL be silent and counted, never assumed.
- Behaviour change: with every check in `shadow`, none. Promoting any check to
  `enforce` is a behaviour change and is gated on a recorded measurement.
- **Wave 3 has a blast radius outside the gate.** Criterion identifiers and
  scope globs change how the architect writes specs. That is why it is a
  separate wave and not a wave-1 task.
