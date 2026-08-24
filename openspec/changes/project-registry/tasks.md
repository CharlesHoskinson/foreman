# Project registry implementation tasks

## 1. Registry codec and store

- [ ] Add RED tests for canonical registry decoding and exact field closure.
- [ ] Add RED tests for duplicate bindings, linked files, and size bounds.
- [ ] Implement the pure codec and atomic machine-local registry store.
- [ ] Verify codec and live-store tests.

## 2. Session command integration

- [ ] Add RED tests for `project register`, `status`, and `list`.
- [ ] Add RED tests for linked worktrees and idempotent registration.
- [ ] Implement the three project commands in `fm-session`.
- [ ] Keep unregistered session commands byte-compatible.
- [ ] Verify orchestration tests and session Bats tests.

## 3. Honest recovery

- [ ] Add a RED test that selects project A's store from project B.
- [ ] Require freshness to use project A or return `unknown`.
- [ ] Add a deleted-project negative test.
- [ ] Verify recovery output and migration row preservation.

## 4. Project-bound projections

- [ ] Add RED tests for `project_id` in references and projection keys.
- [ ] Add the explicit SessionStore metadata migration.
- [ ] Update both SessionStore backends and projection helpers.
- [ ] Verify both backend contract suites and copied runtime behavior.

## 5. Release lane

- [ ] Add the immutable package brief.
- [ ] Set project-registry coverage rows to `complete`.
- [ ] Run the lane coverage check.
- [ ] Run the full repository verifier.
