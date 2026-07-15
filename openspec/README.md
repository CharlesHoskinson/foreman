# OpenSpec change conventions

Foreman change specs follow [OpenSpec](https://github.com/Fission-AI/OpenSpec)
folder conventions (CLI optional):

- `openspec/changes/<change-name>/` — one folder per change:
  - `proposal.md` — why + what is changing
  - `specs/` — requirements and scenarios (EARS phrasing, see
    `skills/foreman/references/five-part-spec.md`)
  - `design.md` — technical approach
  - `tasks.md` — implementation checklist
- Workflow: propose → approve → implement (foreman lanes) → archive.
- WHEN a change ships, the folder SHALL move to
  `openspec/changes/archive/<YYYY-MM-DD>-<change-name>/`.
- Legacy pre-OpenSpec specs live in `docs/superpowers/specs/` and stay there.
