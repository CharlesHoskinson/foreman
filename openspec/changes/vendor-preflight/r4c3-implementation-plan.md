# R4C3 persisted vendor-lane admission implementation plan

> **For agentic workers:** Use test-driven development for each task.

**Goal:** Make vendor-lane admission consume only the persisted TypeScript preflight record.

**Architecture:** `lane-run.sh` forwards one vendor and one absolute record path to `lane-gate`. A closed TypeScript policy validator pins the legacy remainder and accepts only this forwarding block.

**Tech stack:** Node.js 24, strict TypeScript, Effect, Bats, and deterministic generated runtime bundles.

## Global constraints

- Do not change the `lane-gate` interface.
- Do not add shell domain logic.
- Do not change later orchestration packages.
- Do not add record freshness policy.
- Do not claim Council quorum.

## Task 1: Write RED process-boundary tests

**Files:**

- Modify `tests/lifecycle-gate.bats`.
- Modify other listed Bats files only when their old live-probe fixture becomes invalid.

- [x] Replace live vendor shims with canonical persisted records.
- [x] Add a trap executable that records any live vendor probe.
- [x] Prove that the current implementation fails the persisted-ready case.
- [x] Prove that the current implementation fails the no-live-probe case.
- [x] Record both RED outputs.

## Task 2: Write RED architecture-policy tests

**Files:**

- Modify `packages/policy/src/architecture-adapter.test.ts`.

- [x] Add a test that requires the tracked `lane-run.sh` migration artifact to pass.
- [x] Add a test that changes one forwarding-block byte and requires rejection.
- [x] Add a test that changes one remainder byte and requires rejection.
- [x] Run the focused test file.
- [x] Confirm that the exact-artifact test fails before production changes.

## Task 3: Implement the closed migration validator

**Files:**

- Modify `packages/policy/src/architecture-adapter.ts`.
- Modify `packages/policy/src/architecture-evaluate.ts` only if required.

- [x] Match only the exact repository-relative `lane-run.sh` path.
- [x] Match only the exact forwarding and boundary block from the task specification.
- [x] Normalize only that one block before hashing the remainder.
- [x] Compare the SHA-256 digest with one compiled constant.
- [x] Return `legacy_adapter_domain_logic` after any mismatch.
- [x] Run the focused policy tests.
- [x] Confirm that all focused policy tests pass.

## Task 4: Replace live lane readiness

**Files:**

- Modify `skills/foreman/scripts/lane-run.sh`.

- [x] Delete the live `FOREMAN_TOOL_CHECK` and `env/tool-check.sh` readiness branch.
- [x] Delete the unverified continuation and its alert.
- [x] Add the exact forwarding and boundary block from the task specification.
- [x] Delete stale shell comments that describe the removed probe.
- [x] Preserve the closed vendor map, secret scan, and all later code.
- [x] Run the focused Bats files under the host-wide lock.
- [x] Confirm that all focused Bats tests pass.

## Task 5: Build and verify

**Files:**

- Update generated architecture runtime files through `npm run build` only.

- [x] Run TypeScript type checking.
- [x] Build twice.
- [x] Compare the two architecture-policy digests.
- [x] Run runtime verification.
- [x] Run the full Node verification suite.
- [x] Run affected Bats tests under the host-wide lock.
- [x] Run architecture policy against base `438f2e2`.
- [x] Run repository hygiene.
- [x] Run documentation checks.
- [x] Run strict validation for both OpenSpec changes.
- [x] Run `git diff --check`.
- [x] Write exact RED and GREEN evidence in the worker report.
