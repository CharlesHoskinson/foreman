---
name: checkpoint
description: Use when ending a work session, pausing, hitting a context limit, or before any handoff - captures a canonical stopping point so no context is lost. Also use when resuming, to recover the previous session. Replaces hand-written devlog/RESUME prose with typed, staleness-aware records.
---

# checkpoint — canonical session stopping point

A checkpoint is not a summary. A summary is prose someone must read and
reconcile; this is **typed records a machine can hand back verbatim**, with
every perishable claim carrying a computed freshness verdict.

The failure this exists to prevent, observed repeatedly: an agent resumes, reads
a hand-written RESUME doc, and confidently quotes "13/13 tests green" that was
measured hours and eleven commits earlier. The number was never wrong when
written. It went stale, and flat prose cannot say so.

Store: `.foreman/session.db` (SQLite).
Tool: `skills/foreman/scripts/fm-session.py`.

## Resuming — do this FIRST, before anything else

```bash
python3 skills/foreman/scripts/fm-session.py begin --note "what you are about to do"
```

This prints the canonical recovery and mints a session id. It is the **only**
recovery you need — do not also go reading old RESUME files, and do not trust a
number in any markdown file over what this prints.

Read the output in this order:

1. **STALE / unknown measurements.** Each carries the exact command that
   produced it. **Re-run them before quoting any of their numbers.** This is the
   whole point of the checkpoint system; skipping it reintroduces the bug.
2. **Open obligations.** This is your work queue.
3. **Facts.** Durable context — what landed, with evidence.

## Creating a checkpoint — when to do it

Do this when the user says checkpoint, when you are pausing or handing off,
**when you sense the context window filling**, and before any long-running
dispatch whose result you would otherwise have to remember.

Capture in this order. Everything is `python3 skills/foreman/scripts/fm-session.py …`.

### 1. Facts — durable, true by construction

Things that stay true: a commit landed, a decision was made, a package shipped.
Always attach evidence (a SHA, a path, a command).

```bash
fm-session.py fact "vendor-preflight fixed: auth binds to probe content not exit status" --evidence "commit ad2366f"
fm-session.py fact "remote CI is unavailable (out of GitHub Actions credits); tools/ci-local.sh is the verification authority" --evidence "tools/ci-local.sh"
```

### 2. Measurements — perishable, and the reason this system exists

Any number produced by running something: test counts, timings, benchmark
results, pass/fail verdicts.

**`--scope` is mandatory and the tool refuses without it.** The scope is the set
of paths whose modification would invalidate the number. A measurement with no
scope can never be shown stale, which defeats the entire mechanism.

```bash
fm-session.py measure "tests/audit-verdict.bats pass count" 26 \
  --command "flock /tmp/foreman-bats.lock bats tests/audit-verdict.bats" \
  --scope tests/audit-verdict.bats \
  --scope skills/foreman/scripts/audit-run.sh
```

Recovery then computes `fresh|stale|unknown` at read time via
`git rev-list <measured_sha>..HEAD -- <scope>`. You cannot receive the number
without its verdict.

**Never record process liveness as a measurement.** "Lane X is running" is false
seconds later. Ask the process; that is what `tools/lanectl.sh ps` is for.

### 3. Obligations — owed work and stated blockers

```bash
fm-session.py obligation "wt-merge.sh gate-to-merge TOCTOU needs its own package"
fm-session.py obligation "graph-context-builder T2-T10 unimplemented" --blocker "needs architect diagnosis; task lists do not dispatch"
fm-session.py close 3 --status done
```

A stated blocker is a good outcome. Record it rather than leaving it implied.

### 4. Supersede rather than edit

When a fact stops being true, do not delete it — link the replacement, so the
history of what was believed stays intact:

```bash
fm-session.py supersede 4 "the suite is 41 files, not 33" --evidence "tests/run.sh output"
```

### 5. End the session

```bash
fm-session.py end
```

## What belongs here versus elsewhere

| Goes in the checkpoint | Stays where it is |
|---|---|
| What landed, with evidence | Full narrative devlog prose |
| Numbers, with the command and scope that produced them | `AGENT_TRAPS.md` — standing rules that never go stale |
| Owed work and blockers | `bugeventlog.md` — incident post-mortems |
| Decisions and their reasons | Source code and its comments |

The checkpoint answers *"what is true right now, and what of it can I still
trust?"* The other files answer *"what happened"* and *"what must I never do
again."* Do not merge them.

## Rules

- **Recovery is exact SQL, never similarity search.** Two resumes of the same
  tree must produce the same world. If recovery ever becomes fuzzy, it is no
  longer canonical and you are back to guessing.
- **A measurement without `--scope` is refused.** Do not work around it by
  recording numbers as facts — a fact cannot go stale, so that launders a
  perishable claim into a durable one. That is precisely the original bug.
- **Re-run stale measurements before quoting them.** The recovery output hands
  you the command; there is no excuse.
- Checkpoint *before* the context window is critical, not after. A checkpoint
  you could not finish writing is worth nothing.
