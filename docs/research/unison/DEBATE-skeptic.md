# The case AGAINST porting Foreman's orchestration layer to Unison

Position: **do not port.** Not "not yet, but maybe after v0.3.0" — the shape of
the argument does not improve with time, because the mismatch is structural
rather than schedule-driven.

Every claim below is sourced. Where I could not verify something I say so.
Where Unison genuinely wins I say that too, in section 3, before I start
arguing — a skeptic who concedes nothing has told you nothing.

---

## 0. Method, so this can be checked rather than believed

Foreman's shape was measured, not recalled:

```
wc -l skills/foreman/scripts/*.sh skills/foreman/scripts/lib/*.sh
  → 8797 total (25 scripts + 8 lib files)
```

Primitive census over that same corpus (`grep -oE '\b(kill|trap|…)\b' | sort |
uniq -c`):

| primitive | uses | primitive | uses |
|---|---|---|---|
| `jq` | 168 | `mktemp` | 19 |
| `kill` | 97 | `stat` | 18 |
| `trap` | 47 | `sort`/`sed`/`comm` | 28 |
| `timeout` | 36 | `setsid` | 5 |
| `wait` | 34 | `flock` | 4 |
| `find` | 24 | `umask` | 2 |
| `tee` | 23 | `awk` | 5 |
| `exec` | 20 | | |

Unison's capability surface was measured from the compiler, not from marketing
pages. `parser-typechecker/src/Unison/Builtin.hs` on `trunk` is the file that
declares the type of every builtin the language has:

```
IO.process.call     : Text -> [Text] ->{IO} Nat
IO.process.start    : Text -> [Text] ->{IO} (Handle, Handle, Handle, ProcessHandle)
IO.process.kill     : ProcessHandle ->{IO} ()
IO.process.wait     : ProcessHandle ->{IO} Nat
IO.process.exitCode : ProcessHandle ->{IO} Optional Nat
```

That is the complete process-control API of the Unison language. Five
functions. And a grep of the same file for the things Foreman's 8,797 lines
depend on returns **nothing at all**:

```
grep -in 'signal|SIGINT|SIGTERM|installHandler|umask|chmod|symlink|flock|lockFile|setEnv' \
  parser-typechecker/src/Unison/Builtin.hs
  → (no matches)
```

Note `getEnv` is present at line 1048; `setEnv` is absent. That asymmetry
matters and I return to it.

---

## 1. The core claim: Foreman's job is precisely the job Unison declines to do

Unison is a language whose central design commitment is that code is a pure,
content-addressed value in a database. That commitment is what buys it perfect
incremental compilation, non-breaking renames, and serialisable distributed
computation. It is also what makes the OS a second-class citizen: the runtime's
foreign surface is deliberately small, deliberately audited (`declareForeign
Tracked`), and — per the project's own FAQ on FFI — *"still in its infancy."*

Foreman is the opposite kind of program. It is 8,797 lines whose entire purpose
is to be extremely good at the parts of the operating system that Unison
abstracts away. Concretely, here is what a port would have to reproduce, and
what Unison offers for each.

### 1.1 Process-tree ownership

`launcher/README.md` describes what Foreman actually needs:

> **Windows**: assigns the child to a Job Object with
> `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` … kernel-enforced, orphans impossible by
> construction.
> **POSIX**: bootstraps itself as the init (PID 1) of a fresh PID namespace
> (`unshare --pid --mount-proc --fork --kill-child`), then spawns the child
> under `setsid` inside it.

This exists because vendor CLIs spawn subprocesses that outlive them. The
bugeventlog records the cost of not having it: *"unreaped grok subprocess
blocked the T3 lane for ~70 minutes"* (`bugeventlog.md:221`), *"audit agent's
verification bats orphaned, blocked the release gate ~1hr"* (`:510`).

Unison offers `IO.process.kill : ProcessHandle ->{IO} ()`. One handle, one
process. No process groups, no `setsid`, no namespaces, no Job Objects, no
choice of signal. It cannot express `kill -- -PID` (which `lane-run.sh:692`
does), let alone the graded TERM→grace→KILL sequence that `kill_cmd_bounded`
implements at `lane-run.sh:433-441`.

### 1.2 Signals — the port cannot even clean up after Ctrl-C

`lane-run.sh` installs **47 traps** across the corpus, and the ordering is
load-bearing. Lines 753-813 encode a two-phase install: a non-exiting
pending-signal trap first, so a signal arriving before ownership is recorded
does not orphan a worktree; then the real cleanup trap; then a replay of any
pending signal. There is an audit citation in the comment (`audit t3-2 round
3`) explaining why a trap that only records must not fail to terminate.

Unison has **no signal API**. Not a limited one — zero matches for `signal`,
`SIGINT`, `SIGTERM`, `installHandler` in the builtin declarations. A Unison
Foreman interrupted at the terminal leaves its worktrees, its lock files and
its lane registry exactly as they were. That is not a rough edge; for a CLI
orchestrator that creates git worktrees and holds locks, it is disqualifying on
its own.

### 1.3 No `setEnv`, no per-child env, no per-child cwd

`IO.process.start` takes a command and an argument list. It takes **no
environment** and **no working directory**. And Unison has no `setEnv` at all,
so you cannot even mutate your own environment before spawning.

Foreman assigns 169 distinct SCREAMING_CASE variables across its scripts and
its entire isolation model is environment-scoped: `FM_LANE_OWNER` /
`FM_LANE_LABEL` (the PID registry from incident S-6), `FOREMAN_LAUNCH`,
`WC_GROK_MODEL`, `WC_CODEX_MODEL`, `WC_CODEX_REASONING_EFFORT`, `HOME` and
`USERPROFILE` relocation for vendor credential isolation, `GIT_ASK_YESNO`,
`LANE_CONFIG_DIR`. ROADMAP.md records an *unsolved* problem in exactly this
area — `agy`'s per-lane isolation, where "`GEMINI_CLI_HOME` is a no-op, and
relocating `HOME` moves all state except the OAuth token."

The cwd gap is worse than the env gap, because Unison *does* have
`IO.setCurrentDirectory` — but it is process-global, and Unison has real
concurrency (`IO.forkComp`, `MVar`, `STM`). An orchestrator that runs N lanes
in N git worktrees would be mutating one global cwd from N threads. That is a
data race in the one piece of state that decides *which repository a worker
edits*. Foreman already lost a session to a weaker version of this bug:
*"finisher lane's cwd silently reset to a DIFFERENT lane's worktree"*
(`bugeventlog.md:265`).

The practical escape hatch is `IO.process.call "bash" ["-lc", "cd … && env … &&
…"]`. Which is to say: **the port does not remove bash. It adds a layer above
bash, and moves every argument through a shell-quoting boundary** — the exact
boundary `AGENT_TRAPS.md` §1 identifies as having *"cost four incidents in one
session."* A port that increases the number of string-quoting seams while
claiming to be a safety improvement is arguing against itself.

### 1.4 Liveness diagnosis needs `/proc`, and Windows needs `/proc/<pid>/winpid`

Incident S-2 (2026-07-29) is the sharpest example in the record. A grok round
ran 11 minutes, wrote nothing, and looked like a slow model. The real state was
`STAT=Tl` — stopped by `SIGTTIN` — with `TIME=00:00:00`. The diagnosis required
reading process *state* and *CPU time*. S-7 records that the watchdog armed
against it polled `pgrep`, which reported the stopped process as alive.

Unison's `IO.process.exitCode : ProcessHandle ->{IO} Optional Nat` returns
`None` for that process. Running, stopped, network-blocked, and wedged are all
`None`. The cross-cutting finding of the strandings incident is *"'Still
running' is the most dangerous status"* — and `None` is the only status Unison
can give you.

You could read `/proc/<pid>/stat` with `IO.getBytes`, on Linux. Foreman also
targets Windows/Git Bash, where `lane-run.sh:406` reads `/proc/<pid>/winpid` to
translate an MSYS PID into a real Windows PID, and lines 35-40 document that a
Windows child dying with an NTSTATUS has its exit code masked to a byte. Unison
gives you a `Nat` from `process.wait` with no way to recover that.

### 1.5 File-level facts Unison's IO does not model

`IO.getFileTimestamp` and `IO.getFileSize` exist. Mode bits do not. There is no
`chmod`, no `umask` (Foreman uses it twice), no symlink API, no executable-bit
test. The whole of `crlf-extensionless-hardening` — an S1 package, 7 tasks — is
about git filemode and line-ending behaviour on 33 files. `AGENT_TRAPS.md`
names *"the 33/41 filemode changes in `git status`"* as a standing trap. There
is no `flock`, and `lock-primitive-hardening` (102 tasks, the largest package in
the release) exists **because** `mkdir` atomicity failed under uutils and
`flock` was measured as the replacement: "0 violations on ext4, tmpfs and
drvfs."

A Unison port would ship the release's single largest workstream by shelling
out to `flock(1)`.

### 1.6 Git is not typed by rewriting the caller

Foreman is a git-plumbing program: worktree create/merge/cleanup/consolidate,
`rev-parse --git-common-dir`, `ls-files` with `:(glob)` pathspecs,
`status --porcelain -uall`, hook-disabled invocation via `git -c
core.hooksPath=`. Unison has no git library. Every one of those calls is
`IO.process.call "git" [...]` followed by parsing text.

This matters because one of the most expensive bugs in the record is precisely
a git-text bug: *"`git status --porcelain` digest → lane wrote nothing"* when in
fact porcelain *"collapses an untracked directory to one line"*
(`AGENT_TRAPS.md` §2; root-caused at `bugeventlog.md:1584`). No type system
catches that. The string was well-typed. It was *semantically wrong about the
world*, and the fix was `-uall` plus a content hash — a change to the predicate,
identical in bash and in Unison.

---

## 2. The empirical question, answered

This is the part that decides it. `AGENT_TRAPS.md` §2 tabulates twelve checkers
that returned a confident wrong answer in a single day, from at least five
different actors. If those were *language* failures, the port has a case. Let me
classify each one honestly against the question: **would a strong static type
system with algebraic effects have prevented this?**

| # | Defect | Class | Would Unison have caught it? |
|---|---|---|---|
| 1 | `grep -q "violation"` matched Quint's **success** string `[ok] No violation found` | wrong predicate | **No.** Both branches are `Text`. Needs `^\[violation\]`. |
| 2 | Invariant held **vacuously** — counter never advances in the failure it targets | vacuous truth | **No.** A true proposition, true for the wrong reason. |
| 3 | `codex exec` exited 0, claimed report "ready" — wrote nothing | success bound to exit code | **No.** Same `Nat` from `process.call`. |
| 4 | `grok-multiround.sh` reported `EMPTY-BURST FAILED`; all four files were written and valid | checker bound to wrong artifact | **No.** Checked the wrong path. |
| 5 | `git status --porcelain` blind to files after the first in an untracked dir | wrong tool flag | **No.** Git's output contract, not the caller's types. |
| 6 | "Architect verified live: 5/5" — artifact on disk was the **pre-fix** 4-check run | stale artifact | **No.** Provenance, not typing. |
| 7 | `build_from_json(directed=True)` returns `DiGraph`, silently dropping one of two parallel edges | wrong library semantics | **Partially.** A type distinguishing `DiGraph` from `MultiDiGraph` would surface it — but that is Python's API design, and the port is of the *orchestrator*, not of graphify. |
| 8 | Contention regex matched `config/foreman.toml` as a prefix of `config/foreman.toml.example` | missing anchor | **No.** |
| 9 | Guard flagged 37 "regex artifacts", nearly all deliverables the packages create | **enumerated inclusions instead of exclusions** | **No.** Pure logic. |
| 10 | Criterion satisfiable by never instrumenting at all; three siblings were zero-denominator live passes | vacuous / no guard on denominator | **No.** A refinement type could forbid a zero denominator; that is not what "port to Unison" buys, and nothing in the language forces it. |
| 11 | 15-minute rebuild bound vs a measured 5.1 s — 176× slack, could never fire | wrong threshold | **No.** Both are numbers. |
| 12 | `syscall` evidence of `flock` defined as "the create returning `EEXIST`"; `flock` creates nothing | spec written against the wrong primitive | **No.** And note the direction: the spec was *insufficiently* coupled to OS reality. Unison couples less, not more. |

**Score: 0 of 12 clean, 1 of 12 partial — and the partial one is in a Python
dependency the port does not touch.**

Now the eight strandings of 2026-07-29:

| # | Stranding | Would Unison have caught it? |
|---|---|---|
| S-1 | Opus audit lane died mid-write, `API Error: Connection closed mid-response` | **No.** Vendor transport. |
| S-2 | grok SUSPENDED by its own self-update via `SIGTTIN` | **No — worse.** Unison cannot see `STAT=T` at all, and cannot set the child's stdin to the null device, which is the mitigation Foreman adopted. |
| S-3/4 | Lane backgrounded its round and ended its turn (occurrences 12 and 13) | **No.** An LLM behavioural attractor, documented as *prompt-immune*. |
| S-5 | Audit lane sat 21 min without ever launching its vendor | **No.** Absence of a process is not a type error. |
| S-6 | Redundant untracked watchdogs, unattributable, left running | **No.** Fixed by env-var tagging + a PID registry — and Unison has no `setEnv`. |
| S-7 | Watchdog polled `pgrep`, saw a stopped process as alive | **No — worse**, see S-2. |
| S-8 | The reaper's CPU-delta predicate false-positived twice, on a live interactive session and a healthy network-blocked lane | **No.** The fix was *deleting* a predicate. |

**Score: 0 of 8.** Two are cases where Unison would have been strictly worse,
because the fix required OS visibility the language does not expose.

Twenty defect instances. Zero clean prevention. The failure mode of this
project is not "we wrote a type error." It is, in the words of the incident
file's own cross-cutting finding:

> Not one stranding was caught by the mechanism responsible for catching it.
> Every one was caught by an out-of-band filesystem or process check.

A language change does not supply an out-of-band check with a different
predicate. Only a second, differently-shaped check does — and `AGENT_TRAPS.md`
standing rule 4 already mandates it. That rule costs zero lines of Unison.
