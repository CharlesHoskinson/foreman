# Council v0.3.0 Integration Evidence

Date: 2026-08-02

## Scope

This report records the read-only architecture review and disposable experiments used to plan Council localization in Foreman. No provider inference ran during these experiments. Temporary state was isolated below `/tmp`.

The integration branch starts from Foreman commit `7981538f25e60e16dbd8ad2b202eee29b9a8e16b`. It imports Council commit `369723b34d3fa96bb869f828562f0ba2dc18cd17` as an unsquashed subtree at `components/council/`. Merge commit `0e542d02df76509e3c7c47bf677ef7fc61861d6e` preserves both histories.

## Architecture Result

Council is the typed decision and deliberation plane. Foreman remains the execution and release-control plane.

Council owns:

- sealed proposals and blinded non-author review;
- failure-domain quorum and typed abstention;
- preserved dissent;
- deterministic advisory replay.

Foreman owns:

- provider readiness, authentication guidance, and process launch;
- worktrees, queues, event logs, and checkpoints;
- audit verdicts, Graphify mutation, release gates, and merges.

Council output is advisory. It must not write `audit-verdict.json`, Foreman event or checkpoint files directly, Graphify state, or release decisions.

## Localization Experiment

The existing installer enumerates immediate `skills/*/` directories. A canonical `skills/council/SKILL.md` therefore installs automatically for Claude, Codex, and Grok as absolute directory links:

| Host | Destination |
| --- | --- |
| Claude | `$HOME/.claude/skills/council` |
| Codex/Agents | `$HOME/.agents/skills/council` |
| Grok | `$HOME/.grok/skills/council` |

The installer preserves an existing real destination directory. It replaces stale or foreign symlinks. A repository relocation requires reinstalling the absolute links.

The installer has no Gemini or `agy` destination. Antigravity instead discovers workspace plugins below `.agents/plugins/`. The localized design uses `skills/council/` as the policy source and a thin `.agents/plugins/council/` wrapper with a minimal `plugin.json`.

The experiment ran `tests/plugin-drift.bats`, `tests/tool-check-auth.bats`, and `tests/adapters.bats`. All 42 declared tests passed.

## `agy` Readiness Experiment

The `agy` adapter exists and its direct authentication probe succeeded on this host. Its capability map sets `cap_n=1` and `isolation=partial`.

The command below failed before it reached the adapter probe:

```bash
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane agy
```

Observed result:

```text
bad lane: agy (grok|codex)
SETUP: NOT-READY
```

The cause is a registry mismatch. `env/tool-check.sh` and the Setup wrapper admit only the older lane set even though `skills/foreman/scripts/adapters/agy.sh` is implemented. The first implementation task adds `agy` to Setup through failing Bats tests. It does not change the adapter or run paid inference.

The model-family classifier correctly treats the selected `agy` model as the identity boundary. `agy` with `gemini-2.5-pro` is a Google lane and can independently audit a Codex worker. `agy` with `gpt-5.6-sol` is an OpenAI lane and is refused for that same worker. An empty model is refused as unknown.

## Shadow Composition Experiment

Existing Foreman ports are sufficient for a fixture-only Council shadow round:

- adapter capability and argv builders control provider invocation;
- `ac_model_family` enforces independent model-family routing;
- `el_init`, `el_attempt_new`, and `el_emit` provide durable events;
- `ckpt_snapshot` and `ckpt_latest` provide recovery points;
- standard `FOREMAN_REPORT` pairs feed `wt-consolidate.sh`;
- `merge-gate.sh` checks dispatch freshness;
- `gate-eval.sh` remains the release authority.

The experiment emitted and read a Council observation, created and recovered a checkpoint, consolidated two synthetic reports, and passed the merge-freshness check. A release-gate invocation without required task evidence exited 2. This confirms that Council-only evidence cannot authorize a release.

## First Dogfood Target

Run the first advisory Council against `audit-groundedness-gate`. The review should test three known risks:

1. The G1 predicate does not bind `repository_head`.
2. An empty registry can satisfy the current canary condition vacuously.
3. The canary is not bound to the evaluated entrypoint.

Keep the v0.2.9 target worktree read-only. Convert accepted recommendations into normal Foreman specifications and dispatch them through existing worktree, audit, and merge gates.

## Verification Baseline

From `components/council/`, `corepack pnpm verify` passed 9 test files and 114 tests. Strict OpenSpec validation passed for `design-council-core`.

The implementation sequence and commands are in `docs/superpowers/plans/2026-08-02-council-v030-localization.md`.
