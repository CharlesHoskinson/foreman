# Lane strandings — 2026-07-29

Every stranded workstream is a datapoint. This file records each one observed
during the S1 implementation session, with what was lost, the diagnosis, and
what changed as a result. Entries merge into `bugeventlog.md` once the
concurrent interactive sessions release that file.

**Eight strandings in one session across three vendors and the orchestrator
itself.** Six were recoverable, two lost work outright. Not one was detected by
the mechanism nominally responsible for detecting it.

---

## S-1 — Opus audit lane died mid-write, analysis lost

- **Vendor:** Anthropic (Opus), audit lane on `crlf` diff `bfc8af4..f02f207`.
- **Symptom:** task notification `status=failed`, `API Error: Connection closed
  mid-response`. Final transcript line: *"Now writing the final report."*
- **Lost:** the entire audit. `AUDIT-opus.md` was still the 986-byte skeleton
  with nine `PENDING` sections. ~35 minutes of reasoning, unrecoverable.
- **Diagnosis:** transport failure, not a model or prompt fault. The
  write-first instruction *worked* — a skeleton existed — but a skeleton
  carries no findings. Write-first protects against *lane* failure, not
  against losing analysis held in context.
- **Change:** write-first is necessary but insufficient. An audit lane should
  persist each finding **as it is reached**, not accumulate them in context and
  serialize once at the end. Incremental persistence is the only thing that
  would have salvaged this.
- **Status:** re-audit queued against the fixed commit.

## S-2 — grok round SUSPENDED by its own self-update (SIGTTIN)

- **Vendor:** xAI (grok 0.2.112 -> 0.2.114), `crlf` rework round 1.
- **Symptom:** 11 minutes elapsed, output file 0 bytes, no worktree writes.
  Looked like a slow model call.
- **Real state:** `STAT=Tl` (**stopped by signal**), `TIME=00:00:00` (zero CPU),
  with a `<defunct>` child whose elapsed time equalled the parent's.
- **Diagnosis:** grok detected 0.2.114, downloaded it to `~/.grok/downloads/`,
  and attempted terminal interaction from a background job -> `SIGTTIN` ->
  suspended before doing any work. `version.json` `checked_at` matched dispatch
  time to the second.
- **Lost:** 11 minutes. No output.
- **Change:** `AGENT_TRAPS.md` section 6 (commit `c702490`); headless rounds now
  launch with `stdin < /dev/null`; liveness judged on **process state and CPU**,
  never elapsed time or existence.

## S-3 / S-4 — implement lane backgrounded its round and ended its turn (x2)

- **Vendor:** orchestrator-side (Claude subagent wrapper), `crlf` rework.
- **Symptom:** lane returned *"I'll resume verification once it completes"*
  (S-3) and *"I'll wait for the background monitor's notification now"* (S-4),
  having dispatched grok into the background and stopped.
- **Lost:** nothing — grok completed the work both times — but the round was
  **unowned**: nobody was verifying, and the architect only learned the work
  had finished by polling the filesystem.
- **Diagnosis:** this is `round-ownership-default`'s documented failure, whose
  proposal states it is **prompt-immune**. S-4 occurred despite a brief that
  named the exact phrase as a failure condition: *"If you find yourself about
  to say 'I'll check back when it finishes', you have failed the round."* It
  said a synonym instead.
- **Datapoint value:** occurrences 12 and 13 in the field record, and the first
  two where the prohibition was stated verbatim in the brief and still failed.
  This is now strong evidence that the structural fix in S4 is required and
  that further prompt engineering is not a substitute.
- **Change:** implement rounds are now driven directly (`nohup grok ... &`) with
  the architect owning verification, rather than routed through a wrapper agent.

## S-5 — audit lane sat 21 minutes in preflight without launching its vendor

- **Vendor:** OpenAI (Sol) audit of lock L1.
- **Symptom:** 21 minutes elapsed, no `AUDIT-sol-L1.md`, and **no `codex exec`
  process on the box at all**.
- **Diagnosis:** the wrapper agent never launched the vendor CLI. No error, no
  notification, no artifact — indistinguishable from working.
- **Recovery:** a direct status query asking two factual questions (have you
  launched codex; are you blocked) unstuck it. It then ran to completion in
  ~11 minutes and produced a strong audit (5 HIGH findings).
- **Change:** absence of a vendor process after a grace period is now a
  first-class stall signal. `lanectl.sh ps` makes it observable in one command.

## S-6 — audit lane left redundant untracked watchdogs running

- **Symptom:** the lane self-reported spawning several background watchers
  (`bvypgyvfd`, `biuzpgsul`, `b8269yeqp`) as "redundant safety nets", then
  declared them stale and took no action.
- **Diagnosis:** watchers outlived their subject with no owner and no registry.
  Attribution required reading `/proc/<pid>/cwd` and grepping scripts for a
  harness path.
- **Change:** `tools/lanectl.sh` — every lane and watchdog carries
  `FM_LANE_OWNER`/`FM_LANE_LABEL` plus a PID registry, so `ps`/`reap` act on
  **my** processes only and a foreign session's are never touched. Directly
  motivated by finding a 40-minute `lane-watchdog5.sh` belonging to a different
  Claude session, which had to be left running because it could not be safely
  attributed.

## S-7 — the watchdog itself could not see the stall (orchestrator fault)

- **Symptom:** the waiter armed against S-2 polled `pgrep`, which matched the
  **stopped** process and reported it alive. It would have waited its full
  1300-second budget on a process that had done nothing for 11 minutes.
- **Diagnosis:** existence is not liveness. `pgrep` cannot distinguish
  `STAT=T` from `STAT=S`.
- **Change:** `tools/reap-stale-lanes.sh` judges on state and CPU-since-start.

## S-8 — the reaper's own predicate was unsound, twice (orchestrator fault)

- **Symptom:** run 1 flagged a **live interactive codex session** as hung; run 2
  flagged a **healthy dispatched lane** blocked on a model response.
- **Diagnosis:** the CPU-delta predicate cannot distinguish network-blocked from
  wedged, and an idle interactive session legitimately burns no CPU.
- **Change:** the delta check was **removed**, with the reason recorded inline
  so it is not reintroduced. Only `STAT=T` and zero-CPU-since-start survive as
  sound signals, and only for processes with a `timeout` ancestor.
- **Note:** both false positives were caught by *running* the checker, not by
  reviewing it — the same lesson the release's checker-soundness workstream
  draws, applied to a tool written during that workstream.

---

## Cross-cutting findings

1. **Not one stranding was caught by the mechanism responsible for catching
   it.** Every one was caught by an out-of-band filesystem or process check.
   This is the same structural result the release's audit rounds keep
   producing: independent corroboration with a *different* predicate is the
   only thing that has detected anything.
2. **Prompt prohibitions do not prevent backgrounding.** Two occurrences with
   the prohibition stated verbatim.
3. **"Still running" is the most dangerous status.** Suspended, never-launched,
   and network-blocked lanes are indistinguishable from working ones without
   process-state inspection.
4. **Untagged concurrency makes cleanup unsafe.** The correct action for an
   unattributable wedged process is to leave it alone, so untagged lanes
   accumulate.
