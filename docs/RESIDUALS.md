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

### `mkdir` stays permanently distrusted on Ubuntu 26.04

Not a new finding — see `docs/research/vnext/F-uutils-mkdir-blocker.md`, which
established in July that Ubuntu 26.04 resolves `mkdir` to uutils 0.8.0, that it
performs a userspace `statx` check-then-act instead of issuing `mkdir(2)`, and
that GNU `mkdir` does not. A fresh eight-racer sample on this host reproduces it
at **20 violations in 40 rounds**, against **0 of 40** for GNU `gnumkdir`.

What is worth recording as a residual is the standing consequence: `mkdir` can
never earn a trusted verdict on this platform, so every durable lock rests on
`flock` alone, and `lib/lock.sh` fail-closes if `flock` is unavailable or
unlicensed. Pinning GNU `mkdir` when `gnu-coreutils` is present would restore a
second mechanism; nobody has decided whether that is worth it, and it matters
only for a host with no usable `flock`.

### `strace` is a hard dependency of the lock, and reads like a debugging tool

The syscall evidence class is the **only** one that can license a mechanism as
`atomic`: flavour licenses nothing, and contention can license only `non-atomic`
or `unknown`. So on any host whose `mkdir` is uutils, no `strace` means no
trusted mechanism, and `lib/lock.sh` fail-closes with `FM_LOCK_UNAVAILABLE`.
That is not a theoretical cost — it failed **102 tests across 11 files** on a
freshly provisioned Ubuntu 26.04 host, and every one of them was the lock
refusing rather than the code under test being wrong. `strace` is now installed
by `env/bootstrap-wsl.sh` and reported by `env/tool-check.sh` on every POSIX
profile, so its absence is visible up front instead of arriving later as
unexplained refusals. It remains a `should` rather than a `must`: a host can run
without it, but only by fail-closing every durable lock.

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
commit hook. No comparison has been run. Any Tier 2 number quoted anywhere would
therefore be fabricated; there are none.

**Correction — the machinery is not in this tree.** This entry previously said
"the machinery exists and is tested against recorded fixtures." It exists on
`origin/lane/tier2-machinery`, an unverified branch that was never audited and
deliberately not merged; `git ls-tree -r main | grep tier2` returns only two
evidence text files. Either that branch is verified and landed, or this release
ships without the machinery at all — and until one of those happens, "built" is
not true of what you can check out.

Four things must exist before Tier 2 could be fired even with spend authorised,
and none does: a live vendor adapter, a locked spec set, a chosen model pin, and
**a definition of what the per-spec score in [0,1] actually measures.** The last
is a specification gap, not an implementation gap, which is why this was never
really a spend decision. Note also that the declared USD 18 budget is a ceiling
asserted before any measurement — Foreman cannot currently measure vendor cost
at all, because every vendor reports `source: "unavailable"`.

### The mkdir atomicity alternation was never reproduced locally

The probe was observed returning `atomic` then `unknown` for the same binary on
the same host seconds apart, in CI. Two causes were found and fixed: strace
output was captured on the same channel as the traced process's stderr under
`-f`, and a tracer that failed to *attach* was indistinguishable from a trace
that ran and said nothing. The second is confirmed. **The alternation itself was
never reproduced on the development host**, because local ptrace policy rejects
`strace` outright, giving `unknown` 100 of 100 both before and after. Whether the
flapping is fully closed is a question only CI answers.

A *second* and independent source of verdict alternation has since been measured
and must not be mistaken for this one: because the contention sample is drawn
once per run and violates roughly half the time on uutils `mkdir`, the verdict
alternates between `unknown` (clean sample) and `non-atomic` (violations seen) on
the same binary and host — see the `mkdir` entry above. That is a different pair
from the `atomic` ↔ `unknown` flapping described here, which turns on whether
`strace` attached, and it leaves this residual open.

One premise of this entry did not survive contact with a second host. "Local
ptrace policy rejects `strace` outright" was not true here: `strace` was simply
**not installed**, and `ptrace_scope` is `1`, which permits tracing one's own
descendants — precisely what the probe does. Once installed it traced without
complaint and licensed `flock` as `atomic`. Whether the original host genuinely
denied `ptrace` or merely lacked the binary was never distinguished, and the two
look identical through `command -v strace`.

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
