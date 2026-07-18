# Spec delta — T5b destructive concurrency verdict

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirement: the destructive matrix runs under strict containment

WHEN running the concurrency matrix for a vendor, the implementer SHALL use
throwaway git repos, per-instance isolated config directories
(`CODEX_HOME`/`GROK_HOME`/`CLAUDE_CONFIG_DIR`+separate `$HOME`), and
lowest-tier auth, and SHALL NOT reuse production auth across simultaneous
lanes.

- The matrix SHALL cover N=2 and N=3 concurrent same-vendor instances per
  tested vendor (grok, codex).
- WHILE the matrix runs, the implementer SHALL monitor for: config-file
  corruption, lock-acquisition freeze (>2 min), cross-lane auth
  invalidation, and 429 behavior versus the shared-quota model.
- IF any process requires `kill -9`, OR any write lands outside the throwaway
  config dir, OR a sibling lane's auth is invalidated, OR a 429 cascade
  exceeds shared-quota math, THEN the implementer SHALL abort that vendor's
  run, record the trigger, and leave the cap at 1.

## ADDED Requirement: a green verdict requires all assertions to hold at N

WHERE a vendor's N=2 and N=3 runs both complete with config JSON valid after
parallel launch/exit, no lock freeze, no cross-lane auth invalidation, and
429 behavior consistent with shared quota, the implementer SHALL record a
GREEN verdict at that N and MAY raise that vendor's pueue group cap to the
proven N.

- IF any assertion fails at an N, THEN the verdict for that N SHALL be RED
  and the cap SHALL remain at the last green value (default 1).
- The implementer SHALL NOT raise a cap above a proven-green N.

## ADDED Requirement: Claude Code is ruled from the public evidence base

The implementer SHALL record Claude Code's verdict as REQUIRES-SEPARATE-HOME
without a local destructive run, citing the public corruption issues
(`.claude.json` write races; `CLAUDE_CONFIG_DIR` not covering top-level
session state), and SHALL document that a safe Claude Code lane needs a
distinct `$HOME` per instance, not only `CLAUDE_CONFIG_DIR`.

## ADDED Requirement: results are recorded and gate cap changes

The implementer SHALL populate `docs/research/vendor-concurrency-results.md`
with, per vendor: the verdict at N=2 and N=3, the observed signals, the abort
log (if any), and the resulting cap decision.

- WHEN a cap default in `lane-queue.sh`/config is changed, the change SHALL
  cite the corresponding green verdict row.

#### Scenario: codex greens at N=2 but not N=3

- WHEN codex N=2 passes all assertions and N=3 trips the port-collision
  restart loop
- THEN the results doc records GREEN@2 / RED@3
- AND the codex cap is set to 2, not 3, with the row cited.

## ADDED Requirement: grok promotion is gated on a green grok verdict

WHERE grok records a GREEN verdict at N>=1 with no isolation failures, the
implementer SHALL flip the default-implementer doctrine in `CLAUDE.md`/
`SKILL.md` to name grok, in a single reviewable edit citing the verdict.

- IF grok's run is RED or aborted, THEN grok SHALL remain an optional lane
  and the doctrine SHALL stay unchanged.
