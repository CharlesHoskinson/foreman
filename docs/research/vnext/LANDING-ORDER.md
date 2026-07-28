# File contention and landing order — v0.2.9

**Revision 2, 2026-07-28.** Supersedes revision 1 entirely. Revision 1 derived
its contention table by grepping every package for path-shaped strings, which
counted a sentence saying a package does **not** touch a file as a claim on it.
Opus (NB-1) and Codex (B6) both flagged the table as unauthoritative, and Fable's
reconciliation made regenerating it fix R1/R2 — start-blocking.

This revision counts **modification claims only**: a path asserted in a
`proposal.md` `## Impact` section or on a `tasks.md` checkbox line, excluding
lines carrying disclaiming language (*does not*, *never*, *owned by*, *defers
to*, *consumer of*). Derived mechanically; the script is reproducible.

## What changed from revision 1

| | rev 1 (mentions) | rev 2 (claims) |
|---|---|---|
| Live packages | 24 (13 new / 11 pre-existing) | **33 (23 new / 10 pre-existing)** |
| Peak contention | 8 | **7** |
| Most contended file | `env/tool-check.sh` | **`config/foreman.toml.example`** and **`lane-run.sh`**, both 7 |
| Files claimed by >1 package | not computed | **22** |

The overcount was +1 to +2 on five files, and the ranking was wrong. The
qualitative conclusion is unchanged — contention is real and serialisation is
required — but the specific figures quoted in earlier reporting were inflated.
`test-infrastructure-hardening` no longer appears as a `tool-check.sh`
claimant; it was revision 1's clearest false positive, present only because it
contains a sentence saying it does not touch that file.

## Contended files (modification claims, n >= 3)

| File | Claims | Packages |
|---|---|---|
| `config/foreman.toml.example` | **7** | agy-lane-activation, audit-groundedness-gate, cross-vendor-audit-routing, doctrine-reality-drift, round-ownership-default, three-outcome-verdicts, vendor-concurrency-and-quota |
| `skills/foreman/scripts/lane-run.sh` | **7** | agy-lane-activation, decision-lineage-and-telemetry, graph-context-builder, round-ownership-default, wsl-launcher-shipped, wsl-preflight, wsl-seam-doctrine |
| `env/tool-check.sh` | **6** | agy-lane-activation, knowledge-plane-refresh, lock-primitive-hardening, vendor-concurrency-and-quota, wsl-launcher-shipped, wsl-tool-path-persistence |
| `skills/foreman/scripts/audit-run.sh` | 5 | cross-vendor-audit-routing, decision-lineage-and-telemetry, graph-context-builder, three-outcome-verdicts, vendor-adapter-contract |
| `skills/foreman/scripts/worker-run.sh` | 5 | agy-lane-activation, graph-context-builder, hard-mode-launcher, vendor-adapter-contract, wsl-seam-doctrine |
| `tests/run.sh` | 5 | el-emit-spawn-reduction, hard-mode-launcher, test-harness-fork-tax, test-infrastructure-hardening, v030-soft-mode-report |
| `skills/foreman/scripts/foreman-setup.sh` | 4 | round-ownership-default, wsl-launcher-shipped, wsl-preflight, wsl-tool-path-persistence |
| `skills/foreman/scripts/gate-eval.sh` | 4 | audit-groundedness-gate, decision-lineage-and-telemetry, graph-context-builder, three-outcome-verdicts |
| `env/reference-manifest.toml` | 3 | knowledge-plane-refresh, lock-primitive-hardening, wsl-launcher-shipped |
| `skills/foreman/scripts/lane-queue.sh` | 3 | agy-lane-activation, vendor-concurrency-and-quota, wsl-seam-doctrine |
| `skills/foreman/scripts/lib/config.sh` | 3 | cross-vendor-audit-routing, round-ownership-default, three-outcome-verdicts |
| `skills/foreman/scripts/lib/eventlog.sh` | 3 | el-emit-spawn-reduction, lock-primitive-hardening, work-dag-projection |
| `tests/eventlog.bats` | 3 | el-emit-spawn-reduction, lock-primitive-hardening, test-harness-fork-tax |

## Two packages had no stage — corrected

Revision 1 omitted `hard-mode-launcher` and `v030-soft-mode-report` from every
stage despite both claiming contended files (`worker-run.sh`, `pr-open.sh`,
`tests/run.sh`). Both are pre-existing and both fail validation. They are placed
below with the conformance decision attached.

## Landing order

Each stage is independently taggable. **Within a stage, packages claiming the
same file land serially, never in parallel worktrees** — bugeventlog `:479-496`
records the architect violating its own serialised-gates doctrine and paying
for it, and `config/foreman.toml.example` at 7 claimants is exactly that shape.

| Stage | Packages | Why here |
|---|---|---|
| **S0** | Archive `test-harness-fork-tax`, `el-emit-spawn-reduction`. Decide the OpenSpec conformance debt. | Both merged in v0.2.0 and visible in the code; one causes a live `test-harness` capability collision. Removes 3 claims on `tests/run.sh`/`eventlog.sh` before anything moves. |
| **S1** | `crlf-extensionless-hardening` (widen to 34 scripts + `nats/setup.sh`), `lock-primitive-hardening` | The lock is the stated precondition for every concurrent write path. The exec-bit fix unblocks a clean tree, which the installer change depends on. |
| **S2** | `test-infrastructure-hardening`, `formal-model-suite` | Everything after is verified by this suite. Hardening it first is what makes later green ticks mean anything. |
| **S3** | `wsl-launcher-shipped` → `wsl-tool-path-persistence` → `wsl-preflight` → `wsl-seam-doctrine` (serial) | Four of the six `tool-check.sh` claimants and three of the four `foreman-setup.sh` claimants sit here. |
| **S4** | `decision-lineage-and-telemetry` → `three-outcome-verdicts` → `round-ownership-default` → `doctrine-reality-drift` (serial on `config.toml`/`lane-run.sh`) | Telemetry precedes every comparative claim in the release. Round ownership needs the S1 lock. |
| **S5** | `vendor-adapter-contract` → `agy-lane-activation` → `cross-vendor-audit-routing` → `vendor-concurrency-and-quota` (serial) | All four claim `config/foreman.toml.example`; three claim `tool-check.sh`. |
| **S6** | `evidence-contracts`, `regression-harness-tiers`, `release-metrics` | Consume S2 and S4; low contention among themselves. |
| **S7** | `knowledge-plane-refresh` → `work-dag-projection` → `audit-groundedness-gate` (serial on `gate-eval.sh`) | Graph plane, files-only. GP-2's first five checks need no store. |
| **S8** | `graph-context-builder` | Consumes S7. |
| **S9** | `graph-store-port`, `terminusdb-schema` → `terminusdb-adapter` → `terminusdb-operations` | The store. Schema first — the adapter's ingest cannot be written against an unfrozen schema. |
| **S10** | `graph-eval-falsification`, `wsl-ci-parity` | CI last so it asserts the final surface. Falsification instrumentation starts at S4 but reports later. |
| **Removed from scope** | — | `hard-mode-launcher` shipped in v0.2.8 and is now archived at `openspec/changes/archive/2026-07-19-hard-mode-launcher/`, where `ROADMAP.md:132` always claimed it was — it had never actually been moved. `v030-soft-mode-report` was deleted by owner decision. Neither is live scope. |

## Open

Whether S7-S9 belong in this release at all remains contested: both plan-review
lanes recommended narrowing the graph plane, and the product owner has decided
the store ships. That decision stands. `audit-groundedness-gate` should survive
any descoping — its first five checks need no graph store and catch a failure
class nothing catches today.

## Revision 2a correction (codex re-audit)

Revision 2 named `config/foreman.toml` as the most contended file. **That path
does not exist** -- the repo has `config/foreman.toml.example`. The extension
alternation lacked a trailing path boundary, so the `.toml` branch matched the
prefix of the real filename. Found by the GPT-5.6 Sol re-audit, verified, and
fixed with a negative lookahead. The derivation script now also refuses to
report any path whose name becomes real when a suffix is appended -- the
precise signature of that artifact.

A first attempt at that guard was itself unsound: it flagged every nonexistent
path, which in a planning artifact is mostly deliverables the packages create
(`lib/lock.sh`, `tests/lock.bats`, CI workflows). Existence does not
discriminate the property; suffix-extensibility does.

The count also went stale (20 to 21) when the fix round added claims, so the
script now stamps the HEAD it was derived at. The peak is unchanged at 7; the
correct peak file is `skills/foreman/scripts/lane-run.sh`.

Two under-counting limitations are documented in the script header rather than
fixed: a claim on a wrapped task continuation line is missed, and a single
negation token suppresses every path on its line. Under-counting is the safer
error -- it yields a more conservative serialisation than reality demands,
where the over-count in revision 1 inflated the figures that were reported.

### Addendum: the boundary fix over-corrected before it settled

Adding the path boundary removed the phantom `config/foreman.toml` but then
matched `config/foreman.toml.example` **not at all**, silently dropping a file
seven packages genuinely claim. Three iterations were needed to get one regex
right: no boundary (phantom path), strict boundary (real file dropped), and
finally an explicit `.example` suffix plus the boundary.

Recorded because it is the release thesis in miniature. Each intermediate
version produced a clean-looking table, and neither wrong version announced
itself -- the first was caught by an auditor, the second only by chasing a
leftover reference. The final count is 22 files claimed by more than one
package, which independently matches what the re-audit computed.
