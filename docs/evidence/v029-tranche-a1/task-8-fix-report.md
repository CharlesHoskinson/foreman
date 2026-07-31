# Task 8 fix: the lock.bats guard, and triage of three unexplained failures

Worktree: `/root/fm-wt/integrate`. Branch: `integrate/v029-w1`.
Commit: `093ca291ac2096a8afb22af8bfdd154966ef3dfd`.

---

## 1. What the guard actually did

The test lived at `tests/lock.bats` line 465. It was the last block in the file.
This is the exact text before the fix:

```bash
@test "operational scripts never use pkill -f pattern matching" {
  run find "$SCRIPTS" -type f -name '*.sh' -print
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -gt 0 ]
  run rg -n 'pkill[[:space:]]+-f([[:space:]]|$)' "$SCRIPTS" --glob '*.sh'
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}
```

`$SCRIPTS` comes from `setup()` at line 7:

```bash
SCRIPTS="${FM_LOCK_TEST_SCRIPTS:-$BATS_TEST_DIRNAME/../skills/foreman/scripts}"
```

Facts about the real shape, which differ from the brief's description:

- The guard covers **one** pattern, not two. It searches for `pkill -f` only.
  It does **not** search for `pgrep -f`. I preserved that scope exactly.
- The search domain is `skills/foreman/scripts/**/*.sh`. It is not the whole
  codebase.
- The first two assertions are a self-check. They prove the search domain is
  not empty, so a silently empty scan cannot pass.
- The predicate is `rg` exit status 1 plus empty output. `rg` exits 1 when it
  finds nothing.

The offending text is `skills/foreman/scripts/audit-run.sh` line 123:

```
# pkill -f here, because it matches other agents' command lines.
```

That line is the tail of a comment on `ar_reap_watchdog()` that tells developers
to kill by exact PID and never to use pattern matching. The comment is correct.
It stays.

Evidence of the false positive, run on the tree before the fix:

```
$ rg -n "pkill[[:space:]]+-f([[:space:]]|$)" skills/foreman/scripts --glob "*.sh"
skills/foreman/scripts/audit-run.sh:123:# pkill -f here, because it matches other agents' command lines.
old_rg_exit=0
```

The predicate is a bare substring match. The claim is that no script *invokes* a
pattern-matching kill. A comment that names the prohibition is not an
invocation, so the predicate does not bind to the claim.

### A related finding, not fixed

`skills/foreman/scripts/lib/liveness.sh` line 68 contains a real, live
invocation:

```bash
lv_pgrep_exists() {
  pgrep -f "$1" >/dev/null 2>&1
}
```

Its own doc comment says it is "the DEFECT under test", kept so tests can prove
a pgrep-style check would have lied. The guard has never covered `pgrep`, so
this is not a regression and it is out of scope for this task. It is recorded
here because anyone who later widens the guard to `pgrep -f` will trip on it and
must decide whether that helper is an intended carve-out.

---

## 2. The fix

`tests/lock.bats`, replacing the block above:

```bash
# @description Report every line of a shell file that invokes a pattern-matching
#   kill. The comment is stripped from each line first, so a comment that names
#   the pattern does not count. A "#" starts a comment only at the start of a
#   word, so "${#array[@]}" survives the strip and is still scanned.
# @arg $@ shell files to scan
# @stdout "path:line: text" for each invocation found
scan_pattern_kill_invocations() {
  awk '
    {
      code = $0
      sub(/(^|[[:space:]])#.*$/, "", code)
      if (code ~ /pkill[[:space:]]+-f([[:space:]]|$)/) {
        printf "%s:%d: %s\n", FILENAME, FNR, $0
      }
    }
  ' "$@"
}

@test "operational scripts never invoke pkill -f pattern matching" {
  local script_files=()
  mapfile -t script_files < <(find "$SCRIPTS" -type f -name '*.sh' -print | sort)
  [ "${#script_files[@]}" -gt 0 ]
  run scan_pattern_kill_invocations "${script_files[@]}"
  [ "$status" -eq 0 ]
  if [ -n "$output" ]; then
    printf 'pattern-matching kill invoked at:\n%s\n' "$output" >&3
  fi
  [ -z "$output" ]
}
```

Design notes:

- The search pattern itself is byte-identical to the old one. Only the text it
  is applied to changed. Coverage is therefore unchanged. A wrapped invocation
  such as `xargs pkill -f ...` or `sudo pkill -f ...` still fires, which a
  command-position regex would have lost.
- The comment strip is `(^|[[:space:]])#.*$`. A number sign only opens a comment
  at the start of a word. `${#array[@]}` is preceded by `{`, so it survives the
  strip and the code around it is still scanned.
- The non-empty file-list assertion is kept, so an empty scan still fails.
- On failure the guard now prints the file, the line number, and the source
  line. The old form printed nothing useful.
- `shellcheck --severity=error --shell=bash tests/lock.bats` exits 0.

Known limit, stated plainly: a real invocation on the same physical line as an
earlier quoted number sign, for example `echo " #" ; pkill -f x`, is not
detected. That shape does not occur in the tree and would be strange shell.

### Proof 1 — the guard fires on a real invocation

I copied `skills/foreman/scripts` to `/root/fm-proof/scripts-neg` and added one
file, `zz-proof-probe.sh`, holding a real invocation:

```bash
reap_the_lane() {
  local pattern="$1"
  pkill -f "$pattern"
}
```

Then I pointed the guard at that tree with the existing `FM_LOCK_TEST_SCRIPTS`
seam:

```
### PROOF B: guard on a tree with a real pkill -f invocation
1..1
pattern-matching kill invoked at:
/root/fm-proof/scripts-neg/zz-proof-probe.sh:7:   pkill -f "$pattern"
not ok 1 operational scripts never invoke pkill -f pattern matching
# (in test file tests/lock.bats, line 492)
#   `[ -z "$output" ]' failed
proofB_exit=1
```

The guard fails and names the file and line. The scratch tree is deleted.

### Proof 2 — the guard passes on comments

Two runs. The first used a copy of the real tree, which carries the
`audit-run.sh` warning comment:

```
### PROOF A: guard on the real repo (comment present, no invocation)
1..1
ok 1 operational scripts never invoke pkill -f pattern matching
proofA_exit=0
```

The second added `zz-comment-probe.sh` to the same tree, holding all three
shapes at once: a leading comment, a trailing comment, and an array-length
expansion.

```bash
# Case 1, leading comment: never use pkill -f here.
...
  kill -KILL "$pattern"   # do not replace this with pkill -f "$pattern"
...
  printf '%s\n' "${#lanes[@]}"
```

```
### PROOF A2: leading comment + trailing comment + ${#array[@]} all present
1..1
ok 1 operational scripts never invoke pkill -f pattern matching
proofA2_exit=0
```

The scratch tree is deleted.

---

## 3. `tests/lock.bats` after the fix

Run under `flock /tmp/foreman-bats.lock`:

```
=== tests/lock.bats ===
1..13
ok 1 occupancy: eight release-contending acquirers strictly alternate ENTER and EXIT
ok 2 trusted flock acquisition creates no lock directory and releases the held lock
ok 3 temporary pinned manifest makes mkdir fallback reachable and cleans success and error paths
ok 4 unpinned Git-Bash host refuses with class consequence and pinning route
ok 5 trusted non-atomic mkdir with no flock refuses as no atomic primitive
ok 6 uncovered filesystem refuses before acquisition and names its class
ok 7 trusted but unusable lock path refuses with operation detail
ok 8 timeout on an engaged trusted mechanism refuses without touching protected data
ok 9 nested acquisition refuses while outer lock remains held and releasable
ok 10 sequence and attempt locks are independent across processes
ok 11 owner-aware reclaim removes only the named dead-holder mkdir lock
ok 12 owner-aware reclaim refuses a live holder and leaves its lock intact
ok 13 operational scripts never invoke pkill -f pattern matching
SLICE tests/lock.bats platform=wsl pass=13 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=13 delta=0 test=PASS budget_verdict=PASS baseline_verdict=PASS

TOTAL pass=13 fail=0 skip=0 tests=13 bare_skip=0 platform=wsl
RESULT PASS mode=shadow
```

Pass count is **13**. The registered baseline in `tests/baseline.tsv` is 13.
`delta=0`, so `tests/baseline.tsv` needed **no change** and was not touched.

---

## 4. Triage of the three unexplained failures

All three pass in isolation. All three failed in the full suite. The cause is
not concurrency. It is the **process environment** the suite ran under.

### The mechanism, established by direct reproduction

Two facts about the product code, both predating this plan:

1. `skills/foreman/scripts/lane-run.sh` line 123 sources the host env file:

   ```bash
   if [[ -r "${HOME}/.foreman/env.sh" ]]; then
     . "${HOME}/.foreman/env.sh" || true
   fi
   ```

   `/root/.foreman/env.sh` **prepends** `/usr/local/bin` and `$HOME/.local/bin`
   to the front of `PATH`, but only when they are not already present. It was
   written on 2026-07-30 at 11:21.

2. `lane-run.sh` line 384 runs the real host prober for the Use-path readiness
   gate:

   ```bash
   lane_ready_report="$(bash "$lane_repo_root/env/tool-check.sh" --profile soft --lane "$LANE_VENDOR" 2>&1)" || true
   if [[ "$lane_ready_report" != *"LANE_READY: ${LANE_VENDOR}=yes"* ]]; then
     echo "lane-run: $LANE_VENDOR lane NOT-READY -- run Setup (foreman-setup) before Use" >&2
     exit "$EXIT_CONFIG"
   fi
   ```

   `env/tool-check.sh` resolves the vendor CLI on `PATH` and runs a real auth
   probe: `timeout 10 grok models` for grok, `claude auth status` for claude.
   There is no test seam.

The suite ran under `systemd-run`, whose default `PATH` is
`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin`. It has no
`/root/.local/bin`. My isolation runs used a login shell whose `PATH` already
starts with `/root/.local/bin`. That single difference flips all three tests.

Reproduction, run directly:

```
### A) suite-like env (systemd default PATH, non-login):
grok=/root/.local/bin/grok
claude=NOTFOUND
PATHHEAD=/root/.local/bin

### B) my isolation env (login PATH):
grok=/tmp/fmshim/grok
claude=/run/user/0/fnm_multishells/1032698_1785530550758/bin/claude
```

Both runs start from `PATH=/tmp/fmshim:$PATH`, where `/tmp/fmshim` stands in for
the test's shim directory, then source `/root/.foreman/env.sh`.

- In A the env file prepends `/root/.local/bin` **ahead of the shim**, so the
  real, authenticated grok wins.
- In A `claude` is not found at all. On this host `claude` resolves only through
  an `fnm` multishell directory that the login profile creates. A non-login
  shell has no such directory.

### `tests/grok-lane.bats` test 11

Verdict: **environment-sensitive test defect. Not a product defect. Predates
this plan.**

Isolation run:

```
=== tests/grok-lane.bats ===
1..11
... ok 1 .. ok 10 ...
ok 11 grok Use route is refused citing Setup when unauthenticated -- no mid-lane auth attempt
SLICE tests/grok-lane.bats platform=wsl pass=11 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=11 delta=0 test=PASS baseline_verdict=PASS
```

Suite failure, `/root/fm-logs/suite-a2.log` line 204:

```
not ok 11 grok Use route is refused citing Setup when unauthenticated -- no mid-lane auth attempt
# (in test file tests/grok-lane.bats, line 317)
#   `[ "$status" -ne 0 ]' failed
```

The test installs a grok shim that prints `You are not authenticated.` and puts
it on `PATH`. The gate must refuse. Under the suite `PATH`, the env file
prepended `/root/.local/bin` ahead of the shim, so `tool-check.sh` probed the
real authenticated grok, reported `LANE_READY: grok=yes`, and the lane was let
through with exit status 0. The assertion is the inverse of what happened.

Blame: env-file sourcing is `a0e809d` 2026-07-30; the readiness gate is
`a432037` 2026-07-18. Both predate every commit of this plan. No commit of this
plan touches `lane-run.sh`, `env/tool-check.sh`, or the test file.

### `tests/lifecycle-gate.bats` test 1

Verdict: **same root cause as grok-lane test 11. Environment-sensitive test
defect. Not a product defect. Predates this plan.**

Isolation run:

```
=== tests/lifecycle-gate.bats ===
1..3
ok 1 Use refuses a not-ready grok lane at the door, citing Setup
ok 2 Use allows a ready grok lane through the door (CMD spawns normally)
ok 3 Use with LANE_VENDOR unset is the frozen path -- no gate, CMD runs unconditionally
SLICE tests/lifecycle-gate.bats platform=wsl pass=3 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=3 delta=0 test=PASS baseline_verdict=PASS
```

Suite failure, `/root/fm-logs/suite-a2.log` line 331:

```
not ok 1 Use refuses a not-ready grok lane at the door, citing Setup
# (in test file tests/lifecycle-gate.bats, line 57)
#   `[ "$status" -ne 0 ]' failed
```

Same assertion, same shim strategy, same shadowing. This test uses
`run env PATH="$SHIM:$PATH" ...` rather than `export PATH`, but the env file
runs inside `lane-run.sh` and prepends in front of either form.

### `tests/vendor-isolation.bats` test 7

Verdict: **environment-sensitive test defect, different arm of the same gate.
Not a product defect. Predates this plan.**

Isolation run:

```
=== tests/vendor-isolation.bats ===
1..10
... ok 6 ...
ok 7 lane-run (LANE_VENDOR=claude, fake launcher shim): CLAUDE_CONFIG_DIR exported, normalized (third vendor mapping)
ok 8 ...
ok 9 ... # skip cygpath unavailable ...
ok 10 ... # skip compiled exe not found ...
SLICE tests/vendor-isolation.bats platform=wsl pass=8 fail=0 skip=2 bare_skip=0 budget=2 slack=0 baseline=8 delta=0 test=PASS baseline_verdict=PASS
```

Suite failure, `/root/fm-logs/suite-a2.log` line 567:

```
not ok 7 lane-run (LANE_VENDOR=claude, fake launcher shim): CLAUDE_CONFIG_DIR exported, normalized (third vendor mapping)
# (in test file tests/vendor-isolation.bats, line 240)
#   `[ "$status" -eq 0 ]' failed
```

The failure is the inverse of the other two. Here the lane had to proceed and it
refused. The test installs a fake **launcher** shim, but installs **no claude
shim at all**. The readiness gate therefore probed the real host. Under the
suite `PATH`, `claude` was not resolvable, `tool-check.sh` recorded the row as
`missing`, emitted `LANE_READY: claude=no`, and `lane-run.sh` exited
`EXIT_CONFIG` before spawning CMD.

Blame: the readiness gate is `a432037` 2026-07-18. No commit of this plan
touches `lane-run.sh` or the test file.

### Not caused by this plan

Stated explicitly, since the brief asked for a loud answer if it were. The
plan's commits are `531d760`, `a16b352`, `ca56916`, `f93e549`, `f5ade57`,
`fcad89f`, `340b482`, all dated 2026-07-31. None touches `lane-run.sh`,
`env/tool-check.sh`, `tests/grok-lane.bats`, `tests/lifecycle-gate.bats`, or
`tests/vendor-isolation.bats`. The two mechanisms are dated 2026-07-30 and
2026-07-18.

### None of them were fixed

Per the brief, all three are left failing under a suite-like environment. They
are recorded as obligations for a later plan. The shape of that later work,
noted but not done:

- Give the Use-path readiness gate a test seam, so no test depends on real host
  vendor authentication.
- Decide whether `lane-run.sh` should prepend or append the env file's `PATH`
  entries. A prepend silently overrides any caller's own `PATH`, which is what
  broke the shims. This is a product design question, not only a test question.
- Make the suite runner's environment explicit, so a login shell and
  `systemd-run` do not produce different verdicts.

---

## 5. Obligations recorded

Recorded with `python3 skills/foreman/scripts/fm-session.py obligation "<statement>"`.
No SQL was written against the store. No row was deleted.

| ID | Subject |
| --- | --- |
| 30 | `tests/grok-lane.bats` test 11 |
| 31 | `tests/lifecycle-gate.bats` test 1 |
| 32 | `tests/vendor-isolation.bats` test 7 |

Each statement carries the isolation result, the suite log line and assertion,
the reproduced mechanism, the blame commits, and the scope note. All three
appear in `fm-session.py project` output as `Finding` nodes.

---

## 6. Commit

```
093ca291ac2096a8afb22af8bfdd154966ef3dfd  Charles Hoskinson <charles.hoskinson@gmail.com>
fix(tests): bind the pkill guard to invocations, not to the text
```

One file changed, `tests/lock.bats`, 26 insertions, 5 deletions. Mode stays
`100644`, unchanged. No CR bytes: `grep -qU -P "\r" tests/lock.bats` finds none.
No `Co-Authored-By` trailer. The working tree is clean.

---

## 7. What I could not verify

- I did not rerun the full suite. The brief forbids it. So the claim that the
  suite now reaches 487 passes is a **projection** from the per-file run, not a
  measurement. What is measured is `tests/lock.bats` at 13 of 13 in isolation.
- I did not reproduce the three failures by rerunning them under `systemd-run`.
  The mechanism is proven at the `PATH` level, not end to end through bats. What
  would settle it: run those three files under
  `systemd-run --setenv=HOME=/root ... /bin/bash tests/run.sh <file>` and check
  that the same three tests fail with the same assertions. That is a cheap
  three-file run, not a full suite, and I recommend it as the first step of the
  follow-up plan.
- The `pgrep -f` call in `lib/liveness.sh` is a live invocation that no guard
  covers. I did not decide whether that is intended. Its own comment says it is
  a defect kept deliberately for a test, which reads as intended, but nothing
  enforces that reading.
- `/root/.foreman/env.sh` has mtime 2026-07-30 11:21. The pre-plan logs that
  showed these three tests passing are dated 2026-07-30. I could not determine
  whether those runs happened before or after that file was written, so I cannot
  say whether the env-file prepend was already latent in them or absent.
