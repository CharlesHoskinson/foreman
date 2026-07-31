# SPEC — crlf-extensionless-hardening (Foreman S1)

You are implementing one OpenSpec change package. Work ONLY in
`/root/fm-wt/s1-crlf` (a git worktree on branch
`s1/crlf-extensionless-hardening`). Never touch `/root/foreman` — another
session is live there.

## 1. Objective

Two defects share the same file set and are fixed together:

**(a) Exec bit.** 41 tracked, directly-executed, Foreman-owned scripts are git
mode `100644`. On a fresh ext4 clone they fail with `Permission denied`,
because they are invoked by direct exec (e.g. `scripts/review-package BASE
HEAD` from `SKILL.md`, never `bash …`) and `install.sh`'s chmod glob only
covers `skills/foreman/scripts/*.sh` + `lib/*.sh`.

**(b) Line endings.** The repo's CRLF protection keys on file *extensions*
(`*.sh`, `*.bash`, `*.bats`). Three extensionless shebang scripts fall
through, so on an `autocrlf=true` checkout (Git-Bash default, and a `/mnt/c`
Windows checkout read from WSL) they materialise CRLF and reproduce a
`set -euo pipefail\r` -> `set: pipefail: invalid option name` failure on real
WSL bash. Their git INDEX blobs are already LF — the index was never the bug.

## 2. Files

Modify:

- `.gitattributes` (repo root)
- The exec bit **in the git index** for the derived 41-file inventory
- `skills/superpowers/.gitattributes` if a path rule belongs there

Create:

- `tests/line-endings.bats`
- `REPORT.md` at the worktree root (see section 5)

Do NOT modify: anything under `openspec/`, any script's *contents*, or
`/root/foreman`.

## 3. Interfaces / required content

### 3a. `.gitattributes` root

Add, keeping the existing `*.sh`/`*.bash`/`*.bats` rules as documented intent:

- `* text=auto eol=lf` catch-all
- Binary carve-out: `*.png *.jpg *.jpeg *.ico *.pdf *.exe binary` (insurance
  against `text=auto` mis-detecting a NUL-free binary)
- Windows-script carve-out: `*.bat *.cmd *.ps1 text eol=crlf`
- Explicit path rules (`text eol=lf`) for the three extensionless scripts:
  `skills/superpowers/skills/subagent-driven-development/scripts/review-package`,
  `.../sdd-workspace`, `.../task-brief` — mirror the existing
  `hooks/session-start text eol=lf` rule in `skills/superpowers/.gitattributes`.

### 3b. The inventory — DERIVE IT, DO NOT HARDCODE 41

**This is the single most important constraint in this brief.** Three
documents previously carried three different numbers for this fix (34, 33, 3)
and *all three were wrong*. Decision D1 (`docs/research/vnext/
DECISIONS-resolved.md`) resolves it: the package scopes an **inventory, not a
number**.

The set is every tracked file that is Foreman-owned, directly executed, and
currently mode `100644`. It decomposes as:

| Set | Count |
|---|---|
| `skills/foreman/scripts/**/*.sh` (includes `nats/setup.sh`) | 34 |
| Extensionless SDD scripts under `skills/superpowers/skills/subagent-driven-development/scripts/` | 3 |
| `skills/superpowers/hooks/*` | 4 |
| **Total** | **41** |

Those counts are given so you can *check your sweep reproduces them* — they
are not the specification. Apply `git update-index --chmod=+x` to the derived
set. `git ls-files -s` must then report `100755` for each.

Note `tasks.md` Task 3 says "the same three scripts". That text is **stale and
superseded by D1 and by `specs/line-endings/spec.md`**. Follow the spec: all 41.

### 3c. `tests/line-endings.bats`

For EVERY tracked file whose content begins with a `#!.../bash` shebang (any
extension, including none), assert:

- **(a)** its git index is LF — `git ls-files --eol` reports `i/lf`. This is
  non-vacuous on every host including a fresh ext4 clone.
- **(b)** on an `autocrlf=true` checkout, the working-tree bytes contain zero
  `\r`. Skip with a stated reason where autocrlf is not in effect — a silent
  skip is a failure.
- **(c)** every file in the derived exec-bit inventory is mode `100755`. If a
  new directly-executed script is added without the exec bit, the test FAILS
  **naming the file**. Assert the derived inventory, never a literal count.

## 4. Constraints

- Use `git update-index --chmod=+x`. A filesystem `chmod` alone does NOT
  change the index mode and does not fix this defect.
- Run `git add --renormalize .` for completeness. Expect a near-no-op for line
  endings (index blobs are already LF). Diff the result and confirm ONLY
  line-ending changes landed — report any content change instead of accepting it.
- Do NOT `git commit`. Leave your work in the worktree; the architect commits.
- Do not reformat, restructure, or "improve" any script contents.
- Match the surrounding style of existing `.bats` files in `tests/`.

## 5. Verification — MANDATORY, and the report

This release has a standing rule that overrides your normal instinct to report
success:

> **Every checker must be demonstrated to FAIL against a known-bad input
> before it is trusted. A check never observed failing is not evidence.**

So you MUST do a red-first proof for `tests/line-endings.bats`:

1. Run the suite and capture it passing.
2. Deliberately break each of the three assertions in turn — e.g. `git
   update-index --chmod=-x` one inventory file; introduce a CRLF working-tree
   file with a bash shebang — and capture the test FAILING, and failing with a
   message that NAMES the offending file.
3. Restore, and capture green again.

A test you did not observe failing does not count as delivered.

Then run:

```
cd /root/fm-wt/s1-crlf
bats tests/line-endings.bats
git ls-files -s | awk '$1=="100755"' | wc -l
git ls-files --eol | grep -c 'i/lf'
bash skills/foreman/scripts/docs-check.sh || true
```

Write `REPORT.md` at the worktree root containing:

- What you changed, file by file
- **The exact command you used to derive the inventory, and its output count**
- The red-first evidence: the command that made each assertion fail, and the
  actual failure text you observed
- Anything in the spec you could not satisfy, stated plainly

Do not claim a command passed unless you ran it and are quoting its real
output. If something is blocked, say so in `REPORT.md` — a stated blocker is a
good outcome; a fabricated pass is the failure mode this entire release exists
to eliminate.
