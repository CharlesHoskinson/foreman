# foreman Empirical-Workload Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> Design: `docs/superpowers/specs/2026-07-19-empirical-workloads-design.md`.
> OpenSpec + EARS: `openspec/changes/{spec-triage-gate,foreman-discover-lane,
> captured-facts-convergence,workload-fit-accounting}/`.

**Goal:** Let foreman handle EXPLORATORY/EMPIRICAL workloads by adding a
DISCOVER → CONVERGE → IMPLEMENT pipeline, so discovery (correctly the expensive
lane) produces a determined spec whose implementation slice still offloads to grok.

**Architecture:** Four packages. A (spec-triage): a coded gate that refuses an
under-determined spec at the grok door and re-admits it after discovery. B
(discover-lane): a new bounded, top-model, empirical `foreman-discover` lane whose
deliverable is facts + a determined spec, not product code. C (captured-facts): the
artifact discovery emits, inlined into grok specs to make them write-first. D
(workload-fit): up-front fit prediction + a post-run discovery-vs-offload split
report. No change to grok-multiround / the empty-burst detector (they stay the
backstop) or the durable-lane core.

**Tech Stack:** bash + bats-core, the five-part-spec + agent-def conventions, the
event log (`el_emit`/`el_read`, `lane` field), `common.sh`, `docs-check.sh`.

## Ground-truth interfaces (verified 2026-07-19)

- **Five-part spec** (`skills/foreman/references/five-part-spec.md`): sections
  `## Objective / Files / Interfaces / Constraints / Verification`; EARS already
  required for grok-bound specs (`:54`). Verification is "the exact command(s) the
  orchestrator re-runs" (`:27`).
- **grok dispatch gate:** the `grok-implementer` agent's Preflight
  (`agents/grok-implementer.md:18-34`) is the "before grok runs" hook; hard mode
  gates in `worker-run.sh`. The refuse pattern to mirror: `lane-run.sh`'s
  grok-secrets refusal (`alert{kind:"grok_secrets_refused"}`, non-zero, CMD never
  spawned).
- **Agent def format** (`agents/foreman-search.md:1-13`): frontmatter `name`,
  `description`, `model` (haiku|sonnet|opus|fable), `tools`, `isolation: worktree`,
  `effort`. Search is `model: haiku`, read-only; discover will be top-model + Bash.
- **Event log:** `el_emit run type lane payload [commit]` (`eventlog.sh:64`); the
  `lane` field carries the lane identity. **Critical (audit):** `el_emit` is called
  ONLY by host-side scripts (`lane-run.sh`, `lane-supervise.sh`, `resume.sh`,
  `watch.sh`, `worker-run.sh`) — **agent-dispatched lanes** (`foreman-search`,
  `foreman-plan`, and the new `foreman-discover`) emit **zero** event-log entries. So
  the fit-report (Package D) does NOT read discovery from the event log; it reads a
  host-side **fit ledger** `$RD/fit.jsonl` the architect keeps. The real grok
  implement label is **`worker-grok`** (`worker-run.sh`: `LANE="worker-$VENDOR"`),
  never `grok:1`.
- **grok's third dispatch path:** besides `worker-run.sh` (hard) and the
  `grok-implementer` preflight (soft), `lane-run.sh` runs grok when `LANE_VENDOR=grok`;
  its grok-secrets refusal (`lane-run.sh:344`, `el_emit "$RUN" alert "$LANE"
  '{"kind":"grok_secrets_refused"}'`, gated on `LANE_VENDOR=="grok"`) is the exact
  shape + placement the spec-triage gate mirrors on this path.
- **Run dir / envelope:** `run_dir "$RUN_ID"` = `$FOREMAN_HOME/runs/$RUN_ID`;
  `task-new.sh` writes `meta.json`; specs live per-run. `common.sh` gives
  `run_dir`, `toml_get`, `die`, `log`, `EXIT_OK/FAIL/CONFIG`.
- **bats runner:** `~/.foreman/tools/bats-core/bin/bats`; run only the new file per
  task; architect gates the full suite at close-out.

## Global constraints

Strict mode + portability + gate mutex per bats run on a QUIET host with grok on
PATH. Do NOT change grok-multiround / the empty-burst detector, or the frozen
lane-run kill/degraded paths. shellcheck-clean on new scripts; docs-check green.
Sonnet implements per package, Opus audits.

## File structure

- Create `skills/foreman/scripts/spec-triage.sh` + `tests/spec-triage.bats` (A).
- Modify `agents/grok-implementer.md` (preflight hook), `worker-run.sh` (hard gate),
  `lane-run.sh` (the `LANE_VENDOR=grok` third path), and
  `skills/foreman/references/five-part-spec.md` (the `determinability:` field) (A).
- Create `agents/foreman-discover.md` + `skills/foreman/references/discovery.md` (B).
- Create `skills/foreman/references/captured-facts.md` (schema) +
  `skills/foreman/templates/captured-facts.md` (template); modify `five-part-spec.md`
  (inline-facts doctrine) (C).
- Create `skills/foreman/scripts/foreman-fit-report.sh` + `tests/fit-report.bats`
  (reads `$RD/fit.jsonl`); modify `five-part-spec.md`/`roles.md` (the `fit:`
  declaration) and `foreman-cleanup.sh` (emit the report at run close) (D).
- Modify `skills/foreman/SKILL.md` (routing table + the pipeline) across A/B/D.
- Author the 4 `openspec/changes/*` packages as the planning artifact; archive them,
  update `ROADMAP.md`, tag/release (E).

---

## Package A — spec-triage gate (capability `spec-triage`; C1 + C4)

### Task A.1 — spec-triage.sh (TDD)

**Files:** Create `skills/foreman/scripts/spec-triage.sh`; Test `tests/spec-triage.bats`.

- [ ] **Step 1: Write the failing test** — a determined spec passes (exit 0); an
  under-determined spec refuses (non-zero, `spec_underdetermined`).

```bash
# tests/spec-triage.bats
setup() { SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"; }

@test "a determined spec (concrete verification, no discovery verbs) passes" {
  cat > "$BATS_TEST_TMPDIR/spec.md" <<'EOF'
## Objective
Add a --json flag to foo.sh.
## Interfaces
foo.sh --json prints {"ok":true}
## Verification
bash foo.sh --json | jq -e .ok
## Meta
determinability: determined
EOF
  run bash "$SCRIPTS/spec-triage.sh" "$BATS_TEST_TMPDIR/spec.md"
  [ "$status" -eq 0 ]
}

@test "an exploratory spec (discovery verbs) is refused" {
  cat > "$BATS_TEST_TMPDIR/spec.md" <<'EOF'
## Objective
Reverse-engineer the live ledger API and figure out the live dust frontier.
## Verification
(determine the correct behavior empirically)
## Meta
determinability: exploratory
EOF
  run bash "$SCRIPTS/spec-triage.sh" "$BATS_TEST_TMPDIR/spec.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"spec_underdetermined"* || "$output" == *"foreman-discover"* ]]
}

@test "declared determined but scan finds discovery phrases -> refused (declaration is not enough)" {
  printf '## Objective\nreverse-engineer the SDK\n## Meta\ndeterminability: determined\n' > "$BATS_TEST_TMPDIR/s.md"
  run bash "$SCRIPTS/spec-triage.sh" "$BATS_TEST_TMPDIR/s.md"
  [ "$status" -ne 0 ]
}

# --- Regression guards against the audit's false-positives ---

@test "determined spec whose objective merely contains 'explore'/'discover the' is NOT refused" {
  cat > "$BATS_TEST_TMPDIR/ok.md" <<'EOF'
## Objective
Add an `explore` subcommand and, per the EARS example, discover the dirty file set.
## Interfaces
foo.sh explore --since REF prints the changed paths
## Verification
cargo build && bash foo.sh explore --since HEAD~1
## Meta
determinability: determined
EOF
  run bash "$SCRIPTS/spec-triage.sh" "$BATS_TEST_TMPDIR/ok.md"
  [ "$status" -eq 0 ]
}

@test "determined spec with an unrecognized-but-real verification command is NOT refused" {
  cat > "$BATS_TEST_TMPDIR/ok2.md" <<'EOF'
## Objective
Serve the built site.
## Verification
python -m http.server 8080
make check
## Meta
determinability: determined
EOF
  run bash "$SCRIPTS/spec-triage.sh" "$BATS_TEST_TMPDIR/ok2.md"
  [ "$status" -eq 0 ]
}

@test "determined spec with empty/parenthetical-only verification IS refused" {
  printf '## Objective\nAdd a flag.\n## Verification\n(by inspection)\n## Meta\ndeterminability: determined\n' > "$BATS_TEST_TMPDIR/e.md"
  run bash "$SCRIPTS/spec-triage.sh" "$BATS_TEST_TMPDIR/e.md"
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 2: Run to verify it fails** (script absent).
- [ ] **Step 3: Implement `spec-triage.sh SPEC_FILE`** — source `common.sh`; read the
  spec; extract `determinability:` (default `unset`). REFUSE (exit `EXIT_CONFIG`,
  print `spec_underdetermined: <reason>; route to foreman-discover first`) when ANY of:
  - **(a) declaration** — `determinability` is `exploratory`/`hybrid`/unset.
  - **(b) discovery phrases** — the Objective/Interfaces match the NARROW,
    anchored pattern (audit fix — no bare verbs, no `re%erse` typo):

    ```bash
    grep -iEq 'reverse[ -]engineer|figure out the (live|real)|resolve the live|determine .*behavior (empirically|by probing)|probe .* to determine|discover (what|how) .* (behaves|returns)' "$spec"
    ```

    This deliberately does NOT match bare `explore` / `discover the …` (so the
    legitimate EARS example *"discover the dirty file set"* and an `explore`
    subcommand pass).
  - **(c) non-concrete verification** — refuse ONLY when the `## Verification`
    body is **empty** OR every non-blank line is parenthetical-prose /
    placeholder. Implement by: extract the section body; drop blank lines; strip
    lines matching `^[[:space:]]*\((.*)\)[[:space:]]*$` (whole-line parentheticals)
    and `^[[:space:]]*(TBD|by inspection|manually?|to be determined)`; if **nothing
    remains**, refuse. Do NOT maintain a command allow-list — any surviving line
    (e.g. `cargo build`, `make check`, `python -m http.server`, `shellcheck …`)
    counts as a concrete check and PASSES.

  else exit `EXIT_OK`. Print the classifying reason for the operator.
- [ ] **Step 4: Run to verify it passes.** shellcheck-clean (WSL).
- [ ] **Step 5: Commit** `git commit -m "feat(triage): spec-triage.sh refuses under-determined specs (routes to foreman-discover)"`.

### Task A.2 — wire the gate into the grok dispatch (C1) + re-admit after discovery (C4)

**Files:** Modify `agents/grok-implementer.md`, `skills/foreman/scripts/worker-run.sh`,
`skills/foreman/references/five-part-spec.md`.

- [ ] **Step 1** — `five-part-spec.md`: add a required `## Meta` line
  `determinability: determined | exploratory | hybrid` to the template, with a
  paragraph: an `exploratory`/`hybrid` spec MUST go through `foreman-discover` first;
  a spec you cannot finish writing the Verification for is not `determined`.
- [ ] **Step 2** — `grok-implementer.md` Preflight: add, after the `grok --version`
  check, "Run `spec-triage.sh <spec>`; if it refuses, STOP and return `GROK REPORT /
  STATUS: refused / REASON: spec under-determined — route to foreman-discover` — do
  NOT run grok on an under-determined spec." (Prevents the empty-burst waste up front.)
- [ ] **Step 3** — `worker-run.sh` (hard mode): before building the worker argv
  (`worker-run.sh:99-140`), run the triage gate on `$RD/task.md`/spec; on refusal,
  `el_emit "$RUN" alert "$LANE" '{"kind":"spec_underdetermined"}'` + `die EXIT_CONFIG`
  with the route-to-discover hint (mirrors the grok-secrets refusal shape). Guard:
  only when the vendor is an implementer lane (not for foreman-discover's own dispatch).
- [ ] **Step 3b (audit — third grok path)** — `lane-run.sh`: inside the existing
  `if [[ "$LANE_VENDOR" == "grok" ]]; then` block (`lane-run.sh:344`, right beside
  `lane_grok_secrets_scan`), add the triage gate on the lane's spec. On refusal,
  mirror the neighbouring shape exactly:

  ```bash
  if ! bash "$lane_repo_root/skills/foreman/scripts/spec-triage.sh" "$LANE_SPEC"; then
    if ! el_emit "$RUN" alert "$LANE" '{"kind":"spec_underdetermined"}' >/dev/null; then
      echo "lane-run: el_emit alert (spec_underdetermined) failed" >&2
    fi
    echo "lane-run: spec under-determined -- route to foreman-discover first" >&2
    exit "$EXIT_CONFIG"
  fi
  ```

  Gated on `LANE_VENDOR=="grok"` only; the unset-`LANE_VENDOR` frozen path stays
  byte-unaffected. This closes the third grok door the audit flagged.
- [ ] **Step 4 (C4 — doctrine, NOT a gate)** — Document C4 in `five-part-spec.md`/
  `roles.md` honestly: after `foreman-discover` converges, the architect SHOULD re-run
  triage on the implementation sub-specs and OFFLOAD the now-`determined` slices to
  grok rather than self-implementing them. State plainly that **foreman cannot enforce
  this** — there is no coded gate on the architect's own edits; C1 only *admits* an
  offloaded sub-spec, it does not *compel* one. C4's only signal is the C5 fit-report
  (a low offload fraction flags the poor cost-fit). Do NOT write "the gate enforces
  admission" — that claim was withdrawn in the audit.
- [ ] **Step 5: docs-check + Commit** `git commit -m "feat(triage): gate all three grok dispatch paths on determinability; C4 re-triage doctrine"`.

---

## Package B — foreman-discover lane (capability `discover-lane`; C2)

**Files:** Create `agents/foreman-discover.md`, `skills/foreman/references/discovery.md`.

- [ ] **Step 1** — Create `agents/foreman-discover.md` (frontmatter: `name:
  foreman-discover`; `model: opus` (top tier — discovery is high-judgment; grok NOT
  eligible); `tools: Read, Grep, Glob, Bash`; `isolation: worktree`; `effort: high`).
  Body: takes a DISCOVERY BRIEF (unknowns, live system to probe, convergence goal);
  MAY run empirical probes (Bash/network). State the guarantees at their real
  strength (audit):
  - **Enforceable:** NEVER writes product code — its only writes are
    `captured-facts.md` + determined sub-specs into the worktree report. This holds
    by role/instruction, not by budget.
  - **Enforceable:** convergence exit = "the unknowns are concrete testable facts
    sufficient for a `determined` spec — *the emitted sub-specs must pass
    `spec-triage.sh`*." Nothing reaches grok until C1 admits it.
  - **Advisory only:** a declared discovery budget (max probe-iterations /
    wall-clock). The def instructs the agent to stop and emit `verdict: partial` +
    remaining unknowns on exhaustion — but say plainly this is a **self-report**, not
    a coded kill (a Claude agent cannot hard-enforce its own turn budget the way
    `lane-run.sh` does). Do not describe it as "never loops forever" as if guaranteed.

  Report shape: `DISCOVERY REPORT / VERDICT: converged|partial / CAPTURED_FACTS: <path>
  / SUB_SPECS: <n determined five-part specs> / REMAINING: ...`.
- [ ] **Step 2** — Create `skills/foreman/references/discovery.md`: the doctrine —
  when to route to discovery (spec-triage refused), the budget contract, the
  convergence criterion, that discovery output feeds the re-triage (C4), and that
  discovery is the EXPENSIVE lane by design (its cost is the price of empirical work;
  the win is offloading the *implementation* slice afterward).
- [ ] **Step 3** — `SKILL.md` routing table: add an **Exploratory** row
  (`Producer: top Claude · Invoke: foreman-discover · Route when: spec is
  under-determined (spec-triage refuses); resolve unknowns empirically → determined
  sub-specs`), and update the deciding rule to distinguish "judgment the spec can't
  capture YET (discover it)" from "irreducible judgment (keep with architect)".
- [ ] **Step 4** — Verify the agent def loads (frontmatter parses) and the routing/doctrine
  is internally consistent (no contradiction with grok-implementer/roles). docs-check green.
- [ ] **Step 5: Commit** `git commit -m "feat(discover): foreman-discover lane (bounded empirical discovery -> facts + determined sub-specs)"`.

---

## Package C — captured-facts convergence (capability `captured-facts`; C3)

**Files:** Create `skills/foreman/references/captured-facts.md`,
`skills/foreman/templates/captured-facts.md`; modify `five-part-spec.md`.

- [ ] **Step 1** — Create `skills/foreman/templates/captured-facts.md` (the artifact
  template foreman-discover fills): sections `## Resolved interfaces` (real API/SDK
  signatures + a sample request+response per call), `## Observed behavior` (empirical
  findings), `## Constraints discovered`, `## Provenance` (which live probe
  established each fact + when). Every fact SHALL cite its probe (no unproven claims).
- [ ] **Step 2** — Create `skills/foreman/references/captured-facts.md`: the doctrine —
  captured-facts is the CONVERGENCE artifact; the architect composes each grok
  implementation sub-spec by INLINING the relevant resolved interfaces + constraints
  into the spec's `## Interfaces` + `## Constraints` sections, so the grok spec is
  write-first (zero reads-first) — the mechanism that turns "grok wrote nothing" into
  "grok writes the determined deliverable" (cross-link the v0.2.8.1 write-first rule
  in `grok-implementer.md`).
- [ ] **Step 3** — `five-part-spec.md`: add a note that a spec derived from discovery
  MUST inline the captured facts (not reference "see captured-facts.md" — grok can't
  read-first); a determined sub-spec carries its facts inline.
- [ ] **Step 4: docs-check + Commit** `git commit -m "feat(captured-facts): convergence artifact schema + inline-into-grok-spec doctrine"`.

---

## Package D — workload-fit accounting (capability `workload-fit`; C5)

**Files:** Create `skills/foreman/scripts/foreman-fit-report.sh` + `tests/fit-report.bats`;
modify `five-part-spec.md`/`roles.md`.

### Task D.1 — up-front fit prediction (doctrine)

- [ ] **Step 1** — `five-part-spec.md`/`roles.md`: add a `## Meta` line `fit:
  discovery_fraction: high | medium | low` (the architect's up-front estimate). When
  `high`, the architect SHALL WARN the operator: "poor cost-fit — mostly empirical
  discovery; the expensive lane will dominate; grok offload will be small" and get an
  explicit proceed. Document that the architect records this as the **first record of
  the run's fit ledger** `$RD/fit.jsonl` — `{"phase":"estimate","discovery_fraction":
  "high"}` — so the ledger exists from run start and the post-run report (D.2) can
  compare estimate vs actual. (This is the automation of the operator's manual verdict;
  the ledger is architect-kept because agent lanes emit no events — see D.2.)
- [ ] **Step 2: docs-check + Commit** `git commit -m "docs(fit): up-front workload-fit prediction + poor-fit warning + fit-ledger seed"`.

### Task D.2 — post-run split report (TDD)

**Audit correction:** the report reads the architect-kept **fit ledger**
`$RD/fit.jsonl`, NOT the event log — agent-dispatched discovery lanes emit zero
`el_emit` entries, so an event-log reader would see no discovery and mis-report a
discovery-heavy run as *good* fit. The ledger's implement records use the real lane
label `worker-grok` (never `grok:1`). Output is structured (`key=value`) so the tests
assert exact tokens, not loose substrings.

**Fit ledger schema** (`$RD/fit.jsonl`, one JSON object per line): `phase` ∈
`estimate | discover | implement`; `discover`/`implement` records carry `lane`
(e.g. `foreman-discover`, `worker-grok`) and optional `weight` (default 1). The
architect appends a `discover` record per discovery pass and an `implement` record
per offloaded slice; a helper may auto-append an `implement` record from a real
`worker-grok` completion.

- [ ] **Step 1: Write the failing test**

```bash
# tests/fit-report.bats
setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"; RD="$FOREMAN_HOME/runs/r1"; mkdir -p "$RD"
  # fit ledger: architect-kept phase records (NOT the event log)
  cat > "$RD/fit.jsonl" <<'EOF'
{"phase":"estimate","discovery_fraction":"high"}
{"phase":"discover","lane":"foreman-discover","weight":2}
{"phase":"implement","lane":"worker-grok","weight":1}
EOF
}
@test "fit-report tallies discovery vs implementer offload with exact fields" {
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [[ "$output" == *"discovery=2"* ]]
  [[ "$output" == *"offload=1"* ]]
  [[ "$output" == *"offload_fraction=33%"* ]]
  [[ "$output" == *"fit_verdict=poor"* ]]   # 33% < 50% threshold
}
@test "a healthy hybrid run (mostly offload) reports good fit" {
  cat > "$RD/fit.jsonl" <<'EOF'
{"phase":"discover","lane":"foreman-discover","weight":1}
{"phase":"implement","lane":"worker-grok","weight":4}
EOF
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [[ "$output" == *"offload_fraction=80%"* ]]
  [[ "$output" == *"fit_verdict=good"* ]]
}
@test "all-discovery run reports poor cost-fit and zero offload" {
  printf '{"phase":"discover","lane":"foreman-discover","weight":1}\n' > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [[ "$output" == *"offload=0"* ]]
  [[ "$output" == *"offload_fraction=0%"* ]]
  [[ "$output" == *"fit_verdict=poor"* ]]
}
@test "missing ledger is reported, not a crash" {
  run bash "$SCRIPTS/foreman-fit-report.sh" r1_absent
  [ "$status" -ne 0 ]
  [[ "$output" == *"no fit ledger"* ]]
}
```

- [ ] **Step 2: Run to verify it fails** (script absent).
- [ ] **Step 3: Implement `foreman-fit-report.sh RUN_ID`** — source `common.sh`;
  resolve `RD="$(run_dir "$RUN_ID")"`; if `$RD/fit.jsonl` is missing, print
  `foreman-fit-report: no fit ledger for <RUN_ID>` and exit non-zero. Else tally
  `weight` (default 1) grouped by `phase`: `discover` → discovery, `implement` →
  offload (the `lane` field is informational; `worker-grok`/`worker-codex` are the
  canonical implement labels). Compute `offload_fraction = round(100*offload/(discovery
  +offload))` (0 when the denominator is 0). Print exactly:
  `foreman-fit report RUN_ID=<id> discovery=<d> offload=<o> offload_fraction=<p>% fit_verdict=<good|poor>`
  where `fit_verdict=poor` when `offload_fraction < 50` (mostly discovery/architect —
  the automatic version of the operator's manual verdict), else `good`. Use `jq` if
  available, else a `grep`/`awk` fallback over the JSONL (keep it `jq`-optional to stay
  portable).
- [ ] **Step 4: Run to verify it passes.** shellcheck-clean.
- [ ] **Step 5** — Wire it into `foreman-cleanup.sh RUN_ID` (the confirmed run-close
  script, `SKILL.md:60`): after the existing cleanup, if `$RD/fit.jsonl` exists, run
  `foreman-fit-report.sh "$RUN_ID"` and append its line to the run summary — so every
  discovery-touched run carries the honest split. Guard: skip silently when no ledger
  (a plain determined run keeps no ledger and needs no fit report). docs-check green.
- [ ] **Step 6: Commit** `git commit -m "feat(fit): foreman-fit-report reads the fit ledger; post-run discovery-vs-offload split + poor-fit verdict"`.

---

## Package E — release close-out

- [ ] **Step 1** — The four `openspec/changes/{spec-triage-gate,foreman-discover-lane,
  captured-facts-convergence,workload-fit-accounting}/` packages were authored as this
  planning artifact (this session), each reconciled to the post-audit design. Verify
  they match the reworked design/plan (esp. the fit-ledger source, `worker-grok` label,
  advisory budget, C4-as-doctrine), then archive them to
  `openspec/changes/archive/2026-07-19-<name>/` on ship (the v0.2.9 pattern).
- [ ] **Step 2** — Full gate on a QUIET host with grok on PATH; the pipeline proof: a
  synthetic exploratory spec is refused by spec-triage and routed to foreman-discover;
  a determined sub-spec (facts inlined) is admitted to grok; fit-report shows the
  split. docs-check + shellcheck green.
- [ ] **Step 3** — `ROADMAP.md` section; tag + GitHub release.

## Self-review

- **Spec coverage:** C1 → A.1/A.2 (all three grok paths: worker-run, grok-implementer,
  lane-run); C2 → B; C3 → C; C4 → A.2 Step 4 (doctrine, not a gate); C5 → D.1
  (up-front estimate and ledger seed) and D.2 (post-run report). All five components
  mapped.
- **No placeholders:** every code step shows the code; the agent-def / doctrine steps
  are content, not "add docs". The discovery-phrase regex is narrow/anchored and the
  verification heuristic refuses only empty/parenthetical (A.1 Step 3), with regression
  guards in A.1 Step 1.
- **Name consistency:** `spec-triage.sh` (`spec_underdetermined` alert),
  `determinability: determined|exploratory|hybrid`, `agents/foreman-discover.md`
  (`verdict: converged|partial`), `captured-facts.md`, `foreman-fit-report.sh` (reads
  `$RD/fit.jsonl`, `phase: estimate|discover|implement`, real label `worker-grok`,
  `offload_fraction`, `fit_verdict`), `fit: discovery_fraction:` — consistent across
  tasks and the OpenSpec specs.
- **Honesty (audit):** the plan claims no enforcement it can't deliver — C4 is doctrine
  measured by C5 (no gate on architect edits); C2's budget is advisory; C5 reads the
  architect-kept ledger, not phantom event-log entries.
- **TDD:** A.1 and D.2 are test-first bats with real fixtures (incl. false-positive
  and missing-ledger guards); B/C and the doctrine are content + a consistency check;
  A.2/D.1 gate on docs-check.

## Acceptance

An under-determined spec is refused at all three grok doors (`worker-run.sh`,
`grok-implementer` preflight, `lane-run.sh`) by `spec-triage.sh` and routed to a
bounded `foreman-discover` lane; discovery emits `captured-facts.md` + determined
sub-specs; those pass the re-run triage and are *offloadable* to grok (facts inlined,
write-first); and `foreman-fit-report` reads the fit ledger and prints the
discovery-vs-offload split with `fit_verdict=poor` when the workload is mostly
empirical. The determined-spec false-positive guards and the missing-ledger guard pass.
Suite + docs-check + shellcheck green. Packaged as OpenSpec + EARS, gated, released.
