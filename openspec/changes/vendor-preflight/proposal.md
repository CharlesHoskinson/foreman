# Change: vendor-preflight

## Why

**Foreman's Setup gate told the operator to re-authenticate a vendor that was
authenticated.** Measured on the reference box, 2026-07-29T14:25Z:
`foreman-setup.sh --profile soft` printed

```
grok            not_authenticated  (run: grok login --device-code)
MUST_FAIL: grok:not_authenticated
SETUP: NOT-READY
```

while `grok -p` answered normally and `grok models` returned exit 0 with the
signed-in banner in 2.4 s. Setup blocked a release round on a vendor that was
working.

The same contradiction recurred on 2026-09-02: Setup reported Grok as signed
out, while a headless read-only inference returned the requested exact token.
The `models` command later returned the signed-in banner without any credential
change. A presentation command is therefore not authoritative evidence that a
real Grok workload can or cannot run.

The root cause is in `env/tool-check.sh`'s `vendor_authed`. The grok branch
runs `timeout 10 grok models` and then:

```sh
out="$("$tmo" 10 grok models 2>&1)" || rc=$?
# Timeout (rc=124) or any other nonzero exit: never authenticated.
(( rc != 0 )) && return 1
```

The comment states the defect plainly. A bound expiring, a network stall, a
leader-socket failure and a genuinely signed-out CLI all collapse into the
single answer `not_authenticated`, which the caller renders as an operator
instruction — `run: grok login --device-code` — that is wrong for three of
those four causes and cannot fix any of them. The box was running two Codex
sessions at the time; the probe measured 2.4 s idle against a 10 s bound.

This is the release's own checker-soundness thesis in the Setup stage:
**a checker that cannot distinguish "disproved" from "could not be
determined" reports the wrong one, loudly.** `lock-primitive-hardening`
already draws exactly this distinction for lock primitives —
`FM_LOCK_NO_ATOMIC_PRIMITIVE` (positively disproved) versus
`FM_LOCK_PROBE_UNTRUSTED` (unproven) — and `vendor_authed` is the same shape
with the distinction missing.

The second finding is that **no uniform vendor auth contract exists**, so a
single predicate cannot be written for all four lanes. Verified against each
CLI on the reference box and against each vendor's published documentation:

| Vendor | CLI | Non-interactive auth status | Machine-readable | Version | Non-mutating update check |
|---|---|---|---|---|---|
| Anthropic | `claude` | `claude auth status` | **yes — JSON** (`loggedIn`, `authMethod`, `subscriptionType`) | `claude --version` | **no** — `claude update` installs |
| OpenAI | `codex` | `codex login status` | no — prose, exit 0 | `codex --version` | **no** — `codex update` has no `--check` |
| xAI | `grok` | **none** | — | `grok version` | **yes** — `grok update --check --json` |
| Google | `agy` | **none** | — | `agy --version` | **no** |

`grok`'s published command list is `login`, `logout`, `update`, `version` —
there is no status verb, and the vendor's own headless example determines
auth by opening an ACP session and inspecting the offered `authMethods`,
throwing `Run 'grok login' first, or set XAI_API_KEY` when none match.
`agy` authenticates silently from the OS keyring and exposes disconnect only
as an in-session `/logout` slash command, not a subcommand.

The third finding is a safety one. **Three of the four `update` verbs mutate.**
`claude update` is documented as "check for updates and install if available";
`codex update` exposes only `--enable`/`--disable`/`--config`. A preflight that
called them to answer "are we current?" would silently upgrade a vendor CLI
mid-release — changing the toolchain under a running gate. Only
`grok update --check --json` is safe to call.

## What changes

- A new `env/vendor-preflight.sh`, composed by `foreman-setup.sh` and by
  `lane-run.sh`'s readiness gate, that reports each vendor as
  **discoverable**, **authenticated** and **current** as three independent
  facts, each with an evidence class, never as one boolean.
- A **three-state** auth result — `authenticated`, `not-authenticated`,
  `unknown` — replacing today's two-state collapse. `unknown` is never
  rendered as an operator login instruction and never silently passes a gate.
- Per-vendor adapters behind one contract, so the asymmetry above lives in one
  table instead of in ad-hoc branches: `declared` evidence where the vendor
  ships a status verb (`claude`, `codex`), `probed` evidence where it does not
  (`grok`, `agy`).
- Grok readiness is decided by a bounded minimal workload outside the target
  repository. It disables tools, subagents, web access, and memory, and it must
  return exactly `FOREMAN_GROK_READY_V1`. A `models` banner no longer decides
  readiness.
- Currency determined by comparing `--version` against a floor pinned in
  `env/reference-manifest.toml`. The preflight SHALL NOT invoke any vendor's
  `update` verb except `grok update --check`, which is the only non-mutating
  one.
- A red-first test suite: every state of every adapter — including
  `not-authenticated` and `unknown` — is demonstrated to be reachable and
  correctly reported before the checker is trusted.

## Impact

- Affected: `env/tool-check.sh` (the `vendor_authed` grok branch loses its
  rc-collapse), new `env/vendor-preflight.sh`, `env/reference-manifest.toml`
  (pinned version floors + vendor capability table),
  `skills/foreman/scripts/foreman-setup.sh`,
  `skills/foreman/scripts/lane-run.sh` readiness gate, new
  `tests/vendor-preflight.bats`.
- Belongs to the S5 multi-vendor workstream. Depends on
  `vendor-adapter-contract` for the adapter shape; should land before
  `agy-lane-activation`, which adds the fourth lane this preflight must cover.
- Sources: `docs.x.ai/build/cli/reference`,
  `docs.x.ai/build/cli/headless-scripting`,
  `code.claude.com/docs/en/cli-reference`, `learn.chatgpt.com/docs/codex/cli`,
  `antigravity.google/docs/cli/install`.
