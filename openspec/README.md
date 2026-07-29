# OpenSpec change conventions

Foreman change specs follow [OpenSpec](https://github.com/Fission-AI/OpenSpec)
folder conventions (CLI optional).

**Header shape.** Live packages use the form the OpenSpec CLI parses, and
validate under `/usr/local/bin/openspec validate <change> --strict`:

```text
## ADDED Requirements
### Requirement: <title>
#### Scenario: <name>
```

All 33 live change packages validate under `--strict` (verified 2026-07-29).
The five S3 WSL packages (`wsl-ci-parity`, `wsl-launcher-shipped`,
`wsl-preflight`, `wsl-seam-doctrine`, `wsl-tool-path-persistence`) were
migrated from the legacy `## ADDED Requirement: <title>` form by a
content-preserving header transform only. New packages SHALL use the
parseable form above. Prefer `/usr/local/bin/openspec` over `npx openspec`
(the latter resolves to a broken 0.0.0 stub in some environments).

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
