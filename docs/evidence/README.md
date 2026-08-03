# Evidence directory

Files below `docs/evidence/` are dated observations and immutable run records.
They can contain old release names, old branch names, failed claims, superseded
counts, or conclusions that apply only to one source commit.

Evidence does not become current guidance because it is searchable. Before you
reuse a claim, verify its date, source commit, command, and supersession state.

Use these files for current release guidance:

- `ROADMAP.md` for current scope and status;
- `checklist.md` for release criteria;
- `docs/RESIDUALS.md` for known limitations;
- `docs/releases/v0.2.8.2-notes.md` for release claims;
- `docs/releases/v0.2.8.2-cleanup-log.md` for cleanup dispositions.

Do not rewrite historical evidence only to remove `v0.2.9` text. If a record
is wrong or superseded, add a dated correction or label at the authority entry
point. SessionDB facts remain historical records and are not release-roadmap
authority.

A generated knowledge graph is current only when its manifest records the
source commit that contains the active guidance above. Reject a graph whose
source commit, node files, or validation evidence is missing.
