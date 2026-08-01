# Tasks — lane-ownership-and-reaping

Ordering: T1 gates everything. T2/T3 may run in parallel. T5 is the gate.

## T1 — ownership primitives

- [x] `tools/lanectl.sh` with `launch` / `adopt` / `ps` / `reap` / `sweep`.
- [x] Ownership recorded redundantly: `FM_LANE_OWNER` and `FM_LANE_LABEL` in
      the environment (inherited by children) **and** a per-owner PID registry
      under `$FM_LANE_DIR`, so it survives `exec` and argv rewriting.
- [x] `adopt` claims the whole descendant subtree, not the named pid alone.
- [x] `ps` lists the caller's lanes by default and foreign ones only under
      `--all`, always labelled with their owner.
- [x] `reap` acts on the calling owner's lanes ONLY. A foreign or unattributable
      process is listed and never signalled.
- [x] Kill by recorded pid. `pkill -f` is forbidden — it has previously matched
      its own command line and killed the shell issuing it.

## T2 — state-based liveness

- [x] `tools/reap-stale-lanes.sh` judges on `STAT` and CPU-since-start.
- [x] `STAT` beginning `T` -> `SUSPENDED`. Zero CPU after grace -> `WEDGED`.
- [x] Candidates restricted to processes with a `timeout` ancestor, so
      interactive sessions are structurally excluded rather than excluded by
      heuristic.
- [x] Record inline, where the predicate lives, that a CPU-delta hang check was
      tried and removed after false-positiving on every run — once against a
      live interactive session, once against a lane blocked on a model
      response — so it is not reintroduced without a predicate that separates
      network-blocked from wedged.
- [x] Replace every `pgrep`-existence liveness check in `watch.sh` and
      `lane-supervise.sh`.

## T3 — stall taxonomy

- [x] Distinguish `SUSPENDED`, `NEVER_LAUNCHED`, `NO_OUTPUT`, `WEDGED`, each
      named by the evidence that produced it.
- [x] `NEVER_LAUNCHED`: no vendor process after grace. Report the vendor process
      searched for and not found.
- [x] `NO_OUTPUT`: deliverable set unchanged by content hash — not by
      `git status --porcelain`, which collapses an untracked directory to one
      line and is blind to content edits inside it.
- [x] Every stall report names its evidence; "not responding" alone is not a
      permitted state.

## T4 — dispatch hygiene

- [ ] `lane-run.sh` tags every lane at dispatch and redirects stdin from
      `/dev/null` for headless vendor rounds.
- [ ] Settle vendor currency BEFORE dispatch, never during — a vendor CLI can
      self-update mid-round and suspend itself. Coordinate with
      `vendor-preflight`, which owns the currency check.

## T5 — tests and gate, red-first

- [ ] `tests/lane-ownership.bats`.
- [x] Prove `SUSPENDED` reachable: `SIGSTOP` a stub lane, assert the supervisor
      reports SUSPENDED and does NOT report it alive.
- [x] Prove the pgrep regression: assert an existence-only predicate would have
      called the same stopped process alive. This is the defect under test.
- [x] Prove `NEVER_LAUNCHED` reachable with a lane whose vendor never starts.
- [x] Prove foreign safety: a process owned by another owner is listed and NOT
      signalled by reap, asserted by the process still being alive afterwards.
- [x] Prove subtree adoption: adopt a wrapper+child pair by the wrapper pid and
      assert both are attributed.
- [x] Prove the healthy-lane negative: a lane blocked awaiting a model response,
      and an idle interactive session, are both left alone.
- [ ] Every one of these SHALL be observed failing against a deliberately wrong
      implementation before it is trusted.
- [ ] `shellcheck` clean on both tools and every modified caller.
- [ ] `bugeventlog.md` entries merged from
      `docs/incidents/2026-07-29-lane-strandings.md`.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [x] `openspec validate lane-ownership-and-reaping --strict`.
