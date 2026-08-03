# v0.2.9.0 Council Path Normalization Evidence

## Scope

The Node runtime resolves relative preflight paths against the CLI invocation
directory. It preserves absolute path strings and provider executable names.

The change covers these fields:

- `cwd`
- `observedBundle.diffPath`
- Each `artifactPaths[].path`

## TDD evidence

The first red test failed because the normalization function did not exist.

The audit rework added an absolute path with a lexical `..` segment. The test
failed because `node:path.resolve` removed the segment.

The final implementation uses `node:path.isAbsolute`. It returns absolute paths
unchanged and resolves only relative paths.

## Verification

The independent complete check passed these stages:

- Format
- Lint
- Type check
- Architecture check
- Build
- Test

Vitest passed 39 files and 1,125 tests. Strict OpenSpec validation passed 31
packages. The documentation gate passed.

## Audit lineage

Grok implemented the change through a durable Foreman round. Codex GPT-5.6 Sol
audited the exact diff in a read-only sandbox.

The first audit returned `BLOCKED`. It found that `resolve` changed absolute
paths with lexical segments. It also found POSIX separators in one test.

Grok completed one rework round. The second cold audit returned `APPROVED` with
zero findings.

These files preserve both verdicts:

- `audit-round-1-blocked.json`
- `audit-round-2-approved.json`

The initial Foreman Grok admission check rejected four tracked fixture documents
that contain a private-key banner test string. A source-only inspection found no
dotenv or key-named files. The operator used the verified WSL Grok home directly
for the durable rounds. Session obligation 105 records the guard defect for a
later release.
