## 1. Release authority and policy

- [x] 1.1 Converge the OpenSpec workflows and verify both schemas in strict mode.
- [x] 1.2 Implement release coverage, authority, admission, and composed policy checks and verify their focused TypeScript and Bats suites.
- [x] 1.3 Activate the eight-child execution family and verify durable family, child, queue, gate, and merge behavior.

## 2. Product foundations

- [x] 2.1 Ship the stable local project registry and verify its complete package suite.
- [x] 2.2 Ship the external MemoryIndex adapter and isolated projection epochs and verify unit, live-service, and network-disabled embedding tests.
- [x] 2.3 Ship the hermetic Foreman appliance and verify its lock, bootstrap, rootless-service, and image tests.
- [x] 2.4 Qualify Graphify 0.9.48 and verify deterministic graph publication and freshness checks.

## 3. Derived knowledge plane

- [x] 3.1 Ship the deterministic work-DAG projection and verify source and built-runtime output equality.
- [x] 3.2 Ship bounded cited graph-context construction and verify deterministic degradation and citation checks.
- [x] 3.3 Publish the locked 2,000-slot evaluation result and verify that absent observations produce `GRAPH_OFF_UNCOMPUTABLE` without fabricated runs.

## 4. Release preparation

- [x] 4.1 Set every workspace package version and internal dependency to 0.4.0 and regenerate the lockfile.
- [x] 4.2 Record the four high transitive npm advisories, their mitigations, and their explicit v0.4.0 acceptance in the release notes.
- [x] 4.3 Reconcile the unfinished SQLite graph-store expansion to v0.5 while retaining the shipped files-only graph port as the v0.4 dependency.
- [x] 4.4 Complete BW-004 and verify the native Windows flock, worktree-create, and worktree-merge Bats suites.

## 5. Candidate verification

- [x] 5.1 Reconcile every remaining v0.4 coverage entry and run lane coverage for each v0.4 owner.
- [x] 5.2 Run the complete TypeScript, runtime, install, documentation, OpenSpec, and Bats gates on the exact candidate.
- [x] 5.3 Run the exact candidate on hosted Linux and native Windows, and record the WSL verification result.
- [x] 5.4 Run release coverage on the unchanged candidate and verify the canonical release result.

## 6. Publication

- [ ] 6.1 Fast-forward `main` to the verified candidate and confirm the remote branch points to the same commit.
- [ ] 6.2 Create and push annotated tag `v0.4.0`, then publish the GitHub release from `docs/releases/v0.4.0-notes.md`.
- [ ] 6.3 Delete only merged release branches and preserve every active or unmerged worktree.
