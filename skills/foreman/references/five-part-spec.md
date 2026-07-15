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
```

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
