# OpenSpec change conventions

Foreman change specs follow [OpenSpec](https://github.com/Fission-AI/OpenSpec)
folder conventions (CLI optional).

**Header shape.** Live packages use the form the OpenSpec CLI parses, and
validate under `openspec validate <change> --strict` when `openspec` is on
`PATH`:

```text
## ADDED Requirements
### Requirement: <title>
#### Scenario: <name>
```

All 32 tracked non-archive change packages validate under `--strict`
(verified 2026-08-04). This count includes
`council-v029-preflight-release`, which is a protected `released_reference`
pending the registered `DST-0061` archive relocation. It is not active work.
The five S3 WSL packages (`wsl-ci-parity`, `wsl-launcher-shipped`,
`wsl-preflight`, `wsl-seam-doctrine`, `wsl-tool-path-persistence`) were
migrated from the legacy `## ADDED Requirement: <title>` form by a
content-preserving header transform only. New packages SHALL use the
parseable form above. Prefer `openspec` from `PATH` over a hard-coded path.
If `openspec` is absent, install with
`npm install -g @fission-ai/openspec` or use
`npx --yes @fission-ai/openspec@latest` for a one-shot validate.

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
