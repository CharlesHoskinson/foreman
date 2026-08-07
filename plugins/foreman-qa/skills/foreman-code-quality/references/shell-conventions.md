# Shell conventions

Full rules for shellcheck, safe scripted edits, file modes, and line endings.
Short versions live in the parent [SKILL.md](../SKILL.md).

## shellcheck must be CLEAN

shellcheck findings at any severity fail the gate, including info-level
rules such as SC2016 (expressions do not expand in single quotes).

When a single-quoted pattern is intentional because a literal dollar sign
must reach `grep`, `sed`, or `awk` unexpanded, put a disable directive on
the line immediately above, with a trailing explanation:

```bash
# shellcheck disable=SC2016 (literal dollar for awk)
```

Real example from `skills/foreman/scripts/docs-check.sh`:

```bash
# shellcheck disable=SC2012 (globbed package layout is intentionally resolved by ls)
LYCHEE_CMD="$(ls "${LOCALAPPDATA:-}"/Microsoft/WinGet/Packages/lycheeverse.lychee*/*/lychee.exe 2>/dev/null | head -1 || true)"
```

### Disable scoping

- A `shellcheck disable` directive on the line immediately before a function
  scopes to **that function only** (and anything after it in the file at the
  same nesting), not the whole file.
- To disable a check for the **whole file**, the directive must appear before
  any code, at the top of the file, on its own line.

## Safe scripted edits

Scripted edits to tracked files MUST:

1. Write a temp file
2. Assert on its contents
3. Move (rename) the temp file over the original

Never open a tracked file for writing directly. A redirect truncates the
target immediately, before the script has produced anything. A failed write
truncates first; the check that would have caught the failure never runs
against the real content.

This has already emptied a tracked test file once in this repository. Only
the commit gate, not the script, caught it before remote push.

## Gate commits on verification exit code

Every scripted edit-then-commit sequence must gate `git add` and the commit
on a verification step that returns a **nonzero exit before staging**.

- Check the verification step with `set -e` or an explicit fallback to
  `exit 1`.
- Do not only print a pass/fail message and continue.
- A script that prints "verification failed" and then commits anyway has, in
  this repository, pushed corruption.

## File modes

| Kind | Index mode | Why |
| --- | --- | --- |
| Shell scripts (`*.sh` intended to run) | `100755` | Executed directly |
| Sourced `.bash` libraries | `100644` | Sourced, never executed |
| `.bats` test files | `100644` | Run via bats, never executed |

A file created in a sandbox, or edited from a Windows-side tool, can land as
`100644` when it should be `100755`, or the reverse. That silently turns CI
red with `Permission denied` on a script that looks correct in its diff.

### Check the index, not only the working tree

```bash
git ls-files -s PATHS
```

The second column is the mode (`100755` = executable, `100644` = not).

Also run:

```bash
bats tests/line-endings.bats
```

A working-tree file can look fine locally while the staged or committed blob
is wrong. Trust what `git ls-files -s` and the bats file report about the
**index**.

## Line endings

Bash-shebang tracked files (anything whose shebang line contains `bash`,
regardless of extension) must be **LF** in the index.

Repository `.gitattributes`:

- Catch-all: `text=auto eol=lf`
- Explicit `eol=lf` for `*.sh`, `*.bash`, `*.bats`
- Narrow CRLF carve-outs only for `*.bat`, `*.cmd`, `*.ps1`
- Binary carve-outs for types such as `*.png`, `*.jpg`, `*.pdf`, `*.exe`
- Three extensionless SDD scripts also carry an explicit per-path `eol=lf`
  rule because they have no matching extension pattern

`tests/line-endings.bats` is the enforcement mechanism. Read its header
comment before assuming a mode or line-ending issue is fine. It asserts:

- index LF
- exec-bit inventory
- Windows carve-out
- PNG binary carve-out

## GitHub Actions: GITHUB_PATH and runner PATH gotchas

### GITHUB_PATH takes effect on the next step, not the current one

Writing to `$GITHUB_PATH` (`printf '%s
' "$dir" >> "$GITHUB_PATH"`) only
extends `PATH` for **steps that run after** the one that wrote it. A
verification line placed later in the *same* step cannot see the new
entry and fails with a plain `command not found` -- indistinguishable
from a genuinely broken install unless the timing rule is already known.

Export `PATH` explicitly in the same step for anything that step itself
needs to run. `.github/workflows/gates-linux.yml` does this correctly
right where it matters:

```bash
printf '%s
' "$HOME/.local/bin" >> "$GITHUB_PATH"
export PATH="$HOME/.local/bin:$PATH"
```

The `$GITHUB_PATH` write hands the entry to later steps; the `export`
makes it usable in this one. Writing only the first line and calling the
newly installed tool later in the same step is the trap.

### A missing tool on a hosted runner may be a PATH gap, not an absent package

`flock` ships in `util-linux`. On Windows runners, the package manager
can report it already installed (`util-linux is up to date -- skipping`)
while Git for Windows' bash still does not expose it on `PATH` -- so any
test or `require_tool flock` guard reads it as absent. Before writing an
install step for a "missing" tool on a hosted runner, check whether it
is present off `PATH` first. General rule and evidence:
[evidence-rules.md](../../foreman-qa/references/evidence-rules.md#a-not-found-result-is-not-proof-of-absence).

## Docs-check comment coverage (detail)

Gate: `skills/foreman/scripts/docs-check.sh`.

Every shell function matched by a bare or `function`-prefixed name followed
by parentheses must be immediately preceded (blank lines skipped; any other
line breaks the association) by a comment block containing:

```text
# @description ...
```

That is the only tag the checker parses for pass/fail. shdoc tags
`@arg`, `@stdout`, `@exitcode`, `@set`, `@return` are conventions to add as
applicable; they do not satisfy the gate by themselves.

There is no built-in or trivial-function exemption. A missing header on
`main()` fails the gate.

Every tracked `*.sh` outside VENDORED, `.claude`, and
`openspec/changes/archive` also needs a top-of-file purpose comment within
the first 6 lines, excluding the shebang.

VENDORED (skipped by markdown, lychee, and comment-coverage sweeps):

- `skills/scrapling`
- `skills/graphify`
- `skills/superpowers`
- `docs/research`
- `sandbox`
- `.harness`
- `FOREMAN_REPORT.md` and `.json`
- `node_modules`

Do not add new first-party shell under those paths expecting the gate to
check it.

Compliant example from `docs-check.sh`:

```bash
# @description Record one tool result.
# @arg $1 tool key
# @arg $2 status pass|fail|missing
# @arg $3 finding count
record() { T_STATUS[$1]="$2"; T_FINDINGS[$1]="${3:-0}"; return 0; }
```

Run the docs gate yourself before `git add`, not after everything else looks
done. A late helper without a header is the common failure.
