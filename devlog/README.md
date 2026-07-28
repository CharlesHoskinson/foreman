# devlog

One file per working day, `YYYY-MM-DD.md`. Append-only. Entries are kept even
when what they describe is superseded — especially then.

## Why this exists separately from STATE and RESUME

| File | Answers | Lifecycle |
|---|---|---|
| `STATE.md` | Where are we? | Continuously rewritten |
| `RESUME.md` | What next? | Continuously rewritten |
| `devlog/*.md` | What happened, and what did it teach us? | **Append-only** |

The first two are rewritten every session, which means they systematically
erase the record of what was wrong — exactly the material with the longest
shelf life. The devlog is the only one of the three that accumulates.

## Entry structure

Six sections, in this order:

1. **What actually happened, in order** — narrative, walkable by a stranger who
   was not here. The causal chain, not a task list.
2. **What went right** — with evidence, not adjectives. Before/after tables,
   measured numbers, the command that produced them.
3. **What went wrong** — *this is the section the whole thing exists for.*
   Write it as a table: **what it claimed / what was true.** Unsparing and fast
   to scan.
4. **Standing rules that came out of today** — anything worth enforcing
   tomorrow.
5. **Where things stand** — green or blocked, one paragraph.
6. **Resume instructions** — written for someone with no memory of the session.

## Why section 3 is the point

A devlog that records only wins is a highlight reel, and a highlight reel
teaches nothing. Individual failures look like isolated slips; they only reveal
themselves as a **class** across days.

From the first entry: a `grep` for `violation` matched `[ok] No violation
found`; an invariant was trivially true in exactly the scenario it was meant to
detect; a lane exited 0 having written nothing; a write-evidence digest was
blind to the files it existed to observe. Each looked like a one-off. Together
they are one failure mode — **tooling that reports success it has not earned** —
and once named it produced a standing rule. That pattern is invisible from any
single day.

## Two operating rules

1. **Write it from the day's commits, not from memory.**
   `git log --since="<date> 00:00" --reverse --oneline` and walk it. Memory
   reconstructs a tidy narrative; the log has the mess.
2. **Verify every factual claim in the resume section before writing it.**
   Tomorrow-you will act on those instructions without re-checking. Grep the
   tree for anything section 6 asserts.

## Index

| Date | Headline | Outcome |
|---|---|---|
| [2026-07-28](2026-07-28.md) | v0.2.9 Total GeorgeCall planned end to end: 12 research lanes, 4 Quint models, 3 audit rounds, 26 packages | S1 ready to dispatch; finding rate judged relocating, not converging |
