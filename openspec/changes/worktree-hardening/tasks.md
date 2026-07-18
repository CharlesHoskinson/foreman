# Tasks — worktree-hardening

Implementer: Sonnet 5 · Audit: Opus 4.8 · gate mutex on every bats run.

- [ ] **1. git-guards bootstrap** — idempotent `scripts/git-guards.sh` setting
  the repo config (maintenance.auto=false, fsmonitor, untrackedCache,
  longpaths, safe.bareRepository) + registering scheduled `git maintenance
  run`; reports applied settings; bats for idempotence + maintenance-path
  presence.
- [ ] **2. Scoped env** — wt-new/lane-run export `GIT_OPTIONAL_LOCKS=0` for
  read-only polls only and `GIT_ASK_YESNO=false` for lane git ops; assert the
  write path never carries `GIT_OPTIONAL_LOCKS=0`.
- [ ] **3. git_retry** — bounded exponential-backoff wrapper in
  `lib/worktree.sh` around shared-lock ops; bats: transient index.lock
  succeeds on retry, gives up after max.
- [ ] **4. Stale-lock sweep** — remove 0-byte locks >30s at lane start, log
  each; bats: sweeps a stale lock, spares a fresh/non-empty one.
- [ ] **5. wt-cleanup hardening** — porcelain check before delete (archive +
  refuse dirty unless --force), SIGINT subprocs before `git worktree remove`;
  existing wt-cleanup tests byte-unmodified + new dirty-refuse case.
- [ ] **6. Defender doctrine** — document repo + `*-wt-*` exclusions in
  `references/orchestration-hardening.md`.
- [ ] **7. Soak proof** — spin N concurrent worktree lanes; assert no
  stale-lock stall and no dirty-delete; capture as the package proof.
- [ ] **8. Verify** — `bash -n`; wt-*.bats + new tests under the mutex;
  `tests/run.sh`; `docs-check.sh`.

Acceptance: guard bundle in place; the stall/lock/dirty-delete classes
covered by tests or documented doctrine; concurrent-lane soak clean; suite +
docs-check green. Archive on ship.
