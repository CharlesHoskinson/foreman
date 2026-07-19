# worktree-hardening Implementation Plan (v0.2.7.5 · package 4/7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> EARS: `openspec/changes/archive/2026-07-18-worktree-hardening/specs/worktree/spec.md`.

**Goal:** Add the concurrent-worktree guard bundle (git config, scoped env,
retry wrapper, stale-lock sweep, Defender doctrine) to stop the operator's
reported stalls and git-lock failures.

**Architecture:** `lib/worktree.sh` already serializes add/remove via
`wt_with_lock` and `wt-cleanup.sh` ALREADY porcelain-checks + archives reports
(shipped v0.2.5 T6) — so those two spec requirements are largely satisfied;
this package adds the NET-NEW guards: a `git-guards.sh` config bootstrap, a
`git_retry` backoff wrapper, per-lane `GIT_OPTIONAL_LOCKS`/`GIT_ASK_YESNO`,
and a stale-lock sweep. Verify the existing wt-cleanup behavior with a test
rather than reimplementing it.

**Tech Stack:** bash, bats-core, `skills/foreman/scripts/lib/worktree.sh`,
`wt-new.sh`, `lane-run.sh`, `wt-cleanup.sh`, git config/maintenance.

## Global constraints

Strict mode + portability checklist + gate mutex per bats run. Existing
`tests/wt-*.bats` stay byte-unmodified except where a task adds a case.
`GIT_OPTIONAL_LOCKS=0` is for READ-ONLY polling only — never on commit/add.

## File structure

- Create `skills/foreman/scripts/git-guards.sh` — idempotent repo-config
  bootstrap + maintenance registration.
- Modify `skills/foreman/scripts/lib/worktree.sh` — `git_retry` + stale-lock
  sweep.
- Modify `wt-new.sh` / `lane-run.sh` — scoped `GIT_OPTIONAL_LOCKS`/`GIT_ASK_YESNO`.
- Modify `references/orchestration-hardening.md` — Defender exclusion doctrine.
- Create `tests/git-guards.bats`; extend `tests/wt-new.bats`/`wt-cleanup.bats`.

---

### Task 1: git-guards config bootstrap

- [ ] **Step 1: Write the failing test** — `git-guards.sh` run in a throwaway
  repo SHALL set `maintenance.auto=false`, `core.fsmonitor=true`,
  `core.untrackedCache=true`, `core.longpaths=true`,
  `safe.bareRepository=explicit`, be idempotent, and report applied settings.

```bash
@test "git-guards sets the concurrency-safe config idempotently" {
  setup_tmp_repo
  run bash "$SCRIPTS/git-guards.sh" "$REPO"; [ "$status" -eq 0 ]
  [ "$(git -C "$REPO" config maintenance.auto)" = "false" ]
  [ "$(git -C "$REPO" config core.longpaths)" = "true" ]
  run bash "$SCRIPTS/git-guards.sh" "$REPO"; [ "$status" -eq 0 ]   # idempotent
}
```

- [ ] **Step 2: Run to verify it fails** (script absent).
- [ ] **Step 3: Implement `git-guards.sh REPO`** — apply the five settings +
  `git maintenance register` (or, where a user scheduler is unavailable on
  Windows, register a foreman-owned maintenance tick and document it); print
  each applied setting; idempotent.
- [ ] **Step 4: Run to verify it passes;** assert a maintenance path exists
  (so disabling reactive gc doesn't leave the repo un-maintained).
- [ ] **Step 5: Commit** `git commit -m "feat(worktree): git-guards config + maintenance bootstrap"`.

---

### Task 2: git_retry backoff wrapper

- [ ] **Step 1: Write the failing test** — `git_retry` succeeds on a command
  that fails once then succeeds, and gives up after max attempts.

```bash
@test "git_retry retries a transient failure then succeeds" {
  source "$SCRIPTS/lib/worktree.sh"
  local f="$BATS_TEST_TMPDIR/n"; echo 0 > "$f"
  flaky() { local n=$(<"$f"); echo $((n+1)) > "$f"; [ "$n" -ge 1 ]; }
  run git_retry flaky; [ "$status" -eq 0 ]
}
@test "git_retry gives up after max attempts" {
  source "$SCRIPTS/lib/worktree.sh"; run git_retry false; [ "$status" -ne 0 ]
}
```

- [ ] **Step 2: Run to verify it fails** (`git_retry` undefined).
- [ ] **Step 3: Implement** `git_retry` in `lib/worktree.sh`: 5 attempts,
  backoff 200→400→800→1600→3200ms (`sleep` with a decimal; compute in ms,
  portability-checklist-safe), return the last failure's code. Wire the
  shared-lock-touching operations in `wt_with_lock`'s worktree add/remove
  through it.
- [ ] **Step 4: Run to verify it passes;** re-run `tests/wt-new.bats` under
  the mutex — unchanged green.
- [ ] **Step 5: Commit** `git commit -m "feat(worktree): git_retry backoff around shared-lock ops"`.

---

### Task 3: stale-lock sweep at lane start

- [ ] **Step 1: Write the failing test** — a sweep removes a 0-byte
  `index.lock` older than the threshold and SPARES a fresh / non-empty one.

```bash
@test "stale-lock sweep removes an aged 0-byte lock, spares a fresh/nonempty one" {
  setup_tmp_repo
  : > "$REPO/.git/index.lock"; touch -d '2 minutes ago' "$REPO/.git/index.lock"
  echo held > "$REPO/.git/other.lock"    # non-empty -> spared
  source "$SCRIPTS/lib/worktree.sh"; run wt_sweep_stale_locks "$REPO"
  [ ! -f "$REPO/.git/index.lock" ]; [ -f "$REPO/.git/other.lock" ]
}
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** `wt_sweep_stale_locks REPO` — remove only 0-byte
  `*.lock` older than ~30s (mtime), log each; call it at lane start in
  `lane-run.sh`/`wt-new.sh`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "feat(worktree): stale-lock sweep at lane start"`.

---

### Task 4: scoped GIT_OPTIONAL_LOCKS / GIT_ASK_YESNO

- [ ] **Step 1: Write the failing test** — a lane's read-only git poll carries
  `GIT_OPTIONAL_LOCKS=0`, and lane git ops carry `GIT_ASK_YESNO=false`, while a
  commit/add path does NOT carry `GIT_OPTIONAL_LOCKS=0` (assert via a git shim
  that records the env).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the scoped exports in `wt-new.sh`/`lane-run.sh`
  (poll helper sets `GIT_OPTIONAL_LOCKS=0`; lane env sets `GIT_ASK_YESNO=false`;
  the write path is left without `GIT_OPTIONAL_LOCKS`).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "feat(worktree): scope GIT_OPTIONAL_LOCKS/GIT_ASK_YESNO per lane"`.

---

### Task 5: SIGINT-before-remove (net-new) + guard existing wt-cleanup + Defender

Audit finding: the porcelain-refuse + report-archive halves ALREADY ship
(`wt-cleanup.sh:63-76` archive, `:105-110` dirty-refuse — the archiver's own
comment dates the data-loss to 2026-07-17). But the spec's SIGINT-before-
`git worktree remove` clause is NOT yet in wt-cleanup (`:112-117` removes with
no subprocess SIGINT — the kill logic lives in lane-run, a different layer).
This task IMPLEMENTS that clause and GUARDS the already-shipped halves.

**Files:** Modify `skills/foreman/scripts/wt-cleanup.sh`; test `tests/wt-cleanup.bats`.

- [ ] **Step 1: Write the failing test** — a worktree with a recorded live
  lane subprocess (a `sleep 300` whose pid is stored where wt-cleanup can find
  it) is SIGINT'd BEFORE `git worktree remove` runs (assert the pid is gone by
  the time remove is attempted; assert removal then succeeds).
- [ ] **Step 2: Run to verify it fails** (no SIGINT step exists yet).
- [ ] **Step 3: Implement** a SIGINT-of-recorded-subprocess step in
  `wt-cleanup.sh` immediately BEFORE the `git worktree remove` call (~:112),
  best-effort/bounded, reading the pid from the worktree's ownership/lock
  record. Order is load-bearing: SIGINT then remove, never the reverse.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5** — Add a regression test asserting the ALREADY-shipped
  behavior (dirty-refuse without `--force` + report-archive) — guard, do NOT
  reimplement. Document Windows Defender path exclusions for the repo + all
  sibling `*-wt-*` dirs in `references/orchestration-hardening.md`.
- [ ] **Step 6: docs-check + Commit** `git commit -m "feat(worktree): SIGINT lane subprocess before worktree remove; guard existing cleanup + Defender doctrine"`.

---

### Task 6: concurrent-lane soak proof

- [ ] **Step 1** — Spin N concurrent worktree lanes; assert no stale-lock
  stall and no dirty-delete; capture as the package proof (FOREMAN_REPORT).
- [ ] **Step 2: Full gate** `bash tests/run.sh` under the mutex + docs-check.
- [ ] **Step 3: Commit** the proof.

## Self-review

- Coverage: R(repo config)→T1; R(retry)→T2; R(stale sweep)→T3; R(scoped
  env)→T4; R(wt-cleanup) BOTH clauses→T5 — porcelain+archive already-shipped
  (guarded), SIGINT-before-remove IMPLEMENTED net-new (audit fix); R(Defender)
  →T5. All covered.
- No reimplementation of the shipped porcelain/archive logic (T5 Step 5 guards
  it); the SIGINT-ordering half was genuinely absent and is added (T5 Steps 1-4).
- `git maintenance register` risk: on Windows Git-Bash there may be no user
  scheduler — T1 Step 3 falls back to a foreman-owned maintenance tick
  (specify the tick mechanism during implementation; document it).
- Names: `git-guards.sh`, `git_retry`, `wt_sweep_stale_locks` consistent.

## Acceptance

Guard bundle in place; stall/lock/dirty-delete classes covered by tests or
doctrine; concurrent soak clean; suite + docs-check green. Archive on ship.
