# Codex Audit -- s1/crlf-extensionless-hardening (bfc8af4..f02f207)
STATUS: complete
VERDICT: BLOCKED

## Findings

| ID | Severity | File and line | Finding |
|---|---|---|---|
| F1 | critical | `tests/line-endings.bats:31` | The exec-bit inventory is not fully derived from the index. It hardcodes the three current SDD paths and therefore silently omits a newly tracked SDD script. This violates the inventory-not-a-count/new-script acceptance criterion. |
| F2 | medium | `tests/line-endings.bats:113` (EOF); `spec.md:97` | There is no automated test for the genuine-Windows-script scenario. The attributes work in an independent fresh-clone check, but no test in this diff asserts `.bat`/`.cmd`/`.ps1` working-tree CRLF or exercises that behavior around renormalization. |
| F3 | low | `tests/line-endings.bats:68` | The working-tree CR test's comment says it also treats attribute-forced conversion as effective, but the condition checks only `core.autocrlf == true`. It consequently skips on this host even though `eol=lf` attributes govern checkout independently of `core.autocrlf`. The skip is honest and visible, but coverage is narrower than the comment claims. |
| F4 | low | `tests/line-endings.bats:113` (EOF); `spec.md:55` | The binary carve-out is implemented and worked in an independent renormalization check, but the specified bit-identical binary scenario has no automated test in this diff. |

## Detail

### a) Inventory derivation — FAIL (F1)

Severity: critical  
Primary location: `tests/line-endings.bats:29-43`

- The test does not contain the literal number `41`, a fixed expected count, or a literal list of all 41 current paths.
- The current function does invoke `git ls-files` at runtime for:
  - `skills/foreman/scripts/**/*.sh` and `skills/foreman/scripts/*.sh` at line 31;
  - `skills/superpowers/hooks/*` at line 42.
- However, lines 33-41 contain a fixed literal list of the three current SDD scripts:

  `review-package`, `sdd-workspace`, and `task-brief`.

  That is a baked-in sub-inventory, not a mechanical sweep of the SDD scripts directory or a content/shebang-derived inventory.
- Reproducing the function at `f02f207` yields exactly 41 paths. Comparing it with:

  `git diff --summary bfc8af4..f02f207 | sed -n 's/^ mode change 100644 => 100755 //p'`

  also yields exactly 41 paths, with no path present on only one side. All 41 currently derived entries have mode `100755`.
- `tests/line-endings.bats` itself is mode `100755`, but is correctly absent from this Foreman-owned direct-exec inventory.
- Current equality does not satisfy the regression requirement. A temporary-index experiment added five synthetic `100644` entries. The function selected:
  - `skills/foreman/scripts/new-direct.sh`;
  - `skills/foreman/scripts/nested/new-direct.sh`;
  - `skills/superpowers/hooks/new-direct`.

  It omitted both:
  - `skills/superpowers/skills/subagent-driven-development/scripts/new-direct.sh`;
  - `skills/superpowers/skills/subagent-driven-development/scripts/new-direct`.

  Therefore the claim that the pass condition is a derived inventory rather than a fixed literal file list is false for the SDD portion. Per the supplied verdict rule, this is blocking.

### b) New `100644` directly executed script detection — FAIL for SDD, PASS for the other two families (F1)

Severity: critical  
Primary location: `tests/line-endings.bats:31-42, 89-111`

- A new `.sh` below `skills/foreman/scripts/` is selected by the line-31 pathspec, including a nested path. A new path below `skills/superpowers/hooks/` is selected by line 42.
- For a selected `100644` path, lines 95-98 collect the path and mode:

  `mode="$(git -C "$REPO_ROOT" ls-files -s -- "$f" | awk '{print $1}')"`  
  `if [[ "$mode" != "100755" ]]; then`  
  `  bad+=("$f (mode=$mode)")`

- Lines 107-111 fail and name the path:

  `echo "files in derived exec-bit inventory missing index mode 100755:" >&2`  
  `printf '  %s\n' "${bad[@]}" >&2`  
  `printf 'offending: %s\n' "${bad[@]}" >&2`  
  `return 1`

- The temporary-index trace produced, for example:

  `offending: skills/foreman/scripts/new-direct.sh (mode=100644)`

  Thus detection and naming work for paths that enter the inventory.
- A newly tracked script in the SDD scripts directory does not enter the inventory unless its path is one of the three literals at lines 34-36. The mode loop and failure message never see it, so the test silently passes with respect to that new file.

### c) Working-tree CR check and ext4 skip — PARTIAL (F3)

Severity: low  
Primary location: `tests/line-endings.bats:65-85`

- `git config --get core.autocrlf` on this worktree returned exit status 1 with no value: it is unset.
- The skip is an actual Bats skip, not a return-0 or swallowed error:

  `skip "core.autocrlf is '${autocrlf:-unset}' (not true); working-tree CR check is non-vacuous only on autocrlf=true checkouts (Git-Bash / shared /mnt/c)"`

- The message explicitly says the setting is unset/not true and that the working-tree check is not being run. A reader cannot reasonably mistake this for a passed byte check.
- The predicate at line 70 skips exactly when the lower-cased config value is not the literal `true`.
- The line-68 comment claims attribute-forced conversion is also treated as effective, but the code never calls `git check-attr` and has no attribute-based branch. This matters because `text eol=lf` affects checkout even when `core.autocrlf` is unset/false. A fresh clone with `core.autocrlf` unset reported the three SDD paths as `i/lf w/lf attr/text eol=lf`.
- Against the spec's narrowly worded “on an autocrlf=true checkout” assertion, the skip is honest and conditional. As a regression test for the actual attribute policy, however, it unnecessarily skips a meaningful check on this ext4 host and its explanatory comment is inaccurate.
- When the test does run, lines 76-85 detect CR bytes, return 1, and name every offending path via `printf 'offending: %s\n'`.

The Foreman serialized Bats gate could not execute because its `pueue` daemon/configuration was absent. No direct Bats invocation was substituted; the skip judgment above is based on the complete test source plus the independently observed unset config.

### d) `.gitattributes` syntax, ordering, and nested interaction — PASS

Severity: none  
Locations: `.gitattributes:10-27`; `skills/superpowers/.gitattributes:1-24`

- Root `* text=auto eol=lf` is valid and provides the requested total text policy.
- The six binary patterns are valid one-pattern-per-line `binary` rules. `git check-attr text eol diff merge` on all three tracked PNGs showed `text: unset`, `diff: unset`, and `merge: unset`; the inherited `eol: lf` is inert because text conversion is disabled.
- The Windows rules are valid `text eol=crlf` rules.
- Ordering is correct in the root file: catch-all line 10 precedes binary lines 11-16 and Windows lines 17-19. The later matching Windows line overrides `eol=lf` with `eol=crlf`; the catch-all cannot win.
- Shell rules at lines 20-22 and the explicit extensionless rules at lines 25-27 reinforce LF and do not reverse the Windows carve-out.
- The nested `skills/superpowers/.gitattributes:12` has `*.cmd text eol=lf`. Git's closer-file precedence is confirmed by:

  `skills/superpowers/hooks/run-hook.cmd: eol: lf`  
  `skills/superpowers/hooks/run-hook.cmd: text: set`

- LF is correct and intentional for this cmd/bash polyglot wrapper, as the nested file states at line 11. It is an intentional exception to genuine Windows scripts, not an accidental conflict.
- In an independent fresh clone with `core.autocrlf` unset, the four genuine PowerShell files were `w/crlf`, while `run-hook.cmd` was `w/lf`. No catch-all/carve-out reversal was found in either attribute file.

### e) Mode-only versus content changes — PASS

Severity: none  
Range: `bfc8af4..f02f207`

- `git diff --stat` reports 44 files and 139 insertions: 20 in root `.gitattributes`, 6 in the nested `.gitattributes`, and 113 in new `tests/line-endings.bats`.
- `git diff --numstat` reports `0 0` for each of the 41 exec-bit entries.
- `git diff --raw` shows identical old/new blob IDs for every one of those 41 entries, alongside only `100644 -> 100755`.
- `git diff --summary` lists exactly 41 such mode changes and the new mode-`100755` Bats file.
- No exec-bit file has a content change. There is no scope violation under this criterion.

### f) Every SHALL and Scenario checklist — PARTIAL / BLOCKING

Severity: critical overall because the inventory SHALL is not met  
Locations: `spec.md:7-103`

| Spec item | Status | Evidence |
|---|---|---|
| Every tracked bash-shebang file has index LF, tested on every host (`7-15`, `21-25`) | Implemented and tested | Test lines 14-23 discover tracked working-tree bash shebangs; lines 46-63 assert `i/lf`. Independent output showed every discovered entry as `i/lf`. |
| Bash-shebang working-tree bytes have no CR on `autocrlf=true` (`12-15`, `24-25`) | Implemented and conditionally tested | Test lines 65-85 perform the byte check and name failures only when config is literally true. It honestly skips here; see claim c. |
| Root total catch-all, binary carve-out, and explicit three extensionless LF rules (`17-20`) | Implemented but not directly tested as policy | Rules exist at root lines 10-27 and have correct effective attributes. The Bats tests check resulting bash-file EOLs, not the rule inventory itself. |
| CI catches reintroduced CRLF shebang script and names it (`27-33`) | Implemented and tested conditionally | Lines 76-85 collect and print offending paths, then return 1 on an `autocrlf=true` checkout. |
| Three known SDD scripts are index-LF and working-tree LF (`35-45`) | Implemented and tested | They report `i/lf`; explicit root and nested attributes produce `w/lf`; index and conditional working-tree tests cover them. |
| Real WSL direct execution avoids `pipefail\r` (`44-45`) | Implemented but not functionally tested | LF bytes remove the failure mode, but no test in this diff invokes the three scripts through real WSL bash. |
| `git add --renormalize .` is near-no-op (`46-47`) | Implemented but not automated | An independent fresh-clone temporary-index renormalization produced clean status, but no committed regression test asserts it. |
| Known binary types are marked binary and bytes remain identical after renormalization (`49-60`) | Implemented but not automated (F4) | Rules are effective. Independent before/after blob IDs for all three tracked PNGs were identical, but the Bats file has no binary test. |
| Direct-exec set is mechanically derived; a new missing-exec script fails naming it (`62-75`) | Not implemented (F1) | Current 41 match, but lines 33-41 hardcode the SDD sub-inventory and synthetic new SDD paths are omitted. |
| Three extensionless SDD scripts are mode `100755` (`77-82`) | Implemented and tested | All three are mode changes to `100755`; current inventory mode test covers them. |
| Fresh ext4 clone can direct-exec SDD scripts (`84-90`) | Implemented but only mode-tested | Mode `100755` is asserted; no automated test in this diff actually invokes `review-package BASE HEAD` in a fresh clone. |
| Genuine Windows scripts remain CRLF (`92-95`) | Implemented but not automated (F2) | Root lines 17-19 are correct; independent fresh-clone evidence showed PowerShell files `w/crlf`. |
| Windows carve-out remains CRLF through renormalization (`97-103`) | Implemented but not automated (F2) | There is no `.bat`/`.cmd`/`.ps1` working-tree-byte assertion anywhere in the new Bats file. The polyglot `run-hook.cmd` is intentionally LF under the nested override. |

### Overall judgment

The attribute and current mode changes themselves are sound, and the present inventory exactly matches the 41 mode changes without altering their content. Merge is nevertheless blocked because the highest-value acceptance criterion is specifically future-proof inventory derivation, and the test silently misses new SDD scripts. The missing Windows and binary automated scenarios are additional non-blocking coverage gaps once F1 is repaired.
