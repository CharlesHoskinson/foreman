# File contention and landing order — v0.2.9

Produced by the architect from a mechanical scan of every live change package's
`proposal.md` / `design.md` / `tasks.md` for referenced repo paths, 2026-07-28.
This is input to the review lanes, not a decision they must accept.

## Why this matters

v0.2.9 carries **24 live change packages** (13 authored for this release, 11
pre-existing). R5 §18 assessed the pre-existing set as having "only real
contention three-way on `env/tool-check.sh` and `lane-run.sh`". With the new
packages that is badly out of date: `tool-check.sh` is now claimed by **eight**
packages and `lane-run.sh` by **eight**. Landing order is no longer a
convenience — it is the difference between a clean merge sequence and a series
of conflicted rebases across a very large release.

## The contended files

| File | Packages claiming it | n |
|---|---|---|
| `env/tool-check.sh` | agy-lane-activation, knowledge-plane-refresh, lock-primitive-hardening, test-infrastructure-hardening, vendor-adapter-contract, vendor-concurrency-and-quota, wsl-launcher-shipped, wsl-tool-path-persistence | **8** |
| `skills/foreman/scripts/lane-run.sh` | agy-lane-activation, decision-lineage-and-telemetry, el-emit-spawn-reduction, graph-context-builder, round-ownership-default, wsl-launcher-shipped, wsl-preflight, wsl-seam-doctrine | **8** |
| `config/foreman.toml` | agy-lane-activation, cross-vendor-audit-routing, doctrine-reality-drift, round-ownership-default, three-outcome-verdicts, vendor-concurrency-and-quota | **6** |
| `skills/foreman/scripts/audit-run.sh` | cross-vendor-audit-routing, decision-lineage-and-telemetry, graph-context-builder, three-outcome-verdicts, vendor-adapter-contract | **5** |
| `skills/foreman/scripts/foreman-setup.sh` | round-ownership-default, wsl-launcher-shipped, wsl-preflight, wsl-seam-doctrine, wsl-tool-path-persistence | **5** |
| `skills/foreman/scripts/worker-run.sh` | agy-lane-activation, graph-context-builder, hard-mode-launcher, vendor-adapter-contract, wsl-seam-doctrine | **5** |
| `env/reference-manifest.toml` | knowledge-plane-refresh, lock-primitive-hardening, wsl-launcher-shipped, wsl-preflight, wsl-tool-path-persistence | **5** |
| `skills/foreman/scripts/lib/eventlog.sh` | decision-lineage-and-telemetry, el-emit-spawn-reduction, knowledge-plane-refresh, lock-primitive-hardening | **4** |
| `tests/run.sh` | el-emit-spawn-reduction, hard-mode-launcher, test-harness-fork-tax, test-infrastructure-hardening, v030-soft-mode-report | **5** |
| `skills/foreman/scripts/gate-eval.sh` | decision-lineage-and-telemetry, graph-context-builder, three-outcome-verdicts | 3 |
| `skills/foreman/scripts/lib/config.sh` | cross-vendor-audit-routing, round-ownership-default, three-outcome-verdicts | 3 |
| `skills/foreman/scripts/lane-queue.sh` | agy-lane-activation, vendor-concurrency-and-quota, wsl-seam-doctrine | 3 |
| `skills/foreman/scripts/lib/lock.sh` | knowledge-plane-refresh, lock-primitive-hardening | 2 (creator + consumer) |

## A capability-namespace collision

Two packages declare the capability `test-harness`:
`test-harness-fork-tax` (pre-existing) and `test-infrastructure-hardening`
(new). R5 §17 assessed `test-harness-fork-tax` as **stale — already merged in
v0.2.0 and visible in the code**, along with `el-emit-spawn-reduction`. Both
should be archived rather than carried, which resolves the collision and
removes two of the `tests/run.sh` and `eventlog.sh` claimants. That is an
architect decision, not something to leave to a merge conflict.

## Proposed landing order

Extends R5 §7.1 and SYNTHESIS §5. Each stage is independently taggable.

| Stage | Packages | Rationale |
|---|---|---|
| **S0** | archive `test-harness-fork-tax`, `el-emit-spawn-reduction` | Stale; removes 2 claimants and the capability collision before anything else moves |
| **S1** | `crlf-extensionless-hardening` (widened to 33 files + `nats/setup.sh`), `lock-primitive-hardening` | The lock is a stated precondition for every concurrent write path in the release. The exec-bit fix unblocks a clean working tree, which the installer change depends on |
| **S2** | `test-infrastructure-hardening` | Everything after this is verified by the suite; hardening it first is what makes later green ticks mean anything |
| **S3** | `wsl-launcher-shipped`, `wsl-tool-path-persistence`, `wsl-preflight`, `wsl-seam-doctrine` | The `tool-check.sh` / `foreman-setup.sh` cluster — land these together, serially, since four of the eight claimants are here |
| **S4** | `decision-lineage-and-telemetry`, `three-outcome-verdicts`, `round-ownership-default`, `doctrine-reality-drift` | Telemetry precedes every comparative claim in the release (PM's hinge criterion). Round-ownership needs the lock from S1 |
| **S5** | `vendor-adapter-contract`, `agy-lane-activation`, `cross-vendor-audit-routing`, `vendor-concurrency-and-quota` | Serial within the stage — all four touch `tool-check.sh` and `config/foreman.toml` |
| **S6** | `knowledge-plane-refresh`, `work-dag-projection`, `audit-groundedness-gate` | Graph plane, files-only. GP-2's first five checks need no graph store |
| **S7** | `graph-context-builder` | Consumes S6 |
| **S8** | `graph-store-port` *(may be deferred behind the GP-7 census)*, `graph-eval-falsification` | The store is the only genuinely optional stage |
| **S9** | `wsl-ci-parity` | Last, so CI asserts the final surface rather than a moving one |

## Serialisation rule

Within S3, S4 and S5, packages touching the same file land **serially, not in
parallel worktrees**. This release is being developed with Foreman itself, and
the repo's own doctrine (bugeventlog `:479-496`) records the architect
previously violating its own serialised-gates doctrine and paying for it. The
eight-way contention on `tool-check.sh` is exactly the shape that produced that
entry.

## Open question for the review lanes

Is S6-S8 worth carrying in this release at all, or should the graph plane be a
separate v0.3.x once telemetry (S4) has produced the query census GP-7
specifies? The PM lane's position is that the knowledge plane and the store are
**unjustified on current evidence**. The counter-argument is that S6's
`audit-groundedness-gate` catches a live failure class (hallucinated and
self-contradictory audit output) with 0%-FP closed-world checks and needs no
graph store at all — so at minimum GP-2 should survive any descoping.
