## Allowed file scope

`packages/orchestration/src/session-sqlite-bootstrap.ts`,
`packages/orchestration/src/fm-session-main.ts`, `packages/session-store/src/**`,
their `.test.ts` siblings, `tests/session.bats`, `RESUME.md`, `brokenwindows.md`.

## Tasks

- [ ] 1. Regression check. Add a `session-sqlite-bootstrap.test.ts` case that deletes the store and asserts that `recover` rebuilds from the sidecar (`rehydrateFromSidecarIfEmpty` at line 151 already does this). Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/session-sqlite-bootstrap.test.ts"`. Expected: pass without code changes. Commit.
- [ ] 2. RED: a case builds a half-migrated fixture (both schemas present) and asserts that `repair` renames it with the `.corrupt-` suffix and that `recover` then succeeds. Expected: fail, no `repair` command. GREEN: implement `repair` in `fm-session-main.ts` and the rename-and-rebuild path in `session-sqlite-bootstrap.ts`. Expected: pass. Commit.
- [ ] 3. RED: cases for the healthy-store no-op, the backup name collision, and `repair_failed` on a corrupt sidecar with the renamed file preserved. Expected: fail. GREEN: implement. Expected: pass. Commit.
- [ ] 4. RED: a case asserts the refusal text contains `run: node skills/foreman/runtime/dist/fm-session.js repair`. Expected: fail. GREEN: change the message at `session-sqlite-bootstrap.ts:107`. Expected: pass. Commit.
- [ ] 5. RED: a case asserts `no_session_source` with exit 2 when neither file exists. Expected: fail. GREEN: implement. Expected: pass. Commit.
- [ ] 6. Update `RESUME.md` to name `node skills/foreman/runtime/dist/fm-session.js` instead of the removed `fm-session.py`. Mark BW-008 resolved in `brokenwindows.md` with the commit.
- [ ] 7. Verify on the reference host: `node skills/foreman/runtime/dist/fm-session.js repair && node skills/foreman/runtime/dist/fm-session.js recover`. Expected: both exit 0 and the moved-aside file exists.

## Verification

```bash
npx tsx scripts/run-tests.ts "packages/orchestration/src/session-sqlite-bootstrap.test.ts" "packages/session-store/src/**/*.test.ts"
bats tests/session.bats
npm run build && npm run verify-runtime
```
