# Tasks -- terminusdb-operations

Ordering note: T1-T3 (deployment, data placement, backup) are prerequisites for
everything else and should land together. T4 (migration) and T5 (query layer) depend
on the frozen schema (`graph-store-port` T2 / Council 1). T6-T8 (monitoring,
drop-and-rebuild, exit path) depend on T1-T3. T9 is the gate.

Precondition: `graph-store-port`'s port, schema, adapter, and ingest have landed.

## T1 -- Docker deployment

- [ ] Write the compose/run definition pinning server version and image digest.
- [ ] Deployment script verifies running digest against pinned digest; refuses to
      start on mismatch, naming both digests.
- [ ] Credentials sourced from environment/secret store, never hardcoded.
- [ ] `TERMINUSDB_SERVER_WORKERS` raised above 8 when more than 8 lanes configured.
- [ ] Version/digest bump requires a completed backup before the new image starts.

## T2 -- data directory placement

- [ ] Bind-mount host path resolves off `/mnt/*`; deployment script refuses and names
      the offending path otherwise.
- [ ] Data directory stays on the same side of the WSL/Windows boundary as the
      writing process, matching the `durable-lanes.md` `store_dir` note.
- [ ] Prove restart-preserves-data on the correct filesystem.

## T3 -- backup and restore, rehearsed

- [ ] Stop-and-tar backup script; runs before every version change and on a weekly
      cadence.
- [ ] Restore drill: restore into a fresh container, run the query-layer regression
      suite, confirm identical results to pre-archive.
- [ ] Drill runs at least once before go-live and at least quarterly thereafter.
- [ ] A failed drill is recorded and the backup procedure marked broken until
      re-drilled and passing.

## T4 -- schema migration runbook

- [ ] Dry-run-then-backup-then-apply sequence implemented and documented.
- [ ] Weakening vs. strengthening classification; strengthening changes refused
      without an explicit default/transform.
- [ ] Inheritance restructuring routed to drop-and-rebuild, never the migration API
      (`ChangeParents` unimplemented upstream).
- [ ] Failed or inconsistent live migration triggers restore from the pre-migration
      backup, not in-place partial recovery.
- [ ] Every applied migration recorded: operation list, dry-run report, backup
      reference, post-migration regression-suite result.

## T5 -- the named query layer (24 competency questions)

- [ ] Implement Q-W1 through Q-W13 (work-DAG plane), each wrapped in the
      non-emptiness contract.
- [ ] Implement Q-K14 through Q-K20 (knowledge plane), each wrapped in the
      non-emptiness contract.
- [ ] Implement Q-X21 through Q-X24 (cross-plane), each wrapped in the non-emptiness
      contract; Q-X21 is the mandatory third canary alongside `graph-store-port`'s
      two silent-empty canaries.
- [ ] Every `Path`-based query wrapped in the deduplication operator.
- [ ] Every negation query implemented via the verified negation construct, not the
      auto-generated filter surface.
- [ ] Publish the manifest: CQ number, query ID, plane, formalism tag, emptiness
      contract.
- [ ] Record W4 as a partial implementation (no shortest-path operator upstream);
      record K16 and X22 as schema-frozen/deferred gaps matching the schema
      package's own dispositions (not "mapped, not gaps"); record W6, W13, and
      X23 as mapped-but-dependent on same-release sibling-package elements.
- [ ] Regression suite fixture with hand-computed answers for all 24; wired into CI
      on every schema or query-layer change.
- [ ] Missing schema element referenced by a named query fails the suite loudly,
      naming the element.

## T6 -- monitoring without Prometheus

- [ ] Hourly poll script: `/api/info` liveness/version, container RSS, data-directory
      size, document count.
- [ ] No `/api/log` call anywhere in the monitoring path.
- [ ] Alert when RSS or disk size exceeds 3x the R8 baseline for current document
      count.
- [ ] Unreachable `/api/info` within timeout triggers the files-only degradation
      reporting path.
- [ ] Monitoring script exercised on the same cadence as the drop-and-rebuild job.

## T7 -- timed drop-and-rebuild

- [ ] Monthly scheduled job: drop, rebuild from `events.jsonl` + `graph.json` +
      `worklog.jsonl` + run JSON records, run the regression suite, record
      duration and document count.
- [ ] Duration budget derived from R8's ~1,070 docs/s measured rate; re-derived as
      corpus grows.
- [ ] Budget overrun or regression-suite divergence fails loudly and is recorded in
      the release checklist.
- [ ] Job runs against the live operational data directory, not only a synthetic
      fixture.

## T8 -- exit path and named tripwires

- [ ] Quarterly tripwire check implementing all four named conditions: fewer than 50
      commits/rolling-6-months; single author above 90% across two consecutive
      checks; any in-use capability moving to Enterprise; any license change off
      Apache-2.0.
- [ ] Check re-fetches live upstream data each run; reports inconclusive (not green)
      if it cannot reach the upstream commit history.
- [ ] Any tripwire firing records the trigger, evidence, and fallback action in the
      release checklist.
- [ ] Exit-path rehearsal: full round on files-only with the adapter stopped, run at
      least once before go-live.
- [ ] Re-rehearsal within one release of any tripwire firing.

## T9 -- gate

- [ ] All 24 named queries pass the regression suite against a known fixture
      (K16 and X22 pass as recorded-gap assertions -- i.e. the suite asserts they
      are correctly flagged as gaps, not that they return non-trivial results).
- [ ] Both `graph-store-port` silent-empty canaries plus this package's Q-X21 canary
      fail closed when assertions are disabled -- verified by running it.
- [ ] Deployment script refuses on digest mismatch and on a `/mnt/*` data directory
      -- verified by running it, not by reading the code.
- [ ] Restore drill passes at least once.
- [ ] Drop-and-rebuild job passes at least once against a live data directory, timed.
- [ ] Tripwire check runs at least once and produces a dated record, even if no
      tripwire fires.
- [ ] Exit-path rehearsal passes at least once.
- [ ] `shellcheck` clean on every new script; docs gate green (`markdownlint-cli2`,
      `codespell`, `lychee`).
- [ ] `openspec validate terminusdb-operations --strict` passes.
- [ ] `bugeventlog.md` appended with any workflow failure or friction event
      encountered while implementing this package.
