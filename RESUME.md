# RESUME — 2026-07-29 stop point

Written for someone with no memory of the session. Every claim here is checkable
by a command given inline; if a command disagrees with this document, trust the
command and fix this file.

---

## The one thing to know

**`integrate/v029-w1` is the pickup branch.** It is on GitHub, 45 commits ahead
of `main`, and contains **all fourteen implemented packages merged clean**.
`main` has none of the code — only decisions, tooling and the devlog.

```bash
git fetch origin
git worktree add /root/fm-wt/resume integrate/v029-w1
cd /root/fm-wt/resume
git log --oneline main..HEAD | wc -l      # expect 45
```

**Verified green on that branch at the stop point:**

```bash
flock /tmp/foreman-bats.lock bats tests/line-endings.bats   # 5/5 ok
for d in openspec/changes/*/; do c=$(basename $d); [ "$c" = archive ] && continue
  /usr/local/bin/openspec validate "$c" --strict >/dev/null || echo "FAIL $c"; done
# expect: no output — 33/33 valid
```

---

## What is done

Fourteen packages have code. All are merged into `integrate/v029-w1` and each
also exists as its own branch on origin, so any one can be examined in isolation.

| Package | Branch | Head |
|---|---|---|
| crlf-extensionless-hardening | `s1/crlf-extensionless-hardening` | `9da74c5` |
| lock L1 helper | `s1/lock-L1-helper` | `94eb08d` |
| lock L2 trust plane | `s1/lock-L2-trust` | `3aebe45` |
| lock L3 callers | `s1/lock-L3-callers` | `ea59d65` |
| lock L1+L2+L3 integrated | `trial/s1-merge` | `330d52a` |
| lock L4 regression suite | `s1/lock-L4-tests` | `0669b9c` |
| test-infrastructure-hardening | `s2/test-infrastructure-hardening` | `d7b3a83` |
| formal-model-suite | `s2/formal-model-suite` | `af04a53` |
| decision-lineage-emission (S4a) | `s4/decision-lineage-emission` | `8b9b8e8` |
| lane-ownership-and-reaping | `s4/lane-ownership` | `f9c8823` |
| evidence-contracts (T1) | `s6/evidence-contracts` | `30935d8` |
| release-metrics | `s6/release-metrics` | `020071f` |
| work-dag-projection | `s7/work-dag-projection` | `ec308b3` |
| readme-refresh | `s10/readme-refresh` | `d89a790` |
| openspec conformance | `s0/openspec-conformance` | `eff1ccc` |
| terminusdb-schema | `s9/terminusdb-schema` | `e52910d` |
| graph-store-port (round 1) | `s9/graph-store-port` | `933c308` |

Decisions **D5–D13** plus a **D11 correction** are on `main` in
`docs/research/vnext/DECISIONS-resolved.md`. The day is narrated in
`devlog/2026-07-29.md`.

---

## What is NOT done — read this before doing anything

### 1. The full suite has never completed uncontended

**This is the most important open item.** The 33-file suite was started once and
I killed it, because it held the host-wide `bats` mutex and was starving a lane
that had eleven minutes of budget left. It has therefore **never run to
completion on the integrated tree.**

Do this first, with **no lanes running**:

```bash
cd /root/fm-wt/resume
flock /tmp/foreman-bats.lock bash tests/run.sh 2>&1 | tail -40
```

Until that passes, "fourteen packages merged clean" means *they merged*, not
*they work together*. Individual suites were green in their own worktrees.

### 2. crlf is BLOCKED — F2 and F3 owed

Six audits, six blocks. The sixth was caused by **my ruling, not the
implementation**: D11's exclusion pattern
`skills/superpowers/skills/*/scripts/**` silently matched
`subagent-driven-development/scripts/` — the three directly-executed scripts the
package exists to protect. F1 (narrowing to
`skills/superpowers/skills/brainstorming/scripts/**`) is **fixed and committed**
at `9da74c5`. Still owed:

- **F2** — restore D1's required non-bash `skills/superpowers/hooks/*` directory
  sweep, which round 6 dropped. It is deliberately a directory sweep and not the
  shebang property, because the hook installers package the whole directory and
  `run-hook.cmd` is a polyglot with no bash shebang.
- **F3** — add the regression that would have caught F1: assert the three
  founding SDD scripts and the four `hooks/*` entries remain **inside** the
  derived inventory. The suite proves it detects *additions* and has never proved
  it still covers its *founding case*. That is half a checker.
- **The corrected D11 obligation** — enumerate the current matches of **every**
  exclusion pattern and verify the stated reason holds for each. A wildcard
  asserts the reason is true of every sibling it captures; that has to be checked.

Full audit: `/root/fm-wt/s1-crlf/AUDIT-merge-ready.md`. Brief already written at
`/root/fm-wt/s1-crlf/REWORK.md`.

### 3. L4 covers 3 of 11 requirements

The lock regression suite is committed and all 13 of its tests pass, including
the L4-F1 fix. But its own coverage audit is honest about scope: **3 covered, 1
vacuous-only, 7 NOT covered.** It is a real regression net for the refusal chain
and mutual exclusion; it is **not** a gate for the specification. Do not treat a
green `tests/lock.bats` as S1's gate being satisfied. The gap list is in
`/root/fm-wt/s1-lock-L4/REPORT.md`.

### 4. The devlog audit never finished

`/root/fm-wt/integrate/AUDIT-devlog.md` is 15KB with `VERDICT: PENDING`. It was
an adversarial check of `devlog/2026-07-29.md` — counts, quotes, causal claims,
and specifically errors the devlog does not admit. **Re-dispatch it before the
retrospective**, because the retrospective will be built on that record and it is
self-assessment by the party being assessed.

### 5. Deferred deliberately, recorded rather than hidden

- **D5** — the Git-Bash half of the S1 gate. Durable lanes are **unavailable**,
  not degraded, on MSYS2/Git-Bash until someone commits a real syscall trace from
  a Foreman-controlled host of that class. The pinned register ships **empty on
  purpose**; fabricating a digest was refused.
- **D6** — telemetry's verdict-lineage half (4b) waits on
  `three-outcome-verdicts`.
- **No CI job runs `bats` on any platform.** `formal-model-suite` added the first
  workflow that runs *any* verification suite. `wsl-ci-parity` owns the bats gate
  and is the last stage.
- Two `bugeventlog.md` entries are parked in the session scratchpad, unwritten,
  because interactive Codex sessions held that file. One is the
  `vendor-preflight` false-negative; one is the max-turns stranding.

---

## Suggested order for tomorrow

1. **Uncontended full-suite run** on `integrate/v029-w1`. Nothing else matters
   until that is known.
2. **crlf F2 + F3.** The brief exists; it is a small round.
3. **Re-dispatch the devlog audit**, then fix whatever it finds.
4. **Merge `integrate/v029-w1` → `main`** once 1–3 are clean.
5. **Then** the retrospective: graphify the merged tree (not the branches — nine
   separate branches map a codebase that does not exist), superpowers
   brainstorming, and an audit pass over the remaining ~19 packages.

---

## Environment and traps

Read `AGENT_TRAPS.md` at the repo root **in full** before dispatching anything.
It is the consolidated list and hand-picking from it is a documented failure mode.
The entries that cost the most today:

- **Never build a heredoc inline through `bash -lc`** with prose containing
  apostrophes or backticks. It truncates and executes prose as shell. This caught
  me **four times in the file that warns about it**. Write to a file, then
  `tr -d '\r' < file > target`.
- **`pgrep -f` and `ps ... | grep` match their own command line**, and match the
  text of other agents' prompts. Check by PID with `kill -0`, or by `comm`.
- **Liveness is process STATE and CPU, never existence.** A `SIGTTIN`-suspended
  process answers `kill -0` and `pgrep` identically to a running one. Use
  `tools/lanectl.sh ps`.
- **`git update-index --chmod=+x` followed by `git add <same path>` silently
  reverts the mode.** Use `git add --chmod=+x`. Verify against the **commit**,
  not the index.
- **Vendor CLIs self-update mid-round** and can suspend themselves on `SIGTTIN`.
  Launch headless rounds with `stdin < /dev/null`.
- **Do not run a full suite while lanes are running.** It takes the host-wide
  `bats` mutex and starves them; a lane's remaining budget is scarcer than your
  verification.
- **Saturate every lane slot before ending a turn.** Caps are grok 3, codex 2.
  Nothing runs between turns — a single lane finishing means the box idles.

Lane tooling: `tools/lanectl.sh {launch|adopt|claim|ps|reap|sweep}` and
`tools/reap-stale-lanes.sh`. Ownership is by env var, PID registry **and**
directory marker, because grok re-execs and loses the first two.

---

## Standing count, honestly

**Thirteen audits, thirteen BLOCKED, zero false alarms.** Every one found a real
defect. Four of thirteen found defects introduced by the immediately preceding
fix round.

**Fourteen of 33 packages have code; none is on `main`.** The binding constraint
is round depth, not parallel width — parallelism is worth roughly 4× and cannot
compress a serial audit-rework cycle. Two of crlf's seven rounds were a failure
to generalise a finding rather than relay the instance, and the sixth block was
an architect ruling that was too broad.
