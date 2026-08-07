---
name: foreman-code-quality
description: Use when writing or reviewing Foreman code - covers the docs-check gate, shellcheck and shdoc requirements, file modes, safe scripted edits, and the TypeScript/Effect Iron Rule.
---

# Foreman code quality

Gates and repeat failures that turn CI red after a change looks done. Run these
yourself before `git add`, not after a green-looking diff.

## The docs gate

`skills/foreman/scripts/docs-check.sh` runs five checks in order:

1. **markdownlint-cli2** over `**/*.md`
2. **codespell** (config in `.codespellrc`)
3. **lychee** link-checker (offline by default; pass `--online` for live links)
4. **Agent vendor-invocation drift** — scans `agents/`, `.agents/`,
   `.claude/agents/`, `.codex/agents/` for raw `grok`/`codex`/`claude`/`agy`
   invocations that must come from `scripts/adapters/VENDOR.sh` instead
5. **Bash comment coverage** (shdoc-style headers)

Exit codes are fail-closed:

| Code | Meaning |
| --- | --- |
| 0 | All checks pass |
| 1 | Findings in one or more checks |
| 2 | A required tool is missing from PATH (gate refuses to skip) |

**VENDORED paths** are skipped by markdown, lychee, and comment-coverage
sweeps: `skills/scrapling`, `skills/graphify`, `skills/superpowers`,
`docs/research`, `sandbox`, `.harness`, `FOREMAN_REPORT.md` and `.json`,
`node_modules`. Do not put new first-party shell under those paths expecting
the gate to check it.

### Comment coverage (shdoc)

Every shell function (bare or `function`-prefixed name followed by
parentheses) must be immediately preceded by a comment block that contains an
`@description` line (`# @description ...`). Blank lines between the header and
the function are skipped; any other line breaks the association.

- The gate parser requires **only** `@description`. Missing it fails even if
  the function is otherwise well commented.
- `@arg`, `@stdout`, `@exitcode`, `@set`, `@return` are shdoc conventions to
  add as applicable; the gate does not require them.
- There is **no** trivial-function or `main()` exemption.
- Every tracked `*.sh` outside VENDORED, `.claude`, and
  `openspec/changes/archive` also needs a top-of-file purpose comment within
  the first 6 lines, excluding the shebang.

This fails late: a helper added at the end of a change without a header. Run
`skills/foreman/scripts/docs-check.sh` yourself before committing.

Compliant header shape (from `docs-check.sh`):

```bash
# @description Record one tool result.
# @arg $1 tool key
# @arg $2 status pass|fail|missing
# @arg $3 finding count
record() { T_STATUS[$1]="$2"; T_FINDINGS[$1]="${3:-0}"; return 0; }
```

Full shell detail: [Shell conventions](references/shell-conventions.md).

## Shell: shellcheck, safe edits, modes

Short rules; full text and examples in
[Shell conventions](references/shell-conventions.md).

1. **shellcheck must be CLEAN** — info-level findings (e.g. SC2016) still fail.
   Intentional single-quoted patterns need
   `# shellcheck disable=SC2016` on the line above with a why-comment.
   A disable on the line before a function scopes to that function only; for
   the whole file, place the directive at the top before any code.
2. **Scripted edits** write a temp file, assert on its contents, then
   `mv`/rename over the original. Never open a tracked file for writing
   directly — a redirect truncates first; a failed write has already emptied
   the file.
3. **Edit-then-commit scripts** must gate `git add` and commit on a
   verification step that returns nonzero **before** staging (`set -e` or
   explicit `exit 1`). Logging "verification failed" and committing anyway
   has pushed corruption.
4. **File modes:** tracked shell scripts are `100755`; sourced `.bash`
   libraries and `.bats` files are `100644`. Check the **index** with
   `git ls-files -s PATHS` and `bats tests/line-endings.bats`, not only the
   working tree.
5. **Line endings:** bash-shebang tracked files must be LF in the index.
   `.gitattributes` sets `text=auto eol=lf` plus explicit `eol=lf` for
   `*.sh`/`*.bash`/`*.bats`; CRLF carve-outs only for `*.bat`/`*.cmd`/`*.ps1`.
   Read the header of `tests/line-endings.bats` for what it asserts.

## Verify what is staged

The index is a snapshot at `git add` time, not a live view of the working
tree. Edits after `git add` are not in the next commit unless you re-add.

- After any late fix: `git add -A` or `git add PATH` again.
- After commit: `git status --porcelain` must return empty. Nonempty means
  the working tree still differs from HEAD.

A commit in this repository once captured pre-edit contents because the fix
landed after `git add` and before `git commit`.

## TypeScript / Effect (Iron Rule)

Short rules; full text in
[TypeScript conventions](references/typescript-conventions.md). Canonical
sources: [CLAUDE.md](../../../../CLAUDE.md), [AGENTS.md](../../../../AGENTS.md),
[design](../../../../openspec/changes/node-typescript-runtime/design.md).

1. **All new executable code** targets Node.js 24 and is TypeScript. No new
   Python, Bash, PowerShell, CMD, JavaScript, MJS, or CJS implementation
   files. Tests for new behavior are TypeScript.
2. **Existing non-TS entry points** may only delete behavior or become thin
   adapters: locate Node.js, forward exact argv/env, run one compiled TS
   entry, preserve exit status and stdout/stderr/signals. Adapters must not
   parse domain data, implement business rules, own state, schedule, retry,
   or supervise.
3. **Effect** owns typed failures, scoped resources, cancellation, retries,
   timeouts, and concurrency. Pure deterministic transforms stay ordinary
   TypeScript — do not wrap pure functions in Effect for style.
4. **API boundaries** return typed failures; throwing inside a local scope and
   converting via `Effect.try` / `Effect.either` at the boundary is correct.
5. **Strict compile; run on Node.js** — not Bun, Deno, or a TS-only runtime.
6. **Generated output:** `skills/foreman/runtime/dist/` and
   `skills/foreman/runtime/manifest.json` are generated. Never hand-edit.
   After TS source changes that feed a bundle: run the package build script,
   commit source + regenerated dist/manifest together, prove
   `git diff --exit-code` on dist is clean.
7. **Packages** live under `components/council/packages/`; new TS work goes in
   the appropriate package `src/`.

## Markdown style

Satisfy markdownlint-cli2 per repo root `.markdownlint-cli2.jsonc`:

- No consecutive blank lines (MD012)
- Every fenced code block declares a language
- Headings surrounded by blank lines
- File ends with a single trailing newline
- Ordered-list style per MD029
- Config: MD013 off, MD033 off, MD041 off, MD024 siblings_only, MD046 fenced

Write terse declarative prose. Do not invent rules not given here or measured
in the repo. If unsure of a fact, write "check X" rather than asserting a
guess.
