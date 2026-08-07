# LESSONS.md

Append-only register of what each Foreman release taught the foreman-qa
plugin. Entries are never edited or removed once recorded; a correction is a
new entry, not a rewrite. See `skills/foreman-qa-maintenance/SKILL.md` for
the ritual that produces these rows.

Columns: release, date, symptom, root cause, the rule that now prevents it,
and where that rule is written in the plugin.

| Release | Date | Symptom | Root Cause | Rule | Where |
|---|---|---|---|---|---|
| v0.2.9.0 | 2026-07-28 | An unanchored `violation` substring predicate matched `[ok] No violation found`, so a check classified clean and dirty output identically and stayed green for weeks. | The predicate tested for the word `violation` anywhere in the tools output instead of anchoring on the tools actual failure marker, so the tools own success message satisfied it. | Every predicate carries a positive control proving it discriminates. | `skills/foreman-qa-maintenance/SKILL.md`, ritual step 2 |
| v0.3.0 (pending) | 2026-08-06 | A launcher re-exec dropped the parents node flags, so a PID-namespace child could not resolve its own modules. It failed only where `unshare` was permitted and passed where it was denied, which is why CI never caught it. | The re-exec path rebuilt the child's argv without carrying forward the loader flags the parent had been started with, and the only host class that exercises the `unshare` path is not the one CI runs on. | CI green only proves the paths CI took. | `skills/foreman-qa-maintenance/SKILL.md`, ritual step 1 |
| v0.2.9.0 | 2026-08-07 | A commit captured pre-edit files because `git add` ran before a late fix. | The fix landed after staging, so the index still held the pre-fix blob; the commit was cut from the index, not from the working tree, and nothing re-diffed the two. | A commit records the INDEX; re-add after any late edit and confirm `git status --porcelain` is empty. | `skills/foreman-qa-maintenance/SKILL.md`, ritual step 3 |
| v0.2.9.0 | 2026-08-07 | A scripted edit opened a tracked file for writing and truncated it when the write failed. | The script opened the destination path directly in write/truncate mode before it had produced valid output, so a failure between open and successful write left a zero-byte or partial file in place of the original. | Write to a temp file, assert on it, then move it into place. | `scripts/plugin-lessons.sh` (this script performs no direct writes to tracked files) |
