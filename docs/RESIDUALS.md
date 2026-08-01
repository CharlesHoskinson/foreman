# Residuals — what v0.2.9.0 does not do

Tag criterion 11 requires these to be stated, not resolved. Each entry says what
is unsolved, what is nevertheless true, and how you would know if it started to
matter. Nothing here is a promise; several are permanent.

## Carried from earlier releases

### D5 — Git-Bash syscall trace still owed

The lock-atomicity probe licenses `atomic` only from an observed
`mkdir(2) … EEXIST` on the probe target. On Git Bash under Windows that trace has
never been captured, so the Windows verdict rests on flavour and contention,
which by doctrine can only license `non-atomic` or `unknown` — never `atomic`.
Windows therefore reports `unknown` and the system falls back accordingly. This
is conservative and correct; it is not knowledge.

### `agy` per-lane isolation unsolved

`agy` is a gateway CLI whose model may come from several vendor lineages, and it
has no per-lane isolated home. Two `agy` lanes share credentials and state. The
model-family classification added in `cross-vendor-audit-routing` handles the
lineage question — the family is the family of the model actually selected, never
one associated with the CLI — but isolation itself is unsolved. Do not run two
`agy` lanes concurrently and expect independence.

### Audit latency bounded, not solved

Audit rounds are bounded by a wall-clock timeout, which converts an unbounded
wait into a failed round. That is a bound, not a latency guarantee. A slow
auditor still costs the round.

### Formal results bounded and sampled

Apalache runs are bounded (8–12 steps) and trace exploration is sampled (20k
traces). A property that holds within those bounds may fail outside them. The
suite reports `VIOLATED` / `HOLDS` against the bound, and the bound is part of
the result, not a footnote to it.

## Added by the v0.2.9.0 work

### The groundedness gate may not leave shadow

`audit-groundedness-gate` ships with all nine registered checks in `shadow`, and
this is enforced in the resolution path rather than by configuration: no
promotion-record implementation exists, so `gg_effective_mode` forces `shadow`
regardless of what any config says. Three things must close before any check
enforces:

- the canary is not bound to a gate entrypoint, so "evaluates the corpus on every
  invocation" is not mechanised — that checkbox was withdrawn twice rather than
  claimed;
- a validly-loaded registry with **zero rows** yields a vacuous `CANARY_OK`
  meaning "no checks ran", not "no violations found";
- `G1` declares `repository_head` among its required inputs while its predicate
  tests `changed_paths` only, contradicting its own zero-false-positive rationale.

The checks are real and their mutation proof disables a real predicate. The
gate's *promotion* is what is unfinished.

### Tier 2 is built but has never been executed

Tier 2 is seeded-defect statistical comparison against a pinned vendor model:
8–12 specs at N=3 runs per condition. That is real vendor spend, and the package
requires Tier 2 to have **no automatic trigger at all** — no CI workflow, no
commit hook. The machinery exists and is tested against recorded fixtures. No
comparison has been run. Any Tier 2 number quoted anywhere would therefore be
fabricated; there are none.

### The mkdir atomicity alternation was never reproduced locally

The probe was observed returning `atomic` then `unknown` for the same binary on
the same host seconds apart, in CI. Two causes were found and fixed: strace
output was captured on the same channel as the traced process's stderr under
`-f`, and a tracer that failed to *attach* was indistinguishable from a trace
that ran and said nothing. The second is confirmed. **The alternation itself was
never reproduced on the development host**, because local ptrace policy rejects
`strace` outright, giving `unknown` 100 of 100 both before and after. Whether the
flapping is fully closed is a question only CI answers.

### bats has never passed on the Windows runner

`bats` is now provisioned on `gates-windows`, but `FOREMAN_CI_BATS` remains `0`
and the suite runs only under a non-gating probe. Provisioning and passing are
different claims. Nobody yet knows what the suite does on Windows; the probe
exists to find out, and until it reports, "the suite passes on Windows" is
unsupported.

### Measurement freshness is not discharged

The session store carries stale measurements whose recorded re-run commands were
not readable from the report a human would consult. Criterion 6 requires every
measurement fresh at the tag commit and no number in the release notes without
its re-run command. Until that sweep is done, treat any number in this repository
as carrying the commit it was measured at, which the store records, and check it
rather than quoting it.

## How to read this document

Every entry above was found by something failing, or by an audit refusing to
certify a claim. That is the intended mechanism. A release with no residuals
document is not a release without residuals — it is one that has not looked.
