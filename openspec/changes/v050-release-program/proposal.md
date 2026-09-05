# Change: v050-release-program

## Why

Foreman v0.4.0 shipped and the containment remedy of 2026-09-05 landed on
`main`. The repository has no current release contract for what follows.
Forty-eight active OpenSpec packages carry open tasks. Several are stale,
several target Bash, and none states the release it belongs to.

The lane path still runs in Bash. The architecture policy admits `lane-run.sh`
and `watch.sh` only by digest pin. Every lane change needs a re-pin. A lane
can still exit 0 with no work, and an audit verdict has no value for "no
judgment was formed".

## What changes

- Establish one canonical v0.5 release program at commit
  `00c342bd449948ab2ea5ca0b9d0c890614dd81d6`.
- Make the release runtime program-parameterized. The literal `v040` in
  `release-policy`, `release-admission`, and `release-coverage` becomes a
  closed program enum that includes `v050`.
- Reconcile every active package in one coverage register with a closed
  disposition enum: `v050_owner`, `v050_dependency`, `released_reference`,
  `superseded`, `v060`.
- Order eight dependency-bound tranches and run them under one root-anchored
  Endstop contract family with thirteen package-level children.
- Own the four new packages: `lane-runtime-typescript`,
  `session-store-recovery`, `build-determinism`, and this program.
- Reconcile nine existing packages before their implementation starts.
  Re-express Bash-targeted tasks in TypeScript before dispatch.
- Define eleven exit predicates and measure each on the unchanged candidate.
- Reassign the Council and formal roadmap rows to v0.6 and add the v0.5 rows.
- Publish tag `v0.5.0` only after every gate and the independent cold audit
  pass on unchanged bytes.

## Impact

- **Authority:** This package governs v0.5 scope, order, integration, and
  publication. Focused packages own their module contracts.
- **Runtime:** every program authority in `packages/policy` and
  `packages/orchestration` accepts program `v050`. The v0.4 evidence bundles
  stay valid for program `v040`.
- **Process:** The v0.4 loop is reused unchanged. An approved `tasks.md` is
  the only active plan for its package.
- **Deferral:** Ten packages move to v0.6 with a recorded reason each.
