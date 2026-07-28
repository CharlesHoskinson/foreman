# PKG — multi-vendor lanes: change package summary

Authored 2026-07-28 for Foreman v0.2.9, branch `plan/v029-graph-multivendor`.
All four packages pass `openspec validate <name> --strict`.

**Correction of record:** research lane R3 evaluated `@google/gemini-cli`
0.52.0. That binary is installed on the reference box but is unauthenticated
and is **not** the CLI these lanes use. The Google lane is the **Antigravity
CLI (`agy`)**, version 1.1.8, OAuth-authenticated. R3's vendor-independent
doctrine — the eight adapter contract points, prompt never on stdin, the
post-audit `git status --porcelain` assertion, the write-evidence digest,
schema-validate whatever cannot be schema-forced — carries over unchanged. Its
per-flag detail does not, and was re-probed live.

## The packages

| Package | Capability | Purpose |
|---|---|---|
| `vendor-adapter-contract` | `vendor-adapters` | Generalize `wc_build_argv` into per-vendor adapters with two verbs (implement, audit) and R3's eight contract points; resolve the `claude` half-wiring; promote the git-status write-evidence digest from a grok script to a contract point. |
| `agy-lane-activation` | `agy-lane` | Wire the Antigravity CLI as a first-class fourth lane at every attachment site, isolated by `$HOME` with an explicitly seeded credential, with every unverified vendor behaviour specced as a required verification task. |
| `cross-vendor-audit-routing` | `audit-routing` | Replace the scalar auditor with an ordered `[audit] vendors` list that auto-filters worker vendors, enforce the invariant over **model family** at every tier from one shared component, and define opt-in dual audit with a Fable tiebreak. |
| `vendor-concurrency-and-quota` | `vendor-concurrency` | Cap `agy` at 1 until a recorded GREEN row, extend the concurrency harness to every vendor's real isolation lever, and make readiness report entitlement and quota exhaustion rather than only authentication. |

## Dependency order

```
vendor-adapter-contract
  ├── agy-lane-activation            (fills in adapters/agy.sh)
  ├── cross-vendor-audit-routing     (consumes adapter_audit_argv, adapter_caps)
  └── vendor-concurrency-and-quota   (consumes adapter_caps: cap_n, rc_unavailable)
```

`vendor-concurrency-and-quota` also depends on `agy-lane-activation`'s
credential-seeding decision for its T4 destructive run.

## Ownership boundaries (deliberate, to avoid merge contention)

- The post-audit tamper assertion at `audit-run.sh:90-93` is owned by
  `cross-vendor-audit-routing`. `vendor-adapter-contract` must not touch it.
- Concurrency caps are owned by `vendor-concurrency-and-quota`.
  `agy-lane-activation` must not set one.
- Lane wiring is owned by `agy-lane-activation`.
  `vendor-concurrency-and-quota` must not wire the lane.
- The `claude` finish-or-remove decision is owned by
  `vendor-adapter-contract` T7; the matching pueue group removal, if that is
  the decision, lands in that change.

## Live findings behind these packages (WSL, 2026-07-28, read-only probes)

- `agy models` → rc 0 + model list authenticated; rc **1** +
  `Error: Please sign in to view available models.` under a credential-less
  home. rc 1 is also the general error code, so the auth probe must require a
  positive signal and fail closed.
- `GEMINI_CLI_HOME` has **no effect** on `agy`. `$HOME` redirection relocates
  all state but the OAuth token does not travel — an isolated home is
  credential-less.
- `agy` is a **gateway**: its model list spans Gemini, Anthropic
  (`claude-sonnet-4-6`, `claude-opus-4-6-thinking`) and OpenAI-lineage
  (`gpt-oss-120b-medium`) families. The cross-vendor invariant must therefore
  be over model family, not CLI name.
- `--print` takes the prompt as its **value** and must come last;
  `agy "prompt" --print` **hangs indefinitely** rather than erroring.
- `--json-schema` exists, so an agy auditor can be schema-forced — R3's
  "biggest shim" for the Google lane does not apply. Caveat: for `stream-json`
  the schema covers only the final result.
- `--print-timeout` defaults to 5m0s against `limits.round_timeout_min` = 30.
- Reasoning effort is expressible twice (`--effort` and the model-name suffix);
  precedence is unverified.
- `~/.gemini` is a root shared with `@google/gemini-cli`; agy's own state
  includes a live SQLite database with `-wal`/`-shm` companions.
- `settings.json` carries `trustedWorkspaces`; fresh worktrees are untrusted
  and there is no `--skip-trust` flag.
- The CLI self-updates: 1.1.7 → 1.1.8 within one authoring session.

## Honest residuals carried into the specs as tasks, not assumptions

`agy-lane-activation` T1 blocks the READY verdict on recorded answers for: the
success-path structured-output shape, whether agy has a silent zero-write
failure mode in headless, untrusted-workspace behaviour, effort precedence,
timeout interaction, and the unauthenticated exit contract.
`vendor-concurrency-and-quota` T4 blocks any cap raise on a recorded
concurrency row and on agy's headless quota-exhaustion behaviour.

## On the independence argument

R6 §6.1 measures that nine frontier models across seven families behave as
about **two effective independent votes**, and concludes the independence
argument justifies roughly two vendors, not four. These packages do not dispute
that. `agy-lane-activation` requires the lane's justification to be recorded and
**forbids claiming it increases reviewer independence** unless a per-pair
unique-catch measurement supports it; absent that measurement, it is recorded
as a cost, capability or availability lane. `cross-vendor-audit-routing`
declines to default dual audit on the same evidence, and escalates
disagreements to `foreman-advisor` rather than taking the strictest verdict.
