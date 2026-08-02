# Change: positive-control-expansion

## Why

v0.2.9 limits release criterion 4 to named checks of `kind: gate`. The current
`test-infrastructure-hardening` package also describes exhaustive controls for
probes, assertions, and verdict predicates. That broader inventory is too large
for the release and conflicts with the recorded scope decision.

Probe and verdict-predicate controls still have value. They must remain visible
without silently restoring them to v0.2.9. Exhaustive assertion registration is
not proportional: the current estimate is approximately 710 rows, while each
assertion remains test-first under its owning package.

## What Changes

- Preserve full-tree inventory and fail-capable controls for `kind: probe` and
  `kind: verdict-predicate` as v0.3 work.
- Extend the v0.2.9 gate scanner instead of replacing it.
- Keep the same `check_id` and six-column registry contracts.
- Do not make Council, Graphify, or a model the inventory authority.
- Withdraw exhaustive `kind: assertion` registration. Keep individual
  assertion controls with their owning features.

## Impact

- Target release: v0.3.0.
- Affected spec: `positive-control-expansion` (new).
- Affected future code: `tests/lib/check-inventory.sh`,
  `tests/positive-control-registry.tsv`, and bounded control fixtures.
- No v0.2.9 runtime or release-gate change.
