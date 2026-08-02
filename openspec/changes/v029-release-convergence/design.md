# Design: v0.2.9.0 release convergence

## Architecture

Use an evidence-first convergence loop.

Foreman owns execution, worktrees, verification, gates, and merge decisions.
Grok implements one bounded task per round.
Council reviews immutable committed bundles and preserves dissent.

The architect owns package classification and finding resolution.

## Package matrix

Store the matrix at `evidence/package-matrix.tsv`.

Use these columns:

1. `package`
2. `disposition`
3. `owner_requirement`
4. `consumer`
5. `verification`
6. `result_artifact`

Use only these disposition values:

- `v029-implemented`
- `v029-gap`
- `v030-deferred`
- `parked`
- `withdrawn`
- `split`

A `v029-implemented` row requires a consumer and a verification command.
A deferred row requires a destination package or preservation file.

## Work-package order

1. Recover the Council review plane and admit the `agy` Setup lane.
2. Reconcile release scope and every active package.
3. Implement safety controls and close Tier 2 firing gaps.
4. Implement per-package audit evidence and telemetry sigma.
5. Close documentation, plugin, and freshness tooling.
6. Run final gates, refresh measurements, write records, and tag.

Later work depends on the package matrix.
Do not dispatch a later package from the stale checklist alone.

## Closeout dependency graph

The final implementation uses the following bounded work packages.
Each package has one owner, one isolated worktree, one focused gate, and one
independent cold audit.

| ID | Work package | Hard dependencies | Required result |
|---|---|---|---|
| C1 | Admit active core candidates | T1 package matrix | Each core candidate passes its host gate and an independent cold audit before commit. |
| C2 | Correct stale test records and record README decisions | T1 package matrix | Stale test claims are corrected and the user-delegated README decisions are recorded without rewriting the README. |
| I1 | Persist the WSL-native tool path | Accepted WSL preflight core | Setup writes an idempotent environment file and non-interactive lanes source it. |
| I2 | Wire vendor-preflight callers | Accepted vendor-preflight core and I1 | Setup, lane launch, and tool-check consume one bounded, identity-bound readiness record. |
| I3 | Integrate the doctrine registry | Accepted doctrine checker and C2 | The registry, documentation gate, release records, and Windows checks consume one documented doctrine contract. |
| I4 | Publish release sigma | Accepted metrics rollup | Repeated unchanged-code samples produce per-metric thresholds or `not_evaluated`. |
| I5 | Complete the README refresh | C2 and I2 through I4 | The final prose is grounded in the claim ledger, code, and current release evidence. |
| I7 | Retire stale doctrine and correct release records | C1 through I5 | Live withdrawn doctrine is removed and release records are grounded in the accepted implementations. |
| R1 | Freeze the release manifest and gate set | C1 through I5 and I7 | Matrix, archive, and audit-index predicates are final before control capture. |
| I6 | Prove real positive controls | Accepted inventory scanner and R1 | Every registered `kind: gate` check has a reachable known-bad and known-good arm at the frozen gate set. |
| R2 | Archive and build immutable per-package audits | I6 | Each shipped package is archived with source cold-audit evidence, then receives a source-preserving cross-family audit artifact. |
| R3 | Run final release convergence | R2 | All gates, freshness, graph refresh, records, typed Council approval, and tag conditions pass at one commit. |

The dependency order is normative.
In particular, Foreman SHALL NOT write final README claims before I2 through
I4 land. Foreman SHALL finalize matrix, archive, and audit-index predicates in
R1 before I6 captures positive-control records. R2 SHALL archive a package
only after its accepted implementation and source cold-audit evidence exist.
R2 SHALL build the immutable package audit after the archive move so the audit
scope binds to the final path.

## Candidate admission contract

A worker report is not admission evidence.
For each candidate in C1, the architect SHALL:

1. disable sparse checkout and inspect the complete diff;
2. run the focused host gate from a clean process environment;
3. obtain a read-only cold audit from a different model family;
4. route every release-grade finding to a new Grok rework round;
5. repeat the gate and cold audit after rework;
6. commit only the accepted tracked deliverables; and
7. exclude `.harness/`, `FOREMAN_REPORT*`, recovered prompt files, and other
   run-local evidence from the product commit.

One failed gate or one admissible `changes_requested` verdict keeps the
candidate at `v029-gap`.

## Review loop

Each Grok round produces a committed candidate after architect verification.
Foreman builds a bundle from different base and head commits.
The bundle records the diff content hash.

Council requires three admissible verdicts from at least two model-family domains.
One admissible `changes_requested` verdict forces rework.
The final typed Council outcome must be `approved`.
`insufficient_evidence`, `judge_unstable`, and `outcome_unknown` do not permit
release.

## Checkpoints

Write a SessionDB checkpoint at least once per hour.
Write another checkpoint before each long provider dispatch.
Write another checkpoint after each accepted package.

Do not record process liveness as a fact.

## Release gate

Do not create tag `v0.2.9` until all conditions hold:

- Every v0.2.9.0 package has executable implementation evidence.
- Every deferred item has a preserved v0.3.x destination.
- No release-blocking obligation remains open.
- Every quoted measurement is fresh at the final candidate commit.
- Council emits the typed outcome `approved` for the final bundle.
- `tools/ci-local.sh` and the recorded `merge-gate.sh check` pass.
