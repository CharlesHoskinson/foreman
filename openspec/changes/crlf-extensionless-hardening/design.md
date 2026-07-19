# Design — crlf-extensionless-hardening

Parent design: `docs/superpowers/specs/2026-07-19-v029-wsl-compat-design.md`
(package P2).

## Citations (load-bearing)

- Live CRLF bug (internal, raw-byte confirmed): `skills/superpowers/skills/
  subagent-driven-development/scripts/{review-package,sdd-workspace,
  task-brief}` are `#!/usr/bin/env bash` + `set -euo pipefail`, no file
  extension, CRLF on disk; `git check-attr eol` reports them unspecified.
- Existing extension-keyed rules that miss this class: root `.gitattributes`
  (`*.sh text eol=lf`, `*.bash text eol=lf`, `*.bats text eol=lf`).
- The precedent this package generalizes: `skills/superpowers/.gitattributes`
  already carries a path-specific carve-out, `hooks/session-start text
  eol=lf`, for exactly one other extensionless script — proof the pattern is
  already known-good in this repo, just not applied to the three affected
  files.
- These three files reproduce the exact 2026-07-16 `pipefail\r` bug on real
  WSL bash (the bug class this repo already fixed once for extension-bearing
  scripts).
- CRLF policy SOTA (R4): Microsoft/VS Code's documented recommendation is a
  repo-root `* text=auto eol=lf` catch-all plus a `*.bat/*.cmd/*.ps1
  eol=crlf` carve-out for genuine Windows files, applied via `git add
  --renormalize`.

## Approach

1. **Catch-all first.** Add `* text=auto eol=lf` to the top of root
   `.gitattributes` (before the existing `*.sh`/`*.bash`/`*.bats` rules,
   which remain as explicit documentation of intent even though the
   catch-all now subsumes them). Add the Windows-script carve-out (`*.bat
   *.cmd *.ps1 text eol=crlf`) so genuinely CRLF-needing files are excluded
   from normalization.
2. **Explicit path rules for the three known offenders**, mirroring the
   `hooks/session-start` precedent exactly (path, not glob, since these
   files have no distinguishing extension):
   `skills/superpowers/skills/subagent-driven-development/scripts/
   review-package text eol=lf` (and the other two), so the intent is
   documented even though the catch-all already covers them.
3. **Renormalize.** `git add --renormalize .` converts the three files (and
   surfaces any other drift the broader catch-all newly covers) to LF in one
   commit-worthy pass. Per the parent design's risk note, R1's internal audit
   found only these three affected files, but the catch-all is intentionally
   broader than the prior extension-keyed rules — the implementer must
   diff the renormalize output and confirm no unexpected files changed
   content in a way that isn't pure line-ending normalization.
4. **Regression test.** `tests/line-endings.bats` walks every tracked file,
   filters to those whose first bytes are a `#!.../bash` (or `#!/usr/bin/env
   bash`) shebang regardless of extension, and asserts (a) no `\r` byte
   appears in the working-tree content and (b) `git ls-files --eol` reports
   `w/lf` for that path. This closes the "declared policy vs. verified
   reality" gap: the `.gitattributes` rule and the actual working-tree bytes
   can no longer silently diverge without the test catching it.

## Key decision

The catch-all (`* text=auto eol=lf`) is the correct SOTA fix rather than
enumerating every extensionless script by hand, because new extensionless
shebang scripts will keep appearing (as these three did) and an
extension-keyed allowlist cannot anticipate them. The explicit per-path rules
for the three known files are kept anyway as documentation, matching the
existing `hooks/session-start` precedent in the same repo.

## Verification

`tests/line-endings.bats` is the executable proof this policy holds: run on
a fresh checkout, it must show zero `\r`-containing shebang scripts and `git
ls-files --eol` reporting `w/lf` universally. The parent design's testing
bias applies here too — the fix is confirmed on a real WSL bash invocation of
all three previously-broken scripts, not merely by the bats assertion.
