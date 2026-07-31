# Final Pre-Merge Audit

## VERDICT

**BLOCKED**

The defect class has relocated a sixth time: D11's broad
`skills/superpowers/skills/*/scripts/**` exclusion swallows the directly
executed SDD script family that the OpenSpec and D1 expressly require. Round 6
also removed D1's required non-bash hooks sweep. Existing committed modes happen
to be correct, but the regression test does not protect either family.

## Scope

- Repository: `/root/fm-wt/s1-crlf`
- Branch: `s1/crlf-extensionless-hardening`
- Package diff: `bfc8af4..HEAD`
- Criteria: OpenSpec line-endings specification plus decisions D1 (amended) and D11

## Findings

### R1 — Initial whole-repository relocation controls pass, but the conclusion is superseded by B1

- **Severity:** PARTIAL / NOT DISPOSITIVE
- **Location:** `tests/line-endings.bats:129-250`, especially the whole-index
  enumeration at line 160, regular-blob filter at lines 177-183, and shebang
  predicate at lines 239-247.
- **Conclusion:** The derived exec-bit test covers bash-shebang regular blobs by
  property across the whole temporary index unless an exclusion removes them.
  The generic controls passed, but B1 proves that one exclusion removes a
  required directly-executed region; therefore this initial conclusion cannot
  support approval.
- **Concrete evidence:** With a temporary index and temporary object directory,
  25 synthetic `100644` bash-shebang paths all made the test fail and were all
  named:
  - repository root, extensionless and `.sh`;
  - `bin/`, `scripts/`, and a brand-new top-level directory, each top-level and
    nested;
  - `env/`, `skills/foreman/scripts/`, `skills/superpowers/hooks/`,
    `launcher/`, `docs/tooling/`, and repository `tests/`;
  - paths deliberately adjacent to (but outside) every excluded pattern,
    including `sandbox-adjacent/`, `skills/superpowers/tests-adjacent/`,
    `skills/superpowers/script/`, `scripts-adjacent/`, `tests/run.sh-extra`,
    and `misc/helper.bash.sh`.
  The run reported `INCLUDED_EXPECTED=25 COVERAGE_MISSES=0`.

### R2 — D11 exclusions exclude their intended synthetic members without swallowing adjacent regions

- **Severity:** PASS
- **Location:** `tests/line-endings.bats:59-105`, `tests/line-endings.bats:143-158`
- **Concrete evidence:** Synthetic `100644` bash-shebang files under
  `sandbox/**`, `skills/superpowers/tests/**`,
  `skills/superpowers/scripts/**`,
  `skills/superpowers/skills/*/scripts/**`, and `*.bash`, plus a temporary
  `100644` replacement for `tests/run.sh`, were not reported. Ten adjacent
  non-excluded controls were reported. The probe ended
  `EXCLUSION_LEAKS=0`.

This only proves pattern boundaries. It does **not** prove that every pattern is
semantically safe. B1 proves one is not.

### B1 — D11 exclusion swallows the directly-executed SDD family (sixth relocation)

- **Severity:** BLOCKER
- **Location:** `tests/line-endings.bats:80`,
  `tests/line-endings.bats:154-158`, `tests/line-endings.bats:181-183`;
  `openspec/changes/crlf-extensionless-hardening/specs/line-endings/spec.md:62-90`;
  `origin/main:docs/research/vnext/DECISIONS-resolved.md:59-65`
- **Defect:** The pattern
  `skills/superpowers/skills/*/scripts/**` is applied before shebang
  classification and excludes
  `skills/superpowers/skills/subagent-driven-development/scripts/**`.
  Those scripts are not `bash`/`sh`-invoked exclusions: the OpenSpec says they
  are directly executed and requires the test to protect them. Therefore the
  exclusion's stated “documented sh” reason is false for part of the pattern it
  governs.
- **Concrete evidence:**
  - In a temporary index, demoting the three committed SDD scripts
    `review-package`, `sdd-workspace`, and `task-brief` to `100644` left the
    derived-mode test green; all three escaped unnamed
    (`SDD_EXCLUSION_GAP_RC=0`).
  - Adding new top-level and nested `100644` bash-shebang files at
    `.../subagent-driven-development/scripts/future-tool` and
    `.../scripts/nested/future-tool.sh` also left the test green and named
    neither path (`SDD_RELOCATION_TEST_RC=0`).
  - Direct-exec documentation is present at
    `skills/superpowers/skills/subagent-driven-development/SKILL.md:136`,
    `:182`, `:204`, and `:226`.
- **Impact:** A mode regression on any of the three original extensionless
  scripts, or a new directly-executed SDD script, merges undetected. This is the
  same coverage defect relocated into an over-broad exclusion.

### B2 — Round 6 removed D1's deliberate non-bash hooks sweep

- **Severity:** BLOCKER
- **Location:** `tests/line-endings.bats:107-118`,
  `tests/line-endings.bats:177-183`, `tests/line-endings.bats:239-247`;
  `origin/main:docs/research/vnext/DECISIONS-resolved.md:59-65`
- **Defect:** D1 amended defines the property inventory as bash-shebang blobs
  **plus** `skills/superpowers/hooks/*`, because that directory contains
  non-bash JSON and CMD/polyglot members. The checker explicitly states there is
  “no separate hooks branch” and now selects only bash-shebang content.
- **Concrete evidence:** In a temporary index, demoting committed
  `skills/superpowers/hooks/hooks.json` to `100644` and adding new `100644`
  `future-hook.json` and `future-hook.cmd` entries left the derived-mode test
  green; all three escaped unnamed (`HOOK_GAP_TEST_RC=0`).
- **Impact:** The current commit is accidentally safe because all four existing
  hook members are already `100755`; future non-bash hook additions and mode
  regressions are unprotected.

### R2a — Exclusion inventory has the required syntax, but one reason is semantically false

- **Severity:** PARTIAL
- **Location:** `tests/line-endings.bats:59-84`
- **Concrete evidence:** Mechanical parsing found six active entries, each with
  a non-empty `pattern|reason`. Five are wildcard patterns:
  `sandbox/**`, `skills/superpowers/tests/**`,
  `skills/superpowers/scripts/**`,
  `skills/superpowers/skills/*/scripts/**`, and `*.bash`. The only literal
  path is D11's expressly permitted `tests/run.sh`. The validation ended
  `ENTRY_COUNT=6 INVALID_ENTRIES=0`. This is a syntactic result only; B1
  falsifies the skill-scripts entry's stated reason for the SDD subtree.

### R3 — Regular-blob restriction and unreadable-object handling cover the former hooks seam

- **Severity:** PASS
- **Location:** `tests/line-endings.bats:160-183`,
  `tests/line-endings.bats:188-247`, `tests/line-endings.bats:352-357`
- **Conclusion:** There is one inventory code path; hooks do not bypass the
  mode filter or object-read failure handling.
- **Concrete evidence:**
  - Added synthetic mode-`120000` entries whose blob content begins with a bash
    shebang at repository root and under `skills/superpowers/hooks/`, plus
    mode-`160000` gitlinks at both locations. The derived-mode test passed
    (`TYPE_FILTER_RC=0`), proving those non-regular entries were not interpreted
    as scripts.
  - Added a nonexistent OID as a mode-`100644` entry first at
    `future-unreadable`, then at
    `skills/superpowers/hooks/future-unreadable`. Each independent run failed
    (`RC=1`) and printed
    `error: cannot read index object for path: <exact path>`.
  - A missing regular object under the intentionally excluded
  `skills/superpowers/tests/**` pattern was skipped before object access and
    the test passed, consistent with the exclusion being a structural
    subtraction from the inventory.

This structural handling passes, but it does not cure B2: readable non-bash
regular hook blobs are inspected and then omitted by the shebang predicate.

### H1 — Package test cleanup preserves repository status on success-path execution and induced failure

- **Severity:** PASS
- **Location:** `tests/line-endings.bats:466-557`
- **Concrete evidence:**
  - During the attempted full-suite run, raw
    `git status --porcelain -uall` snapshots before and after had the identical
    SHA-256
    `9cf9964bfa186a11268c94e0b51781ce26c8ec056e3bb21ddddc87dd8338696f`.
    The package's five tests all passed as full-suite tests 192-196.
  - A complete dependency-masked full-suite run reached test 387 and again
    produced identical before/after porcelain hashes. `/usr/local/bin` was
    removed from that run's `PATH` so NATS was unavailable because this sandbox
    forbids local listening sockets; other missing tools account for additional
    masked-run failures.
  - For the failure path, an exported `git` shim refused exactly the PNG
    probe's `hash-object -w --no-filters` operation with status 77. Tests 1-4
    passed, test 5 failed at `tests/line-endings.bats:528`, and the before/after
    porcelain snapshots again had the identical SHA-256 above. No probe
    appeared in the live repository.

### H2 — PNG cleanup trap composes with Bats failure reporting

- **Severity:** PASS
- **Location:** `tests/line-endings.bats:489-497`
- **Concrete evidence:** The induced failure produced exactly one normal Bats
  `not ok` result with the failing command and synthetic probe path. It produced
  zero `Executed 0 instead of expected 1 tests` messages. Audit counters:
  `INDUCED_RC=1`, `STATUS_HYGIENE=IDENTICAL`, `NOT_OK_COUNT=1`,
  `BATS_ZERO_TEST_TRAP_MESSAGE_COUNT=0`, `INDUCED_MARKER_COUNT=1`.

### N1 — Each of the five package tests has a named red-side witness

- **Severity:** PASS
- **Location:** `tests/line-endings.bats:295-312`,
  `tests/line-endings.bats:314-344`, `tests/line-endings.bats:346-383`,
  `tests/line-endings.bats:385-464`, `tests/line-endings.bats:466-557`
- **Concrete evidence:** Five independent known-bad probes each produced Bats
  exit 1 and named the offender:
  1. CRLF index blob: `tests/run.sh` reported `i/crlf`.
  2. CR-bearing LF-governed worktree file: `install.sh`.
  3. Mode-`100644` derived inventory member: `install.sh`.
  4. Missing root `*.ps1` carve-out: `zz-win-carveout-probe.ps1`.
  5. Missing `*.png binary` carve-out: tracked
     `assets/foreman-banner.png` and the NUL-free synthetic PNG probe.
  The harness concluded `FIVE_RED_PROOFS=5/5`. This establishes that none of
  the five tests is wholly vacuous; B1 and B2 separately prove that the
  executable-mode test's derivation is incomplete.

### M1 — Existing required executable modes are correct in the commit

- **Severity:** PASS
- **Location:** commit `1f257550d83409c0a3e6841d2f0bd9769f1416a0`;
  `openspec/changes/crlf-extensionless-hardening/specs/line-endings/spec.md:62-90`
- **Concrete evidence:** An independent `git ls-tree -r HEAD` audit derived
  the current required set using the whole-repository shebang property, D11
  exclusions, D1's hooks addition, and the SDD family that the faulty D11
  pattern currently swallows. It found 47 current required paths and every
  tree entry was mode `100755` (`COMMIT_BAD_MODES=0`). The count is evidence at
  this commit, not the specification. It includes:
  - all four current hooks, including the three non-bash members;
  - all three current SDD/direct-exec scripts, explicitly overriding the faulty
    checker exclusion for this independent audit;
  - `install.sh`, the three `env/` scripts, Foreman scripts, the new
    `find-polluter.sh` residue, and the existing repository test probe.
  A separate temporary index populated by `git read-tree HEAD` also passed the
  current derived-mode test (`COMMIT_INDEX_TEST_RC=0`).
- **Conclusion:** Round 6 did not leave a transient-index-only chmod. B1 and B2
  are future-regression/derivation blockers, not current committed-mode defects.

### S1 — Full-suite status and package attribution

- **Severity:** WARNING (not the reason for the BLOCKED verdict)
- **Location:** `tests/eventlog.bats:83`, `tests/eventlog.bats:152`,
  `tests/eventlog.bats:199`, `tests/lane-queue.bats:384`,
  `tests/lane-run.bats:582`, `tests/nats-bridge.bats:53-74`
- **Concrete evidence:**
  - Normal environment: the full runner reached package tests 192-196, all
    passed, then NATS setup failed because `nats-server` cannot bind in this
    sandbox. A direct start reported
    `listen tcp 0.0.0.0:34222: socket: operation not permitted`. The run was
    terminated with status 143 at test 225, and repository status remained
    byte-identical.
  - With NATS deliberately absent from `PATH`, the runner completed all 387
    tests: 377 `ok`, 10 `not ok`, final TAP line `ok 387`, status
    byte-identical. The extra masked-path failures reflect other
    `/usr/local/bin` tools being absent.
  - The five non-NATS failures from the normal run reproduce at package base
    `bfc8af4`. Their test and implementation blob OIDs are identical between
    `bfc8af4` and `HEAD`, so rounds 5-6 did not introduce them.
- **Conclusion:** The full repository suite is not green in this execution
  environment. The CRLF package's five tests are green on their normal path,
  and its test hygiene passes. Approval is nevertheless blocked independently
  by B1 and B2.

## Evidence

- Relocation probe: Bats exit 1 as required, with every non-excluded path named;
  audit assertion exit 0 after checking the complete expected set.
- Temporary evidence directory: `/tmp/crlf-relocation.9091tX` (repository
  worktree and live index were not used for the synthetic entries).
- Object-type evidence directory: `/tmp/crlf-object-types.ePnYQv`.
- Full-suite attempt evidence: `/tmp/crlf-full-suite.JOCuzh`.
- Completed NATS-masked full-suite evidence:
  `/tmp/crlf-full-suite-no-nats.qmdJOZ`.
- Induced-failure evidence: `/tmp/crlf-induced-failure.TSFpUt`.
- Five-test red-proof evidence: `/tmp/crlf-five-red.yIqqmU`.
- SDD exclusion-gap evidence: `/tmp/crlf-sdd-exclusion-gap.xKxtga`.
- Synthetic sixth-relocation evidence: `/tmp/crlf-sdd-relocation.Jc1A8Q`.
- Hooks-gap evidence: `/tmp/crlf-hooks-gap.njMB1i`.
- Commit-index evidence: `/tmp/crlf-commit-index.9zZkCC`.
- Base-comparison evidence: `/tmp/crlf-base-compare.p2lXxr`.

## What Would Change the Verdict

To change the verdict to **APPROVED**:

1. Refine the D11 skill-scripts exclusion so it cannot swallow
   `skills/superpowers/skills/subagent-driven-development/scripts/**`; do not
   replace it with a filename list. Add red tests that demote each current SDD
   script and add a fourth top-level/nested SDD script, requiring failure with
   the exact path.
2. Restore D1's pattern-level `skills/superpowers/hooks/*` sweep while keeping
   the unified regular-blob filter and loud object-read failures. Add red tests
   for a `100644` non-bash hook, a `120000` hook symlink, a `160000` hook
   gitlink, and an unreadable regular hook object.
3. Re-run the complete package audit, including success/failure status hygiene
   and the committed-tree mode check.
