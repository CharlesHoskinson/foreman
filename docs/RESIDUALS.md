# Residual work after v0.2.9.0

Total Georgecall v0.2.9.0 is released. This file lists residual limits that
feed the active v0.3.0 program. These items are not release blockers for
`v0.2.9.0`.

## Product limits

- The executable supports Grok, Claude, and Codex canaries.
- Gemini is not implemented. Google requests fail before provider dispatch.
- The release does not include a complete Council review coordinator or MCP
  runtime.
- The bundle is private workspace output. This release does not publish an npm
  package.

## Runtime limits

- The reference runtime is Node.js 24.
- POSIX and WSL provider execution are the live target boundary.
- Native Windows receives hosted build and process-test coverage.
- The hosted Windows gate does not run the complete Bats suite.
- Native Windows live provider canaries are outside this release.
- WSL can use a process group when a process namespace is unavailable.

## Foreman limits

- Pueue can mark a green worker round failed when `FOREMAN_REPORT.md` is stale.
- Grok can return an empty burst when a task needs repository exploration
  before one edit.
- The default isolated Grok home does not inherit the authenticated WSL Grok
  identity. The successful external run selected the authenticated WSL Grok
  home explicitly. Automatic credential copying is not implemented.
- The source-secret scan traverses dependency directories. It stalled the
  first external attempt while it scanned `node_modules` on a Windows mount.
  The successful retry installed dependencies only after the scan.
- Foreman writes `.harness/` telemetry inside target worktrees. The release
  ignores that path, but a future TypeScript orchestrator must place runtime
  state outside target source and define credential provisioning explicitly.
- The external repository passed its native gate. Exact-diff Council closure
  evidence remains incomplete.

## Migration limits

- New executable code uses Node.js and TypeScript.
- The repository still contains shell and Python modules.
- Complete Python removal remains in `typescriptmigration.md` and its OpenSpec
  package.

## Knowledge limits

- The v0.2.9.0 graph is exact for commit
  `fbe23257fc389036d6feaa8f38e7b377f3106406`.
- Graphify package version and CLI drift remains v0.3.0 work.
- Historical SessionDB facts remain immutable and can contain withdrawn
  release names.
- The installed Graphify package and vendored Graphify skill still have
  different versions.

## Release limits

- Read the canonical ledger at
  `docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md` before you claim work
  that this release already shipped.
- Plan unfinished work under
  `openspec/changes/v030-release-program/`.
- Do not claim live provider support without current provider-neutral
  receipts.
