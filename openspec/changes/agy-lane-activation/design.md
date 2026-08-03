# Design — agy-lane-activation

## What a fourth vendor has to earn, and how we would know

R6 §6.1 is the strongest disconfirming evidence in the vNext research and it
points directly at this package. "Nine Judges, Two Effective Votes"
(arXiv 2605.29800) finds a panel of nine frontier models across seven families
behaves as roughly **two genuinely independent votes**, with individual top
models matching or exceeding the full panel; the behavioural-entanglement work
(arXiv 2604.07650) finds synchronized failures across eighteen models and six
families, explicitly naming "ensemble verification pipelines" as the thing that
breaks. R6's own conclusion is blunt: *"Foreman is about to have 4 vendors; the
independence argument justifies roughly 2."*

The product owner has decided to add this lane. That decision is not what this
design argues with. What this design refuses to do is let the lane be justified
by an argument the evidence does not support.

Three things follow.

**First, the independence claim is retired as the stated reason.** Foreman's
real decorrelation mechanism is not vendor diversity; it is the cold-diff
audit — a different evidence set and a different role, which is precisely what
R6 identifies as the property that actually buys independence and which the
judge-panel studies did not have. That mechanism is already in place with two
vendors. A third and fourth vendor add capability, cost options and
availability, and on this evidence they add close to nothing in independence.

**Second, the lane must be measured, not assumed.** R6 §6.1's actionable
consequence is specific: measure **unique-catch rate per vendor pair** before
justifying the expansion on quality grounds, and if the new vendor's
unique-catch rate over the existing pair is below roughly 5%, document it as a
cost/capability/availability lane rather than a quality lane. This package
therefore ships a measurement obligation, not a quality claim, and the spec
says so in the requirement that the lane's justification is recorded.

**Third, the risk is that this lane makes independence *worse*, not merely
fails to improve it.** `agy` is a **gateway, not a Gemini-only CLI**. Its live
model list on this host is:

```
gemini-3.6-flash-{high,medium,low}   gemini-3.5-flash-{high,medium,low}
gemini-3.1-pro-{high,low}            claude-sonnet-4-6
claude-opus-4-6-thinking             gpt-oss-120b-medium
```

A lane whose CLI is `agy` can therefore be served by an Anthropic or an OpenAI
model. A naive cross-vendor check that compares CLI names would pass a
"claude implements, agy audits" pairing whose model families are identical. On
R6's evidence — where the whole problem is that different families already
collapse to about two effective votes — routing that collapses two lanes into
one family is not a cosmetic defect. It is the failure mode the fourth vendor
was supposed to avoid. The invariant is therefore written against **model
family**. The current audit router owns this invariant. This package makes the
family of every agy round observable so that invariant has something to check.

## Why `$HOME` isolation, when `$HOME` isolation breaks auth

The isolation options were probed rather than assumed.

- `GEMINI_CLI_HOME=$T agy models` — `$T` stayed empty, the real home was still
  used. **No effect.** R3's isolation lever for `@google/gemini-cli` does not
  transfer.
- `HOME=$T agy models` — created `$T/.gemini/config/`,
  `$T/.gemini/antigravity-cli/` and a Playwright browser cache; returned rc 1
  with `Error: Please sign in to view available models.` **State moves, the
  credential does not.**

That leaves three candidate designs.

**Share one home across lanes.** Rejected as the default. The shared home holds
`conversation_summaries.db` with live `-wal`/`-shm` files — a SQLite database
written concurrently by every lane — plus `settings.json`, the OAuth token, and
a `~/.gemini` root shared with a second, unrelated CLI. This is structurally
the `.claude.json` corruption class Foreman already ruled
`REQUIRES-SEPARATE-HOME`, and Foreman does not get to rule it differently for a
different vendor because it is inconvenient.

**Per-lane `$HOME` with the credential seeded in.** Chosen. It is the only
option that gets both isolation and auth, and it is the shape `wt-new.sh`
already provisions for every other vendor. The cost is honest and must be
stated: the seeding step copies credential material into a per-lane directory,
which is a security-relevant operation that Setup owns, that must never be
performed by a worker, and that must be cleaned up with the worktree. A lane
whose home has no credential must be refused at Setup rather than started and
allowed to fail mid-round — a lane that dies with "please sign in" after
consuming a worktree and a queue slot is the half-wiring failure this release
is trying to eliminate.

**Wait for a per-process credential env var.** Rejected as a plan, retained as
a hope. `@google/gemini-cli` has `GEMINI_API_KEY`; agy's binary exposes no
equivalent that the probe found. If one appears, it is strictly better than
seeding, and the adapter's `adapter_home_var` indirection means adopting it is
a one-file change.

## Trust, and the thing most likely to kill this lane on day one

`~/.gemini/antigravity-cli/settings.json` contains
`"trustedWorkspaces": ["/mnt/c/Users/charl"]`. Every Foreman lane runs in a
worktree created moments earlier, at a path that has never been trusted, and
`agy --help` exposes no `--skip-trust`. The plausible outcomes are: the run
proceeds normally; the run proceeds in a restricted mode where writes silently
fail; or the run blocks waiting for a trust decision no one can give.

The second and third are both lane-killers, and the second is the *silent* one
— the same class as grok's prompt-cancelled writes. This is why the package
does not simply assert a trust behaviour: it requires the behaviour to be
established empirically before the lane is declared ready, and it requires the
write-evidence digest regardless of what that probe finds. If the answer turns
out to be "pre-seed the worktree path into the lane home's `trustedWorkspaces`
at provisioning time", that is a legitimate outcome — but it must be a measured
one, and a seeded trust entry must be scoped to the lane's own home, never
written to the operator's real settings.

## Reasoning effort is expressed twice, and that is a doctrine problem

`--effort low|medium|high` exists, and the model names encode effort as a
suffix. Which wins is unverified. Foreman's doctrine that auditors run at the
highest reasoning level is only enforceable if there is exactly one mechanism
that decides. The design therefore refuses to pick by inference: it requires a
probe, and it requires the losing mechanism to be either unused or asserted
against. A lane that passes `--effort high` to a model named `…-low` and
believes it got high reasoning is worse than one that never had the flag.

Worth noting alongside this: R6 §6.4 records HAL's finding that higher
reasoning effort *reduced* accuracy in the majority of runs. So the doctrine
itself deserves measurement, not just enforcement. That measurement belongs to
the evaluation work, not here; what belongs here is making the dial real.

## Timeout authority

`--print-timeout` defaults to 5m0s. `limits.round_timeout_min` defaults to 30.
The vendor default is six times shorter, and it truncates from inside — the
lane's own supervision sees a process that exited, not a process that was cut
off. One of the two has to be authoritative, and it has to be Foreman's,
because Foreman is the layer that owns rework rounds, stall detection and the
event log. The adapter therefore derives `--print-timeout` from the configured
round timeout rather than inheriting the default.

## Alternatives considered and rejected

**Wire the lane to `@google/gemini-cli` instead**, since R3 evaluated it in
depth. Rejected: it is unauthenticated on this host, it is not the tool the
shop uses, and its auth story for concurrent lanes (`GEMINI_API_KEY` per
process) does not exist here. Research depth is not a reason to ship the wrong
binary.

**Support both Google CLIs behind one vendor id.** Rejected: two binaries with
different flags, exit codes, isolation levers and structured-output
capabilities behind one id reproduces exactly the ambiguity that caused this
package to be drafted against the wrong tool. If `@google/gemini-cli` is ever
wanted, it gets its own vendor id and its own adapter.

**Declare the lane ready now and verify later.** Rejected. Five behaviours that
gate correctness are unverified: the success-path structured-output shape,
headless write reliability, untrusted-workspace behaviour, effort precedence
and timeout interaction. Foreman's own doctrine is that caps and readiness
follow recorded evidence. Shipping a READY verdict on inference is how the
`claude` lane became half-wired.

## Risks

- **Credential seeding is the weakest point.** It moves secret material into
  per-lane directories under a worktree. Mitigation: Setup owns it, the lane
  never performs it, the secrets-refusal preflight at `lane-run.sh` must not be
  confused by it, and `wt-cleanup` must remove it. If this cannot be made
  clean, the correct fallback is a shared home at cap 1, not a leaky seed.
- **The CLI self-updates under us.** 1.1.7 → 1.1.8 inside one session. Every
  verified behaviour in this package is a claim about a version, so the version
  is recorded per round and the adapter declares the version it was verified
  against.
- **`~/.gemini` is shared with another CLI.** A cleanup or reset that targets
  `~/.gemini` wholesale would destroy the other tool's state, and vice versa.
  Anything this package writes or removes must be confined to
  `~/.gemini/antigravity-cli/` within the lane's own home.
- **The unique-catch measurement may never be run**, leaving the lane
  justified by nothing. Mitigation: the justification is a recorded artefact,
  and "cost/capability/availability lane" is an acceptable recorded answer —
  "quality lane" without a measurement is not.
