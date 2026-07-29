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
