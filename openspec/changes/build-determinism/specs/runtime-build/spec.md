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

### Requirement: Expected installed set

WHEN `verify-runtime` starts, it SHALL derive the expected installed set by
walking `package-lock.json` from the traversal roots (the root entry `""`
and each workspace `link: true` entry, which are traversed but never
compared)
along `dependencies`, `devDependencies`, and `peerDependencies` edges, and
along `optionalDependencies` edges only into entries whose `os`, `cpu`, and
`libc` lists admit the current host. An entry reachable only through an
excluded optional entry SHALL NOT be expected. On the reference Linux x64
glibc host this excludes the 75 platform-specific optional packages and
the four entries reachable only through the musl and WASM branches.

#### Scenario: Platform optional package absent

- **WHEN** an `optional: true` package lists `os: ["aix"]` and the host is Linux
- **THEN** its absence from `node_modules` is not a mismatch

#### Scenario: libc-mismatched optional package absent

- **WHEN** an `optional: true` package lists `libc: ["musl"]` and the host reports glibc
- **THEN** its absence is not a mismatch

#### Scenario: Excluded-parent dependency absent

- **WHEN** `tslib` is reachable only through an excluded optional package
- **THEN** its absence is not a mismatch

### Requirement: Installed tree matches the expected set

WHEN the expected set is derived, `verify-runtime` SHALL compare each
expected entry's `(package path, version, resolved, integrity)` tuple with
`node_modules/.package-lock.json`, and SHALL check that the entry's
directory exists with a `package.json` whose `version` equals the tuple's
version. IF an expected entry is missing from the hidden lockfile, any
tuple differs, the directory is absent, or the installed version differs,
THEN `verify-runtime` SHALL exit 1 with `lockfile_mismatch` and SHALL name
the first differing package path.

#### Scenario: Installed tree matches

- **WHEN** `npm ci` produced `node_modules`
- **THEN** the identity check passes on the reference host

#### Scenario: One dependency drifted

- **WHEN** one expected package under `node_modules` has a different version than the lockfile
- **THEN** `verify-runtime` exits 1 with `lockfile_mismatch` and names that package

#### Scenario: Required package missing

- **WHEN** a non-optional package is absent from `node_modules`
- **THEN** `verify-runtime` exits 1 with `lockfile_mismatch` and names it

### Requirement: Drift cause is measured before it is fixed

WHEN two independent checkouts of the same commit at different absolute
paths are each installed with `npm ci` and built, `verify-runtime` SHALL
report which bundles differ and the first differing byte offset of each.

#### Scenario: Drift report

- **WHEN** the two builds differ in `appliance-doctor.js`
- **THEN** the report names `appliance-doctor.js` and the first differing offset

### Requirement: Path-independent bundles

WHEN two builds run from checkouts with identical declared inputs (the
same commit, `npm ci` from the same lockfile, the same Node version), they
SHALL produce byte-identical bundles regardless of checkout path.

#### Scenario: Two checkouts agree

- **WHEN** the same commit is built at `/home/u/a` and `/tmp/b` after `npm ci` in each
- **THEN** every bundle digest is equal

### Requirement: Scan selection

WHEN `secret-scan` runs on a repository root, it SHALL scan every tracked
file. WHEN it encounters an untracked file, it SHALL scan the file only if
Git does not ignore it.

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

WHEN `secret-scan` runs on an uncontaminated Foreman checkout at the
candidate commit with default bounds, the result SHALL be `Clean`.

#### Scenario: Reference checkout is clean

- **WHEN** the scan runs on the candidate with no planted secret
- **THEN** the result is `Clean`
