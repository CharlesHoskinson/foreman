# Five-part spec template

Copy this into every soft-mode delegation prompt and into hard-mode `task.md` /
plan handoffs.

```markdown
## Objective
[One paragraph: what to build or change and why.]

## Files
- create: path/to/new.file
- modify: path/to/existing.file
- do not touch: path/to/protected/**

## Interfaces
[Signatures, types, API shapes, HTML section IDs, CSS tokens — anything the
code must match exactly.]

## Constraints
- Project conventions: …
- Stack / libraries: …
- Forbidden: no new dependencies without asking; no drive-by refactors
- Mode notes: soft | hard

## Verification
```bash
# Exact command(s) the orchestrator will re-run
npm test
# or: python -m http.server 8080  (manual smoke)
# or: test -f site/index.html && grep -q "Foreman" site/index.html
```

```markdown

## Standing constraints (copy into EVERY spec's Constraints section)

- NEVER run git write commands (`commit`, `add`, `reset`, `branch`, `push`,
  `rebase`, `merge`, `tag`). Changes stay uncommitted in the working tree.
- Do not delete or rename files. List needed deletions/renames in your
  report under `ARCHITECT_ACTIONS`.
- Work only inside the provided worktree path. Never write outside it.
- No network access unless the spec explicitly grants it.
- Documentation and comments are part of the deliverable: markdown passes
  markdownlint-cli2; bash functions carry shdoc headers (`# @description`
  minimum); scripts carry a top-of-file purpose comment.

## Quality bar

- If you cannot fill **Interfaces** or **Verification**, you are not ready to
  delegate — finish architect work.
- Prefer absolute-from-repo-root paths.
- One task per spec when files overlap; parallelize only independent specs.

## Discovery-derived specs

A spec derived from discovery MUST inline the relevant captured interfaces,
request and response shapes, and constraints directly into its `## Interfaces`
and `## Constraints` sections. Never make the worker read the captured-facts
artifact before writing. A determined sub-spec carries the facts it needs
inline, preserving the
[single-burst write-first contract](../../../agents/grok-implementer.md#single-burst-write-first-specs)
so its first action can be a concrete write with zero repository reads first.

## EARS phrasing (required for Grok-bound specs)

Write Interfaces/Constraints/Verification requirements in EARS (Easy Approach
to Requirements Syntax). Fixed clause order, closed keyword set — this
measurably reduces implementer drift.

| Pattern | Template |
|---|---|
| Ubiquitous | The implementer SHALL <response>. |
| Event-driven | WHEN <trigger>, the implementer SHALL <response>. |
| State-driven | WHILE <precondition>, the implementer SHALL <response>. |
| Optional feature | WHERE <feature is included>, the implementer SHALL <response>. |
| Unwanted behavior | IF <unwanted condition>, THEN the implementer SHALL <response>. |
| Complex | WHILE <precondition>, WHEN <trigger>, the implementer SHALL <response>. |

Worked example (from a real spec):

> WHEN computing the dirty file set, the script SHALL build it as the sorted
> union of `git diff --name-only`, `git diff --name-only --cached`, and
> `git ls-files --others --exclude-standard`.
> IF a fix would require changing unrelated logic, THEN the implementer SHALL
> stop and report the gap instead of expanding scope.
