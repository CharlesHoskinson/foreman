# grok-lane-activation Implementation Plan (v0.2.7.5 · package 2/7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> EARS requirements: `openspec/changes/archive/2026-07-18-grok-lane-activation/specs/lane-run/spec.md`.
> Depends on package 1 (lifecycle-three-stage) for the Setup auth stage.

**Goal:** Wire grok into lane-run's vendor map (reusing T5a's normalized
vendor-home isolation), document the headless recipe, add a secrets-refusal
preflight, and delegate grok auth to the Setup stage.

**Architecture:** `LANE_VENDOR=grok` already maps in T5a's `lane_vendor_env_var`
(grok/codex/claude) — this activates and proves the grok arm, adds a
`.env`/private-key preflight scan gated on `LANE_VENDOR=grok`, corrects the
manifest, and moves auth to Setup. Grok stays optional until t5b greens it.

**Tech Stack:** bash, bats-core, `skills/foreman/scripts/lane-run.sh`,
`env/reference-manifest.toml`, the grok CLI (`@xai-official/grok`, 0.2.103,
verified signed-in on this host).

## Global constraints

Same as package 1 (strict mode, portability checklist, gate mutex per bats run,
one commit per task, existing tests byte-unmodified unless a task names them).

## File structure

- Modify `skills/foreman/scripts/lane-run.sh` — secrets preflight (gated on
  `LANE_VENDOR=grok`).
- Modify `env/reference-manifest.toml` — real grok install + device-code auth.
- Modify `skills/foreman/references/lanes.md` — grok-implementer recipe.
- Create `tests/grok-lane.bats`.
- Coordinate with package 1: grok auth verified in Setup (no in-lane auth).

---

### Task 1: verify the grok arm of the vendor map

**Files:** Test `tests/grok-lane.bats`; read `lane-run.sh` `lane_vendor_env_var`.

- [ ] **Step 1: Write the failing test** — a `LANE_VENDOR=grok` lane exports
  normalized `GROK_HOME` on the launcher-absent branch and fills
  `ownership.config_dir` (mirror the existing codex/claude vendor-isolation
  cases in `tests/vendor-isolation.bats`; use `FOREMAN_LAUNCH=/nonexistent`).

```bash
@test "LANE_VENDOR=grok exports normalized GROK_HOME and fills ownership.config_dir" {
  # setup_tmp_repo + WT + .harness/vendor-home/grok ; run lane-run with a CMD
  # that writes "$GROK_HOME" to a file; assert == norm("$WT/.harness/vendor-home/grok")
  # and jq '.payload.config_dir' of the ownership event == same.
}
```

- [ ] **Step 2: Run to verify** — if the grok arm already works (T5a shipped
  the mapping), this may PASS immediately; if so, it becomes a regression
  guard. If it FAILS, the arm needs the same treatment as codex/claude in
  `lane_vendor_env_var` — add `grok) echo GROK_HOME ;;`.
- [ ] **Step 3: Implement** (only if Step 2 failed) the grok mapping arm.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "test(grok): vendor-home isolation arm for grok"`.

---

### Task 2: secrets-refusal preflight

**Files:** Modify `skills/foreman/scripts/lane-run.sh`; test `tests/grok-lane.bats`.

- [ ] **Step 1: Write the failing tests** (both directions) — a
  `LANE_VENDOR=grok` lane targeting a worktree with `.env` exits non-zero,
  emits `alert{kind:grok_secrets_refused}`, and does NOT spawn CMD; a clean
  worktree (only `.env.example`) proceeds.

```bash
setup() { load helpers; setup_tmp_repo; SCR="$BATS_TEST_DIRNAME/../skills/foreman/scripts"; }

@test "grok lane refuses a worktree containing .env" {
  # WT with a vendor-home + a tracked .env in the source tree
  # (NOT under .harness/ — the scan is scoped to worktree source, not harness scaffolding)
  echo "SECRET=x" > "$WT/.env"
  run env LANE_VENDOR=grok bash "$SCR/lane-run.sh" run1 lane-a "$WT" -- bash -c 'echo RAN > "$WT/ran"'
  [ "$status" -ne 0 ]
  [ ! -f "$WT/ran" ]
  run jq -rc 'select(.type=="alert") | .payload.kind' "$(run_dir run1)/events.jsonl"
  [[ "$output" == *"grok_secrets_refused"* ]]
}

@test "grok lane proceeds with only .env.example (CMD actually runs)" {
  echo "SECRET=example" > "$WT/.env.example"
  run env LANE_VENDOR=grok bash "$SCR/lane-run.sh" run2 lane-a "$WT" -- bash -c 'echo RAN > "$WT/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]           # non-vacuous: proves CMD ran on a clean worktree
}
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** a `lane_grok_secrets_scan WT` function scoped to
  the worktree SOURCE (exclude `$WT/.harness/` scaffolding to avoid
  false-positives): find `.env` (excluding `.env.example`) and grep tracked
  content for `-----BEGIN .*PRIVATE KEY-----`. Call it, gated on
  `LANE_VENDOR=grok`, BEFORE the spawn AND after the Task-5 (package 1)
  readiness gate; on a hit emit `alert{kind:grok_secrets_refused}` and exit
  non-zero. Frozen-path rule: unset `LANE_VENDOR` / non-grok byte-unaffected.
  NOTE: this in-lane secrets guard is DISTINCT from the package-1 Use-path
  readiness gate (env readiness) — both apply to a grok lane.
- [ ] **Step 4: Run to verify it passes;** re-run `tests/lane-run.bats` (33) +
  `tests/vendor-isolation.bats` under the mutex — Expected unchanged green.
- [ ] **Step 5: Commit** `git commit -m "feat(grok): secrets-refusal preflight for grok lanes"`.

---

### Task 3: manifest + Setup-stage auth

**Files:** Modify `env/reference-manifest.toml`; coordinate with package 1's
tool-check auth probe.

- [ ] **Step 1** — Correct the `grok` manifest entry: install
  `npm i -g @xai-official/grok`, binary at the npm global prefix, auth =
  `grok login --device-code`. (tool-check's grok auth probe + Setup gate
  already land in package 1 — this task ensures the manifest matches and adds
  a bats assertion that `foreman-setup --lane grok` reports NOT-READY when the
  grok shim is unsigned, refusing a grok Use route.)
- [ ] **Step 2** — Run the assertion under the mutex — Expected: a grok Use
  route is refused citing Setup, no mid-lane auth attempt.
- [ ] **Step 3: docs-check + Commit**
  `git commit -m "chore(grok): manifest reflects real install; auth gated in Setup"`.

---

### Task 4: lanes reference recipe

**Files:** Modify `skills/foreman/references/lanes.md`.

- [ ] **Step 1** — Document the grok-implementer headless recipe:
  `grok -p "<spec>" --cwd <worktree> --output-format json --always-approve
  --session-id <uuid> --no-auto-update`, the resume form (`grok -r <id>`), the
  auth doctrine (device-code / `XAI_API_KEY`, done in Setup), and the
  secrets-refusal rule. State grok is optional until t5b greens it.
- [ ] **Step 2: docs-check** — Expected pass.
- [ ] **Step 3: Commit** `git commit -m "docs(grok): grok-implementer recipe in lanes reference"`.

---

### Task 5: live acceptance (real grok --round)

**Files:** (proof run — grok is signed in on this host)

- [ ] **Step 1** — Route one trivial spec to grok via a real `lane-run --round`:
  grok edits a throwaway worktree (secrets-free), the gate runs, a report is
  written, `round_done` emitted. Capture output as the package proof.
- [ ] **Step 2** — Opus audits the resulting grok-authored diff (cross-vendor:
  worker xAI ≠ auditor Anthropic).
- [ ] **Step 3: Full gate** `bash tests/run.sh` under the mutex + docs-check.
- [ ] **Step 4: Commit** the proof artifact.

## Self-review

- Coverage: R(vendor map)→T1; R(secrets refusal)→T2; R(manifest)+R(Setup
  auth)→T3; R(recipe)→T4; live→T5. All covered.
- Frozen path: unset `LANE_VENDOR` unaffected (asserted in T2 Step 4).
- Names consistent: `lane_grok_secrets_scan`, `grok_secrets_refused`,
  `LANE_VENDOR`, `GROK_HOME`.

## Acceptance

grok runs a real audited `--round` lane; secrets preflight proven both ways;
manifest matches reality; auth gated in Setup; full suite + docs-check green.
Archive the change folder on ship.
