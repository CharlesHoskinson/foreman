# Project registry implementation tasks

## 1. Registry codec and store

- [x] Add RED tests for canonical registry decoding and exact field closure.
- [x] Add RED tests for duplicate bindings, linked files, and size bounds.
- [x] Implement the pure codec and atomic machine-local registry store.
- [x] Verify codec and live-store tests.

## 2. Session command integration

- [x] Add RED tests for `project register`, `status`, and `list`.
- [x] Add RED tests for linked worktrees and idempotent registration.
- [x] Implement the three project commands in `fm-session`.
- [x] Keep unregistered session commands byte-compatible.
- [x] Verify orchestration tests and session Bats tests.

## 3. Honest recovery

- [x] Add a RED test that selects project A's store from project B.
- [x] Require freshness to use project A or return `unknown`.
- [x] Add a deleted-project negative test.
- [x] Verify recovery output and migration row preservation.

## 4. Project-bound projections

- [x] Add RED tests for `project_id` in references and projection keys.
- [x] Add the explicit SessionStore metadata migration.
- [x] Update both SessionStore backends and projection helpers.
- [x] Verify both backend contract suites and copied runtime behavior.

## 5. Release lane

- [ ] Add the immutable package brief.
- [ ] Set project-registry coverage rows to `complete`.
- [ ] Run the lane coverage check.
- [ ] Run the full repository verifier.
