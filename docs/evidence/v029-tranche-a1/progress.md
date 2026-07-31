# Tranche A.1 progress ledger

Plan: docs/superpowers/plans/2026-07-31-v029-tranche-a1-recording-instruments.md
Branch: integrate/v029-w1
Started: 2026-07-31

Tasks listed complete here are DONE. Do not re-dispatch them.

Task 1: complete (commits 45d626a..2adcc74, review clean)
  - spec OK, quality approved; union verified lossless at line level by the reviewer
  - MINOR (deferred to the doc sprint): the section "Event 3 - a watchdog with two blind surfaces" appears 3x verbatim in the ledger source; pre-existing, insertion-only brief correctly left it
Task 2: complete (commits 2adcc74..af2b63d, review clean)
  - measurements 10 and 11 recorded with scope; 11 records INCOMPLETE honestly
Task 3: complete (commits af2b63d..531d760, review clean)
  - fm-session.py retire + schema v3; session.bats 11->14; measurements 2 and 9 retired by 10
  - MINOR (for bugeventlog): a bad sed -i briefly corrupted baseline.tsv line 45 mid-task; caught by diff before commit
Task 4: complete (commits 531d760..ca56916, review clean)
  - repo_root now --path-format=absolute --git-common-dir; store canonical at /root/foreman/.foreman/session.db
  - session.bats 14->15; fact 16 superseded by 32; old DB retained at integrate
  - IMPORTANT follow-up -> obligation recorded: .foreman/config.toml still resolves per-worktree
  - MINOR (for bugeventlog): WSL file-splice dropped the 100755 bit; caught by git show --stat, fixed in ca56916
Task 5: complete (commits ca56916..f93e549, review clean)
  - closed obligations 8, 9, 10, 22 with evidence; fact 33 records ob 10 obsolete premise
  - obligations open=14 blocked=4; ob 3 correctly left open (premise only partly stale)
  - MINOR (for bugeventlog): the ARCHITECT relayed an unverified claim (ob 24 already closed); the implementer checked the store, found it open, and refused to reconcile silently
Task 6: complete (commits f93e549..fcad89f, re-review approved after 1 fix round)
  - tools/plugin-drift.sh + tests/plugin-drift.bats (3 tests, registered in both policy files)
  - real install is 20 files behind; repoint REFUSED (Windows checkout ~190 dirty, diverged)
  - obligation 24 corrected done->blocked: it was closed on half its text
  - MINOR (for bugeventlog): a review agent wrote to the live session store it was reviewing, then DELETEd the row; reviewers need read-only access to the record under review
Task 7: complete (commits fcad89f..fd0ebef, approved after 1 fix round)
  - root cause was NOT no-reap: the trap killed the wrapper subshell, not the sleep inside it
  - first fix (setsid) introduced 2 regressions, both caught by review with A/B proof; second fix reverted to in-group self-terminating watchdog
  - decision-events.bats: 1800s hang -> 65s, 8/10 pass (3 and 5 pre-existing, untouched); baseline 9->8 (9 was never observed)
  - 5 MINOR residuals from re-review -> obligations 28, 29 recorded; items 4-5 (test scope/fd coupling) for the final review to triage
Task 8: complete (commits fd0ebef..093ca29)
  - SUITE COMPLETED FOR THE FIRST TIME: 511 tests, 19m13s, zero per-file timeouts
  - RESULT FAIL test_failures=6 -> 1 was ours (lock.bats guard matched its own documentation), fixed at 093ca29
  - 2 known gate-eval failures (decision-events 3,5) belong to Plan 2
  - 3 pre-existing env-sensitive test defects (grok-lane 11, lifecycle-gate 1, vendor-isolation 7) -> obligations 30,31,32
  - root cause of all 3: lane-run.sh PREPENDS the env-file PATH ahead of each test shim, so tests probed the real grok/claude

FINAL REVIEW: 4 blockers + 4 important, all fixed (f2e1397, 880f0b9, b7b75b5, 3ec2ae0)
  - B1 retire reported success for a nonexistent measurement (the PLAN supplied that code)
  - B2 projector exported retired measurements as live: recover and project disagreed on one number
  - B3 retire allowed cycles; recover then said every measurement is fresh over an empty set
  - B4 reap signalled a PID already freed by wait (PID-reuse hazard on the merge-gating path)
  - I1 obligation 27 tombstone restored; I2 bugeventlog events 14-18; I3 plugin-drift wired as informational gate; I4 orphan-store warning
  - session.bats 15->19, all four new tests are negative controls verified failing first

VERIFICATION: pass=493 fail=3 skip=19 of 515, zero timeouts, only vendor-isolation below baseline
  - grok-lane 11 and lifecycle-gate 1 PASS with HOME+PATH set, confirming the env-sensitivity triage empirically

LANDED: origin/main fast-forwarded dbf81b3..3ec2ae0 (16 commits). Branch and main level. Worktree preserved for Plans 2-6.
