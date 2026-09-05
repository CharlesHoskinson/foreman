# Runtime build determinism specification

## ADDED Requirements

### Requirement: node_modules is a real directory

WHEN `verify-runtime` starts, it SHALL check that `node_modules` is a
directory and not a symbolic link. IF it is a symbolic link, THEN
`verify-runtime` SHALL exit 1 with `node_modules_symlink` and SHALL NOT
report drift.

#### Scenario: Symlinked node_modules

- **WHEN** `node_modules` is a symbolic link
- **THEN** `verify-runtime` exits 1 with `node_modules_symlink`

### Requirement: Installed tree matches the lockfile

WHEN `verify-runtime` starts, it SHALL compare the set of
`(package path, version, resolved, integrity)` tuples under `packages` in
`node_modules/.package-lock.json` with the same tuples in
`package-lock.json`, excluding the root entry `""`. IF any tuple differs or
is missing, THEN `verify-runtime` SHALL exit 1 with `lockfile_mismatch` and
SHALL name the first differing package path.

#### Scenario: Installed tree matches

- **WHEN** `npm ci` produced `node_modules`
- **THEN** the identity check passes

#### Scenario: One dependency drifted

- **WHEN** one package under `node_modules` has a different version than the lockfile
- **THEN** `verify-runtime` exits 1 with `lockfile_mismatch` and names that package

### Requirement: Drift cause is measured before it is fixed

WHEN two independent checkouts of the same commit at different absolute
paths are each installed with `npm ci` and built, `verify-runtime` SHALL
report which bundles differ and the first differing byte offset of each.

#### Scenario: Drift report

- **WHEN** the two builds differ in `appliance-doctor.js`
- **THEN** the report names `appliance-doctor.js` and the first differing offset

### Requirement: Path-independent bundles

WHEN the measured drift cause is removed, two independent checkouts of the
same commit SHALL produce byte-identical bundles.

#### Scenario: Two checkouts agree

- **WHEN** the same commit is built at `/home/u/a` and `/tmp/b` after `npm ci` in each
- **THEN** every bundle digest is equal

### Requirement: Scan selection

WHEN `secret-scan` runs on a repository root, it SHALL scan every tracked
file and every untracked file that Git does not ignore, and SHALL skip
ignored paths.

#### Scenario: Ignored paths are skipped

- **WHEN** `.foreman/session.rebuild-20260822T2135Z.ndjson` is present and ignored
- **THEN** the scan does not read it

#### Scenario: Untracked secret is still found

- **WHEN** an untracked, non-ignored file contains a planted secret
- **THEN** the scan reports it

### Requirement: Bound violation report

IF a bound is exceeded, THEN the result SHALL be `Refused` with the bound
name and the observed count.

#### Scenario: Bound report is specific

- **WHEN** the file count exceeds `maxFiles`
- **THEN** the result names `maxFiles` and the observed count

### Requirement: The checkout scans clean

WHEN `secret-scan` runs on the Foreman checkout at the candidate commit
with default bounds, the result SHALL be `Clean`.

#### Scenario: Reference checkout is clean

- **WHEN** the scan runs on the candidate with no planted secret
- **THEN** the result is `Clean`
