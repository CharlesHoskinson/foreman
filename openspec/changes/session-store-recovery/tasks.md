## Allowed file scope

`packages/orchestration/src/session-sqlite-bootstrap.ts`,
`packages/orchestration/src/fm-session-main.ts`, `packages/session-store/src/**`,
their `.test.ts` siblings, `tests/session.bats`, `RESUME.md`, `brokenwindows.md`.

## Tasks

- [ ] 1. RED: `session-sqlite-bootstrap.test.ts` builds a half-migrated fixture and asserts that `repair` renames it and `recover` then succeeds. Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/session-sqlite-bootstrap.test.ts"`. Expected: fail, no `repair`.
- [ ] 2. GREEN: implement `repair` in `fm-session-main.ts` and the rebuild path in `session-sqlite-bootstrap.ts`. Expected: pass.
- [ ] 3. RED: a test deletes the store and asserts that `recover` rebuilds from the sidecar. Expected: fail. GREEN: implement. Expected: pass.
- [ ] 4. RED: a test asserts the refusal text contains the exact repair command. Expected: fail. GREEN: change the message. Expected: pass.
- [ ] 5. Update `RESUME.md` to name `fm-session.js` instead of the removed `fm-session.py`. Mark BW-008 resolved in `brokenwindows.md` with the commit.
- [ ] 6. Verify on this host: `node skills/foreman/runtime/dist/fm-session.js repair && node skills/foreman/runtime/dist/fm-session.js recover`. Expected: both exit 0.

## Verification

```bash
npx tsx scripts/run-tests.ts "packages/orchestration/src/session-sqlite-bootstrap.test.ts" "packages/session-store/src/**/*.test.ts"
bats tests/session.bats
npm run build && npm run verify-runtime
```
