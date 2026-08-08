---
description: Run the required Foreman QA checks before claiming work is done
---

# Foreman QA preflight

Run this preflight before claiming the work is done. Perform the following
checks in order and report the evidence from each check.

1. Confirm every command whose result you are relying on actually executed. An
   exit code belongs to the wrapper, not to the work: a run mangled by argument
   quoting, path conversion, a missing `PATH`, or a detached shell reports
   success and produces nothing. Bind each claim to a non-empty, on-topic
   artifact you have read. Consult
   [AGENT_TRAPS.md § 1 Environment traps](../../../AGENT_TRAPS.md) for the known
   shapes, and the `footguns` skill when driving WSL from Windows or dispatching
   a headless vendor CLI.
2. Read the actual working diff with `git diff` and `git diff --stat`. Review
   what changed instead of relying on what was intended.
3. Run `git ls-files -s` for the files in scope. Confirm their file modes and
   investigate accidental executable-bit changes or mode-only diffs.
4. Before committing, run
   `bash skills/foreman/scripts/docs-check.sh`. Read and report its output; do
   not rely only on its exit code. This fail-closed documentation and
   comment-quality gate runs markdownlint-cli2, codespell, lychee, agent
   vendor-invocation drift checks, and a Bash comment-coverage check. Exit 0
   means pass, exit 1 means findings, and exit 2 means a required tool was
   missing and the gate failed closed.
5. After committing, run `git status --porcelain` and confirm its output is
   empty. Nonempty output means files remain unstaged, modified, or untracked.
6. State explicitly which checks above were not run and why. Silence about a
   skipped check is not acceptable.

Run `docs-check.sh` before committing, not after. Every shell function,
including `main()`, requires shdoc-style header comments such as
`@description`. Add these incrementally; waiting until the end can turn them
into last-minute failures.

After any late edit, including a fix prompted by `docs-check.sh` or lint output,
run `git add` again on every changed file before committing. A commit captures
the index, not the working tree. An edit made after the last `git add` is not
silently added to the commit.

When a trap fires that is not yet listed, add it to `AGENT_TRAPS.md` with the
observed symptom first. The symptom is what the next session will search for.
