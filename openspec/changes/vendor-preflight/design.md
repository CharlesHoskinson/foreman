# Design — vendor-preflight

## The defect, precisely

`env/tool-check.sh`'s `vendor_authed` returns a boolean. Its grok branch:

```sh
out="$("$tmo" 10 grok models 2>&1)" || rc=$?
# Timeout (rc=124) or any other nonzero exit: never authenticated.
(( rc != 0 )) && return 1
```

Four distinct world-states map onto `return 1`:

1. the CLI is genuinely signed out,
2. the 10 s bound expired,
3. the leader socket or network failed,
4. the CLI changed its output and matched nothing.

Only state 1 is fixed by `grok login --device-code`, which is what the caller
prints for all four. States 2-4 are *unknown*, and an unknown reported as a
definite negative is a wrong diagnosis, not a conservative one.

Measured 2026-07-29: Setup reported `not_authenticated` while the CLI answered
in 2.4 s against a 10 s bound, on a box running two concurrent Codex sessions.

## Why this is the same shape as the lock defect

`lock-primitive-hardening` separates `FM_LOCK_NO_ATOMIC_PRIMITIVE` — a trusted
verdict exists and is negative, atomicity **disproved** — from
`FM_LOCK_PROBE_UNTRUSTED` — no trusted verdict exists, atomicity **unproven**.
The spec is explicit that offering the implementer a choice between them was
itself the defect.

`vendor_authed` is that same distinction with the second code missing. This
package adds it. Failing closed is retained; *diagnosing* closed is removed.

## Why one predicate cannot serve four vendors

Verified per CLI on the reference box and against published documentation:

| Vendor | Status verb | Shape | Evidence class |
|---|---|---|---|
| `claude` | `claude auth status` | JSON: `loggedIn`, `authMethod`, `apiProvider`, `subscriptionType` | `declared` |
| `codex` | `codex login status` | exit 0 + prose "Logged in using ChatGPT" | `declared` |
| `grok` | none | published verbs are `login`, `logout`, `update`, `version` | `probed` |
| `agy` | none | silent OS-keyring sign-in; `/logout` is an in-session slash command | `probed` |

xAI's own headless example does not shell out to a status verb at all — it
opens an ACP session, inspects the offered `authMethods`, and throws
`Run 'grok login' first, or set XAI_API_KEY` when none match. That is a
positive-signal handshake, and it is the shape the `probed` class imitates
with a bounded minimal call.

Two consequences follow. First, the asymmetry belongs in a **table**, not in
per-vendor branches accumulating in one function — that is what let the grok
branch drift into a different failure semantics from its neighbours. Second, a
`probed` verdict is structurally weaker than a `declared` one and the record
says which it is, so a later reader can tell an inference from a contract.

## Why a workload canary replaces the banner

The former Grok probe used the string `logged in` inside a human-readable
`models` banner. That banner is a presentation detail, not proof that a workload
can run. It has also contradicted a successful inference on the reference host.
Foreman now executes this shell-free vector with a 90-second host bound and a
fresh private directory below the operating-system temporary directory as its
working directory. Foreman removes that directory after the probe:

```text
grok --single "Reply with exactly this ASCII token and nothing else: FOREMAN_GROK_READY_V1" \
  --no-subagents --disable-web-search --no-memory --tools "" --verbatim
```

The classifier recognizes a signed-out marker only on stderr or with a nonzero
process exit. Model-generated stdout is not authentication evidence. Otherwise,
the classifier accepts only exit 0, empty stderr, and stdout that trims to
exactly `FOREMAN_GROK_READY_V1`. A timeout, a nonzero exit without signed-out
evidence, additional output, or any other response is `unknown`, never a login
diagnosis. The capability manifest permits the exact empty argument after
`--tools`, but it continues to reject whitespace-only arguments.

This is a small billed inference. The gate must determine if inference works.
A cheaper presentation query repeatedly gave a false answer. The canary disables
tools, subagents, web access, and memory. The temporary working directory prevents
repository instructions from changing the response.

Two failure directions remain, and they are not symmetric:

- Banner changes and the adapter reads *absence of the negative* as success →
  a signed-out vendor is reported ready, and the lane fails later, deeper, and
  more expensively.
- Banner changes and the adapter reads absence of the positive as failure →
  today's bug.

The exact-token contract addresses both: success is positive workload evidence,
while every indeterminate result remains `unknown`.

## Why the preflight must not call `update`

`claude update` is documented as "Check for updates and install if available"
and exposes no dry-run flag. `codex update` exposes only `--enable`,
`--disable` and `--config`. Invoking either to answer "are we current?" would
upgrade a vendor CLI underneath a running release gate — changing the
toolchain mid-round, after the gate's evidence was collected.

Only `grok update --check --json` is a genuine non-mutating check.

Currency is therefore a comparison against a floor pinned in
`env/reference-manifest.toml`, which has the side benefit of making "current"
mean *what this release requires*, rather than *whatever the vendor shipped
today* — a moving target no reproducible gate can bind to.

A static check asserts the mutating verbs never appear in the preflight, so a
later well-meaning edit cannot reintroduce them.

## Honest limits

- The Grok workload verdict includes current inference availability, so quota
  or transport failure can prevent readiness. Such failures remain `unknown`
  unless the CLI emits recognized signed-out evidence.
- The stub-CLI test suite proves the **adapter's** state machine, not the
  vendor's real response. Provider drift produces `unknown` because only the
  exact token is accepted.
- Pinning a version floor means a vendor release newer than the floor is
  reported `current` without being tested. The floor is a minimum, never an
  assertion that the resolved version was validated.
