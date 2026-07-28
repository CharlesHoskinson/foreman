# OpenSpec change conventions

Foreman change specs follow [OpenSpec](https://github.com/Fission-AI/OpenSpec)
folder conventions (CLI optional).

**Header shape.** Packages authored from v0.2.9 onward use the form the
OpenSpec CLI parses, and validate under `openspec validate <change> --strict`:

```text
## ADDED Requirements
### Requirement: <title>
#### Scenario: <name>
```

Eight packages predating v0.2.9 use `## ADDED Requirement: <title>` and do
**not** validate. That is recorded rather than silently migrated: they are
out of this release's scope, and a mechanical transform would touch files
several in-flight packages already claim. New packages SHALL use the
parseable form.

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
