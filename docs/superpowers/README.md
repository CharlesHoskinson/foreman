# docs/superpowers — historical plan and design records

**Nothing here is normative.** These are dated records of how work was planned
and designed at a point in time. They are kept because the reasoning is worth
having, not because they describe the current system — several describe designs
that were later withdrawn, and at least one contains a file census that was wrong
when written.

**Requirements live in `openspec/changes/*/specs/`.** That is the only normative
home for a specification in this repository: it has the ADDED/MODIFIED
requirement structure, a tasks ledger with tick state, and an archive convention
for withdrawal (`openspec/changes/archive/`). If a statement here and a statement
there disagree, `openspec` wins and this file is history.

## Why this directory is not renamed

`specs/` here sits beside `openspec/changes/*/specs/`, and the word naming two
different things is a real hazard — a review of this repository flagged it. The
obvious fix is to rename this directory to `designs/`.

That fix costs more than it returns. Forty-five files reference
`docs/superpowers/specs`, and a substantial share of them are archived evidence
under `docs/evidence/`. Editing an archive to satisfy a path change falsifies
the archive, which is exactly the doctrine `.markdownlint-cli2.jsonc` already
encodes by exempting `docs/evidence/**` from linting. Leaving the archives
un-updated instead would break their links and fail the `lychee` gate.

So the ambiguity is resolved by saying which one is normative — this file —
rather than by a rename that would either corrupt archives or break links.

## What is here

- `plans/` — dated implementation plans, superseded as work landed
- `specs/` — dated design documents, several for withdrawn or reshaped work

Read them for reasoning and for the record of what was tried. Do not read them
for the current state: that lives in the session store
(`fm-session.py recover`), and the current requirements live in `openspec`.
