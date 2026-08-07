---
name: foreman-afk
description: Use before and during any unattended (AFK) run - how to pace work, what a backstop is for, and the failure that cost a night
---

# Running unattended

## The failure this exists to prevent

On the night of 2026-08-06/07 an unattended run delivered roughly four hours of
work across a seven-and-a-half hour window. Close to three hours were idle. The
owner woke to less than half the work they had authorised.

The cause was not the gates, the tooling, or the environment. It was pacing.

### What actually happened

An hourly cron backstop was armed. Each firing produced ten to twenty minutes of
real work, then the turn ended. The next firing came an hour later. The commit
timestamps show it exactly:

```text
02:19 -> 03:21 -> 04:20 -> 05:22 -> 06:21 -> 07:19
```

Five consecutive gaps of 58 to 62 minutes. Gate runs account for 131 of those
300 minutes. The remaining 169 minutes were nothing.

### The mechanism, stated plainly

**The backstop became the clock.** A cron interval is a recovery mechanism for a
session that has died. Treating it as a work schedule converts every firing into
permission to stop, and the interval silently becomes the throughput ceiling. An
hourly backstop caps output at one work-unit per hour no matter how much work
remains.

Two things made it worse:

1. **Finishing a unit was treated as finishing.** A commit is where the next
   thread starts, not a stopping point. Every turn that ended on "committed X,
   next is Y" was a turn that should have continued to Y.
2. **Gate runs were treated as blocking when they are not.** A bats run holds a
   host-wide mutex and needs the host quiet, but it executes in the background.
   There were three worktrees available. Waiting in one while a gate ran in
   another was pure loss.

The instruction "NEVER end a turn with a summary" was already written into the
operating prompt, by me, and violated repeatedly. Writing a rule is not
following it.

### It happened again

On 2026-08-07 the very session that had just read this file armed a
`ScheduleWakeup` backstop and let it become the schedule a second time:
two consecutive iterations did nothing but wait on a CI run while four
other worktrees sat idle. The owner corrected it twice. A principle
already written down, and already violated once before, was violated
again by the session that had just read it. Writing the rule down was
not enough, because arming a backstop cost nothing to justify even when
work was available -- the rule had no check attached to it. Rule 1 below
is that check.

## Rules

1. **State the in-flight lane list before arming any backstop.** Name
   every worktree and what it is doing right now. An empty list is not
   silence -- it is the condition that means start work, not wait. Do not
   arm a backstop while any lane could be started, advanced, or
   diagnosed instead.
2. **A backstop is not a schedule.** Arm it for session death only, and set it
   far longer than any work unit. Never let a firing be the reason work resumes.
3. **Never end a turn on a completed unit.** If the next action is known, take
   it. "Next: X" in a report means X should already have started.
4. **A running gate blocks one tree, not the session.** Switch to another
   worktree immediately. Prepare the next change, diagnose the next failure,
   write the next test. Only heavy CPU is forbidden, not all work.
5. **Report at boundaries the owner cares about, not at every step.** Progress
   reports are for decisions and blockers. A report that ends in "next I will
   do X" and then stops has substituted narration for work.
6. **Measure idle before claiming a night's output.** Commit timestamps do not
   lie. Gaps longer than the work unit are the number that matters, and it
   should be stated without being asked.

## Pacing check

Before ending any turn during an unattended run, ask: is there an action I can
take right now? If yes, take it. The only valid reasons to stop are a blocked
decision that genuinely requires the owner, an exhausted work list, or a running
job whose output every remaining task depends on — and the last one is rare with
more than one worktree available.
