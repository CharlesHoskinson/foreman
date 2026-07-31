# Final Cold Audit

## VERDICT

**BLOCKED**

At minimum, approval requires applying the regular-blob restriction and
unreadable-object failure path to the hooks sweep as well as the
shebang-property regions, and removing/reworking the PNG test's framework-
clobbering `EXIT` trap so failures retain their diagnostics. The mode
derivation must also cover future Foreman direct-exec locations without adding
another hand-enumerated region each time.

## Findings

Audit baseline:

- Audited branch: `s1/crlf-extensionless-hardening`.
- Audited package: `bfc8af4..27779c4` (five commits, HEAD
  `27779c415584af70a9c974553b3ac82bc9fa5c21`).
- Governing criteria: the line-endings spec plus D1 at
  `docs/research/vnext/DECISIONS-resolved.md:15-37`.
- The pre-audit worktree was already dirty. In particular, `install.sh`,
  `env/bootstrap-wsl.sh`, `env/tool-check.sh`, and
  `env/wsl-clock-preflight.sh` had unstaged filesystem-mode differences.
  Commit-tree and temporary-index evidence below is therefore kept separate
  from the live worktree/index state.

### F1 — BLOCKER — type/error hardening bypasses the appended hooks region

`tests/line-endings.bats:76-106` restricts the shebang-property regions to
`100644|100755` and validates their objects. But
`tests/line-endings.bats:108-114` appends every hooks path directly to the
inventory without either check.

Concrete temporary-index evidence:

- `120000 skills/superpowers/hooks/zz-audit-shebang-target-link`, whose target
  blob begins with `#!/usr/bin/env bash`, was included and failed the mode test
  naming the path instead of being excluded structurally.
- `160000 skills/superpowers/hooks/zz-audit-gitlink` was likewise included and
  failed as though a gitlink could have mode `100755`.
- `100755 skills/superpowers/hooks/zz-audit-unreadable`, pointing to missing
  object `1111111111111111111111111111111111111111`, passed silently (exit 0,
  no path diagnostic).

The same probes under `skills/foreman/scripts/` behaved correctly: symlink and
gitlink were excluded; an unreadable regular blob failed with exit 1 and
`cannot read index object for path: ...`; NUL-containing non-shebang data was
excluded without warning. Round 4 therefore hardened one input branch while
leaving the separately appended branch with the prior defect class.

### Derivation shape

The shebang derivation at `tests/line-endings.bats:101-106` contains no literal
file path and no extension filter. It contains only region pathspecs, including
the root-region `:(glob)*`. The hooks append at line 114 is also a directory
sweep (`skills/superpowers/hooks/*`), not a literal member list or extension
filter.

### F2 — BLOCKER — PNG cleanup trap replaces Bats' failure-reporting trap

Round 4 adds `trap cleanup_png_test EXIT` at
`tests/line-endings.bats:353-357`. In a disposable clone with only
`*.png binary` removed, the filtered test exited 1 but emitted:

```text
1..1
# bats warning: Executed 0 instead of expected 1 tests
```

It did not name a tracked PNG or the NUL-free probe, violating the explicit
loud/non-vacuous failure obligation. The same framework-level symptom occurred
when `git add --renormalize` was deliberately failed mid-test.

Causality is isolated: deleting only the test's `trap ... EXIT` line in that
disposable clone made the same missing-carve-out control report a normal Bats
failure naming `assets/foreman-banner.png`,
`assets/v029-total-georgecall.png`, and `zz-nul-free-probe-52.png`, including
the probe's before/after blob SHA. The cleanup strategy must not overwrite
Bats' own EXIT handling (the enclosing `BATS_TEST_TMPDIR` is already
disposable, or cleanup can use a framework-safe mechanism).

### F3 — BLOCKER — the relocation class moved outside the enumerated regions

D1 requires a derived inventory and says a new directly executed script added
without its exec bit must fail naming the path
(`docs/research/vnext/DECISIONS-resolved.md:21-35`;
`openspec/.../line-endings/spec.md:71-75`). The implementation still derives
from a closed list of regions at `tests/line-endings.bats:101-106`, so a new
Foreman script in a new region is invisible.

This is not merely an arbitrary hypothetical. The same resolved-decision
document records the future Foreman-owned `bin/lane.sh` at
`docs/research/vnext/DECISIONS-resolved.md:98-109`. A temporary-index
`100644` bash-shebang entry at that exact path made the mode test pass
(`rc=0`) without naming it. The same was demonstrated for
`skills/foreman/bin/lane` and top-level `scripts/foreman-run.sh`.

Thus root relocation is repaired, and all six currently declared regions are
recursive/extension-agnostic, but the defect class is not closed: it has
relocated to the first plausible Foreman direct-exec path outside the static
pathspec list. Approval requires a derivation whose future-new-script promise
does not depend on manually extending that list (for example, deriving
direct-exec targets/call sites as the planned WSL-seam checker describes, or a
documented whole-repository ownership rule with explicit exclusions).

## Relocation test

The derived mode inventory is implemented at `tests/line-endings.bats:47-119`.
Its shebang-property regions are:

- repo-root depth 1 via `:(glob)*`;
- `skills/foreman/scripts/*`;
- `skills/superpowers/skills/subagent-driven-development/scripts/*`;
- `env/*`;
- `tests/probes/*`.

`skills/superpowers/hooks/*` is appended as a deliberate whole-directory
sweep rather than selected by shebang.

Temporary-index probes used a copied index plus a temporary object directory;
no synthetic path or object was written to the live index/object database.
For every declared directory region, all four combinations (top-level and
nested; extensionless and `.sh`) made the filtered mode test exit 1 and print
`offending: <synthetic-path>`. Both requested root forms did the same.

The following plausible but unswept locations all let the same `100644`
bash-shebang blob pass the mode test without naming it:

- `skills/foreman/` outside `scripts/`, including hypothetical
  `skills/foreman/hooks/` and `skills/foreman/bin/`;
- top-level `bin/` and `scripts/`;
- `tests/` outside `tests/probes/`;
- `sandbox/`, `.github/scripts/`, `launcher/scripts/`, and `tools/`;
- other vendored Superpowers script/skill trees.

The current `sandbox/entrypoint.sh` and `sandbox/init-firewall.sh` are not D1
misses: `sandbox/Dockerfile:46-47` copies and explicitly chmods them before
their direct execution. Vendored Superpowers test/tool scripts and
`tests/run.sh` are invoked through an interpreter, not repository-mode direct
exec. The top-level `bin/` escape is materially different:
`docs/research/vnext/DECISIONS-resolved.md:98-109` records the future
Foreman-owned `bin/lane.sh`. Final severity classification is pending the
remaining requirement walk.

## Requirements and scenarios

| Spec obligation | Status | Evidence |
|---|---|---|
| Every tracked bash-executed file is index-LF and checkout-LF under `autocrlf=true` (`spec.md:7-15`) | **Implemented; platform half deferred** | Package tests 1-2 pass; all current index-shebang entries report `i/lf`; catch-all resolves them to `eol=lf`. An actual `windows-latest`/Git-Bash run is owned by the recorded `wsl-ci-parity` deferral below. |
| Add root `* text=auto eol=lf`, binary carve-outs, and explicit rules for three SDD scripts (`spec.md:17-20`) | **Implemented and tested** | `.gitattributes:10-27`; `git check-attr` resolves all six binary extensions to `binary=set`, and the three SDD paths to `eol=lf`. |
| Test every tracked bash-shebang file for index LF and relevant worktree CR (`spec.md:21-25`) | **Implemented and non-vacuous** | `tests/line-endings.bats:16-27,159-208`; independent CRLF index/worktree controls both fail naming their paths. |
| CI catches a reintroduced CRLF script (`spec.md:27-33`) | **Deferred, recorded; not counted as oversight** | `openspec/changes/wsl-ci-parity/proposal.md:24-49` explicitly consumes this test in later Linux/Windows CI; its tasks remain unchecked at `tasks.md:6-27`. |
| Three known SDD scripts are index/worktree LF and renormalize is near-no-op (`spec.md:35-47`) | **Implemented and tested except real WSL host** | Fresh `--no-hardlinks` clone showed all three `i/lf w/lf`; `git add --renormalize .` left zero status lines. Real WSL/Git-Bash execution remains part of the same recorded CI deferral. |
| Known binary types are `binary` (`spec.md:49-53`) | **Implemented** | `.gitattributes:11-16` covers PNG/JPG/JPEG/ICO/PDF/EXE; attribute probes resolve each to `binary=set`. |
| Binary asset remains bit-identical after renormalize (`spec.md:55-60`) | **Behavior implemented, regression reporting broken** | Good-input PNG test passes and leaves live status unchanged; removal of the rule changes the NUL-free probe SHA. F2 prevents the committed bad-input run from naming it. |
| Every directly executed Foreman script is executable; inventory derived mechanically and future additions fail naming (`spec.md:62-75`, D1 `:15-37`) | **Not implemented completely** | Current derived set has 46 paths and passes; the original D1 41 plus root/env additions are executable. F1 bypasses structural/error validation for hooks, and F3 proves future `bin/lane.sh` passes unnamed. |
| Three extensionless SDD scripts are mode `100755` (`spec.md:77-82`) | **Implemented and tested** | HEAD tree and a fresh clone report `755` for all three. |
| Fresh ext4 clone can direct-exec SDD review package (`spec.md:84-90`) | **Implemented and tested** | In a disposable fresh clone, direct execution of `scripts/review-package bfc8af4 27779c4` exited 0 (112 output bytes), with no `Permission denied`. |
| Genuine `.bat/.cmd/.ps1` scripts remain CRLF (`spec.md:92-95`) | **Implemented and tested** | Root rules are `.gitattributes:17-19`; a fresh clone reports `w/crlf` for all four tracked PS1 files. The polyglot nested `run-hook.cmd` intentionally resolves LF and is not a genuine Windows-only script. |
| Windows carve-out survives catch-all and renormalize (`spec.md:97-103`) | **Implemented and non-vacuous** | Fresh clone stayed clean after renormalize; independent deletion of each `.bat`, `.cmd`, and `.ps1` rule makes test 4 fail naming its synthetic root probe. |

The separate four-file Round 3 repair is genuinely committed, not transient:

```text
100755 env/bootstrap-wsl.sh
100755 env/tool-check.sh
100755 env/wsl-clock-preflight.sh
100755 install.sh
```

Those values come from `git ls-tree -r 27779c4`, while the live filesystem
copies happen to be mode 644 and show as unstaged differences. The commit-tree
evidence therefore directly closes the earlier “update-index then reverted by
git add” failure mode.

## Test hygiene and non-vacuity

### Hygiene

The complete `bash tests/run.sh` run executed all 387 tests. It exited 1 because
of 20 failures outside this package (event-log contention/append behavior,
Windows-only assumptions on this Linux host, absent compiled launcher,
NATS-server readiness, and related pre-existing tests). The five package tests
were tests 192-196 and all passed.

Most importantly for this package's hygiene obligation, live status was
byte-identical before and after the complete run:

```text
AUDIT_SUITE_RC=1
AUDIT_STATUS_EQUAL=yes
AUDIT_STATUS_BEFORE_SHA256=ba89153a586990e4e92eb1ddb0a232a993aa54511bc9e877821f2877a910ff8a
AUDIT_STATUS_AFTER_SHA256=ba89153a586990e4e92eb1ddb0a232a993aa54511bc9e877821f2877a910ff8a
```

An induced mid-PNG-test failure used a temporary `git` shim that exits 97 on
the first `git add --renormalize`, after the disposable clone and probe have
been created. A unique marker proved the shim was reached. Bats exited 1, and
live status again remained byte-identical:

```text
AUDIT_INDUCED_RC=1
AUDIT_FAILURE_SHIM_HIT=yes
AUDIT_STATUS_EQUAL=yes
AUDIT_STATUS_BEFORE_SHA256=ba89153a586990e4e92eb1ddb0a232a993aa54511bc9e877821f2877a910ff8a
AUDIT_STATUS_AFTER_SHA256=ba89153a586990e4e92eb1ddb0a232a993aa54511bc9e877821f2877a910ff8a
```

No `assets/zz-nul-free-probe.png` or other repository residue appeared.

### Non-vacuity

Disposable-clone controls produced:

| Test | Known-bad input | Result |
|---|---|---|
| 1 index LF | `zz-bad-index-crlf.sh`, raw CRLF index blob | exit 1, path named |
| 2 worktree LF | `zz-bad-working-tree-cr.sh`, LF index/CRLF worktree | exit 1, path named |
| 3 exec mode | `zz-bad-mode-extless`, root shebang mode `100644` | exit 1, path named |
| 4 Windows | independently remove `.bat`, `.cmd`, then `.ps1` root rule | each exit 1 and names its corresponding `zz-win-carveout-probe.*` |
| 5 PNG | remove and commit only `*.png binary` | exit 1, but no path is reported because of F2 |

Test 5's predicate itself is load-bearing: after removing the faulty EXIT trap
in the disposable clone, the NUL-free CRLF probe changed blob SHA and was
named. The committed test nevertheless fails the user's “fails naming the
offending file” condition, so all five tests are not currently acceptable.
