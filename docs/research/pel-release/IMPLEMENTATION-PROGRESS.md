# Return of the ForeDi implementation observation

Observation date: 2026-09-13. Committed source boundary: `6c1515ecf3d28ccbea6205731e9142aede7a8110`.
This note records repository evidence. It does not declare the final release accepted.

## Committed milestones

| Milestone | Implementation commit | Source record |
| --- | --- | --- |
| M1 language and host contracts | `b48b1a7` | [M1 implementation](../../releases/return-of-the-foredi/m1-implementation.md) |
| M2 checked authoring | `501558e` | [M2 implementation](../../releases/return-of-the-foredi/m2-implementation.md) |
| M3 exact provider adapters | `fb02774` | [M3 implementation](../../releases/return-of-the-foredi/m3-implementation.md) |
| M4 durable execution | `eb8c6de` | [M4 implementation](../../releases/return-of-the-foredi/m4-implementation.md) |
| M5 candidate delivery | `03ff807` | [M5 implementation](../../releases/return-of-the-foredi/m5-implementation.md) |

The [M5 verification record](../../releases/return-of-the-foredi/m5-verification.json) records 3,090 passed tests, seven skipped tests, and no failures. Its source hashes and retained command outputs bind that result to the M5 implementation. The later `6c1515e` commit binds its architecture check to the committed candidate.

M5 captures candidate identity from Git and file observations. It does not use provider claims as candidate authority. Publication requires the existing registered destination and candidate authority. Lost acknowledgement uses destination observation instead of a second push. The [M5 record](../../releases/return-of-the-foredi/m5-implementation.md) distinguishes these implemented boundaries from live coding qualification.

## Work after the committed boundary

M6 adoption work is in progress after this boundary. Installation, migration, research usability, simplification measurement, and exact live qualification require their own final evidence. Uncommitted test results do not extend the committed M5 verification record.

Instruction reduction requires a complete candidate-bound startup instruction corpus. Known mandatory files alone do not establish that corpus. A partial measurement must retain unknown totals and cannot pass the instruction target. The frozen [M6 design](../../../openspec/changes/foredi-06-adoption/design.md) owns the acceptance requirement.

## Graph provenance

The retained advisory graph uses Graphify 0.9.61. Its code baseline is `441c3fb9f6acb2656760d03cc79e7c706fb8b7dd`; the later release graph records `bbbdb7d670bd4b3e649866664f1e4aa83b38882d`. These are historical research snapshots, not an extraction of M1–M6 code.

The separate qualified Graphify 0.9.48 graph records source `637ebdbd10df1c9abaadb6e7cb5e40a6067ba875`. A freshness check against `6c1515e` reports stale. Graphify 0.9.61 output cannot replace or inherit that qualification. Final code extraction must use the fixed candidate and disclose unsupported syntax, unresolved references, and unmetered semantic work.

The research design and plan now live at [research-design.md](../../releases/return-of-the-foredi/research-design.md) and [research-plan.md](../../releases/return-of-the-foredi/research-plan.md). Older verification files retain their original paths and hashes as historical evidence.
