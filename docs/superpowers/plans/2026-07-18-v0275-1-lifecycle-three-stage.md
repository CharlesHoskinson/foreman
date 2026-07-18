# lifecycle-three-stage Implementation Plan (v0.2.7.5 · package 1/7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> Requirements are in `openspec/changes/lifecycle-three-stage/specs/lifecycle/spec.md`
> (EARS) — this plan sequences their implementation; cite requirement text
> from there rather than re-deriving it.

**Goal:** Reframe foreman to operate in three ordered stages — Setup &
Environment → Use → Cleanup — with all model authentication owned by Setup and
a machine-readable readiness verdict gating Use.

**Architecture:** Two thin wrapper scripts (`foreman-setup.sh`,
`foreman-cleanup.sh`) COMPOSE existing scripts (tool-check, bootstrap,
wt-cleanup, lane-supervise) — this is an organizing frame, not a rewrite.
tool-check gains per-vendor auth probes and a `NOT_AUTHENTICATED` state plus a
lane-scoped readiness verdict. SKILL.md adopts the three stages as the
operating model.

**Tech Stack:** bash (`set -euo pipefail`, `lib/common.sh`), bats-core, the
existing `env/tool-check.sh` + `skills/foreman/scripts/{wt-cleanup,lane-supervise,lane-queue}.sh`.

**Foundational:** land this FIRST — the other v0.2.7.5 packages attach to the
stages (auth → Setup, teardown → Cleanup, full-WSL install → Setup).

## Global constraints (apply to every task)

- `#!/usr/bin/env bash`, `set -euo pipefail`, source `lib/common.sh`, shdoc
  headers (`# @description/@arg/@stdout/@exitcode`) on every function.
- Portability checklist (see `docs/superpowers/plans/2026-07-15-durable-lanes.md`
  lines 33-60): CR-strip captured output; `if…fi` not trailing `[[ ]] && …`;
  no flock (mkdir mutex); `local x; x="$(cmd)"` split to avoid set-e masking.
- Gate mutex around EVERY bats run: `until mkdir ~/.foreman/gate.lock 2>/dev/null;
  do sleep 15; done` with a trap-protected `rmdir`. One bats file at a time.
- Do not commit until a task's Step "Commit". Frequent commits (one per task).
- Existing tests stay green byte-unmodified except where a task names them.

## File structure

- Create `skills/foreman/scripts/foreman-setup.sh` — Setup stage wrapper.
- Create `skills/foreman/scripts/foreman-cleanup.sh` — Cleanup stage wrapper.
- Modify `env/tool-check.sh` — auth probes + `NOT_AUTHENTICATED` + lane-scoped
  readiness in the verdict.
- Create `tests/foreman-setup.bats`, `tests/foreman-cleanup.bats`.
- Modify `skills/foreman/SKILL.md` — the three-stage operating frame.

---

### Task 0: determine each vendor's real, NON-BILLING auth probe (empirical)

Auth-status commands differ per CLI and MUST NOT trigger a billed inference or
hang. grok is signed in on this host — test against it.

**Files:** Create a note `openspec/changes/lifecycle-three-stage/auth-probes.md`
recording the exact command per vendor + evidence.

- [ ] **Step 1** — Run `grok --help`, `codex --help`, `claude --help`; find
  each CLI's auth-status / whoami / login-state subcommand. VERIFY each is
  non-billing (no model call) and fast: for grok, confirm the chosen command
  distinguishes signed-in (exit 0) from signed-out (non-zero) WITHOUT running
  `grok -p` (that bills + can hang). If a CLI has NO non-billing auth check,
  the probe SHALL be credential-file presence under the vendor's config dir,
  documented as a known limitation (never a billed inference).
- [ ] **Step 2** — Record the exact per-vendor probe command + a signed-in and
  (where reproducible) signed-out transcript in `auth-probes.md`. This feeds
  `vendor_authed` in Task 1.
- [ ] **Step 3: Commit** `git commit -m "docs(lifecycle): empirical non-billing auth-probe commands per vendor"`.

---

### Task 1: tool-check emits per-vendor auth state

**Files:**

- Modify: `env/tool-check.sh` (the `check_one` grok/codex/claude cases ~lines
  86-93, the tally block ~line 262, and `report_text`/`report_json` ~lines
  285-382)
- Test: `tests/tool-check-auth.bats` (new)

- [ ] **Step 1: Write the failing test.** A grok shim on PATH that prints a
  version but exits non-zero on the auth probe SHALL make tool-check report
  grok `not_authenticated`, not `ok`. (NOTE: reference tool-check via
  `$BATS_TEST_DIRNAME/../env/tool-check.sh` — `helpers.bash` defines only
  `REPO`/`SCRIPTS`, NOT `$ROOT`.)

```bash
# tests/tool-check-auth.bats
setup() { load helpers; setup_tmp_repo; SHIM="$BATS_TEST_TMPDIR/bin"; mkdir -p "$SHIM"; TC="$BATS_TEST_DIRNAME/../env/tool-check.sh"; }

@test "tool-check reports grok not_authenticated when installed but not signed in" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  *) echo "Not signed in." >&2; exit 1 ;;   # the Task-0 auth-probe subcommand fails
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"grok"*"not_authenticated"* ]]
}
```

- [ ] **Step 2: Run to verify it fails.** `~/.foreman/tools/bats-core/bin/bats
  tests/tool-check-auth.bats` — Expected FAIL (grok reports `ok`, no auth
  probe exists yet).

- [ ] **Step 3: Add an auth probe helper (using Task 0's commands) + wire the
  grok case.** In `env/tool-check.sh`, add near `have()` — substitute the
  EXACT non-billing subcommands recorded in `auth-probes.md`, NEVER `grok -p`:

```bash
# @description Probe whether a vendor CLI is authenticated (not merely present).
#   Uses the non-billing auth-status command determined empirically in Task 0
#   (auth-probes.md). MUST NOT run a billed model inference.
# @arg $1 vendor id  @exitcode 0 authenticated  @exitcode 1 not authenticated
vendor_authed() {
  case "$1" in
    grok)   grok <AUTH_STATUS_SUBCMD_FROM_TASK0> >/dev/null 2>&1 ;;
    codex)  codex <AUTH_STATUS_SUBCMD_FROM_TASK0> >/dev/null 2>&1 ;;
    claude) claude <AUTH_STATUS_SUBCMD_FROM_TASK0> >/dev/null 2>&1 ;;
    *) return 0 ;;
  esac
}
```

Change the grok case (~line 86) to distinguish auth:

```bash
    grok)
      if have grok; then
        detail="$(grok --version 2>&1 | head -1)"
        if vendor_authed grok; then status=ok
        else status=not_authenticated; detail="$detail (run: grok login --device-code)"; fi
      else status=missing; fi
      ;;
```

Apply the same present-but-`not_authenticated` pattern to `codex)`/`claude)`.
Add a `not_authenticated` case to the tally block (~line 262) alongside
`missing/outdated/degraded` (a `not_auth+=("$id")` array); a
not_authenticated must-tool already flows into `must_fail` via the `!= "ok"`
test (tool-check.sh:279 — verify).

- [ ] **Step 4: Surface NOT_AUTHENTICATED in BOTH outputs.** In `report_text`
  add `[[ ${#not_auth[@]} -gt 0 ]] && echo "NOT_AUTHENTICATED: ${not_auth[*]}"`
  (near the MISSING/OUTDATED lines ~:329-331); in `report_json` add a
  `not_authenticated` array alongside missing/outdated/degraded (~:344-382) so
  a caller can gate on the distinct verdict field (spec R3).

- [ ] **Step 5: Run to verify it passes.** Same bats command — Expected PASS.
  Then run the existing tool-check/`config.bats` tests under the mutex — green.

- [ ] **Step 6: Commit.**

```bash
git add env/tool-check.sh tests/tool-check-auth.bats
git commit -m "feat(lifecycle): tool-check reports+emits per-vendor NOT_AUTHENTICATED state"
```

---

### Task 2: a lane-scoped readiness verdict

**Files:**

- Modify: `env/tool-check.sh` (verdict/report block)
- Test: `tests/tool-check-auth.bats` (add a case)

- [ ] **Step 1: Write the failing test.** A `--lane grok` query SHALL print
  `LANE_READY: grok=no` when grok is not_authenticated and `=yes` when ok.

```bash
@test "tool-check --lane grok gates on grok auth state" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--version" ]] && { echo "grok 0.2.103"; exit 0; }
exit 1
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --lane grok
  [[ "$output" == *"LANE_READY: grok=no"* ]]
}
```

- [ ] **Step 2: Run to verify it fails** (no `--lane` flag yet).

- [ ] **Step 3: Implement `--lane`.** Add `--lane) LANE="$2"; shift 2 ;;` to
  the arg parser (~line 10). After the verdict is computed, if `$LANE` is set,
  print `LANE_READY: <lane>=yes|no` where `no` iff that lane's vendor row is
  not `ok`. Map lane→vendor (grok/codex/claude → same id). Keep it additive —
  the default (no `--lane`) output is unchanged.

- [ ] **Step 4: Run to verify it passes;** re-run Task 1's cases + existing
  tool-check tests under the mutex.

- [ ] **Step 5: Commit.**

```bash
git add env/tool-check.sh tests/tool-check-auth.bats
git commit -m "feat(lifecycle): tool-check --lane emits LANE_READY gating verdict"
```

---

### Task 3: foreman-setup.sh (idempotent Setup stage)

**Files:**

- Create: `skills/foreman/scripts/foreman-setup.sh`
- Test: `tests/foreman-setup.bats`

- [ ] **Step 1: Write the failing test.** With a not-signed-in grok shim,
  `foreman-setup.sh --profile soft` SHALL exit non-zero, print grok NOT-READY
  with the device-code instruction, and NOT attempt a login itself.

```bash
# tests/foreman-setup.bats
setup() { load helpers; setup_tmp_repo; SHIM="$BATS_TEST_TMPDIR/bin"; mkdir -p "$SHIM"; }

@test "setup marks grok NOT-READY and refuses (no auto-login) when unsigned" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--version" ]] && { echo "grok 0.2.103"; exit 0; }
[[ "$1" == "login" ]] && { echo "SETUP-SHOULD-NOT-CALL-LOGIN" > "$BATS_TEST_TMPDIR/login-called"; exit 0; }
exit 1
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/foreman-setup.sh" --profile soft
  [ "$status" -ne 0 ]
  [[ "$output" == *"grok"*"NOT-READY"* ]]
  [[ "$output" == *"grok login --device-code"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/login-called" ]
}
```

- [ ] **Step 2: Run to verify it fails** (script does not exist).

- [ ] **Step 3: Implement `foreman-setup.sh`.** Compose: run
  `env/tool-check.sh --profile "$PROFILE"`; parse its verdict; for each
  required vendor that is `not_authenticated`, print
  `<vendor>: NOT-READY — run <auth instruction>` and set a non-zero rc; on all
  READY print `SETUP: READY`. It NEVER runs a login itself (auth is an
  operator action Setup instructs, per the spec's device-auth clause). It is
  idempotent (a pure read of state + instructions). Flags:
  `--profile soft|hard|full`, `--lane <v>` (scope readiness to one lane).

- [ ] **Step 4: Run to verify it passes;** add + run the idempotent-rerun case
  (two runs on an all-ok shim set both print READY, change nothing) under the
  mutex.

- [ ] **Step 5: Commit.**

```bash
git add skills/foreman/scripts/foreman-setup.sh tests/foreman-setup.bats
git commit -m "feat(lifecycle): foreman-setup Setup stage (idempotent, auth-gated, no auto-login)"
```

---

### Task 4: foreman-cleanup.sh (idempotent Cleanup stage)

**Files:**

- Create: `skills/foreman/scripts/foreman-cleanup.sh`
- Test: `tests/foreman-cleanup.bats`

- [ ] **Step 1: Write the failing test.** Cleanup against a run whose worktree
  has an uncommitted file SHALL archive reports and NOT delete the worktree
  (delegating to `wt-cleanup.sh`'s existing porcelain guard), and a second run
  SHALL succeed (idempotent).

```bash
# tests/foreman-cleanup.bats
setup() { load helpers; setup_tmp_repo; SCR="$BATS_TEST_DIRNAME/../skills/foreman/scripts"; }

@test "cleanup preserves a dirty worktree and archives its reports; rerun is idempotent" {
  # build a run with one worktree via wt-new, write an uncommitted file into it,
  # write a FOREMAN_REPORT.md into it:
  run bash "$SCR/wt-new.sh" clnrun implement lane-a
  WT="$(git worktree list --porcelain | grep -A0 clnrun | head -1)"  # resolve the wt path
  echo dirty > "$WT/uncommitted.txt"; echo report > "$WT/FOREMAN_REPORT.md"
  run bash "$SCR/foreman-cleanup.sh" clnrun
  [ -d "$WT" ]                                             # dirty tree NOT deleted
  [ -f "$HOME/.foreman/runs/clnrun/reports/"*"FOREMAN_REPORT.md" ] || \
    ls "$HOME/.foreman/runs/clnrun/reports/" | grep -q FOREMAN_REPORT
  run bash "$SCR/foreman-cleanup.sh" clnrun                # idempotent
  [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run to verify it fails** (script absent).

- [ ] **Step 3: Implement `foreman-cleanup.sh RUN [--force]`.** Ordered,
  idempotent teardown: (a) SIGINT any recorded lane subprocess for the run
  (best-effort, before removal); (b) `wt-cleanup.sh RUN [--force]` (which
  already archives reports + porcelain-guards — do NOT reimplement); (c) stop
  a foreman-owned `pueued` ONLY if a `~/.foreman/runs/RUN/.pueued-owned` marker
  says this run started it — NEVER a blind `pueued shutdown`; **do NOT touch
  the global `~/.foreman/gate.lock`** (it is the host-wide bats mutex; a
  concurrent gate may own it — cleanup only removes locks it can prove are its
  run's); (d) sweep stale 0-byte locks under the run dir. Every step tolerant
  of already-done state.

- [ ] **Step 4: Run to verify it passes** under the mutex.

- [ ] **Step 5: Commit.**

```bash
git add skills/foreman/scripts/foreman-cleanup.sh tests/foreman-cleanup.bats
git commit -m "feat(lifecycle): foreman-cleanup Cleanup stage (ordered, idempotent, dirty-safe)"
```

---

### Task 5: Use-path readiness gate (real enforcement, spec R1/R2)

The spec REQUIRES Use to REFUSE routing to a not-ready lane — not merely for
Setup to report it. This task wires the door-check into the dispatch path so
"agent stopped early because grok wasn't signed in mid-lane" is impossible.

**Files:**

- Modify: `skills/foreman/scripts/lane-run.sh` (a readiness assertion at the
  top of the vendor path, gated on `LANE_VENDOR`)
- Test: `tests/foreman-setup.bats` (add a gate case) or a new
  `tests/lifecycle-gate.bats`

- [ ] **Step 1: Write the failing test.** A `LANE_VENDOR=grok` lane, with a
  not-signed-in grok shim on PATH, SHALL refuse BEFORE spawning CMD, exit
  non-zero, and print a message citing Setup — with NO grok auth attempt.

```bash
@test "Use refuses a not-ready grok lane at the door, citing Setup" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--version" ]] && { echo "grok 0.2.103"; exit 0; }
echo "SHOULD-NOT-RUN" > "$BATS_TEST_TMPDIR/ran"; exit 1
EOF
  chmod +x "$SHIM/grok"
  # WT + vendor-home; CMD would write a file; assert it never runs:
  run env PATH="$SHIM:$PATH" LANE_VENDOR=grok bash "$SCR/lane-run.sh" gaterun lane-a "$WT" -- bash -c 'echo RAN > "$WT/ran"'
  [ "$status" -ne 0 ]
  [[ "$output" == *"Setup"* ]]
  [ ! -f "$WT/ran" ]; [ ! -f "$BATS_TEST_TMPDIR/ran" ]
}
```

- [ ] **Step 2: Run to verify it fails** (no gate yet — CMD runs).
- [ ] **Step 3: Implement the gate.** When `LANE_VENDOR` is set, lane-run
  SHALL, before the vendor path, run the readiness probe
  (`env/tool-check.sh --lane "$LANE_VENDOR" --profile soft` and check
  `LANE_READY: <v>=yes`, OR call `foreman-setup.sh --lane "$LANE_VENDOR"`) and,
  if not ready, print `lane-run: <vendor> lane NOT-READY — run Setup (foreman-setup)`
  and exit non-zero, WITHOUT spawning CMD and WITHOUT authenticating. Unset
  `LANE_VENDOR` = today's behavior (frozen — no gate).
- [ ] **Step 4: Run to verify it passes;** re-run `tests/lane-run.bats` (33) +
  `tests/vendor-isolation.bats` under the mutex — Expected unchanged green (the
  gate is `LANE_VENDOR`-scoped; those tests set a ready/absent vendor).
- [ ] **Step 5: Commit** `git commit -m "feat(lifecycle): Use-path readiness gate refuses not-ready lanes (R1/R2)"`.

---

### Task 6: SKILL.md adopts the three-stage operating frame

**Files:**

- Modify: `skills/foreman/SKILL.md`

- [ ] **Step 1** — Add a top-level "Operating model: Setup & Environment →
  Use → Cleanup" section: Setup owns tool-check + bootstrap + vendor auth +
  (on WSL) full provisioning and MUST report READY before Use; Use assumes an
  authenticated/provisioned env and never authenticates; Cleanup closes every
  run. State that the same three stages run on Windows and WSL.
- [ ] **Step 2** — Point at `foreman-setup.sh`/`foreman-cleanup.sh` and the
  readiness gate; cross-link `references/reference-environment.md`.
- [ ] **Step 3: docs-check.** `bash skills/foreman/scripts/docs-check.sh` —
  Expected all pass.
- [ ] **Step 4: Commit.**

```bash
git add skills/foreman/SKILL.md
git commit -m "docs(lifecycle): SKILL.md adopts Setup/Use/Cleanup as the operating frame"
```

---

### Task 7: Package acceptance proof

**Files:** (none new — a proof run)

- [ ] **Step 1** — With an all-authenticated shim set, run
  `foreman-setup.sh --profile soft` → READY; run a trivial Use action (any
  existing lane-queue/lane-run smoke) → succeeds; run `foreman-cleanup.sh RUN`
  → clean. With a not-signed-in grok shim, assert a grok Use request is
  refused citing Setup (the readiness gate). Capture as the package proof in
  the change's FOREMAN_REPORT.
- [ ] **Step 2: Full gate.** `bash tests/run.sh` under the mutex + docs-check —
  Expected green.
- [ ] **Step 3: Commit** any proof artifact; the architect (Opus) audits the
  diff.

## Self-review

- Spec coverage: R1 three stages + Use-refuses-not-ready → Tasks 3-6, and the
  Use-path ENFORCEMENT is Task 5 (a real coded gate in lane-run, per the Opus
  audit — not merely Setup-side reporting); R2 Setup owns auth (non-billing
  probe) → Tasks 0,1,3; R3 readiness verdict incl. NOT_AUTHENTICATED in
  report_text+report_json → Tasks 1-2; R4 Cleanup deterministic → Task 4; R5
  SKILL.md frame → Task 6. All covered.
- No placeholders: every task shows the failing test + the concrete edit
  target; the `<AUTH_STATUS_SUBCMD_FROM_TASK0>` tokens are resolved by Task 0's
  empirical output (not a plan placeholder — a sequenced dependency).
- Type consistency: `vendor_authed`, `LANE_READY:`, `not_authenticated`,
  `foreman-setup.sh`, `foreman-cleanup.sh` used consistently. Tests reference
  tool-check via `$BATS_TEST_DIRNAME/../env/...` ($ROOT is NOT defined in
  helpers.bash).
- Gate lock: Cleanup NEVER touches the global `~/.foreman/gate.lock` (the
  host-wide bats mutex) — audit fix.

## Acceptance

Setup owns auth and gates Use; Cleanup is deterministic + idempotent + dirty-
safe; tool-check distinguishes `not_authenticated`; SKILL.md carries the frame;
full suite + docs-check green. On ship, archive
`openspec/changes/lifecycle-three-stage/` to `openspec/changes/archive/`.
