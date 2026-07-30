# AGENT_TRAPS.md — read this in full before doing anything

Consolidated from `devlog/2026-07-28.md` §3/§4/§6, `docs/research/vnext/
START-HERE.md`, and `bugeventlog.md`. Every agent dispatched into this repo
reads this file **in full** as its first action. Do not skim for what looks
relevant to your task — the traps that bite are the ones nobody predicted.

Keep this current: when a new friction event lands in `bugeventlog.md`, add it
here.

---

## 1. Environment traps

| Trap | What to do |
|---|---|
| Inline heredoc through `bash -lc` with prose containing apostrophes or backticks | The outer quotes eat them: content truncates mid-sentence and prose executes as shell commands. Write the file to `/tmp` from a real file, then `tr -d '\r' < /tmp/f > target`. Cost four incidents in one session. |
| `Write`/`Edit` tools on `/root/...` paths | They resolve against **Windows**, not WSL, silently creating phantom files. Use WSL redirection instead. |
| Any leading-slash argument passed through Git Bash | MSYS path-converts it — `wsl -e bash /root/x.sh` becomes `C:/Program Files/Git/root/x.sh`. This applies to **every** leading-slash argv, not just `/mnt/...`. Use `wsl -e bash -lc "cd /root/dir && exec bash script"` (path embedded mid-string), or `MSYS_NO_PATHCONV=1`. |
| `npx openspec` | Resolves to a broken 0.0.0 stub; the global `.bin` symlink is missing. Use `/usr/local/bin/openspec`. This fooled three audit agents. |
| Two divergent foreman checkouts | `/root/foreman` (WSL) is live; `C:\Users\charl\foreman` (Windows) is stale. Work done in one never reaches the other. |
| Live sessions in `/root/foreman` | Interactive `codex` sessions run there and append to `bugeventlog.md` mid-session. Never `git add -A` in the main checkout. Work in your assigned worktree only. |
| The 33/41 filemode changes in `git status` | Deliberate, not dirt. They belong to `crlf-extensionless-hardening` and must not ride along in an unrelated commit. |
| `foreman-setup.sh` / `tool-check.sh` vendor auth | Known false negative: reports `grok: not_authenticated` while `grok -p` answers fine. Verify a vendor directly before believing the checker. |

## 2. Checker soundness — the core failure class of this release

**Twelve checkers in a single day returned a confident wrong answer, from at
least five different actors. Not one was caught by the check itself** — every
one was caught by cross-checking an independent result.

| What it claimed | What was true |
|---|---|
| `grep -q "violation"` → every Quint run failed, including controls | Quint prints `[ok] No violation found` on success; the grep matched the **success** string. Anchor on `^\[violation\]`. |
| An invariant holds → non-termination refuted | The counter it constrains never advances in that failure. **Vacuously true in exactly the scenario it was meant to detect.** |
| `codex exec` exited 0, "report ready for its required final write" | Wrote nothing. It ran its own existence check, saw the file absent, and stopped. |
| `grok-multiround.sh` → `EMPTY-BURST FAILED after 3 rounds` | All four files were written and valid. |
| `git status --porcelain` digest → lane wrote nothing | Porcelain collapses an untracked directory to **one line** — blind to every file after the first, and to content edits in untracked files. Use `-uall` plus a content hash. |
| "The architect verified this live: 5/5" | The artifact on disk recorded the **pre-fix** 4-check run whose check 2 said the opposite. |
| `"directed": true` gate → parallel typed edges survive | `build_from_json(directed=True)` returns `DiGraph`, not a multigraph: one of two edges silently discarded, **gate green**. |
| Contention table → `config/foreman.toml` most contended | That path does not exist. The regex lacked a boundary and matched the prefix of `config/foreman.toml.example`. |
| A guard to catch that → 37 "regex artifacts" | Nearly all were deliverables the packages *create*. Existence does not discriminate the property; suffix-extensibility does. |
| A criterion satisfiable | By **never instrumenting at all**. Three sibling criteria were zero-denominator live passes. |
| A 15-minute rebuild bound | ~176× the measured 5.1 s. Could not fire at any realistic corpus size. |
| `syscall` evidence required of `flock` | Defined as "the create returning `EEXIST`". `flock` creates nothing — faithful implementation refuses **every** acquisition on WSL and Linux. |

## 3. Standing rules — these override your defaults

1. **A success predicate binds to an artifact and its content** — never an exit
   code, a substring match, or an agent's own account of its state.
2. **Every checker must be demonstrated to FAIL against a known-bad input
   before it is trusted.** A check never observed failing is not evidence.
3. **An invariant that holds vacuously is reported as vacuous**, not as a pass.
4. **A result that would change a release decision is corroborated by an
   independent check with a different predicate.** This is the only mechanism
   that caught anything.
5. **Never build a heredoc inline through `bash -lc`** with prose containing
   backticks or apostrophes.
6. **Read `stopReason` / `cancellationCategory` from the vendor log** — never
   infer why a lane produced nothing. Two causes present identically.
7. **Scope by inventory, not by count.** Three documents carried three
   different numbers for the same fix; all three were wrong.
8. **Two agreeing lanes are not a control.** A third lane with an actual
   control experiment refuted a conclusion two agreeing lanes had reached.

## 4. Vendor-lane traps

| Trap | What to do |
|---|---|
| Dispatching grok | `--always-approve --max-turns 30`; inline every fact; write the validity-critical file first. Grok stalled on 3 of 8 lanes, each time reporting a plausible terminal state. |
| `grok --prompt-file` | **Single-turn.** A round can exit 0 having written nothing. |
| grok "empty burst" | At least two distinct causes present identically: `PermissionCancelled` (an unlisted tool verb cancels the whole turn) and research-budget exhaustion. Read the vendor log; do not infer. |
| Codex agents and graphify | Codex/GPT-5.6 auto-triggers graphify and stalls 25 min+ rebuilding the graph. **Tell it explicitly to skip graphify**, and cap every run (`timeout 1200 codex exec`). |
| `codex-auditor` in a detached-HEAD host repo | Cannot start. Give it a worktree on a real branch. |
| Codex audit lane | Has reached a verdict and then exhausted its turn before writing the report. Require the report file to be written **first**, not last. |
| Long background lanes | Arm a stall watchdog at dispatch — silent hangs and deaths are wasted work. But note the Git Bash argv trap above when arming it. |
| Two audit lanes disagreeing | Fable decides the tie-break. Never silently default to the strictest verdict. |

## 5. Verification discipline

- Never claim "verified" without quoting the command that produced the result.
- Gate every `bats` invocation through the host-wide mutex; concurrent bats
  runs make load-sensitive tests fail spuriously.
- `tests/eventlog.bats` "under concurrent contention" is **load-dependent** —
  it fails while lanes saturate the box and passes on an idle machine. It is a
  symptom test. The mechanism test is `tests/probes/mkdir-atomicity.sh`.
- If something is blocked, say so plainly in your report. A stated blocker is a
  good outcome; a fabricated pass is the failure mode this release exists to
  eliminate.

## 6. Vendor CLI self-update suspends a headless round (observed 2026-07-29)

**Symptom.** A dispatched `grok` round runs for 11 minutes, writes nothing, and
its output file stays 0 bytes. `git status` in the worktree is unchanged. It
looks like a slow model or a stalled network call. It is neither.

**Diagnosis.** Check process STATE, not elapsed time:

```
ps -o pid,etime,time,stat,cmd -p <PID>
```

- `STAT` = `T` or `Tl` → **STOPPED**, not running. A background process that
  attempts terminal I/O receives `SIGTTIN`/`SIGTTOU` and is suspended.
- `TIME` = `00:00:00` after minutes of elapsed time → zero CPU consumed. A
  working process burns CPU; a wedged one does not.
- A `<defunct>` / `Zs` child whose elapsed time equals the parent's → the
  worker died at launch.

**Root cause observed.** `grok` detected version 0.2.114 while 0.2.112 was
installed, downloaded it to `~/.grok/downloads/`, and tried to interact with
the terminal about it. The round was suspended before doing any work.
`~/.grok/version.json` `checked_at` matched the dispatch time to the second.

**What to do.**

- Kill by recorded PID. **Never `pkill -f` by pattern** — it has previously
  matched its own command line and killed the shell issuing it.
- Re-dispatch only after confirming the CLI runs headlessly:
  `timeout 90 grok -p "reply with exactly: READY" < /dev/null`
- Always redirect stdin from `/dev/null` for headless vendor rounds, so a
  prompt fails fast instead of suspending the process.
- Pin or pre-run vendor updates **before** dispatching a round, never during.

**Why this matters beyond the one incident.** A vendor CLI can upgrade itself
unprompted, mid-release, after a gate's evidence was collected — changing the
toolchain underneath a round. `openspec/changes/vendor-preflight/` forbids the
preflight from *invoking* mutating `update` verbs; this incident shows the
vendor may do it on its own, so currency must be checked and settled before
dispatch rather than discovered during it.

**Watchdog note.** A liveness watchdog that polls `pgrep` treats a STOPPED
process as alive and waits forever. A watchdog must test process *state* and
CPU delta, not mere existence.

---

## 7. Dispatching a grok lane — what actually determines success (2026-07-30)

Five dispatches, same chain, same model, same worker. The only variable was
spec shape. This is measurement, not preference.

| Spec shape | Result |
|---|---|
| "read the OpenSpec change, then implement" (×3 lanes) | EMPTY-BURST, 3 rounds each |
| 2 deliverables + "wire it where appropriate" | EMPTY-BURST, 3 rounds |
| 1 deliverable, defective function pasted in, exact change stated | files changed, **round 1, 26s** |
| 1 deliverable, exact insertion block pasted in | files changed, **round 1** |
| 1 deliverable, existing helper + status vocabulary pasted in | files changed, **round 2** |

**`grok --prompt-file` is single-turn.** The consequence is the part that bites:
a round that must *read* before it can *write* spends its only turn reading and
exits having written nothing. `grok-multiround` re-issuing the same spec cannot
fix it — every round has the same one-turn budget, so three rounds are three
identical failures, not three attempts. **Raising `--max-rounds` buys nothing.**

Rules:

1. **Inline every fact.** If the worker must open a file to learn what to
   change, the spec is not finished. Paste in the current source of the function
   to change, the measured evidence, and the target semantics. Producing that
   costs the architect a diagnosis pass — that pass *is* the work, and it is not
   delegable to a single-turn worker.
2. **One deliverable per dispatch.** Two deliverables empty-burst even when both
   are individually well-specified and richly inlined. Necessary but not
   sufficient — see 4.
3. **Write-first must name the REAL deliverable, never a sentinel.** "Your first
   action is to EDIT `env/tool-check.sh`" is correct. "Create SPEC-NOTES.md
   first" is a defect: it manufactures exactly the artifact the change detector
   measures, and produced three lanes reporting `round_done exit_code=0` having
   implemented nothing. (`grok-multiround` now excludes such artifacts, but do
   not rely on that — do not ask for them.)
4. **Budget the whole round, not just the implementation.** A spec whose
   *verification* section requires a multi-step stateful experiment (move a file,
   re-run, restore, re-run) is asking for two things in one turn however singular
   its code change. Keep the worker's verification to a single pass; stateful
   setup/teardown belongs to the architect after the diff lands.
5. **Know when to stop delegating.** A five-line insertion already specified to
   the character is not worth a fourth round. Compare remaining lane cost against
   doing it directly. The specification effort is never wasted — it becomes the
   commit message and the review criteria.
6. Keep the spec OUTSIDE the worktree (`/root/fm-specs/`, not `$WT/SPEC-*.md`).
   A spec staged inside the tree is another artifact that can flip a change
   detector.

## 8. Lane liveness has no process-layer signal during preamble (2026-07-30)

**A lane that has not yet spawned its vendor process has NO liveness signal at
the process layer.** `ps | grep grok` returning nothing is the normal early
state, not a fault. Absence of a process is not evidence of death.

Three healthy lanes were killed at 18 minutes on exactly this misreading. All
three returned "now dispatching grok" when stopped. The entry above them in
`bugeventlog.md`, written the day before about a different watchdog, already
said so — and said the threshold had been "set from impatience, not from
measurement."

- The only valid early-phase surface is the lane's own **output stream growing**:
  `stat -c %s /root/.foreman-lanes/<owner>.<label>.out`.
- **No kill threshold below the measured preamble cost (~30 min) is defensible**
  without that surface. A lane briefed to read `AGENT_TRAPS.md` in full plus four
  spec files legitimately spends that long before writing anything.
- Still true, and not in tension with the above: a *running* process must be
  judged by STATE and CPU delta, never by existence — a `SIGTTIN`-suspended
  process answers `kill -0` exactly like a healthy one.

## 9. Destructive proofs must never cross a turn boundary (2026-07-30)

A destructive proof is two-phase: sabotage → observe RED → restore → observe
GREEN. A worker's turn can end between any two phases, and nothing makes the
restore atomic with the sabotage.

Observed: a lane sabotaged an enforcement predicate to
`[[ "$durable_enabled" == "__disabled_for_independent_proof__" ]]` — a literal
that can never match, leaving the refusal branch dead so every unowned dispatch
would proceed silently — then its turn ended before the restore. It reported
success. It had not lied; it correctly reported the proof as unfinished. **The
hazard is that the leftover filesystem state looks like completed work in
`git status`.**

- **A destructive proof is architect-run, or run against a COPY outside the
  worktree.** Never ask a worker to leave a worktree deliberately broken.
- **Never commit a lane's output on the lane's own account of it.** Re-run the
  suites yourself. This programme has a dozen checker-soundness incidents; this
  was the first where the false signal was *filesystem state* rather than a
  check result.
- **Run `skills/foreman/scripts/lane-complete-check.sh WORKTREE` before any
  commit.** It refuses a report still containing `(TBD)` and any sabotage
  sentinel in tracked source. Both conditions are mechanical; reading the prose
  is what fails under time pressure.
- What actually caught it was the **registered pass baseline** disagreeing with
  the observed count (8 vs 7). Register every new `.bats` file in
  `tests/baseline.tsv` AND `tests/skip-budget.tsv` — eight packages skipped this,
  and it is the cheapest tripwire in the repo.

## 10. The suite's verdict depends on how it was launched (2026-07-30)

`tests/run.sh` can return different results for the same tree:

| invocation | `lane-run` test 8 |
|---|---|
| standalone `bats tests/lane-run.bats`, detached | ok |
| `bash tests/run.sh tests/lane-run.bats` | ok |
| full 41-file suite under load | **not ok** |

- **Launch the full suite detached, with stdin from `/dev/null`:**
  `nohup setsid flock /tmp/foreman-bats.lock bash tests/run.sh > LOG 2>&1 < /dev/null &`
  A backgrounded process that touches the terminal gets `SIGTTIN`-suspended.
- **Never run the full suite while lanes are running.** It takes the host-wide
  bats mutex and starves them; a lane's remaining budget is scarcer than your
  verification.
- Setup-liveness timeouts are not the property under test — make them generous.
  Only the asserted property should be tight.
- A test that can only pass on one platform must carry a **capability guard**
  (`command -v taskkill`, `command -v cygpath`, a PATHEXT probe), never a
  platform assumption. Four tests failed rather than skipped on POSIX because
  they asserted Windows behaviour with no guard.

## 11. Verification commands that read ambient state need a baseline (2026-07-30)

Checking whether a generated env file duplicated `PATH` entries:

```
. ~/.foreman/env.sh; . ~/.foreman/env.sh
tr ':' '\n' <<<"$PATH" | grep -c "$HOME/.local/bin"      -> 3
```

`3` was read as a duplicate-entry defect. It was not — the ambient WSL `PATH`
already contained that directory several times, so the count conflated "entries
the file added" with "entries already there". A false defect report was avoided
only because the number looked implausible enough to re-test.

Re-run controlled: `env -i HOME=/root PATH=/usr/bin:/bin bash -c '…'` →
baseline 0, after one source 1, after two sources 1. Idempotent, correct.

**A verification command that reads inherited state must establish its baseline
in a controlled environment before its output means anything.** `grep -c`
against an ambient `PATH` is not evidence.
