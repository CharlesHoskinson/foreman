# Tasks — crlf-extensionless-hardening

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [x] **1. `.gitattributes` catch-all** — add `* text=auto eol=lf` to root
  `.gitattributes`, plus a `*.png *.jpg *.jpeg *.ico *.pdf *.exe binary`
  carve-out (insurance against `text=auto` mis-detecting a NUL-free binary)
  and a `*.bat *.cmd *.ps1 text eol=crlf` carve-out for genuine Windows
  scripts; keep the existing `*.sh`/`*.bash`/`*.bats` rules as documented
  intent.
- [x] **2. Explicit path rules for the three offenders** — add path-specific
  `text eol=lf` rules for `skills/superpowers/skills/
  subagent-driven-development/scripts/{review-package,sdd-workspace,
  task-brief}`, mirroring the existing `hooks/session-start` rule in
  `skills/superpowers/.gitattributes`.
- [x] **3. Exec-bit fix** — `git update-index --chmod=+x` the same three
  scripts (committed mode `100644` → `100755`), so a fresh ext4 clone can
  direct-exec them (they are invoked as `scripts/review-package BASE HEAD`
  from `SKILL.md`, never via `bash …`, and `install.sh`'s chmod glob does not
  cover `skills/superpowers/**`).
- [x] **4. Renormalize** — run `git add --renormalize .`; diff the result to
  confirm only line-ending changes landed (no unintended content changes).
  Expect this to be a near-no-op for the three scripts — their git INDEX
  blobs are already LF (`i/lf`); the durable fix is the `.gitattributes`
  `eol=lf` attribute coverage forcing the working tree to LF on
  `autocrlf=true` checkouts, not the renormalize step itself.
- [x] **5. `tests/line-endings.bats`** — assert, for every tracked file whose
  content starts with a `#!.../bash` shebang (any extension, including
  none): (a) its git INDEX is LF (`git ls-files --eol` reports `i/lf`) —
  non-vacuous on every host, including a fresh ext4 clone; and (b) on an
  `autocrlf=true` checkout, the working-tree bytes contain zero `\r` bytes.
  The red-first proof for (b) runs on a Git-Bash/`autocrlf=true` checkout —
  the only place the three scripts are `w/crlf` today.
- [x] **6. Live WSL confirmation** — re-run all three previously-broken
  scripts on real WSL bash (both via `bash script` and via direct exec) and
  confirm the `pipefail\r` failure and the `Permission denied` failure are
  both gone.
- [ ] **7. Verify** — new bats file passes under the mutex; `docs-check.sh`.

Acceptance: the three scripts are index-LF on every host, working-tree LF on
autocrlf checkouts, and executable (`100755`) in the index, running clean on
real WSL bash both ways; `.gitattributes` has a total `* text=auto eol=lf`
policy with a binary carve-out and a Windows-script carve-out;
`tests/line-endings.bats` proves the policy against the index (every host)
and actual working-tree bytes (autocrlf hosts), not just declared attributes.
