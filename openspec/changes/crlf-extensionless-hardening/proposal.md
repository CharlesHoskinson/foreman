# Change: crlf-extensionless-hardening

## Why

There is a real, but narrower-than-first-thought, bug: `skills/superpowers/skills/
subagent-driven-development/scripts/{review-package,sdd-workspace,task-brief}`
are `#!/usr/bin/env bash` + `set -euo pipefail` scripts with NO file
extension. Their git INDEX blobs are LF (`git ls-files --eol` reports
`i/lf` — confirmed on this checkout) — the index was never the bug. But they
carry NO `eol=lf` attribute (`git check-attr eol` reports "unspecified"),
because the repo's CRLF fix keys on extensions: the root `.gitattributes` has
`*.sh`/`*.bash`/`*.bats text eol=lf` rules, and the nested
`skills/superpowers/.gitattributes` has a `hooks/session-start text eol=lf`
path-specific carve-out for exactly one other extensionless script — but no
equivalent rule exists for these three. So on a checkout with
`core.autocrlf=true` (Git-Bash's default, and a shared `/mnt/c` Windows
checkout read from WSL — confirmed `w/crlf` on this host today), they
materialize as CRLF in the working tree and reproduce the exact 2026-07-16
`pipefail\r` bug on real WSL bash. A fresh ext4 clone (`autocrlf=false`)
checks them out LF — no bug there. This is a **shared-checkout /
autocrlf-seam** hardening, not a fresh-clone blocker.

The same three scripts are ALSO a live exec-bit trap: they are git mode
`100644` and invoked by **direct exec** (`scripts/review-package BASE HEAD`
from `SKILL.md`/the SDD prompts), never `bash …`; `install.sh`'s chmod glob
only touches `skills/foreman/scripts/*.sh` + `lib/*.sh`, never
`skills/superpowers/**`. So on a fresh ext4 clone (where the CRLF bug does
NOT reproduce) they fail with `Permission denied` instead. Both defects share
the same three files and are fixed together here.

This is also a policy gap, not just three files: Microsoft/VS Code's
documented recommendation (SOTA research, R4) is a repo-root `.gitattributes`
catch-all — `* text=auto eol=lf` plus a `*.bat/*.cmd/*.ps1 eol=crlf`
carve-out for genuine Windows scripts, plus a binary carve-out as insurance
against `text=auto` mis-detecting a NUL-free binary — normalized via `git add
--renormalize`. foreman has the `*.sh`-class rules but not the catch-all,
which is exactly why an extensionless script falls through unprotected.

## What changes

- `.gitattributes`: add a `* text=auto eol=lf` catch-all; add a binary
  carve-out (`*.png *.jpg *.jpeg *.ico *.pdf *.exe binary`); add explicit
  path-specific LF rules for the three extensionless shebang scripts
  (mirroring the existing `hooks/session-start` pattern in
  `skills/superpowers/.gitattributes`); add a `*.bat *.cmd *.ps1 text
  eol=crlf` carve-out for genuine Windows scripts. This forces LF
  working-tree on `autocrlf=true` checkouts (as `*.sh` already are `w/lf`).
- `git update-index --chmod=+x` the three scripts (committed mode `100644` →
  `100755`) so a fresh ext4 clone can direct-exec them.
- `git add --renormalize .` is run for completeness, but is expected to be a
  near-no-op for line endings — the index blobs are already LF; it may only
  pick up newly-attributed files the broadened catch-all now covers.
- A new regression test, `tests/line-endings.bats`, that asserts, for EVERY
  tracked file with a `#!.../bash` shebang (any extension, including none):
  (a) its git INDEX is LF (`git ls-files --eol` reports `i/lf`) — non-vacuous
  on every host including a fresh ext4 clone; and (b) on an `autocrlf=true`
  checkout, the working-tree bytes contain no `\r` — closing the
  declared-vs-verified gap so policy and reality cannot drift apart silently
  again. The red-first proof for (b) runs on a Git-Bash/`autocrlf=true`
  checkout, the only place the three scripts are `w/crlf` today.

## Impact

- Affected: `.gitattributes` (root), the three extensionless scripts under
  `skills/superpowers/skills/subagent-driven-development/scripts/`
  (working-tree line endings normalized on autocrlf checkouts, exec bit set
  in the index, no logic change), new `tests/line-endings.bats`.
- `git add --renormalize .` may touch other tracked files if the new
  catch-all surfaces additional drift beyond the three known files (R1's
  internal audit found only these three, but the catch-all is broader than
  the prior extension-keyed rules by design); expected near-empty.
- Depends on: none. Should land alongside/before wsl-launcher-shipped and
  wsl-ci-parity, since P5's CI job runs this bats file.
