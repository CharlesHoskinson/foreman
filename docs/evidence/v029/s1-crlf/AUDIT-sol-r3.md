# Round 3 Audit

VERDICT: BLOCKED

## Scope

- Repository: `/root/fm-wt/s1-crlf`
- Branch: `s1/crlf-extensionless-hardening`
- Diff: `bbb8ad8..c89077a`
- Acceptance criteria:
  - `openspec/changes/crlf-extensionless-hardening/specs/line-endings/spec.md`
  - D1 amendment in `docs/research/vnext/DECISIONS-resolved.md`

## Synthetic Coverage Matrix

All probes below were `100644` entries added only to a copied index, with
synthetic objects stored under `/tmp`.

| Region | Top level | Nested | Extensionless | `.sh` | Non-shebang |
|---|---:|---:|---:|---:|---:|
| `skills/foreman/scripts/` | covered | covered | covered | covered | excluded |
| SDD `scripts/` | covered | covered | covered | not separately needed | excluded |
| `env/` | covered | covered | covered | covered | excluded |
| `tests/probes/` | covered | covered | covered | not separately needed | excluded |
| `skills/superpowers/hooks/` | covered | covered | covered | not separately needed | covered by deliberate directory policy |
| repository root, other than exact `install.sh` | escapes | n/a | escapes | escapes | excluded |
| `skills/foreman/` outside `scripts/` | escapes | escapes | escapes | not separately needed | excluded |
| other Superpowers scripts/skills | escapes | escapes | escapes | not separately needed | excluded |
| `tests/` outside `probes/` | escapes | escapes | escapes | not separately needed | excluded |
| `sandbox/`, `.github/scripts/`, `bin/` | escapes | escapes | escapes | not separately needed | excluded |

The only demonstrated in-scope relocation hole is repository root: the current
inventory explicitly claims root-owned `install.sh`, but represents that region
with the one literal filename. Existing out-of-inventory bash files elsewhere
are Superpowers-owned tooling/tests, bash-invoked test helpers, or Docker inputs
that the Dockerfile explicitly chmods after copy; no current unintended
Foreman direct-exec file was found among them.

## Findings

### F1 — BLOCKER — newly covered scripts remain non-executable

`tests/line-endings.bats:48-53` adds `install.sh` and `env/*` to the
property-derived inventory, and `tests/line-endings.bats:153-177` requires every
inventory member to have index mode `100755`. At commit `c89077a`, however,
`git ls-files -s` reports `100644` for all four newly covered files:

```text
100644 env/bootstrap-wsl.sh
100644 env/tool-check.sh
100644 env/wsl-clock-preflight.sh
100644 install.sh
```

Thus the round-3 checker correctly discovers four defects that round 3 itself
does not repair. This violates the acceptance requirement that every member of
the mechanically derived direct-exec inventory be executable.

### F2 — BLOCKER — root coverage is still a literal singleton and relocates the hole

`tests/line-endings.bats:48-53` has no extension filter, but it is not free of
literal file paths: line 51 passes the exact path `install.sh`. In a temporary
index, synthetic `100644` bash-shebang files at both
`zz-audit-root-extless` and `zz-audit-root.sh` were absent from
`exec_bit_inventory()` and were not named by the mode test. The same synthetic
blob was covered and named at the top and at nested depths under each declared
directory tree (`skills/foreman/scripts/`, SDD `scripts/`, `env/`,
`tests/probes/`, and `skills/superpowers/hooks/`).

This is the same defect class as rounds 1 and 2: moving a future directly
executed root script next to `install.sh` bypasses the regression test. The
root must be swept as a region and filtered by the index-blob shebang property,
not represented by one known filename.

### F3 — WARNING — index object/type errors are silently converted to exclusion

`tests/line-endings.bats:44` suppresses every `git show ":$f"` error with
`2>/dev/null ... || true`, and it does not first restrict the property scan to
regular-file index modes.

Concrete temporary-index evidence:

- A `100644` candidate pointing to a deliberately missing object made direct
  `git show :path` fail with exit 128, but `exec_bit_inventory()` emitted no
  diagnostic and excluded it. After F1's four modes were corrected in that
  temporary index, the mode test passed despite the unreadable candidate.
- A normal `120000` symlink was excluded, but a `120000` symlink whose link
  target blob began `#!/usr/bin/env bash` was falsely included and then failed
  the impossible requirement that a Git symlink have mode `100755`.
- An ordinary NUL-containing binary was excluded, but Bash emitted
  `warning: command substitution: ignored null byte in input`. A binary whose
  first line was a bash shebang was included. Empty files and `160000` gitlinks
  in the property-filtered tree were cleanly excluded.

The scan should distinguish regular blobs from symlinks/gitlinks and propagate
object-read failures instead of treating them as a negative predicate.

### F4 — BLOCKER — the new PNG test mutates the live worktree/object database and has no failure cleanup

Despite the “Temporary index only” statement at
`tests/line-endings.bats:247-248`, lines 292-301 copy a probe to the fixed live
path `assets/zz-nul-free-probe.png` and run `git hash-object -w` without a
temporary object directory. Cleanup occurs only on the straight-line success
path at lines 313-314; there is no trap.

This audit observed the concrete failure mode: the sandbox rejected the real
object-database write at line 300, Bats aborted the test, and
`assets/zz-nul-free-probe.png` remained in `git status`. The audit removed that
probe immediately and verified the worktree returned to its prior state.

On a writable checkout, every run can write an unreachable probe object into
the real object database. More seriously, a pre-existing untracked file at the
fixed probe path would be overwritten and then deleted, and any failure between
lines 296 and 314 leaves residue. The probe must run in an isolated disposable
worktree/object directory, or preserve/restore the path with reliable trap-based
cleanup and a temporary object database.

### F5 — BLOCKER — Windows carve-out test does not protect the `.bat` or `.cmd` root rules

The acceptance criterion requires independent root carve-outs for `*.bat`,
`*.cmd`, and `*.ps1`. `tests/line-endings.bats:194-225` only examines tracked
paths. This corpus has four tracked `.ps1` files, no tracked `.bat`, and one
tracked `.cmd` whose nested `skills/superpowers/.gitattributes` rule
deliberately resolves to LF.

In a disposable clone, deleting only the root `*.bat text eol=crlf` and
`*.cmd text eol=crlf` lines left the filtered Windows test green (`1..1`,
`ok 1`, exit 0). Thus the new assertion protects the `.ps1` rule but not the
other two acceptance-required rules. It should probe each root pattern
independently (synthetic top-level path names are sufficient) while retaining
the nested polyglot exception.

## Evidence Log

- Audit report skeleton created before any repository inspection.
- Conclusion 1 — diff isolation: `git diff --name-status bbb8ad8..c89077a`
  reports only `M tests/line-endings.bats`; its tree mode is `100755` at
  `c89077a`. Round 3 itself does not alter `.gitattributes`, production files,
  or any file mode.
- Conclusion 2 — current derived inventory has 46 entries. Exactly four fail
  its `100755` requirement: `install.sh`, `env/bootstrap-wsl.sh`,
  `env/tool-check.sh`, and `env/wsl-clock-preflight.sh`, all mode `100644`.
- Conclusion 3 — temporary-index coverage matrix:
  - Covered recursively, extensionless and `.sh`: `skills/foreman/scripts/`,
    SDD `scripts/`, `env/`, and `tests/probes/`.
  - Covered recursively regardless of content: `skills/superpowers/hooks/`.
  - Escapes: any other root path (including both tested shebang forms), plus
    all paths outside those listed pathspecs.
  - The mode test failed and named every covered `100644` synthetic; it did
    not name any escaping synthetic.
- Conclusion 4 — the content predicate itself is genuinely extension-agnostic
  and index-based. `tests/line-endings.bats:44-46` reads `git show ":$f"` and
  matches the first index-blob line; extensionless synthetic entries that
  existed only in `GIT_INDEX_FILE` were discovered and named. There is no
  `*.sh`/other extension filter in lines 41-53. The remaining literal is the
  exact root path `install.sh`, addressed in F2.
- Conclusion 5 — `skills/foreman/scripts/adapters/verdict.schema.json` is
  correctly excluded. It is mode `100644`, its index blob starts with `{`, and
  a bare `skills/foreman/scripts/*` sweep does include it, while the shebang
  predicate does not. In a temporary index where only F1's four scripts were
  changed to `100755`, the filtered mode test passed (`1..1`, `ok 1`) with the
  schema still `100644`.
- Conclusion 6 — the deliberate hooks directory sweep is supported by the
  actual bundle. `skills/superpowers/hooks/` contains two JSON manifests,
  extensionless bash `session-start`, and directly invoked cross-platform
  polyglot `run-hook.cmd`, whose first line is not a bash shebang. Both hook
  manifests invoke `run-hook.cmd`. Temporary-index probes at the hook root and
  a nested depth, including a non-shebang JSON probe, were all inventoried and
  named. The exception is over-inclusive by explicit D1 policy but has no
  within-directory extension/content escape.
- Conclusion 7 — all four F1 files genuinely begin
  `#!/usr/bin/env bash`. In a disposable clone, changing only their index modes
  from `100644` to `100755` passed `bash -n`, all 5
  `tests/line-endings.bats` tests, all 9 `tests/tool-check-auth.bats` tests, and
  all 7 `tests/wsl-clock-preflight.bats` tests. No unintended current file is
  selected by the shebang portion: every selected member has a bash shebang.
  The only selected non-bash files are the three deliberately retained hook
  bundle members (`hooks.json`, `hooks-cursor.json`, `run-hook.cmd`).
- Conclusion 8 — performance is acceptable on the current tree: the property
  scan examines 47 candidates (not all 623 tracked paths) and five measured
  runs took 163–187 ms. Edge behavior is detailed in F3. The explicit hooks
  sweep includes empty, binary, symlink, and gitlink members by policy and
  therefore fails closed on any such new member whose mode is not `100755`;
  the type-related silent/false classifications occur in the shebang-filtered
  portion.
- Conclusion 9 — no requested regression:
  - `.gitattributes` is blob
    `18127ee43b060f53d011ddd24aea61322f270837` at both endpoints.
  - `skills/superpowers/.gitattributes` is blob
    `02502a779aa896f071a9158b7ee067386b2ebfe9` at both endpoints.
  - Re-evaluating the pre-round-3 inventory at `bbb8ad8` yields exactly 41
    paths. Every path is `100755` at both `bbb8ad8` and `c89077a`, and the two
    complete mode/path lists have identical SHA-256
    `2c9ca4755936278d691b82e0ecc5630bc8fef7a196e6dfc2d77034ded010745f`.
  - The original change `bfc8af4..f02f207` contains 41 mode changes;
    `f02f207..c89077a` contains none.
- Conclusion 10 — unmodified `c89077a` suite result in a disposable clone:
  tests 1, 2, 4, and 5 pass; test 3 fails and names exactly F1's four `100644`
  paths. Exit status is 1. A real-worktree attempt also encountered the
  sandbox's read-only Git object store in test 5; its created probe was removed
  immediately, and a final status/diff check confirmed no repository change
  outside this report.
- Conclusion 11 — F4's object-database side effect is reproducible on success.
  In a fresh disposable clone, `git count-objects -v` changed from `count: 0`
  to `count: 1` after running only the PNG test, even though the worktree probe
  was removed and the test reported `ok 1`.
- Conclusion 12 — deleting only the root `*.bat` and `*.cmd` CRLF rules in a
  disposable clone left the round-3 Windows test green. The deletion was then
  reverted in that clone. This is F5.

## Verdict Basis

**BLOCKED.** Four independent blockers remain:

1. The widened inventory is red on the real commit because four selected bash
   scripts still ship `100644` (F1).
2. Root coverage still hardcodes `install.sh`, so a relocated/new root
   direct-exec script escapes (F2).
3. The new PNG test can overwrite/delete a live untracked file, leaks a real
   Git object even on success, and leaves residue on failure (F4).
4. The new Windows test cannot detect deletion of the required root `.bat` and
   `.cmd` carve-outs (F5).

The verdict changes to **WARNING** when F1, F2, F4, and F5 are fixed and their
red/green probes pass; F3 would remain as the warning. It changes to
**APPROVED** when F3 is also fixed (regular-file type gating, visible
object-read failures, and clean binary handling) and the full disposable-clone
suite plus the complete temporary-index coverage matrix pass.
