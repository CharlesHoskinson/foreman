## Allowed file scope

`scripts/verify-runtime.ts`, `scripts/build-runtime.ts`,
`packages/orchestration/src/secret-scan.ts`, their `.test.ts` siblings,
`brokenwindows.md`.

## Tasks

- [ ] 1. RED: `scripts/verify-runtime.test.ts` builds a fixture with a symlinked `node_modules` and asserts `node_modules_symlink`. Run `npx tsx scripts/run-tests.ts "scripts/**/*.test.ts"`. Expected: fail. GREEN: add the identity check. Expected: pass. Commit.
- [ ] 2. RED: a test builds the same fixture commit at two temporary paths and asserts equal digests. Expected: fail if any bundle embeds a path. GREEN: build in a temporary directory and strip absolute paths from esbuild metadata. Expected: pass. Commit.
- [ ] 3. RED: `secret-scan.test.ts` asserts that an ignored file's lines are not counted and that `Refused` carries the bound name and count. Expected: fail. GREEN: implement. Expected: the existing "scans the current Foreman worktree clean" case passes on this host. Commit.
- [ ] 4. Mark BW-010 and BW-017 resolved in `brokenwindows.md` with the commit.

## Verification

```bash
npx tsx scripts/run-tests.ts "scripts/**/*.test.ts" "packages/orchestration/src/secret-scan.test.ts"
npm run build && npm run verify-runtime
```
