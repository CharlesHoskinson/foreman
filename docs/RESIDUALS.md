# v0.2.9.0 release candidate residuals

This file states current limitations. It does not record completed release evidence.

## Product limits

- The executable supports Grok, Claude, and Codex canaries.
- Gemini is not implemented. Google requests fail before provider dispatch.
- The release does not include a complete Council review coordinator or MCP runtime.
- The bundle is private workspace output. This release does not publish an npm package.

## Runtime limits

- The reference runtime is Node.js 24.
- POSIX and WSL provider execution are the live target boundary.
- Native Windows receives hosted build and process-test coverage.
- The hosted Windows gate does not run the complete Bats suite.
- Native Windows live provider canaries are outside this release.
- WSL can use a process group when a process namespace is unavailable.

## Foreman limits

- Pueue can mark a green worker round failed when `FOREMAN_REPORT.md` is stale.
- Grok can return an empty burst when a task needs repository exploration before one edit.
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
- Complete Python removal remains in `typescriptmigration.md` and its OpenSpec package.

## Knowledge limits

- The live graph predates the active candidate.
- The release requires one exact-candidate graph replacement.
- Historical SessionDB facts remain immutable and can contain withdrawn release names.
- The installed Graphify package and vendored Graphify skill still have different versions.

## Release limits

- Candidate evidence is not release evidence until every checklist criterion passes.
- Do not create tag `v0.2.9.0` before exact-main local, Linux, and Windows gates pass.
- Do not claim live provider support without current provider-neutral receipts.
