# Design — vendor-concurrency-and-quota

## The cap is 1 because the rule says so, not because the vendor looks risky

`lane-queue.sh` already encodes the governance: *"no cap raised without a
recorded green row; default-on-doubt is 1"*, and *"A future cap raise here MUST
cite a specific GREEN row"*. The design contribution here is small and mostly
about resisting a shortcut.

The shortcut is tempting because there is a plausible argument for a higher
starting cap — a Go binary, per-project conversation state, and Foreman's
worktree-per-lane model. The argument is plausible and it is not evidence. The
same argument would have been made for claude before the `.claude.json` finding.
Foreman's caps doctrine exists precisely because plausible arguments about
concurrency safety are wrong often enough to have cost this project real
incidents.

So: 1, with a citation to the absence of a row, and a harness that can produce
the row.

## The isolation dilemma has to be stated, not resolved by wishful topology

Two probes, both read-only, on 2026-07-28:

- `GEMINI_CLI_HOME=$T agy models` — `$T` remained empty; state still came from
  the real home. The isolation lever that works for the other Google CLI does
  nothing here.
- `HOME=$T agy models` — created `$T/.gemini/config/`,
  `$T/.gemini/antigravity-cli/` and `$T/.cache/ms-playwright-go/1.57.0`, and
  returned rc 1 `Error: Please sign in to view available models.`

So there is no topology that is simultaneously isolated and authenticated
without moving credential material into each lane home. `agy-lane-activation`
owns that decision. This package owns its consequence for concurrency, and the
consequence is asymmetric:

- **If credential seeding lands cleanly**, lanes are genuinely isolated and the
  concurrency question becomes the ordinary one: run the T5b matrix, record a
  row, raise the cap if green.
- **If it does not**, lanes share one home, and the shared home holds a SQLite
  database with live `-wal`/`-shm` files, a settings file, and an OAuth token —
  all user-root-scoped. That is the shape Foreman already ruled
  `REQUIRES-SEPARATE-HOME` for another vendor. In that case the cap stays 1
  permanently, not provisionally, and the harness's job is to document why
  rather than to hunt for a green row.

The harness therefore needs a monitor it does not have today: when isolation is
known to be incomplete, watch the shared mutable state directly. The existing
monitors watch config corruption, lock freeze, auth invalidation and
containment leakage — all correct, all scoped to the assumption that each lane
owns its own root. A shared SQLite database with WAL companions is a fifth
failure surface and it fails quietly.

## Quota is an entitlement question, and readiness answers the wrong one today

`env/tool-check.sh` answers "is this vendor authenticated". For a token-priced
vendor with one model tier that is sufficient. For a vendor whose plan
determines which models exist, it is not: a credential can be perfectly valid
and unable to serve the model the auditor is pinned to.

This matters because of a specific doctrine. Foreman states that auditors run
at the highest reasoning level. If the active plan silently restricts the
account to a smaller model class, that doctrine is not merely unmet — it is
unmet invisibly, and the resulting audit carries the same weight in the gate as
a full-strength one. R3 §6.1 documents exactly this shape for the Google
consumer CLI's free tier, which is restricted to the Flash model class.

Two honest notes about applying that to `agy`. First, its specific quota and
tier semantics are **unverified**; R3's numbers are for a different binary and
must not be copied across. Second, on this host the model list does include
`gemini-3.1-pro-high`, so this credential is not restricted to the small model
class — a fact about this host, on this date, not a property of the vendor. The
requirement is therefore written as "report the entitlement and refuse a
configuration the entitlement cannot serve", not as a claim about any tier.

## Exhaustion must be classified, and the dangerous case is the quiet one

There are three ways a quota-exhausted round can end: a clean nonzero exit, a
hang waiting for an interactive choice, or a silent downgrade to a smaller
model that completes and looks successful. The first is easy. The second is
caught by the round timeout. **The third is the one that corrupts the record**,
because it produces an audit verdict that the gate consumes at full weight from
a model the architect did not choose.

The defence is not clever: pin the model, record the model actually used, and
report a mismatch. It costs nothing and it converts an invisible failure into a
visible one. The classification requirement — exhaustion is `STATUS:
unavailable`, not a model failure — sits on top of that, and it routes through
the adapter's `rc_unavailable` contract so no call site needs vendor-specific
knowledge.

## Alternatives considered and rejected

**Start `agy` at 2 by analogy with codex.** Rejected. codex's 2 is backed by a
recorded GREEN row from a live authenticated run; analogy is not evidence, and
the repo's own rule forbids it in as many words.

**Raise the cap once a shim-level concurrency test passes.**
Rejected. `vendor-concurrency-test.sh`'s logic is shim-tested deliberately,
and the results document is explicit that real destructive runs are a manual,
contained protocol. A shim test proves the harness works, not that the vendor
is safe at N.

**Report quota as a number.** Rejected as the primary mechanism: quota
accounting differs per vendor (tokens, requests per day, requests per minute,
seat entitlements) and a number Foreman computes will drift from the vendor's
own. What Foreman can report reliably is the entitlement it observes — which
models the credential can actually reach — and that is what the auditor
doctrine actually depends on.

**Treat quota exhaustion as a round failure and let rework retry.** Rejected:
retrying into an exhausted quota burns the rework budget on a condition no
rework can fix, and it records model failures that never happened.

## Risks

- **The concurrency row may never be produced**, leaving the cap at 1
  indefinitely. That is an acceptable end state and the design says so; the
  unacceptable one is raising the cap without the row.
- **Per-lane homes have a real disk and setup cost** — each provisions its own
  browser runtime cache. If credential seeding lands, this becomes a
  provisioning-time cost worth measuring before raising the cap, because a cap
  of N multiplies it.
- **Entitlement reporting depends on what the CLI exposes.** Where a vendor
  exposes no plan information, Foreman can only report the models it can
  enumerate. The requirement is written to that limit rather than to an ideal.
- **A shared-home fallback quietly becomes permanent.** If credential seeding
  is deferred, the shared home at cap 1 will work well enough to stop being
  revisited. Mitigation: the fallback is a recorded state with a stated reason,
  not a default.
