---
description: Run the required Foreman QA checks before claiming work is done
---

# Foreman QA preflight

Run this preflight before claiming the work is done. Perform the following
checks in order and report the evidence from each check.

1. Read the actual working diff with `git diff` and `git diff --stat`. Review
   what changed instead of relying on what was intended.
2. Run `git ls-files -s` for the files in scope. Confirm their file modes and
   investigate accidental executable-bit changes or mode-only diffs.
3. Before committing, run
   `bash skills/foreman/scripts/docs-check.sh`. Read and report its output; do
   not rely only on its exit code. This fail-closed documentation and
   comment-quality gate runs markdownlint-cli2, codespell, lychee, agent
   vendor-invocation drift checks, and a Bash comment-coverage check. Exit 0
   means pass, exit 1 means findings, and exit 2 means a required tool was
   missing and the gate failed closed.
4. After committing, run `git status --porcelain` and confirm its output is
   empty. Nonempty output means files remain unstaged, modified, or untracked.
5. State explicitly which checks above were not run and why. Silence about a
   skipped check is not acceptable.

Run `docs-check.sh` before committing, not after. Every shell function,
including `main()`, requires shdoc-style header comments such as
`@description`. Add these incrementally; waiting until the end can turn them
into last-minute failures.

After any late edit, including a fix prompted by `docs-check.sh` or lint output,
run `git add` again on every changed file before committing. A commit captures
the index, not the working tree. An edit made after the last `git add` is not
silently added to the commit.
