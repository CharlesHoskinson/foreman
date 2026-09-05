## Allowed file scope

Exact paths or terminal `/**` prefixes.

- `scripts/verify-runtime.ts`, `scripts/verify-runtime.test.ts`
- `scripts/build-runtime.ts`, `scripts/build-runtime.test.ts`
- `packages/orchestration/src/secret-scan.ts`, `packages/orchestration/src/secret-scan.test.ts`
- `brokenwindows.md`, `docs/research/v050/**`
- `skills/foreman/runtime/dist/**`, `skills/foreman/runtime/manifest.json`

## Tasks

- [ ] 1. RED: `scripts/verify-runtime.test.ts` builds a fixture with a symlinked `node_modules` and asserts `node_modules_symlink`. Run `npx tsx scripts/run-tests.ts "scripts/**/*.test.ts"`. Expected: fail. GREEN: add the check. Expected: pass. Commit.
- [ ] 2. RED: five fixtures: a hidden lockfile with a different version, a missing required package, a missing OS-excluded optional, a missing musl-only optional on a glibc host, and a missing entry reachable only through an excluded optional. A sixth fixture removes an installed directory while the hidden lockfile is unchanged. Expected: the mismatch fixtures assert `lockfile_mismatch` and fail, the legitimate-omission fixtures assert pass and fail. GREEN: implement the reachability walk with `os`, `cpu`, and `libc` eligibility, the tuple comparison, and the directory and version check. Expected: all six pass. Commit.
- [ ] 3. Measure. Create two checkouts of the candidate at different paths, run `npm ci` in each, build both, and record which bundles differ and at which offset under `docs/research/v050/build-drift-<commit>.md`. Expected: a named cause. Commit the receipt.
- [ ] 4. RED: a test builds one fixture at two temporary paths and asserts equal digests. Expected: fail at the measured cause. GREEN: remove that cause in `build-runtime.ts`. Expected: pass. Commit.
- [ ] 5. RED: `secret-scan.test.ts` cases for ignored-path skipping, an untracked planted secret still found, and a `Refused` result carrying the bound name and count. Expected: fail. GREEN: implement using `git ls-files --cached --others --exclude-standard`. Expected: the existing "scans the current Foreman worktree clean" case passes on the reference host. Commit.
- [ ] 6. Mark BW-010 and BW-017 resolved in `brokenwindows.md` with the commit.

## Verification

```bash
npx tsx scripts/run-tests.ts "scripts/**/*.test.ts" "packages/orchestration/src/secret-scan.test.ts"
npm run build && npm run verify-runtime
```
