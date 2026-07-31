# REPORT — crlf-extensionless-hardening, round 7

Worktree `/root/fm-wt/s1-crlf`, base `9da74c5`. Only `tests/line-endings.bats`
and file modes touched. Not committed (per the brief). Every claim below carries
the command that produced it.

**Status: F1 VERIFIED · F2 DONE · F3 DONE · D11 obligation DONE · one item owed at merge.**

---

## F1 — VERIFIED already fixed at `9da74c5`

The narrowed pattern is in place at `tests/line-endings.bats:80`:

```
skills/superpowers/skills/brainstorming/scripts/**|documented sh skills/brainstorming/scripts/<name> invocations
```

Enumeration confirms the three founding SDD scripts are tracked, carry a bash
shebang, and are matched by no exclusion pattern:

```
OK  .../subagent-driven-development/scripts/review-package  tracked=True bash_shebang=True excluded=False
OK  .../subagent-driven-development/scripts/sdd-workspace   tracked=True bash_shebang=True excluded=False
OK  .../subagent-driven-development/scripts/task-brief      tracked=True bash_shebang=True excluded=False
```

## F2 — DONE. Hooks directory sweep restored, without reintroducing the bypass

**The measurement that justifies the sweep.** Of the four tracked
`skills/superpowers/hooks/*` entries, only one carries a bash shebang:

| path | mode | bash shebang |
|---|---|---|
| `skills/superpowers/hooks/hooks-cursor.json` | 100755 | no |
| `skills/superpowers/hooks/hooks.json` | 100755 | no |
| `skills/superpowers/hooks/run-hook.cmd` | 100755 | no |
| `skills/superpowers/hooks/session-start` | 100755 | yes |

A shebang-only sweep therefore covers **one of four**. That is the whole reason
D1 specifies a directory, and it is now written into the code as the reason.

**How this avoids re-breaking F1.** F1's rework collapsed the inventory to one
code path so the type filter, object-existence check and first-line read apply
to every candidate; the old hooks branch had bypassed them. Restoring a second
branch would undo that. Instead only the **inclusion predicate** widened:

```
bash-shebang  OR  inside a swept directory
```

A swept path takes the identical route through every check and merely skips the
shebang requirement at the end. New `_exec_bit_directory_sweeps()` declares the
region as `prefix|reason`, matching the existing exclusion-entry style.

## F3 — DONE. The regression that would have caught F1

New test: *"derived exec-bit inventory still covers its founding cases (SDD
scripts + hooks)"*. `tests/line-endings.bats` is now **6/6**.

The three SDD paths are literals **on purpose**: deriving them would re-run the
very sweep whose failure mode the test exists to catch, so the assertion would
drift along with the bug instead of pinning it. That reason is written inline,
as the brief requires. The hooks entries are **not** literals — they are derived
from the directory via `git ls-files`, because D1's requirement is that the
whole directory is swept, so a fifth hook added later is covered automatically.
The test also fails if the hooks half contributes zero paths, so a
deleted/renamed directory cannot silently reduce it to the SDD half.

**Demonstrated against known-bad input — twice.** A check never observed failing
is not evidence, so both original defects were reproduced:

*Control A — delete the hooks sweep entry (reproduces F2):*
```
not ok 1 derived exec-bit inventory still covers its founding cases
offending: skills/superpowers/hooks/hooks-cursor.json (founding case absent from derived inventory)
offending: skills/superpowers/hooks/hooks.json (founding case absent from derived inventory)
offending: skills/superpowers/hooks/run-hook.cmd (founding case absent from derived inventory)
```

*Control B — restore D11's original wildcard `skills/superpowers/skills/*/scripts/**` (reproduces F1 exactly):*
```
not ok 1 derived exec-bit inventory still covers its founding cases
offending: .../subagent-driven-development/scripts/review-package (founding case absent from derived inventory)
offending: .../subagent-driven-development/scripts/sdd-workspace (founding case absent from derived inventory)
offending: .../subagent-driven-development/scripts/task-brief (founding case absent from derived inventory)
```

The test catches both the defect that caused six blocks and the gap round 6
introduced. Neither control was left in the tree.

## The corrected D11 obligation — enumeration of every exclusion pattern

623 tracked regular blobs swept. "Suppressed" counts only files that would
otherwise be **in** the inventory (regular blob, bash shebang) — listing every
file under `sandbox/**` would drown the signal.

| pattern | matches | suppressed | reason holds? |
|---|---|---|---|
| `sandbox/**` | 4 | 2 | YES — `entrypoint.sh`, `init-firewall.sh`; modes set by `RUN chmod 0755` at image build |
| `skills/superpowers/tests/**` | 52 | 30 | **NEEDS A SECOND PAIR OF EYES** — see below |
| `skills/superpowers/scripts/**` | 4 | 4 | YES — all four are `bump-version.sh`, `lint-shell.sh`, `package-codex-plugin.sh`, `sync-to-codex-plugin.sh` |
| `skills/superpowers/skills/brainstorming/scripts/**` | 5 | 2 | YES — exactly `start-server.sh` + `stop-server.sh`, the two whose `sh` invocation was verified |
| `*.bash` | 1 | 1 | YES — `tests/helpers.bash`, sourced only |
| `tests/run.sh` | 1 | 1 | YES — the documented suite runner |

Total suppressed: **40**.

The narrowed brainstorming pattern is now honest: it captures exactly the two
files whose reason was verified, and nothing else.

**The one entry I am not willing to sign off silently.**
`skills/superpowers/tests/**` suppresses **30** bash-shebang files on the stated
reason "test scripts invoked via bash/sh by their runners". The D11 correction
says a wildcard asserts its reason is true of every sibling it captures. I
enumerated all 30 (full list in `/root/fm-logs/d11-enum.txt`) but did **not**
verify the invocation form of each against its runner. That is 30 individual
claims, and asserting them from the pattern's shape is precisely the reasoning
that produced F1. Flagging rather than claiming.

## Owed at merge, not here

`tests/line-endings.bats` goes 5 tests to 6. On `integrate/v029-w1` that file is
now registered in `tests/baseline.tsv` at `5` (it was one of eight files
registered in neither policy file until today). **Whoever merges this must bump
that baseline to 6**, or the merged tree fails its own pass-baseline gate.

## Commands run

```bash
flock /tmp/foreman-bats.lock bats tests/line-endings.bats     # 6/6 ok
python3 d11_enum.py                                            # enumeration above
# controls A and B as quoted, each on a throwaway copy, both removed after
```

## Observed, not introduced: working-tree exec-bit drift

`git diff --summary` in this worktree reports four mode changes I did not make
and did not stage:

```
mode change 100755 => 100644 env/bootstrap-wsl.sh
mode change 100755 => 100644 env/tool-check.sh
mode change 100755 => 100644 env/wsl-clock-preflight.sh
mode change 100755 => 100644 install.sh
```

`git diff --numstat` shows `0 0` for all four — mode only, no content.

These predate this round. They are **working-tree vs index** drift: the index
still carries `100755`, which is why the inventory test (which reads the INDEX
blob, not the working tree) passes at 6/6. So nothing is broken today.

Recording it because it sits squarely in this package's subject matter and
because `AGENT_TRAPS.md` already warns that
`git update-index --chmod=+x` followed by `git add <same path>` silently reverts
the mode, and that the mode must be verified against the **commit**, not the
index. Four files carrying a working-tree mode that disagrees with the index is
the observable precursor to exactly that trap. Not fixed here — out of this
round's stated scope (F1/F2/F3 + the D11 enumeration), and changing modes
unasked is how a package acquires a diff nobody reviewed.
