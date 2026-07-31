# REPORT — work-dag-projection, round 1

## 1. graph-project.sh
DONE

`skills/foreman/scripts/graph-project.sh` — pure reader of `events.jsonl`.

- CLI: `--run RUN [--events PATH] [--out PATH] [--check]`
- Fail-loud on malformed or truncated lines (names the line; emits no partial DAG)
- Ignores unknown event types (additivity)
- Projects attempt / verdict / gate_decision / finding nodes and
  `produced` / `evaluated_by` / `gated_by` / `descends_from` / `supersedes` edges
- Writes via temp + atomic rename when `--out` is set; `--check` re-projects and `cmp`s
- Takes no event-log lock; does not write the log or invoke graphify
- `telemetry.sh` was referenced by the BRIEF but is **not present** in this
  worktree (`skills/foreman/scripts/lib/` has no such file). Projector depends
  only on the frozen top-level event shape and payload keys already documented
  for decision-lineage (`audit_verdict`, `finding`, `gate_decision`, `usage`)

## 2. Determinism proof
DONE

Observed in `tests/graph-project-harness.sh` case 4 and `tests/graph-project.bats`:

- Two successive projections of the same log are byte-identical (`cmp -s`)
- Projection from a copied path (stand-in for cross-machine / cross-checkout)
  is byte-identical
- `--check` detects a hand-edit (observed FAIL on tampered file) and accepts a
  clean re-project
- No projector-generated timestamps; `LC_ALL=C` total order on
  `(kind, type|relation, id)`

Harness result: `PASS determinism — byte-identical across runs and paths`

## 3. Additivity (unknown event types)
DONE

Injected `type: "future_widget_v99"` into a known-good log.

- Projection still exits 0
- Known nodes and edges are byte-identical to the pre-injection projection
  (coverage `max_seq` / `event_count` may advance — that is the log-wide
  watermark, not a known node)

Control observed FAIL first: a projection with an attempt node dropped fails
the equality check (proves the checker is not vacuous).

Harness result: `PASS additivity — unknown type kept; known nodes byte-identical`

## 4. Node and edge identity from event content
DONE

Identifier scheme (JK-1..5, content-derived):

| Entity | Id |
|---|---|
| attempt | `foreman:run/<RUN>/lane/<LANE>/attempt/<N>` |
| verdict | `foreman:verdict/<RUN>/lane/<LANE>/attempt/<N>` |
| gate | `foreman:gate/<RUN>/lane/<LANE>/attempt/<N>` |
| finding | `foreman:finding/<payload.id>` or `foreman:finding/<sha256(file‖line‖summary)>` |
| edge | `foreman:edge/<relation>/<src>-><tgt>/seq/<seq>` |

- Reordering event lines (same content) → byte-identical projection
- Mutating `payload.attempt` in content → ids change (control observed FAIL)
- `supersedes` edges ordered by attempt number, not file order
- Vendor/model on attempts: first non-null from worker-side events only
  (audit does not overwrite)

Harness result: `PASS content-ids — reordered events → byte-identical projection`

## 5. Verification harness (observed FAIL before PASS)
DONE

`tests/graph-project-harness.sh` — every case runs a known-bad/control FAIL
before the PASS path. Accumulator exits non-zero if any case fails.

| Case | Observed FAIL (control) | PASS |
|---|---|---|
| malformed line | exits 1, names line 10 | clean log projects |
| truncated log | exits 1, names line 10 | clean log projects |
| additivity | dropped-node control differs | unknown type keeps known nodes |
| determinism | hand-edit fails `cmp` | two runs identical |
| content-ids | attempt mutation changes ids | reorder identical |
| harness-nonzero | forced FAIL → rc 1 | meta ok |
| --check | hand-edit fails check | clean check ok |

Final harness run: **passed=7 failed=0**, `HARNESS PASSED`, exit 0.

`tests/graph-project.bats` (via `flock /tmp/foreman-bats.lock`): **10/10 ok**.

`shellcheck -x graph-project.sh` (from `skills/foreman/scripts/`): clean.

## 6. Deferred items
DONE

Per BRIEF scope ("Implement the projection itself and its determinism proof.
Defer store integration and query ergonomics"):

| Deferred | Owner / reason |
|---|---|
| Checkpoint → graphify symbol bridge (`git diff-tree`, symbol refinement, unrepresented paths) | needs `knowledge-plane-refresh` + live `refresh-meta.json` renames map |
| Rename-with-lineage records | consumes refresh rename map; not in round-1 log-only scope |
| `graphify_version` stamp on records | needs `graphify-out/refresh-meta.json` |
| Store integration / TerminusDB materialisation | `graph-store-port` |
| Query ergonomics / context builder | `graph-context-builder` |
| `maintenance.sh` wiring + docs gate `--check` | T7 of full package; not BRIEF r1 |
| Emission of `audit_verdict` / `finding` / `gate_decision` / `usage` | `decision-lineage-and-telemetry` (events are projected when present; emitters may still land separately) |
| `lib/telemetry.sh` | BRIEF asked to read it; file absent in this worktree |
| Per-round hyperedge over spec/implementer/gate/auditor/merge | needs cross-lane task ids not yet in the log |
| Graphify invocation of any kind | hard prohibition for this plane |

No `git commit`. No graphify run.
