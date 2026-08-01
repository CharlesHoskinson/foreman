# FOREMAN_REPORT — rework round: correct three false premises + two in-scope findings

**Status:** done  
**Mode:** soft  
**Date:** 2026-08-01  
**Scope:** factual corrections only in two proposal files. Build on prior
working-tree edits. No commits. No `tasks.md` / `specs/**` /
out-of-`openspec/changes/` edits.

## Prior round (context)

A previous edit corrected a dead "no CI at all" premise, but the architect
spec supplied three false facts (56/685 suite size, Windows bats-free,
every-push trigger). Cross-vendor audit returned **BLOCKED** (eight findings;
seven were architect-spec faults). This round fixes those three plus two
in-scope residual findings.

## What changed this round (per finding)

### Finding 1 — suite is 50 files / 635 tests (not 56 / 685)

**Cause:** prior round used `git ls-files '*.bats'`, which counts fixtures and
archived evidence. The gate selects only top-level files.

**Both proposals** now state 50 / 635 with the commands that produce them:

- `find tests -maxdepth 1 -type f -name '*.bats' | wc -l` → **50**
- `find tests -maxdepth 1 -type f -name '*.bats' | xargs grep -h '^@test' | wc -l` → **635**

Text notes that `tests/run.sh` selects that set (`-maxdepth 1`) and that the
gate prints `tests=635`.

**Locations:**

| File | Where |
|---|---|
| `test-infrastructure-hardening/proposal.md` | Why bullet (suite size); Aggregate bullet (635); Impact (50 `*.bats`) |
| `regression-harness-tiers/proposal.md` | Why opening (50 / 635 + commands) |

### Finding 2 — Windows is not bats-free (precision, not deletion)

**Kept true half:** `FOREMAN_CI_BATS: "0"` disables the **full suite as a gate**
on Windows.

**Added true half:** `gates-windows.yml` lines 86–114 run a deliberate
**non-gating two-file probe** over `tests/line-endings.bats` and
`tests/plugin-drift.bats`, each under a timeout bound, capturing bats' own
exit status (`continue-on-error: true`).

**Removed false half:** "does not run on the Windows runner at all" /
absolute "does not run on Windows".

**Locations:** Why bullet in both proposals; Impact coordination line in
test-infrastructure-hardening (full suite off + non-gating probe).

### Finding 3 — `gates-linux` is not every push

**Correct trigger** (from `.github/workflows/gates-linux.yml` head):

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
```

Text now says: **pushes to `main` and every pull request**, with
`on.push.branches: [main]` plus `pull_request` cited. Removed
"every push and pull request".

### Finding 4 — live `wsl-ci-parity` coordination (missed occurrence)

**`test-infrastructure-hardening/proposal.md` "What changes" CI bullet**
(was ~line 110) still said work is coordinated with the `wsl-ci-parity`
package. That package is withdrawn
(`openspec/changes/archive/2026-08-01-wsl-ci-parity-withdrawn/`).

**Fixed** the same way as Impact was fixed last round: coordinate with
`gates-linux.yml` / `gates-windows.yml` (live entry points); withdrawn
`wsl-ci-parity` is **not** a live dependency.

All remaining `wsl-ci-parity` mentions say **withdrawn**.

### Finding 5 — stale present-tense 373/9 beside corrected count

**`regression-harness-tiers/proposal.md`:** present-tense
"A fresh-clone baseline is 373 pass / 9 fail" sat next to the new suite size.
373 + 9 = 382 (old total).

**Fixed:** marked as a **historical** baseline dated **2026-07-28** (hand-triage
recorded in test-infrastructure-hardening). Not re-derived this round.

## Commands run to verify each claim

### Suite size (top-level only)

```text
$ find tests -maxdepth 1 -type f -name '*.bats' | wc -l
50
$ find tests -maxdepth 1 -type f -name '*.bats' | xargs grep -h '^@test' | wc -l
635
```

Contrast (repo-wide, not what the suite runs):

```text
$ git ls-files '*.bats' | wc -l
56
$ git ls-files '*.bats' | xargs grep -h '^@test' | wc -l
685
```

`tests/run.sh` (around the selection loop) uses
`find "$TESTS_DIR" -maxdepth 1 -type f -name '*.bats'`.

### Windows non-gating probe

```text
$ sed -n '86,114p' .github/workflows/gates-windows.yml
# step: "Probe the bats suite on Windows (non-gating)"
# continue-on-error: true
# for f in tests/line-endings.bats tests/plugin-drift.bats
# timeout-bound bats; capture bats rc
```

`FOREMAN_CI_BATS: "0"` remains at line 73 of the same file (full gate off).

### `gates-linux` trigger

```text
$ sed -n '1,10p' .github/workflows/gates-linux.yml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
```

### `wsl-ci-parity` withdrawn

```text
$ ls openspec/changes/archive/2026-08-01-wsl-ci-parity-withdrawn/
WITHDRAWN.md  design.md  proposal.md  specs  tasks.md
```

## Verification (from the brief)

| Check | Result |
|---|---|
| `openspec validate test-infrastructure-hardening --strict` | Change is valid |
| `openspec validate regression-harness-tiers --strict` | Change is valid |
| `grep` 685 / 56 bats / 56 `*.bats` | No matches |
| `grep` absolute Windows claim | No matches |
| `grep` "every push and pull request" | No matches |
| `grep` wsl-ci-parity in test-infrastructure-hardening | 3 hits, all "withdrawn" / "not a live dependency" |

## Files touched

- modified: `openspec/changes/test-infrastructure-hardening/proposal.md`
- modified: `openspec/changes/regression-harness-tiers/proposal.md`
- updated: `FOREMAN_REPORT.md` (this file)

## ARCHITECT_ACTIONS

None. No deletions or renames required.

## Not done / left uncommitted

- Working tree edits only. No `git add` / `commit` / `push` (forbidden).
- `tasks.md` and `specs/**` under both packages were not touched.
- Historical 373/9 baseline not re-run; only marked historical with date.
- `test-infrastructure-hardening` still opens with the 373/9 figure as the
  triage anecdote (dated 2026-07-28 in the following sentence); it is not
  paired with a conflicting present-tense suite total in that paragraph.
