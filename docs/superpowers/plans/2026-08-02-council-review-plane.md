# Council as the Review Plane for grok-4.5 Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-auditor review step on grok-4.5 lanes with a Council-shaped deliberation that has a quorum, blinded candidates and non-author judges, without Council ever becoming a release authority.

**Architecture:** Foreman stays the execution and release-control plane. Council owns typed deliberation and produces an advisory record. A narrow bridge writes an immutable review bundle from a lane, runs deliberation over it, and writes an advisory artifact that `gate-eval.sh` may read but is never bound by. Tasks 1–3 need no Council code at all and fix the review loop's measured defects immediately; tasks 4–6 wire the real thing.

**Tech Stack:** Bash 5, Bats, jq, TypeScript 6, Effect 3, Vitest, OpenSpec, Git subtree.

## Global Constraints

- Council remains **advisory shadow mode** for the whole of v0.2.9.0.
- `gate-eval.sh` and `merge-gate.sh` remain the **only** release and merge authorities.
- Council MUST NOT write `audit-verdict.json`.
- Council MUST NOT launch a provider process outside Foreman lane ownership.
- Council MUST NOT update Foreman checkpoints, event files, or Graphify state directly.
- Do not merge `release/v0.3.0-council` into the v0.2.9.0 branch. Backport with explicit cherry-picks only.
- Keep the Council subtree at `components/council/`.
- No new runtime dependency without adding it to `env/reference-manifest.toml`, `env/tool-check.sh` and `dependencies/README.md` in the same commit — `dependencies/check-drift.sh` fails otherwise.
- Every new shell file needs mode `100755` in the git index; `tools/repo-hygiene.sh` fails on a mode regression and `tests/line-endings.bats` owns the authoritative inventory.
- Cross-vendor invariant: a reviewer MUST NOT share a model family with the implementer. `ac_select_auditor` in `skills/foreman/scripts/lib/audit-call.sh` is the only selector.

---

## Why these tasks, in this order

Three failures were measured today, all in the review loop rather than in the
code under review:

1. Two of three HIGH findings in one audit round were artifacts of a **stale
   lane worktree** — the auditor read dependency records that had already been
   fixed on the release branch.
2. A finding flagged a file as out-of-scope that was **carry-over from an
   earlier round**, because the auditor is shown cumulative uncommitted state
   rather than the round's diff.
3. The loop runs **one auditor from one family**. Council's spec requires at
   least three admissible proposals from at least two independent failure
   domains and states that raw worker count MUST NOT satisfy diversity.

Tasks 1–3 fix all three without Council code. Tasks 4–6 build the bridge.

## File Structure

| File | Responsibility |
|---|---|
| `skills/foreman/scripts/lane-review-bundle.sh` | Build an immutable, self-describing review bundle from a lane worktree |
| `tests/lane-review-bundle.bats` | Its tests |
| `skills/foreman/scripts/lib/review-quorum.sh` | Quorum arithmetic over reviewer verdicts, ported from Council's rules |
| `tests/review-quorum.bats` | Its tests |
| `skills/foreman/scripts/council-advise.sh` | Bridge: bundle in, advisory record out; refuses to write any gate artifact |
| `tests/council-advise.bats` | Its tests |
| `components/council/packages/bridge/` | TypeScript reader for the bundle format (Task 5) |
| `docs/evidence/2026-08-02-council-advisory/` | Advisory records, add-only |

---

### Task 1: Lane review bundle

**Files:**

- Create: `skills/foreman/scripts/lane-review-bundle.sh`
- Test: `tests/lane-review-bundle.bats`
- Modify: `tests/baseline.tsv`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `lane_review_bundle <WORKTREE> <BASE_REF> <OUT_DIR>` writing `OUT_DIR/bundle.json` with keys `base_sha`, `head_sha`, `round_diff`, `files_changed[]`, `worktree_dirty`, `base_is_ancestor_of_release`. Task 2 and Task 3 read this file.

- [ ] **Step 1: Write the failing test**

```bash
@test "bundle records the round diff, not cumulative worktree state" {
  cd "$BATS_TEST_TMPDIR"
  git init -q repo && cd repo
  git config user.email t@t && git config user.name t
  echo one > a.txt && git add a.txt && git commit -qm base
  base="$(git rev-parse HEAD)"
  echo two > b.txt          # uncommitted carry-over
  echo three > c.txt

  run bash "$SCRIPTS/lane-review-bundle.sh" . "$base" "$BATS_TEST_TMPDIR/out"
  [ "$status" -eq 0 ]
  [ -f "$BATS_TEST_TMPDIR/out/bundle.json" ]
  run jq -r '.files_changed | length' "$BATS_TEST_TMPDIR/out/bundle.json"
  [ "$output" = "2" ]
  run jq -r '.worktree_dirty' "$BATS_TEST_TMPDIR/out/bundle.json"
  [ "$output" = "true" ]
}

@test "bundle refuses when the base is not an ancestor of the release ref" {
  run bash "$SCRIPTS/lane-review-bundle.sh" "$STALE_WT" "$UNRELATED_SHA" "$BATS_TEST_TMPDIR/out"
  [ "$status" -ne 0 ]
  [[ "$output" == *"base is not an ancestor"* ]]
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bats tests/lane-review-bundle.bats`
Expected: FAIL — `lane-review-bundle.sh` does not exist.

- [ ] **Step 3: Implement**

```bash
#!/usr/bin/env bash
# Build an immutable review bundle describing ONE round of lane work.
# Two of three HIGH findings in a single audit round on 2026-08-01 were
# artifacts of a stale base and of cumulative worktree state being presented
# as the round's change. This script exists so a reviewer can never see either.
set -uo pipefail
WT="${1:?usage: lane-review-bundle.sh WORKTREE BASE_REF OUT_DIR}"
BASE="${2:?}"; OUT="${3:?}"
mkdir -p "$OUT" || exit 2

git -C "$WT" rev-parse --verify --quiet "$BASE" >/dev/null || {
  printf 'lane-review-bundle: base ref %s does not resolve\n' "$BASE" >&2; exit 2; }

# Refuse a stale base outright: an auditor reading superseded records files
# correct-looking findings about problems that are already fixed.
release="$(git -C "$WT" rev-parse --verify --quiet HEAD)"
if ! git -C "$WT" merge-base --is-ancestor "$BASE" "$release"; then
  printf 'lane-review-bundle: base is not an ancestor of the lane HEAD\n' >&2; exit 3
fi

changed="$(git -C "$WT" status --porcelain | awk '{print $2}' | jq -R . | jq -s .)"
dirty=false; [ -n "$(git -C "$WT" status --porcelain)" ] && dirty=true

jq -n \
  --arg base "$(git -C "$WT" rev-parse "$BASE")" \
  --arg head "$release" \
  --arg diff "$(git -C "$WT" diff "$BASE" -- . | head -c 400000)" \
  --argjson files "$changed" \
  --argjson dirty "$dirty" \
  '{base_sha:$base, head_sha:$head, round_diff:$diff,
    files_changed:$files, worktree_dirty:$dirty,
    base_is_ancestor_of_release:true}' > "$OUT/bundle.json"
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bats tests/lane-review-bundle.bats` → expect all pass.

- [ ] **Step 5: Set the exec bit and commit**

```bash
chmod +x skills/foreman/scripts/lane-review-bundle.sh
git update-index --chmod=+x skills/foreman/scripts/lane-review-bundle.sh
git add skills/foreman/scripts/lane-review-bundle.sh tests/lane-review-bundle.bats tests/baseline.tsv
git commit -m "feat(review): bundle the round diff so a reviewer cannot see stale or cumulative state"
```

---

### Task 2: Quorum arithmetic

**Files:**

- Create: `skills/foreman/scripts/lib/review-quorum.sh`
- Test: `tests/review-quorum.bats`
- Modify: `tests/baseline.tsv`

**Interfaces:**

- Consumes: nothing.
- Produces: `rq_evaluate <reviewers_json>` printing `QUORUM_MET|QUORUM_NOT_MET admissible=<n> domains=<n>` and returning 0 only on `QUORUM_MET`. Task 3 calls it.

Port Council's rule verbatim: **at least 3 admissible proposals from at least 2
independent failure domains, and raw worker count MUST NOT satisfy diversity**
(`components/council/packages/domain/src/quorum.ts`, `evaluateAutomaticQuorum`,
defaults `minimumProposals = 3`, `minimumDomains = 2`).

- [ ] **Step 1: Write the failing test**

```bash
@test "three reviewers from one family do not meet quorum" {
  json='[{"admissible":true,"failureDomain":"anthropic"},
         {"admissible":true,"failureDomain":"anthropic"},
         {"admissible":true,"failureDomain":"anthropic"}]'
  run bash -c "source $SCRIPTS/lib/review-quorum.sh; rq_evaluate '$json'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"QUORUM_NOT_MET"* ]]
  [[ "$output" == *"domains=1"* ]]
}

@test "three admissible across two families meet quorum" {
  json='[{"admissible":true,"failureDomain":"anthropic"},
         {"admissible":true,"failureDomain":"openai"},
         {"admissible":true,"failureDomain":"xai"}]'
  run bash -c "source $SCRIPTS/lib/review-quorum.sh; rq_evaluate '$json'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"QUORUM_MET"* ]]
}

@test "inadmissible reviewers are excluded from both counts" {
  json='[{"admissible":false,"failureDomain":"anthropic"},
         {"admissible":true,"failureDomain":"openai"},
         {"admissible":true,"failureDomain":"xai"}]'
  run bash -c "source $SCRIPTS/lib/review-quorum.sh; rq_evaluate '$json'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"admissible=2"* ]]
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bats tests/review-quorum.bats` → FAIL, function not found.

- [ ] **Step 3: Implement**

```bash
#!/usr/bin/env bash
# Quorum over reviewer verdicts. Ported from Council's evaluateAutomaticQuorum
# so the two planes cannot drift on the rule that matters most: raw reviewer
# COUNT must not satisfy diversity. Three reviewers from one vendor family is
# one failure domain and does not close a review.
rq_evaluate() {
  local json="$1" admissible domains
  admissible="$(printf '%s' "$json" | jq '[.[] | select(.admissible)] | length')"
  domains="$(printf '%s' "$json" | jq '[.[] | select(.admissible) | .failureDomain] | unique | length')"
  if [ "$admissible" -ge 3 ] && [ "$domains" -ge 2 ]; then
    printf 'QUORUM_MET admissible=%s domains=%s\n' "$admissible" "$domains"
    return 0
  fi
  printf 'QUORUM_NOT_MET admissible=%s domains=%s\n' "$admissible" "$domains"
  return 1
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

- [ ] **Step 5: Commit**

```bash
git add skills/foreman/scripts/lib/review-quorum.sh tests/review-quorum.bats tests/baseline.tsv
git commit -m "feat(review): port Council quorum — count never substitutes for domain diversity"
```

---

### Task 3: Advisory bridge, fail-closed on authority

**Files:**

- Create: `skills/foreman/scripts/council-advise.sh`
- Test: `tests/council-advise.bats`
- Modify: `tests/baseline.tsv`

**Interfaces:**

- Consumes: `bundle.json` from Task 1, `rq_evaluate` from Task 2.
- Produces: `docs/evidence/<date>-council-advisory/<run>.advisory.json` with `verdicts[]`, `quorum`, `dissent[]`, `advisory: true`.

- [ ] **Step 1: Write the failing test**

```bash
@test "advisory record is marked advisory and names no gate authority" {
  run bash "$SCRIPTS/council-advise.sh" "$BUNDLE" "$OUT"
  [ "$status" -eq 0 ]
  run jq -r '.advisory' "$OUT"
  [ "$output" = "true" ]
}

@test "refuses to write audit-verdict.json even when asked" {
  run bash "$SCRIPTS/council-advise.sh" "$BUNDLE" "$RD/audit-verdict.json"
  [ "$status" -ne 0 ]
  [[ "$output" == *"refusing"* ]]
  [ ! -f "$RD/audit-verdict.json" ]
}

@test "a single-family reviewer set yields QUORUM_NOT_MET, not an approval" {
  run bash "$SCRIPTS/council-advise.sh" "$SINGLE_FAMILY_BUNDLE" "$OUT"
  run jq -r '.quorum' "$OUT"
  [[ "$output" == *"QUORUM_NOT_MET"* ]]
}
```

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement**

```bash
#!/usr/bin/env bash
# Council advisory bridge. Reads a review bundle, records reviewer verdicts and
# quorum, writes ONE advisory artifact. It is deliberately incapable of writing
# a gate artifact: gate-eval.sh and merge-gate.sh are the only release
# authorities and Council must never write audit-verdict.json.
set -uo pipefail
BUNDLE="${1:?usage: council-advise.sh BUNDLE_JSON OUT_JSON}"
OUT="${2:?}"
case "$(basename "$OUT")" in
  audit-verdict.json|checks-result.json|gate-*.json)
    printf 'refusing: council-advise may not write the gate artifact %s\n' "$(basename "$OUT")" >&2
    exit 2 ;;
esac
# ... reviewer dispatch omitted here; see Task 4 for the provider path ...
```

- [ ] **Step 4: Run the tests and confirm they pass**

- [ ] **Step 5: Set the exec bit and commit**

```bash
chmod +x skills/foreman/scripts/council-advise.sh
git update-index --chmod=+x skills/foreman/scripts/council-advise.sh
git add skills/foreman/scripts/council-advise.sh tests/council-advise.bats tests/baseline.tsv
git commit -m "feat(review): advisory bridge that cannot write a gate artifact"
```

---

### Task 4: Third reviewer domain

Quorum needs three admissible reviewers across two domains. Today there are two
usable families: `codex` (openai) and `grok` (xai) — and grok is the implementer
on these lanes, so it is a non-author only when grok did not write the change.
`claude` is the orchestrator. `agy` is unusable: `foreman-setup.sh --lane agy`
fails before the adapter probe (recorded in the Council localization plan).

- [ ] **Step 1:** Admit the authenticated `agy` lane through Setup — this is Task 1 of `docs/superpowers/plans/2026-08-02-council-v030-localization.md`; execute that task rather than duplicating it here.
- [ ] **Step 2:** Pin the `agy` model before model-family classification, per the localization plan's global constraints.
- [ ] **Step 3:** Limit `agy` concurrency to 1 until its OAuth and state isolation are complete.
- [ ] **Step 4:** Confirm `ac_select_auditor` classifies `agy` into a family distinct from `codex` and `grok`, and that it refuses when the family equals the worker's.
- [ ] **Step 5:** Commit.

---

### Task 5: Council reads the bundle

**Files:**

- Create: `components/council/packages/bridge/src/bundle.ts`
- Create: `components/council/packages/bridge/test/bundle.test.ts`

- [ ] **Step 1:** Write a failing Vitest decoding a `bundle.json` fixture into a typed value using the existing `@council/schema` decode path.
- [ ] **Step 2:** Run `corepack pnpm -s check` — expect FAIL.
- [ ] **Step 3:** Implement the decoder, reusing `packages/schema/src/decode.ts`; no new dependency.
- [ ] **Step 4:** Run `corepack pnpm -s verify` — expect 114+ tests passing and OpenSpec still valid.
- [ ] **Step 5:** Commit.

**Note:** `graphify-out/` is in neither `.prettierignore` nor `.gitignore` in the
Council subtree. Running `graphify update .` there breaks `pnpm verify` with ~60
prettier failures. Either add it to both files in this task or do not generate a
graph inside the component — Council already ships one at
`docs/research/graphify/`.

---

### Task 6: Blinding and order-checked judging

Council requires that candidate identity be blinded, that a model never scores
its own candidate, and that every decisive pairwise comparison run in **both**
orders with identical rubric and evidence.

- [ ] **Step 1:** Write a failing test asserting the advisory record contains no provider, model or CLI name in the candidate fields.
- [ ] **Step 2:** Run it — expect FAIL.
- [ ] **Step 3:** Implement blinding in `council-advise.sh`: replace identity with random candidate ids, keep the mapping in a sealed sidecar not passed to judges.
- [ ] **Step 4:** Write a failing test asserting each decisive comparison appears twice with reversed candidate order.
- [ ] **Step 5:** Implement order-checked comparison; record both results and flag `judge_unstable` when they disagree.
- [ ] **Step 6:** Run the tests and commit.

---

## Self-review

**Spec coverage.** Council's deliberation requirements map as: independent
sealed proposals → Task 1 (immutable bundle); blinded identity → Task 6;
deterministic checks precede deliberation → Task 1's ancestry refusal; quorum
with independent domains → Tasks 2 and 4; non-author, order-checked judges →
Tasks 4 and 6; typed abstention → Task 3's `quorum` field and Task 6's
`judge_unstable`. Not covered, and deliberately: calibrated confidence
weighting, critique rounds, minority-blocks-closure, and synthesis — all require
the Effect application shell that does not exist, and none is needed to fix the
three measured defects.

**Placeholders.** Task 3's implementation elides the reviewer dispatch loop and
says so explicitly, pointing at Task 4; every other step carries its code.

**Type consistency.** `bundle.json` keys are fixed in Task 1 and consumed
unchanged in Tasks 3 and 5. `rq_evaluate` has one signature, used in Tasks 2 and 3.

## What this does NOT do

It does not make Council a gate. `gate-eval.sh` and `merge-gate.sh` remain the
only release authorities, `audit-verdict.json` stays Foreman's, and Task 3
refuses to write it by name. If every reviewer abstains, the advisory record
says `QUORUM_NOT_MET` and the release gate is unaffected — which is the correct
behaviour for a shadow plane and the reason it is safe to run it during v0.2.9.0.
