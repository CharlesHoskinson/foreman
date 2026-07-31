# AUDIT — 2026-07-30 — first completed full-suite run on `integrate/v029-w1`

Branch `integrate/v029-w1` @ `4aa5864`, worktree `/root/fm-wt/integrate`, clean tree,
47 commits ahead of `main`. Host: WSL, running as root. No lanes running (verified
`tools/lanectl.sh ps` empty) — the run was genuinely uncontended.

Every claim below carries the command that produced it.

---

## 1. The headline: the suite completes, and it FAILS

RESUME's item 1 said the 33-file suite had never run to completion. It has now.

```bash
cd /root/fm-wt/integrate
flock /tmp/foreman-bats.lock bash tests/run.sh      # log: /root/fm-logs/fullsuite-0730.log
```

```
TOTAL pass=434 fail=6 skip=15 tests=455 bare_skip=0 platform=wsl
RESULT FAIL test_failures=6
```

41 `.bats` files, not 33. Zero bare skips. **"Merged clean" did not mean "they work
together" — six tests fail on the integrated tree.**

## 2. The six failures

```bash
awk '/^=== tests/{f=$2} /^not ok/{print f"  ->  "$0}' /root/fm-logs/fullsuite-0730.log
```

| # | File | Test | Triage |
|---|---|---|---|
| 1 | `lane-queue.bats` | 7 — Windows dialect (`.exe` pueue binary) | **Hermeticity defect — see §3** |
| 2 | `lane-run.bats` | 17 — kill_cmd_bounded: clean TERM + vacuous real sweep emits zero alerts | Real; `slow`-tagged; `[ -z "$output" ]` failed |
| 3 | `vendor-isolation.bats` | 9 — backslashed `LANE_CONFIG_DIR` (`C:\x\y`) normalizes | Windows path form; likely same class as #1 |
| 4 | `watch.bats` | 58 — ownership ~10 fake-seconds after latch lands in v2 not v1 | Real; expected `RUNNING_IMPL`, absent |
| 5 | `worker-run.bats` | 5 — real Docker hardened run, firewall default-deny | **Real. Docker IS running** (`docker info` ok); fails `[ "$output" = ok ] # HOME writable` |
| 6 | `wt-cleanup.bats` | 6 — tree-sweep against resolved winpid (Windows `//T` path) | Windows-only; likely same class as #1 |

Failures 2, 4, 5 are not explained by platform and need real triage. 5 is notable
because Docker is present and running, so it is not an environment skip.

## 3. `lane-queue.bats` test 7 escapes its own shim (evidence-backed)

The test asserts Windows-dialect quoting by putting a fake `pueue.exe` on PATH.
`lq_pueue_bin` (skills/foreman/scripts/lane-queue.sh:163) resolves with
`command -v pueue`. On Git Bash, MSYS PATHEXT resolution makes that find
`pueue.exe` — the script header at lines 75-85 documents exactly this reliance.

**There is no such resolution on POSIX.** Demonstrated:

```bash
d=$(mktemp -d); printf '#!/usr/bin/env bash\nexit 0\n' > "$d/pueue.exe"; chmod +x "$d/pueue.exe"
PATH="$d:$PATH" bash -c 'command -v pueue'
# -> /usr/local/bin/pueue      (the REAL binary; shim never invoked)
```

A real pueue 4.0.4 is installed here (`/usr/local/bin/pueue ->
/root/.foreman/tools/pueue/pueue`). So on any POSIX host the test drives the
**real** pueue client, fails its first assertion, and never exercises the
Windows dialect it exists to test.

This falsifies the hermeticity claim written into the test's own teardown
comment (Rework Round 1, F2): *"they never talk to the real binary at all —
PATH_WITH_SHIM/PATH_WITH_EXE_SHIM make `command -v pueue` resolve to a fake
client first."* True for `PATH_WITH_SHIM` (file named `pueue`), **false for
`PATH_WITH_EXE_SHIM`** on POSIX. Blast radius: the file's teardown has logic to
shut down a real staged daemon.

Fix direction: skip-guard test 7 on non-MSYS hosts, or resolve the client
through an injectable hook rather than ambient `command -v`.

## 4. The test-policy layer has never been calibrated for WSL

```bash
for f in tests/*.bats; do grep -q "^$f\t" tests/baseline.tsv || echo "UNREGISTERED $f"; done
```

**8 of 41 files are registered in neither `tests/baseline.tsv` nor
`tests/skip-budget.tsv`**: `decision-events`, `evidence`, `graph-project`,
`line-endings`, `lock`, `readme-structure`, `release-metrics`, `telemetry`.
Baseline has 33 rows — that is where RESUME's "33-file suite" number comes from.
Every one of the 8 is a file added by a v0.2.9 package; each produces
`baseline=MISSING budget=MISSING` and a policy ERROR.

Separately, committed baselines are unachievable on this platform. All 15 skips
are legitimate and reasoned (no bare skips), but `platform=wsl` budgets are 0:

| Reason | Count |
|---|---|
| compiled `foreman-launch.exe` not built (Windows binary) | 13 |
| `cygpath` not available | 1 |
| filesystem ignores mode 000 for writer (running as root) | 1 |

`launcher.bats` is the clearest case: `pass=4 baseline=14`, 10 skips against a
budget of 0. That baseline was recorded on Windows.

**Why this matters:** `tests/run.sh` defaults `TEST_GATE_MODE=shadow`, so these
are `RESULT SHADOW ... exit=0` today. RESUME names `wsl-ci-parity` as the last
stage and the owner of the bats gate. The moment that stage sets
`TEST_GATE_MODE=enforce`, the suite fails on the project's own primary dev
platform — for policy reasons, on top of the six genuine failures.

## 5. Static analysis — clean

```bash
shellcheck -S warning -f gcc skills/foreman/scripts/*.sh skills/foreman/scripts/lib/*.sh tools/*.sh
```

8 warnings across ~13k lines of shell. Six are `SC2034` (unused vars, all
deliberate exports/sentinels), one `SC2155`. One worth a cheap hardening:

- `skills/foreman/scripts/resume.sh:178` — `SC2115` on `rm -rf "${worktree}/${path}"`.
  Mitigated in practice: `$path` empty is skipped, and `$worktree` is validated as a
  real git worktree upfront (resume.sh:235) so it cannot be empty. Still worth
  `${worktree:?}` as belt-and-braces on a recursive delete.

## 6. OpenSpec — independently confirmed

```bash
for d in openspec/changes/*/; do c=$(basename $d); [ "$c" = archive ] && continue
  /usr/local/bin/openspec validate "$c" --strict >/dev/null || echo "FAIL $c"; done
```

33 packages, 0 invalid. RESUME's claim holds. (Used `/usr/local/bin/openspec`,
never `npx openspec` — per AGENT_TRAPS.)

## 7. Code read: `lib/lock.sh` is sound

Read in full (1631 lines). The mkdir acquisition protocol is stronger than the
audit history suggests:

- Winning `mkdir` is explicitly **not** treated as ownership. The exclusive
  `owner` create under `set -C` (noclobber, O_EXCL) identifies the single winner;
  a check-then-act loser treats it as contention and spins rather than rmdir'ing
  the winner's directory.
- A token-write hard failure tears the directory down rather than holding a lock
  it cannot prove it owns.
- `fm_lock_release` clears hold state before unlocking (no double-release) and
  verifies pid **and** `/proc` starttime before deleting, so PID reuse cannot
  make one process release another's lock.
- `fm_lock__holder_liveness` fails closed to `undetermined` whenever identity
  cannot be proven.

I chased one hypothesis — that a missing owner token at release time falls
through to an unconditional `rmdir` — and **it does not hold**: `_FM_LOCK_HELD_PATH`
is set only after a successful token write, and `fm_lock_reclaim` refuses unless
the holder is provably dead. Recording it as checked-and-refuted so it is not
re-investigated.

Caveat unchanged from RESUME item 3: `tests/lock.bats` covers 3 of 11
requirements. The code reads sound; it is not comprehensively gated.

---

## Recommended order from here

1. **Triage failures 2, 4, 5** — the three not explained by platform. #5 first: Docker
   is running, so it is a true red.
2. **Skip-guard or fix 1, 3, 6** — Windows-coupled tests must skip on POSIX, not fail.
   #1 additionally needs its hermeticity restored.
3. **Register the 8 missing files** in `baseline.tsv` + `skip-budget.tsv`, and
   recalibrate `platform=wsl` budgets from this run's actual numbers.
4. Only then crlf F2/F3, the devlog audit re-dispatch, and the merge to `main`.

Item 3 is a prerequisite for `wsl-ci-parity` being able to enforce anything.
