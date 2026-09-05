# Rework after GPT-6 Astra audit round 4

Round 4 confirmed all three round-3 findings resolved and raised three
blocking findings, all in the new `workflow-weight-reduction` package.
Each was verified against the cited file and line, then reworked. The
operator chose to merge after this round. This rework is not re-audited.

| Finding | Verified where | Change |
|---|---|---|
| B1 scope cannot register `gate-plan.js` or retire adapter pins | `build-runtime.ts:185`, `verify-runtime.ts:196`, adapter pins | Scope adds `build-runtime.ts`, `verify-runtime.ts` and test, `gate-plan-main.ts`, `documentation-check.ts`, and `architecture-adapter.ts`. Task 4 registers the bundle and retires the `merge-gate.sh` and `gate-eval.sh` pins when they become adapters. |
| B2 receipt authority is not a uid boundary | `services.ts:272`, diagnosis D1 | Replaced with receipt registration in `events.jsonl`, reuse verified by recomputed tree digest, registered digest, and event ordering. Trust equals `round_done` trust. Three forgery cases in task 2. |
| B3 concurrent audit has no admission path | `release-authority.ts:1413` | Audit is pipelined, not concurrent: reserved automatically when the passing checks receipt is registered. Policy order unchanged. |
| N1 atomicity and undefined terms | four specs | Landing split into four requirements. "Attributable" means the failure output names a diff path. Forbidden paths enumerated. |
| N2 Iron Rule wording, Effect ownership | task 11, design | `docs-check.sh` moves to `documentation-check.ts` with a thin adapter. Effect owns rework, pipelined audit, landing, cancellation. |
| N3 duplicate predicate rows | design.md | P12 to P15 appear once. |
| N4 idle computation | spec, P12 | Interval timestamps, union not sum, `landed` event carries `land_s`, twenty rounds bound to the candidate runtime, `UNCOMPUTABLE` with fewer. |
| N5 P14 and P15 measurement | design.md | `lane-round bench` over four pinned fixture repositories, receipts external. Read floor is bytes divided by four over `docs/doctrine-read-set.txt`. |
| N6 doctrine checker ownership | tasks 11 | `doctrine-reality-drift` owns the checker. The package moves to tranche 7 after that milestone. Doctrine check joins the documentation property closure. |
| N7 full-gate feasibility | tasks 9, 10 | New task 0 measures the complete Bats gate once. A budget renegotiation rule is a requirement. |
| N8 verification precision | bootstrap 1.2, build spec | `execution-guard-cli.test.ts` added to the RED command. Traversal roots distinguished from compared entries. |

## Pre-existing red test, not folded

`tests/wsl-launcher-shipped.bats` cases 1, 2, 8, and 9 fail at the baseline
commit `00c342b` as well. The fixture's Grok shim answers `--version` and
`models`, but Setup's readiness canary now sends `--single ... FOREMAN_GROK_READY_V1`,
so the shim returns empty output and Setup reports `MUST_FAIL: grok:degraded`.
This belongs to the test-infrastructure and doctrine-drift packages.
