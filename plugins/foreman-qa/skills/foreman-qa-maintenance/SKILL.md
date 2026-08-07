---
name: foreman-qa-maintenance
description: Use at the end of a Foreman iteration or release to fold what was learned back into the foreman-qa plugin so it does not go stale.
---

# Foreman QA maintenance

Run this ritual at the end of every Foreman iteration and always before tagging a release.

## Maintenance ritual

1. Collect candidates. From the plugin's own repository checkout, run `scripts/plugin-lessons.sh candidates` and review every item it prints. A check that passes on this host does not mean the lesson does not apply. A lesson that reproduces only on a code path that CI or the current host does not exercise is still a real candidate: CI green only proves the paths CI took.
2. Fold each relevant candidate into the relevant skill file. Edit the guidance in the affected skill or skills under `plugins/foreman-qa/skills/` so the lesson is enforced or stated, not just remembered. When a candidate concerns a check or predicate that failed to discriminate clean from dirty output, every predicate must carry a positive control proving it discriminates.
3. Record the lesson in `LESSONS.md`. Append one row containing the release, date, symptom, root cause, rule, and where the rule now lives. A commit records the INDEX, not the working tree. After any late edit, re-run `git add` and confirm `git status --porcelain` is empty before trusting what will be committed.

## Release gate

Before tagging a release, run `scripts/plugin-lessons.sh check`. It must exit 0 before the tag is cut. Exit 1 means the plugin has fallen behind and needs ritual step 2 or 3 before release. Exit 2 means the check itself could not run; fix the environment first.

## Source of truth

The copy under `plugins/foreman-qa/` in this git worktree and repository is the source of truth. Any copy installed under `~/.claude/plugins` is derived: refresh it from the repository copy and never edit it in place. If you are about to edit a file under `~/.claude/plugins/foreman-qa`, stop, edit the repository copy, and refresh the installation instead. `tools/plugin-drift.sh` provides analogous drift detection for the sibling `foreman` plugin but is not a dependency of this ritual.
