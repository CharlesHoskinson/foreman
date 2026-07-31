# REPORT — L2+L3 integration rework (round 2 continuation)

**Verdict:** F1–F4 addressed in tree. No commit (per instruction).
**Date:** 2026-07-29
**Worktree:** `/root/fm-wt/trial`
**Scope:** Finish partial prior attempt; `tests/lock.bats` out of scope (not recreated).

---

## Summary of fixes

### F1 — reclaim deletion gated on positively selected `mkdir` only

`fm_lock_reclaim` now runs `fm_lock__select_mechanism` before any delete:

| Selection | Behaviour |
|---|---|
| `flock` | `FM_LOCK_RECLAIM_REFUSED … mechanism_is_flock`; dir left |
| indeterminate / refuse | `… mechanism_indeterminate`; dir left |
| `mkdir` + dead holder | `FM_LOCK_RECLAIMED`; token + dir removed |
| live / undetermined liveness | refuse (unchanged) |

Callers (`nats-bridge`, `wt-new`, `el_init`) rely on the callee gate. Indeterminate never authorises deletion.

**Known-bad control (red):** reclaim body without the mechanism gate **deletes** a dead-owner mkdir-format dir under flock/indet conditions — observed in harness `INT-F1 known-bad control`.

**Green:** flock selection and indeterminate both refuse; mkdir+dead reclaims.

### F2 — exclusive owner token; release verifies ownership

- `fm_lock__write_owner_token` uses bash noclobber (`set -C` / exclusive create). Exit 0 = won, 2 = lost race (token unchanged), 1 = hard fail.
- Token publish runs **inside** `fm_lock__acquire_mkdir` after mkdir success; hold is recorded only after exclusive publish succeeds.
- Check-then-act loser (write rc 2) spins as contention; does not rmdir the winner’s dir.
- Hard write failure after our mkdir win tears down unproven locks (including non-file `owner` artifacts) so we never hold a lock we cannot prove we own; a valid foreign token is left in place.
- `fm_lock_release` for mkdir reads the on-disk token and removes only if pid (and starttime when known) match this process.

**Known-bad control (red):** pre-fix `mv -f` overwrite **replaces** the winner’s token — observed in harness `INT-F2 known-bad`.

**Green:** second exclusive write returns 2 with token unchanged; non-holder release leaves lock; CTA sim with non-atomic mkdir stub → B times out, no hold, A’s token intact, A releases cleanly.

### F3 — register EEXIST bound to `probe_target`

- `fm_lock__trace_valid` for mkdir **requires** a target fragment; unbound EEXIST is rejected.
- `fm_lock__pinned_verdict` requires pin `probe_target` / `probe_path` and validates the trace against it.
- `env/tool-check.sh` and `env/tool-check.ps1` validators bind the same way.
- Schema comment in `env/reference-manifest.toml` documents required `probe_target` for mkdir pins.

### F4 — existing suites migrated to trust contract

- `tests/helpers.bash`: `setup_lock_trust_fixture`, `setup_lock_untrusted_fixture`, `setup_lock_mkdir_trust_fixture` (hermetic inventory/pin; `FOREMAN_LOCK_DISABLE_LOCAL_PROBE=1`).
- `tests/eventlog.bats`, `tests/wt-new.bats`, `tests/nats-bridge.bats` call the fixtures in setup / reclaim cases.
- Reclaim cases plant dead-owner tokens and force mkdir selection where reclaim is expected.
- nats-bridge lock tests updated from legacy `PID:token` / inline-mkdir contract to shared `fm_lock_*` ownership.

`tests/lock.bats` intentionally absent (separate round).

---

## Verification (observed)

### Scratch harness (`bash scratch-lock-harness.sh`)

```
HARNESS SUMMARY pass=82 fail=0
HARNESS DONE
exit 0
```

Covers: six refusal codes, H1–H5, M1, N1–N3, L2 trust rules (T4/T5/T14 plane), reclaim contract, **INT-F1 / INT-F2 / INT-F3**, fail-injection.

**Fail-injection (non-vacuous exit):** child harness with one synthetic fail:

```
CHILD SUMMARY pass=1 fail=1
CHILD HARNESS FAILED
exit 1
```

Main harness records `PASS INT-F4 fail-injection child exits non-zero`.

### Bats (host mutex: `flock /tmp/foreman-bats.lock`)

| Suite | Result |
|---|---|
| `tests/eventlog.bats` | 35 tests: all ok (1 skip: mode-000 append ignored as root) |
| `tests/wt-new.bats` | 14 tests: all ok |
| `tests/nats-bridge.bats` | 12 tests: all ok |
| Combined eventlog+wt-new | **49 ok, exit 0** |

### Shellcheck (`shellcheck -S error`)

- `skills/foreman/scripts/lib/lock.sh` — 0 errors
- `env/tool-check.sh` — 0 errors (apostrophe in single-quoted python block fixed)

---

## Files touched (this continuation + prior partial)

| Path | Role |
|---|---|
| `skills/foreman/scripts/lib/lock.sh` | F1 reclaim gate; F2 exclusive owner + release check; F3 pin bind; local-probe disable |
| `env/tool-check.sh` / `env/tool-check.ps1` | F3 validators |
| `env/reference-manifest.toml` | `probe_target` documentation |
| `tests/helpers.bash` | hermetic lock trust fixtures |
| `tests/eventlog.bats` | F4 + reclaim owner tokens |
| `tests/wt-new.bats` | F4 trust fixture |
| `tests/nats-bridge.bats` | F4 trust + ownership migration |
| `scratch-lock-harness.sh` | full integration harness (paths fixed off `s1-lock-L2`) |
| `REPORT.md` | this file |

Not committed. Not graphify.

---

## Residual / out of scope

- **`tests/lock.bats`:** owned by a separate round; do not create.
- **Production mkdir pin register:** remains intentionally empty (Git-Bash host seed deferred; D5).
- **Ambient ptrace:** positive bats paths no longer depend on it (fixtures + `FOREMAN_LOCK_DISABLE_LOCAL_PROBE`).
