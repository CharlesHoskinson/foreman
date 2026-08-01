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

```bash
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

```text
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

## 12. A verification result has an implicit timestamp and tree state (2026-07-30)

Three times in one session the architect measured a moving target once and
quoted the number later as though it still held. Same shape each time:

| Claim | What was actually true |
|---|---|
| "the env file duplicates PATH entries — count is 3" | The ambient `PATH` already contained the directory 3 times. The check had no baseline, so it could not separate "entries the file added" from "entries already there". Controlled re-run: 0 → 1 → 1, correct. |
| "the lane is stalled — no vendor process, no writes for 20 minutes" | It was alive and mid-preamble, twice. Its report later grew 4.4 KB → 18 KB. |
| "the tov lane is sound: 13/13 green, just needs registration" | Its suite had **26** tests by then. The 13/13 was measured against a tree state that no longer existed, and the worktree already contained work from a later dispatch. |

**Rules:**

1. **Never carry a green result across a turn boundary for a worktree that has a
   live lane writing to it.** The lane is a writer, your measurement is a read,
   and there is no lock between them. Re-run before you rely on it.
2. **A verification command that reads ambient state must establish its baseline
   in a controlled environment.** `grep -c` against an inherited `PATH` is not
   evidence. `env -i HOME=... PATH=...` is.
3. **Quote a result with what it was measured against**, or re-measure. "13/13
   green" is not a fact about a package; it is a fact about one tree state at one
   moment.
4. n=2 is not a demonstration of nondeterminism. If you believe something is
   flaky, either read the mechanism that makes it so, or sample enough to report
   a rate with its sample size. The architect published a flakiness finding on
   n=2; it was right by luck, and the actual proof came from reading the runner
   (an unseeded probabilistic search given a bound with zero margin over its own
   documented requirement).

## 13. Escalate a blocker to three DIFFERENT lenses, not three votes (2026-07-30)

Two blockers were escalated to a panel: one agent measuring root cause
empirically, one ruling on design given the defect exists, and one instructed to
**refute** both claims and default to REFUTED where evidence did not support them.

The adversarial lane — the only one told to attack — produced both corrections
the panel yielded. It refuted one claim outright and confirmed the other while
demolishing the evidence offered for it. The two constructive lanes produced
compatible, useful, and *uncorrective* answers.

- **Two agreeing lanes are not a control.** They were never going to disagree
  with the framing they were handed.
- Give each lane a distinct lens: measure it / decide it / break it. Redundancy
  catches transcription errors; diversity catches wrong premises.
- Hand the refuter the strongest version of the claim AND the evidence behind it,
  and tell it explicitly to default to REFUTED. A refuter that must argue against
  a strawman returns nothing.

## 14. Three ways a lane round dies silently (observed 2026-08-01)

Each of these produced an outcome indistinguishable from "the worker did
nothing", and each cost a round before the real cause was found.

| Claim | What was actually true |
| --- | --- |
| "grok narrated orientation but wrote nothing — EMPTY-BURST FAILED" | Headless grok DENIES every tool call unless `--allow Write --allow Edit` are passed. The writes were attempted and refused. `grok-multiround.sh`'s own failure text blames spec design and advises inlining facts; it never names the missing permission flags. Second dispatch with the flags succeeded in round 1. |
| "the second round produced no file change" | `grok-multiround.sh` detects change with a digest of `git status --porcelain` — that is WHICH PATHS changed, not their content. A second round editing an already-modified file leaves the porcelain line identical and reports a false EMPTY-BURST. Commit between rounds. |
| "the lane started; the log is empty because it produced nothing" | The lane was never running. A lane detached with shell-level `(cmd &)` inside a `wsl.exe` invocation is killed when the wrapper exits. Two lanes left 0-byte logs and no process. An empty log looks identical to a lane that started and wrote nothing. |

**Rules:**

1. Always pass `--allow Write --allow Edit` to headless grok. A denied write is
   indistinguishable from an empty burst.
2. grok is single-burst: it cannot read-then-write. Inline every fact the spec
   needs. Route any read-then-write task to codex.
3. Commit between multiround rounds, or the change digest cannot see the second
   round's work.
4. Confirm a dispatched lane is actually running — check for the process, not
   just for the log file. A 0-byte log is not evidence of a quiet worker.

## 15. A verification that cannot see the failure it checks for (observed 2026-08-01)

Four verifications reported clean over something broken. In each case the
command was reasonable and the blind spot was structural, not careless.

| Claim | What was actually true |
| --- | --- |
| "the formatter changed no words — `git diff --word-diff` is clean" | `--word-diff` classifies tabs as whitespace, not content. MD010 had replaced 10 literal TAB bytes with spaces inside TSV examples in a document whose own instructions require literal TABs. Caught by a cross-vendor audit, not by the check. |
| "before and after are identical, so the audit finding is wrong" | The shell wrapper ate the command substitution, leaving `git show :path` — valid syntax meaning the INDEX, not the merge base. After a commit the index equals HEAD, so BEFORE and AFTER printed the same text. The auditor was right. |
| "nothing was weakened: requirements 10 → 10, scenarios 27 → 27" | Counting is not identity. Set comparison of the headings showed 22 of 27 scenarios had been REPLACED. Five guarantees had been dropped with no re-expression. |
| "the withdrawn dependency is gone — `grep -n TerminusDB` returns 7 lines, all historical" | Package names are lowercase (`terminusdb-operations`), the product is camel-case. `grep -in terminus` returned 11, including a claim that a longevity risk was "accepted, not resolved" when withdrawing the dependency had eliminated it. |

**Rules:**

1. A whitespace-insensitive diff cannot verify a whitespace-sensitive file. For
   TSV, Makefiles, or anything with significant tabs, compare bytes.
2. Print the resolved SHAs alongside any before/after comparison. An empty rev
   is valid syntax and fails silently.
3. Compare SETS, not counts. Equal counts are consistent with total replacement.
4. Sweep case-insensitively when retiring a named thing; its package names will
   not match its product name.

## 16. Re-express by editing, never by regenerating (observed 2026-08-01)

A task to re-express two specs against a replacement dependency was given as an
open rewrite. The worker regenerated the text: 1435 insertions against 1459
deletions, replacing 22 of 27 scenarios. Audit round 1 found five dropped
guarantees. They were restored. Audit round 2 found five DIFFERENT ones. A third
round of the same method would have found a third set, because every pass over a
rewrite that large discovers different collateral loss.

The method was then changed: restore the original text, edit only the terms that
name something store-specific. The diff became 59 insertions and 59 deletions,
with every heading in one file byte-identical.

Then a fourth audit returned BLOCKED again — because the rule had been applied
to the spec deltas but NOT to the task lists, which still carried the wholesale
rewrite. Twelve of its fourteen findings were dropped TASKS.

**Rules:**

1. For a re-expression — same behaviour, different dependency — constrain the
   worker to EDIT, not regenerate. A guarantee cannot be dropped by an edit that
   never touches its line.
2. Give the permitted substitutions as an explicit table, and require every hunk
   to be explainable by it.
3. Apply the rule to EVERY normative surface. A task list directs a worker
   exactly as a spec does; covering one and not the other leaves the drop risk
   fully intact on the surface left uncovered.
4. A rework instruction can itself delete a guarantee. "Restore the quarterly
   triggers and mark them as the vendor-exit history they are" converted a live
   recurring obligation into an archive entry. Re-pointing the SUBJECT of an
   obligation is legitimate; converting the obligation into history deletes it.

## 17. Three ways a green signal lies (observed 2026-08-01)

Each of these produced a confident, wrong conclusion. Two were the
architect's, and the third was a lane's.

| Claim | What was actually true |
| --- | --- |
| "the lane implemented the fix — shellcheck and the tests still pass" | The lane changed ZERO tracked files. It produced a numbered design with alternatives considered, then closed with "Approve this design so I can implement it?" and exited. shellcheck and the existing tests passed because nothing had changed. Only the round gate caught the no-op; the transcript read like successful work. |
| "all four adapters bind auth to probe content — test 8 asserts it and passes" | Test 8 is named "auth probes are shimmed, positive-signal based, and never bill" and it passed, but it only asserted the content-failure case for TWO of the four vendors. The other two ran their probe with output discarded and returned on exit status alone — the exact defect a prior commit had already fixed once. The test's NAME generalised past its assertions and was quoted as coverage it did not have. |
| "these two test failures reproduce locally, so they are real product defects" | Reproducing locally proves a failure is not environmental. It does not prove the product is wrong. Both failures were a STALE FIXTURE: the gate had been hardened to bind a verdict to its attempt and evaluated tree, and the fixture never supplied those bindings. Running the gate against the fixture by hand printed eight refusal reasons, every one naming a missing binding. The product was correct and stricter than its own test. |

**Rules:**

1. A lane's transcript is not evidence that it did the work. Diff the tracked
   files. A round gate that asserts a fresh artifact catches the no-op; a
   reader skimming a log does not.
2. State explicitly in a lane spec that the worker is authorised to implement
   and must not stop to ask. "Fix exactly these" is not enough.
3. Read what a test ASSERTS, never what it is NAMED. A green test whose name
   generalises past its assertions is worse than no test, because it is quoted
   as coverage.
4. Local reproduction distinguishes environmental from non-environmental. It
   says nothing about which side is wrong. When a test fails against a
   component that was recently hardened, suspect the fixture before the
   component, and settle it by running the component against the fixture by
   hand and reading its stated reasons.

## 18. An absolute path is not a PATH lookup (observed 2026-08-01)

Twice in one session, a gate checked one assumed location instead of checking
whether its caller could resolve the tool. `gates-linux` verified codespell as
`"$HOME/.local/bin/codespell"`, proving only that a file existed there and
masking the PATH lookup that was the point of the check. Then
`tools/ci-local.sh` hardcoded `/usr/local/bin/openspec` while
`command -v openspec` correctly returned `/root/.local/bin/openspec`.

The installed, working tool was reported as `not executable`, and that single
false failure made the entire local runner report FAIL. A check that lies this
way teaches people to ignore the runner.

**Rule:** To check that a tool is usable, resolve it the way its callers will:
use `command -v`, with a fixed-path fallback if one is required, never the
reverse.

## 19. Privilege level decides which "unreadable" technique is valid (observed 2026-08-01)

`chmod 000` does not deny root, and this repository runs WSL as root. An
architect control used it to simulate an unreadable file, proved nothing, and
briefly made the product look fail-open. CI contained the mirror-image failure:
its evidence probe used `runuser` to drop to `nobody`, but the hosted runner was
non-root and could not construct its own precondition.

**Rule:** A control that simulates "cannot read" must branch on EUID: drop
privileges when root and rely on mode bits when non-root. Prefer a dangling
symlink when possible; it denies both and is the simplest portable choice.

## 20. Windows interop fails for any cwd under /root (observed 2026-08-01)

`powershell.exe` invoked from WSL returns `Invalid argument` when its cwd is
beneath `/root`: interop translates the cwd to a UNC path but cannot traverse
the mode-700 directory. The boundary was measured. `/`, `/tmp`, `/var`,
`/home`, `/opt`, `/usr`, `/tmp/deep/a/b/c`, and `/root` itself worked;
`/root/foreman`, `/root/fm-wt`, and `/root/probedir` failed. Making `/root`
mode 755 made those paths work.

The tempting explanation that any Linux-only cwd breaks interop is false:
`/tmp` is equally Linux-only and worked. Carrying that bad explanation forward
cost a false clock-drift alert on every lane round after checkout moved under
`/root`.

**Rule:** Run an interop call in a subshell that sets its own
Windows-resolvable cwd. Never let it inherit an arbitrary caller cwd.

## 21. Grok's limit is the size of the emitted edit (observed 2026-08-01)

Five dispatches established the boundary: a two-line insert and a two-line
replacement succeeded, while a 98-line deletion, a 147-line exact
reproduction, and a roughly 70-line append all empty-bursted. The files were
verified unchanged, so these were genuine failures, not detector blindness.
The one-file append also ruled out deliverable count, and the successful small
writes ruled out a read-versus-write distinction.

**Rule:** Route large-payload edits to codex and keep grok for small, precise
edits. Count deleted text as payload, not merely its coordinates: an edit tool
matches the content, so "delete lines 1819-1916" is a read-then-write task
wearing line numbers.

## 22. The lane spec pollutes measurements taken in its own worktree (observed 2026-08-01)

By convention, `SPEC-*.md` is staged at a lane worktree's root.
`grok-multiround.sh` excludes that name from its change digest, but a repo-wide
`**/*.md` lint run inside the same worktree still counts it. One spec's two H1s
and unlabelled fenced blocks moved the total from 67 to 71 and shifted two rule
counts, making the change under test appear to have side effects.

**Rule:** Take repo-wide measurements from a clean tree, or explicitly exclude
`SPEC-*.md`. A number measured inside a lane worktree includes the lane.

## 23. A monitor whose predicate does not exist (observed 2026-08-01)

`lib/stall.sh` called `ev_content_hash`, `ev_hash_unchanged`,
`ev_porcelain_digest`, and `ev_porcelain_uall_digest`, but none was defined
anywhere in the repository. In production, `stall_no_output()` therefore hit
`command not found` twice, received an empty result, evaluated a false `if`,
and fell through unconditionally to the OK line. Both no change and real change
printed the same string; the NO_OUTPUT arm could never fire, so an empty lane
could be reported healthy indefinitely.

The catching harness said "content hash failed to detect nested edit", naming
the wrong failure: no hash had been computed. A missing predicate and a blind
predicate are different defects. Three readings chased the harness's
explanation before checking whether its predicate had run at all.

**Rule:** This is the third instance of the class in this project's own log.
Before arming a monitor, execute its predicate against a known-positive case
and watch it fire. When a checker reports failure, confirm that its predicate
ran at all before believing its explanation.

## 24. Liveness read from the parent shell's command line (observed 2026-08-01)

Two codex lanes ran concurrently. The poller asked `pgrep -f "fm-wt/$name"` for
both and reported one RUNNING and one DONE. The DONE one had been dispatched two
minutes earlier and was in fact working normally.

The predicate matched a string that happened to be present for one lane and
absent for the other, for a reason unrelated to liveness. The first lane's
dispatcher ran `git worktree add ... /root/fm-wt/roticks && ...` in the shell's
own command line, so the worktree path was in `/proc/<pid>/cmdline`. The second
was dispatched as `cd "$WT" && codex exec ...`, which puts the path in the
process's *working directory* and never in its argv. Same liveness, opposite
answer, decided by how the dispatch line was written.

Three predicates against the same two lanes:

```text
             cmdline   sandbox-cwd   log-growing
  roticks      YES         NO           YES         (alive)
  batch5       NO          NO           YES         (alive)
```

Only the third was right for both. `cmdline` was wrong for one; `sandbox-cwd`
was wrong for both, because the sandbox helper is transient and absent whenever
the worker is between tool calls.

**Rule:** Liveness is growth of the thing the process produces, not the presence
of a process that matches a pattern. Sample the output twice with a gap and
compare. A quiescent log needs a longer second sample before it means anything —
a 6-second window called the same lane QUIESCENT that a 30-second window showed
GROWING by 4KB.

**Amendment, twenty minutes later.** The rule above was implemented as a waiter
that sampled each lane log twice with a **60-second** gap and dispatched a new
lane when fewer than the cap were growing. It fired while both lanes were alive,
putting three codex lanes against a measured cap of two. Sampling twice was
necessary and not sufficient: a worker that thinks between tool calls writes
nothing for longer than 60s, so a short window reports a live lane as finished.
The same lane had already been seen QUIESCENT over 6s and GROWING over 30s.

**Rule:** A growth window must exceed the longest silence the process legitimately
produces, which for a reasoning worker is its think time between tool calls, not
its write cadence. Prefer a completion signal the worker itself emits — a report
file, an exit status — over any inference from output timing. Timing-based
liveness is a fallback, and its window must be justified by a measured silence,
not chosen for convenience.
