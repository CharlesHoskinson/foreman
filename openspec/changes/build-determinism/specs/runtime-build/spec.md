# Runtime build determinism specification

## ADDED Requirements

### Requirement: Dependency tree identity

WHEN `verify-runtime` starts, it SHALL check that `node_modules` is a real
directory and that `node_modules/.package-lock.json` matches
`package-lock.json`. IF either check fails, THEN it SHALL exit 1 with
`node_modules_symlink` or `lockfile_mismatch` and SHALL NOT report drift.

#### Scenario: Symlinked node_modules

- **WHEN** `node_modules` is a symbolic link
- **THEN** `verify-runtime` exits 1 with `node_modules_symlink`

#### Scenario: Installed tree matches

- **WHEN** `npm ci` produced `node_modules`
- **THEN** the identity check passes

### Requirement: Path-independent bundles

The runtime build SHALL produce byte-identical bundles from two checkouts of
the same commit at different absolute paths. WHEN `verify-runtime` compares
a fresh build with the tracked bundle, it SHALL build in a temporary
directory whose path does not appear in the output.

#### Scenario: Two checkouts agree

- **WHEN** the same commit is built at `/home/u/a` and `/tmp/b`
- **THEN** every bundle digest is equal

### Requirement: Bounded scan of the checkout

WHEN `secret-scan` runs on a repository root with default bounds, it SHALL
skip paths that Git ignores and SHALL report `bound_exceeded` with the bound
name and the observed count. The Foreman checkout SHALL scan `Clean` under
default bounds.

#### Scenario: Ignored paths are skipped

- **WHEN** `.foreman/session.rebuild-*.ndjson` is present and ignored
- **THEN** the scan does not count its lines

#### Scenario: Bound report is specific

- **WHEN** a bound is exceeded
- **THEN** the result names the bound and the count
