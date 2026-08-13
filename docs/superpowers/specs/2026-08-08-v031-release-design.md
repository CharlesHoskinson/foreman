# v0.3.1 "George's Odyssey" — session state is portable

Status: design, approved 2026-08-08. Not an implementation plan.

v0.3.1 is one sentence: **session state is portable — one contract, two
implementations.**

v0.3.0 finished the Node migration. It left `fm-session-main.ts` as a 790-line
`// @ts-nocheck` module holding `node:sqlite` directly, and PR #42 landed a
storage port contract that nothing yet uses. v0.3.1 closes that gap and proves
the contract by satisfying it twice.

## Exit predicates

Six predicates, each falsifiable, all measured on one unchanged pushed commit.

| # | Predicate | Measurement |
|---|---|---|
| 1 | No direct backend access outside the port | Over tracked source, excluding any `dist/`: `node:sqlite` appears only under `packages/session-store/src` |
| 2 | CLI behaviour is unchanged | `tests/session.bats` 29/29 green through the port, and `tests/session-golden.bats` reports an empty diff |
| 3 | The contract is portable | `contract-suite.ts` passes **unchanged** against both `SqliteSessionStore` and `FilesOnlySessionStore` |
| 4 | Correctness is independent of the projection | Every `fm-session` command is byte-identical in stdout, stderr and exit code under null, throwing, hanging and poison `MemoryIndex` |
| 5 | The migration is complete | `fm-session-main.ts` contains no `// @ts-nocheck` |
| 6 | The outbox is exactly-once | `fm-session sync` drains under injected retry and timeout without double-writing |

Predicate 3 is the one that matters. A contract satisfied once is a description
of its only implementation.

## What ships

| Item | Purpose |
|---|---|
| `FilesOnlySessionStore` | Second `SessionStore` implementation, NDJSON-backed. Mirrors `FilesOnlyGraphStore`, which is the established precedent in this repository |
| `fm-session-main.ts` rebuilt on the port | Removes direct `node:sqlite` use and `// @ts-nocheck` |
| `fm-session sync` | Drains `memory_outbox` with bounded retry and idempotency keys |
| `remap` id-collision policy | Currently throws as unimplemented; import into a non-empty store must rewrite `superseded_by` pointers |
| Backend factory | Single selection point reading `FOREMAN_SESSION_BACKEND`, defaulting to SQLite. The CLI never names a backend |
| `tests/session-golden.bats` | Freezes exact CLI output as the migration oracle |
| Broken-store fixture | The conformance suite's missing negative control |

## What does not ship

The the external memory service `MemoryIndex` adapter and projection epochs move to v0.4.0. They
are built against a live instance when one exists, not against a mock. The
adapter needs `memory-core`, `memory-hub` and `proxy` running plus two sets of
LLM credentials; standing that up is not a prerequisite for proving that the
`SessionStore` contract is portable, because such a service would implement `MemoryIndex`
and is not a second implementation of `SessionStore` at all.

`NullMemoryIndex` remains the default. Foreman stays fully functional offline
and without credentials.

## Architecture

Nothing in the port contract changes. v0.3.1 is adoption, not redesign.

```text
fm-session CLI  ─────────────►  SessionStore (port)
                                  ├── SqliteSessionStore      reference
                                  └── FilesOnlySessionStore    second impl
                                        both pass contract-suite.ts unchanged

fm-session sync ─────────────►  memory_outbox ──►  MemoryIndex (port)
                                                     └── NullMemoryIndex  default
```

The CLI depends only on the port. It never names a backend. Backend selection
is a single factory reading `FOREMAN_SESSION_BACKEND`, defaulting to SQLite.

`fm-session sync` is the only code permitted to read `memory_outbox`. The
outbox stays outside `SessionSnapshot`, because it is derived bookkeeping and
is rebuildable.

## Sequencing

Step 0 is the oracle and it is not optional.

| Step | Work | Gate to advance |
|---|---|---|
| 0 | `session-golden.bats` freezes exact stdout, stderr, exit code and sidecar bytes for every command on a fixed fixture | Golden captured on unmodified `fm-session`, and the suite fails when pointed at a deliberately altered command |
| 1 | `FilesOnlySessionStore` | Conformance suite green for both implementations, unchanged |
| 2 | Negative control: deliberately broken store fixture | Suite fails it for at least three independent reasons |
| 3 | Migrate `fm-session` command by command behind `FM_SESSION_CMD` | After each command: `session.bats` 29/29 and golden diff empty |
| 4 | `fm-session sync` and `remap` | Exactly-once under injected retry; remap rewrites `superseded_by` |
| 5 | Cutover: drop `// @ts-nocheck`, delete direct `node:sqlite` | All six predicates measured on one commit |

Step 0 before step 3 is the whole point. v0.3.0 measured a suite that asserted
exit codes and shapes passing a port whose floats had lost their decimals. The
fix was never a better implementer; it was an oracle that could see what
mattered.

Step 1 before step 3 matters too: the second implementation proves the contract
while the CLI still runs on the old code, so a contract defect surfaces before
the risky migration depends on it.

## Testing strategy

The conformance suite is the specification. It is backend-agnostic and factory
driven; a new implementation is trustworthy exactly to the degree it passes.

Three layers, each catching what the others cannot:

- **Golden output.** Exact bytes for every CLI command. Catches behaviour drift
  that shape assertions miss.
- **Conformance suite, run twice.** Once per implementation, unchanged. Catches
  contract violations and anything SQLite-specific that leaked into the port.
- **Fault injection.** Every command under null, throwing, hanging and poison
  `MemoryIndex`. The poison implementation returns references to ids that do not
  exist; it is the one that finds real bugs.

The negative control is a requirement, not a nicety. `graph-store` has
`stubFactory` for this reason. Without one, a green suite proves only that it
ran.

## Dogfooding

Each tool is used for the job it was built for, and each produces evidence that
lands in the release record.

| Tool | Role | Evidence produced |
|---|---|---|
| foreman | Vendor lanes implement each sequencing step | Lane provenance recorded per PR |
| Council | Built once, reviews each diff blinded with evidence bound to `base_sha`, `head_sha` and diff hash | Verdicts archived under `docs/reviews/v031/` |
| foreman-qa | `/foreman-qa-preflight` before any claim of done | Evidence block in every PR |
| SessionDB | The release records its own facts, measurements and obligations | The release's own session store |
| footguns | `AGENT_TRAPS.md` § 1 consulted before each lane dispatch | New traps appended as they fire |

Council is not a blocking gate. It was designed for blinded review of an
implement round, and a real diff now exists for it to bind to, which was not
true when it was last attempted. A broken Council blocks nothing; it yields no
verdict, and that absence is recorded rather than worked around. An honest
`quorum_not_met` is a real outcome, which is precisely why it must not gate a
merge.

## Risks

**We migrate the store while using it to track the migration.** This is the
strongest available test of the work and a genuine hazard. Mitigations: the
release's own session store is pinned via `FOREMAN_SESSION_DB` to a path outside
the repository, and step 0's golden corpus is captured before the first
migration commit. If the live store breaks, the release evidence survives
independently and the break is itself a finding.

**The golden corpus can encode a defect as correct.** It freezes current
behaviour, including any current bug. Mitigation: the corpus is captured on the
released `v0.3.0` commit and reviewed once before it becomes a gate; any
deliberate behaviour change requires an explicit corpus update in the same
commit that changes the behaviour.

**`session.bats` is the only existing oracle and it is weak.** It asserts exit
codes and shapes. This is the reason step 0 exists and the reason it precedes
all migration work.

## Open questions

None blocking.

## Provenance

The storage port contract is `docs/architecture/storage-port.md`, landed in
PR #42 and reviewed by an independent three-model panel archived under
`docs/reviews/2026-08-08-storage-port/`. The oracle-first sequencing is taken
from v0.3.0's release run, recorded in `docs/releases/v0.3.0-notes.md`: five
separate "it passed" reports were false, and every one was caught by a check
that could discriminate rather than by a more careful reading of the report.
