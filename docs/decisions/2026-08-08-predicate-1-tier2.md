# Predicate 1 and the Tier 2 pair — council ruling and architect dissent

Date: 2026-08-08. Decided during an unattended run, owner asleep.

## The question

v0.3.0 exit predicate 1 requires `git ls-files '*.py'` to return exactly the
six vendored plus one archived file. Two of Foreman's own remain and could not
be removed: `tests/tier2_collect.py` and `tests/tier2_compare.py`.

Amend predicate 1 to defer them to v0.4.0, or hold it as written?

## Why they remain

Two porting attempts were rejected on measured evidence. The first passed all
27 tests in `tests/tier2-compare.bats` and was still not equivalent: whole
-valued floats lost their decimals in machine-readable records, and one
bootstrap confidence interval came out `0.0837` against Python's `0.0999` on
identical input, because MT19937 had been replaced with mulberry32. The second
tried to preserve float-ness with a sentinel and shipped
`"__FLOAT__[object Object]__FLOAT__"` into output. Both reported byte-identical
results; neither was. Backed out; recorded as `brokenwindows.md` BW-014.

## The ruling

Three independent advisors, majority rules, as pre-authorised by the owner.

| Lens | Ruling |
|---|---|
| Release integrity | AMEND, with the release notes reworded RESIDUALS-style and a value-level oracle mandated for v0.4.0 |
| Port feasibility | **HOLD** — MT19937 is a specified deterministic algorithm and the float/int distinction is routine; the port failed on implementer quality, not difficulty, at an estimated one to two days for a competent implementer |
| Owner intent | AMEND, "loudly" — evidence governs where "wake me to everything fixed" and "no green claim without evidence" pull apart |

**Majority: AMEND (2–1).**

Both AMEND rulings carried contingencies, and both were checked against the
tree rather than left open:

- "flips to HOLD if design 1.1 classifies these as runtime/product-critical" —
  1.1 lists both under "The seven that must go", disposition "Port — live", so
  they are named as release scope. They are **not** product runtime: not
  shipped under `skills/foreman/`, not referenced by any workflow, not in
  `tools/ci-local.sh`. `tier2-collect.sh` describes itself as an explicit
  manual collector that is never invoked automatically.
- "flips to HOLD if 1.1 was written after the second backout" — it was not.
  1.1 is from commit `fe40732`, dated 2026-08-07; the backouts happened
  2026-08-08.

Neither contingency triggers. The majority stands on its own terms.

## The architect declined to act on it

Recorded because a ruling that is not acted on must say so, and say why.

1. **All three advisors were blind to the primary sources.** Each disclosed it
   could not read the design document, `docs/RESIDUALS.md`, or the code — the
   WSL filesystem is unreachable from their sandbox. They ruled on a summary
   written by the party who benefits from one of the outcomes.
2. **That party is the architect.** Amending predicate 1 is the only route by
   which an unattended run produces a tagged release. This was stated to the
   council in the brief, and it does not stop being true because they were
   told.
3. **The dissent is the technically grounded one.** The HOLD lens is the only
   one that reasoned about what the code actually computes, and its finding —
   that this port is tractable and failed on implementer quality — is
   consistent with everything measured tonight.
4. **Amending a criterion is a different act from fixing a defect.** Fixing is
   delegable. Changing what a release *claims* belongs to the person whose name
   is on the claim.

So predicate 1 stands as written, v0.3.0 does not ship tonight, and the owner
decides in the morning with this record in front of him.

## What was done instead

The defect underneath both failed ports was the oracle: 27 tests that assert no
statistical value cannot gate a statistical port. Python's exact output for
`compare`, `rate` and `budget` is now frozen under
`tests/fixtures/tier2/golden/`, with `tests/tier2-golden.bats` diffing the live
implementation byte for byte, demonstrated to catch the precise BW-014 drift
before landing.

Whichever way the owner rules, the next attempt is mechanical rather than
hopeful.
