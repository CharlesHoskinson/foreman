# Tasks: positive-control expansion

Target: v0.3.0. Do not add these tasks to the v0.2.9 release gate.

## T1: probe inventory

- [ ] Add RED recognizer fixtures for named tool and environment probes.
- [ ] Extend `tests/lib/check-inventory.sh` with `--kind probe`.
- [ ] Derive and architect-review the full-tree probe census.
- [ ] Add paired known-bad and known-good control records.
- [ ] Add deliberate registry rows and prove empty, missing, stale, and
  identical-classification failures.

## T2: verdict-predicate inventory

- [ ] Add RED recognizer fixtures for anchored and unanchored outcome parsers.
- [ ] Extend `tests/lib/check-inventory.sh` with
  `--kind verdict-predicate`.
- [ ] Derive and architect-review the full-tree verdict-predicate census.
- [ ] Add paired controls for each release- or merge-deciding predicate.
- [ ] Prove an unknown outcome token is ERROR and never PASS.

## T3: integration

- [ ] Run both new inventories at each v0.3 landing-stage head.
- [ ] Publish machine-readable coverage and uncomputable states.
- [ ] Run the full local gate and strict OpenSpec validation.
- [ ] Review a committed immutable bundle through advisory Council.

## Withdrawn: exhaustive assertion inventory

- [x] Record that exhaustive `kind: assertion` registration is withdrawn.
  Individual assertion controls remain owned by their feature packages.
