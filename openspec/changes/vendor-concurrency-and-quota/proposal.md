# Change: vendor-concurrency-and-quota

## Why

Foreman's concurrency caps are governed by a rule the repo takes seriously and
states in code. `lane-queue.sh:375-383` and `:415-421`: caps are pinned by the
T5b destructive-concurrency verdict in
`docs/research/vendor-concurrency-results.md`, *"no cap raised without a
recorded green row; default-on-doubt is 1"*, and *"A future cap raise here MUST
cite a specific GREEN row added to that doc."* The current topology is
`grok:3 codex:2 claude:3 misc:2 gate:1`, with grok GREEN at N=2 and N=3 and
codex GREEN at N=2, both from the 2026-07-18 live authenticated run.

**A fourth vendor arrives with no row at all.** By the repo's own rule, `agy`
starts at 1 and stays there until a T5b-style destructive run is recorded. This
package's job is to make that cap real, make the harness able to produce the
row, and be honest about what is not yet known.

The evidence for caution is not merely "no row exists". It was probed live on
the reference box, 2026-07-28, read-only:

- **`agy`'s isolation lever is `$HOME`, and an isolated `$HOME` has no
  credential.** `GEMINI_CLI_HOME` is a no-op for this CLI; `HOME=$T agy models`
  relocates all state and returns rc 1 `Error: Please sign in to view available
  models.` So the two obvious topologies are "isolated lanes, none of which can
  authenticate" and "one shared home for every lane" — and the shared home is
  where the concurrency hazards live.
- **The shared home contains a live SQLite database.**
  `~/.gemini/antigravity-cli/conversation_summaries.db` exists with `-wal` and
  `-shm` companions. N lanes under one home are N writers to one database.
- **The shared home also contains `settings.json` and the OAuth token**, both
  user-root-scoped, which is structurally the `.claude.json` corruption class
  Foreman already ruled `REQUIRES-SEPARATE-HOME`.
- **`~/.gemini` is shared with a second, unrelated CLI** which stores
  `config/`, `tmp/`, `history/` and `projects.json` in the same tree, so
  contention is not confined to Foreman's own lanes.
- **Per-lane homes are not free.** A fresh home provisioned by a single
  `agy models` call also created `.cache/ms-playwright-go/1.57.0` — the CLI
  lays down a browser runtime per home.

**Quota is the second unknown, and it interacts with a doctrine.** Foreman's
doctrine is that auditors run at the highest reasoning level. Whether the
active account tier can actually serve that is not something the readiness
inventory reports today: it reports authenticated or not, and nothing about
what the credential is entitled to. R3 §6.1 documents the general shape of this
hazard for Google's consumer CLI — request-per-day quotas rather than token
quotas, and a free tier restricted to the Flash model class, which silently
converts a "highest reasoning auditor" into a small-model auditor. The specific
tier semantics for `agy` are **unverified**; what is known is that the binary
carries a tier concept (an `AGY_BUSINESS_PAYGO_TIER` symbol) and that this
host's model list does include `gemini-3.1-pro-high`, so this credential is not
Flash-restricted. That is a fact about this host, not a fact about the vendor.

R3 §6.1 also records the behaviour that matters most in headless: at a daily
limit, the consumer CLI offers an interactive choice — switch model, upgrade,
or stop. In headless there is nobody to answer. Whether that surfaces as a
clean nonzero exit or a silent downgrade is untested for any Google CLI, and it
is the difference between a lane that reports `STATUS: unavailable` and a lane
that quietly produces a worse-model result and calls it an audit.

## What changes

- **`agy` enters the group topology at 1**, with the cap's evidence basis
  recorded inline exactly as grok's and codex's are, citing the absence of a
  GREEN row rather than a judgement about the vendor.
- **The cap-raise rule is restated for four vendors and made checkable**: a
  cap above 1 requires a specific GREEN row, and the topology carries the
  citation.
- **`vendor-concurrency-test.sh` covers every vendor**, including a case that
  maps `agy` to `$HOME` (not `GEMINI_CLI_HOME`, which does nothing) and
  re-probes auth with `agy models` after the run, so cross-lane auth
  invalidation is observable.
- **The harness gains a shared-state monitor** for a vendor whose isolation is
  incomplete: when lanes share a home by necessity, the run watches the SQLite
  database and settings file for corruption, not only the containment root.
- **Readiness reports entitlement, not just authentication.** Each vendor row
  reports the active tier or plan where the CLI exposes it, and whether the
  configured model and reasoning effort are actually available under it.
- **Quota exhaustion is classified, not absorbed.** A round that ends because
  the account's quota is exhausted reports `STATUS: unavailable` through the
  adapter's `rc_unavailable` contract, and never as a model failure or as a
  completed round at a downgraded model.
- **A downgraded model is a reportable event.** The round report records the
  model actually used, and a difference from the pinned model is surfaced.
- **The unknowns are tasks, not assumptions.** The agy quota shape, its
  exhaustion behaviour in headless, and its concurrency verdict are each a task
  with a recorded artefact.

## Impact

- Affected: `skills/foreman/scripts/lane-queue.sh` (`:375-383`, `:415-421`,
  `:422`), `skills/foreman/scripts/vendor-concurrency-test.sh`,
  `docs/research/vendor-concurrency-results.md`, `env/tool-check.sh`
  (readiness rows), `config/foreman.toml.example`,
  `skills/foreman/references/lanes.md`.
- New: an agy row in the concurrency results document once a run is recorded;
  a quota/entitlement section in the readiness output.
- Depends on `vendor-adapter-contract` (`adapter_caps` publishes `cap_n` and
  `rc_unavailable`) and on `agy-lane-activation` (which owns the lane itself
  and the credential-seeding decision this package's topology depends on).
- **Ownership boundary:** this package sets the cap and owns the concurrency
  evidence. `agy-lane-activation` SHALL NOT set a cap; this package SHALL NOT
  wire the lane.
- Behaviour change: none for grok, codex or claude. Their caps and their
  recorded evidence are unchanged by this package.
