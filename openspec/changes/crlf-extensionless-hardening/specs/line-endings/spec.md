# Spec delta — CRLF/extensionless hardening

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirement: every bash-executed tracked file is LF in its git index on every platform, and LF in the working tree on an autocrlf=true checkout

Every tracked file that bash executes SHALL be LF in its git INDEX (`git
ls-files --eol` reports `i/lf`) on every platform — this is non-vacuous even
on a fresh ext4 clone, where the index is authoritative and no CRLF bug
occurs — AND SHALL be LF in the working tree (no CR byte) on an
`autocrlf=true` checkout (Git-Bash, or a shared `/mnt/c` checkout read from
WSL). This SHALL be verified by a test rather than declared by
`.gitattributes` alone.

- The implementer SHALL add a repo-root `* text=auto eol=lf` catch-all to
  `.gitattributes` (with a binary carve-out, see below) so line-ending
  policy is total, not extension-keyed, plus explicit `eol=lf` rules for the
  three extensionless shebang scripts.
- `tests/line-endings.bats` SHALL assert, for every tracked file whose
  content begins with a `#!.../bash` shebang (any extension, including
  none), that (a) `git ls-files --eol` reports `i/lf` for its index entry
  (checked on every host), and (b) on an `autocrlf=true` checkout, the
  working-tree bytes contain no `\r`.

#### Scenario: CI catches a reintroduced CRLF shebang script

- WHEN CI checks out the repository on `windows-latest` (`autocrlf=true`,
  Git-Bash)
- THEN no tracked `#!.../bash` script SHALL contain `\r` in its working tree
- AND `tests/line-endings.bats` fails loudly if one is reintroduced,
  naming the offending path.

#### Scenario: the three known scripts are index-LF everywhere, and working-tree LF once autocrlf checkouts are hardened

- WHEN `tests/line-endings.bats` runs on any host, including a fresh ext4
  clone
- THEN `skills/superpowers/skills/subagent-driven-development/scripts/
  {review-package,sdd-workspace,task-brief}` report `i/lf` in the git index
  (they already do today — the index was never the bug)
- AND WHEN the same test runs on a Git-Bash/`autocrlf=true` checkout after
  the `.gitattributes` `eol=lf` rules land
- THEN those three scripts are LF in the working tree too, and run without
  the `pipefail\r` failure on real WSL bash
- AND `git add --renormalize .` is a near-no-op here (the index blobs were
  already LF; it may only pick up newly-attributed files).

## ADDED Requirement: binary files are protected from text=auto mis-detection

WHERE a tracked file is a known binary type (`*.png *.jpg *.jpeg *.ico *.pdf
*.exe`), `.gitattributes` SHALL mark it `binary` so the `* text=auto eol=lf`
catch-all cannot mis-detect a NUL-free binary as text and rewrite its bytes.

#### Scenario: a binary asset is untouched by the catch-all

- WHEN the `* text=auto eol=lf` catch-all is added to `.gitattributes`
- THEN a `*.png *.jpg *.jpeg *.ico *.pdf *.exe binary` rule is present
- AND a tracked binary file's bytes are bit-identical after `git add
  --renormalize .`.

## ADDED Requirement: the three extensionless SDD scripts are executable in the git index

The three extensionless shebang scripts under
`skills/superpowers/skills/subagent-driven-development/scripts/` SHALL be
git mode `100755` (not `100644`), since they are invoked by direct exec
(`scripts/review-package BASE HEAD` from `SKILL.md`/the SDD prompts, never
`bash …`), and `install.sh`'s chmod glob does not cover
`skills/superpowers/**`.

#### Scenario: a fresh ext4 clone can direct-exec the SDD scripts

- WHEN `git update-index --chmod=+x` is applied to the three scripts per
  this change
- THEN `git ls-files -s` reports mode `100755` for each
- AND on a fresh ext4 clone, `scripts/review-package BASE HEAD` runs without
  a `Permission denied` error.

## ADDED Requirement: genuine Windows scripts remain CRLF

WHERE a tracked file is a genuine Windows script (`.bat`, `.cmd`, `.ps1`), it
SHALL be CRLF, and the repo-root catch-all SHALL NOT normalize it to LF.

#### Scenario: Windows script carve-out is respected

- WHEN the `* text=auto eol=lf` catch-all is added to `.gitattributes`
- THEN a `*.bat *.cmd *.ps1 text eol=crlf` carve-out rule is present ahead of
  (or alongside) it
- AND a tracked `.ps1`/`.bat`/`.cmd` file's working-tree line endings remain
  CRLF after `git add --renormalize .`.
