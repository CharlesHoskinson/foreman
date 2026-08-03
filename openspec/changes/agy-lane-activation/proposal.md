# Change: agy-lane-activation

## Why

The product owner has chosen to add a Google lane. The CLI that lane uses is
the **Antigravity CLI (`agy`)**, not `@google/gemini-cli`.

That distinction is not pedantry, it is the reason this package exists in the
shape it does. `@google/gemini-cli` 0.52.0 is installed on the reference box
and is what research lane R3 evaluated in depth — and it is **not
authenticated and not the tool this shop uses**. `agy` 1.1.8 is installed at
`/root/.local/bin/agy`, is OAuth-authenticated, and answers `agy models` with a
model list. The two CLIs have different flags, different exit codes, different
isolation behaviour, and different structured-output capabilities. R3's
vendor-independent doctrine survives intact; its per-flag detail does not.

Everything below was probed live, read-only, on the reference box on
2026-07-28. No login command was run and no vendor auth state was mutated.

**Isolation is the hard problem, and it is not the one R3 anticipated.**

- `GEMINI_CLI_HOME` — R3's verified isolation lever for `@google/gemini-cli` —
  **has no effect on `agy`**. Probed: `GEMINI_CLI_HOME=$T agy models` left `$T`
  empty and still answered from the real home.
- `$HOME` redirection **does** relocate agy's state: `HOME=$T agy models`
  created `$T/.gemini/config/` and `$T/.gemini/antigravity-cli/` (and, notably,
  a `$T/.cache/ms-playwright-go/1.57.0` browser runtime).
- But the credential does **not** travel. The OAuth token lives at
  `~/.gemini/antigravity-cli/antigravity-oauth-token`, and under a fresh
  `$HOME` the same command returns rc **1** and
  `Error: Please sign in to view available models.`

So `agy` is structurally in the same class Foreman already ruled
`REQUIRES-SEPARATE-HOME` for claude: state isolation is achievable, but an
isolated home is credential-less, and there is no documented API-key
environment variable to carry a credential per process the way `GEMINI_API_KEY`
would have done for `@google/gemini-cli`. This is the single most important
finding in the package and it drives the cap, the readiness gate and the
Setup-stage instruction.

**There is no distinct "not authenticated" exit code.** `agy models` returns rc
0 authenticated and rc 1 unauthenticated — and rc 1 is also its general error
code. "Nonzero" therefore cannot separate a Setup problem from a round problem.
The probe must require a positive signal and fail closed, exactly as
`env/tool-check.sh:60-81` already does for grok.

**The prompt-delivery gotcha is a hang, not an error.** `--print` (aliases
`-p`, `--prompt`) takes the prompt as its **value** and must come last.
Verified working: `agy --model gemini-3.6-flash-low --print "Reply with exactly:
AGY_OK"` → `AGY_OK`, rc 0. Verified failing: `agy "some prompt" --print`, with
the prompt as a positional and a valueless trailing `--print`, produced no
output and no error for 180 s and had to be killed. A lane in that state sits
in `RUNNING_IMPL` until the stall watchdog fires, and the failure is
misattributed to the model.

**Some things are better than R3 expected.** `agy --json-schema` exists (a
schema string or a path to a schema file) so an agy auditor can be
schema-**forced** like codex and grok — R3's "biggest shim" for the Google lane
does not apply. The documented caveat does: for `stream-json` the schema
applies only to the final result, so the audit verb must choose an output
format the enforcement actually covers. `--mode plan` and `--mode accept-edits`
give the read-only/write split directly, and `--effort low|medium|high` makes
the "auditors run at the highest reasoning level" doctrine expressible.

**And some things are quietly hazardous.**

- `--print-timeout` defaults to **5m0s**, while Foreman's
  `limits.round_timeout_min` defaults to **30**. Left alone, the vendor
  truncates a long round at five minutes while Foreman still believes the lane
  is running.
- Effort is expressed **twice**: as a `--effort` flag and as a suffix in the
  model name (`gemini-3.6-flash-high`, `gemini-3.1-pro-low`). Which wins when
  both are given is unverified. Until it is settled, "auditors run at highest
  reasoning" is unenforceable for this vendor.
- `agy` **self-updates**. It carries `~/.gemini/antigravity-cli/updater/` and a
  `last_check.timestamp`, and it moved from 1.1.7 to 1.1.8 during the single
  session in which this package was written.
- `~/.gemini` is a **shared root**: `agy` writes `~/.gemini/antigravity-cli/`
  while `@google/gemini-cli` writes `~/.gemini/config/`, `~/.gemini/tmp/`,
  `~/.gemini/history/` and `~/.gemini/projects.json` in the same tree.
- `~/.gemini/antigravity-cli/settings.json` carries a
  `trustedWorkspaces` list — on this host, exactly `["/mnt/c/Users/charl"]`.
  Every Foreman lane runs in a freshly created worktree, which is not on that
  list, and `agy` has **no `--skip-trust` flag**. What an untrusted workspace
  does to a headless run is unverified and is a candidate lane-killer.
- Conversation state is SQLite (`conversation_summaries.db` with `-wal`/`-shm`
  companions) in that shared home, so concurrent lanes sharing a home share a
  database.

**And the inventory that let this happen is itself a defect.** The reason this
package was first drafted against the wrong binary is that "a Google CLI is
installed" was taken for "the Google lane is ready". A readiness inventory that
does not name the binary its lanes actually invoke can report READY for a CLI
no lane uses. That is fixed here.

## What changes

- **A new `agy` vendor lane**, wired at every site R5 §5 enumerates, with no
  half-wiring: `lane-run.sh`'s vendor map and error text, `wt-new.sh`'s
  per-worktree vendor home, `env/tool-check.sh`'s auth probe and inventory row
  and profile membership, `lane-queue.sh`'s group topology, `worker-run.sh`'s
  hard-mode env allow-list, and `adapters/agy.sh` from
  `vendor-adapter-contract`.
- **Isolation by `$HOME`, with the credential seeded explicitly.**
  `adapter_home_var agy` resolves to `HOME`, not `GEMINI_CLI_HOME` (which is a
  no-op), and the lane's home is provisioned with the credential material it
  needs before the lane starts — or the lane is refused at Setup.
- **A zero-cost, fail-closed auth probe.** `agy models` under `timeout`,
  requiring a positive model-list signal; rc 1 alone is never read as
  "unauthenticated" and never as "authenticated".
- **Argument order as a hard requirement**, owned by the adapter: the prompt is
  the value of a trailing `--print`, and a contract test asserts it.
- **Mode split**: `--mode accept-edits` for implement, `--mode plan` for audit,
  with the post-audit `git status --porcelain` assertion mandatory regardless —
  a documented read-only mode is a control, not a proof.
- **One authoritative reasoning-effort mechanism**, chosen after verifying
  precedence between `--effort` and the model-name suffix.
- **Explicit model pinning** and recording of the model actually used.
- **Round-timeout authority**: `--print-timeout` is derived from Foreman's
  configured round timeout, never left at the vendor default.
- **A recorded CLI version** per round, because the binary self-updates.
- **Required verification tasks** for everything still unverified: the
  success-path structured-output shape, whether `agy` has a silent-zero-write
  failure mode in headless, what an untrusted workspace does, effort
  precedence, and timeout interaction. None of these are assumed in the spec;
  each is a task with an acceptance criterion.
- **Inventory honesty**: readiness rows name the binary and the resolved path
  the lanes invoke, and an installed-but-unused CLI never contributes to a
  lane's READY verdict.

## Impact

- Affected: `skills/foreman/scripts/lane-run.sh` (`:206-213`, `:305-307`),
  `skills/foreman/scripts/wt-new.sh` (`:106-109`, `:256-258`),
  `skills/foreman/scripts/worker-run.sh` (`:116-122,141-144,149`),
  `skills/foreman/scripts/lane-queue.sh` (`:422`),
  `env/tool-check.sh` (`:3,15,17`, `:56-83`, `:134-153`, `:273-279`,
  `:403-416`), `config/foreman.toml.example`,
  `skills/foreman/references/lanes.md`, `skills/foreman/SKILL.md`.
- New: `agents/agy-implementer.md`, `agents/agy-auditor.md`,
  `tests/agy-lane.bats`, a Setup-stage credential-provisioning path for the
  per-lane home.
- Depends on `vendor-adapter-contract` (supplies the adapter interface this
  package fills in for `agy`).
- Coordinates with `vendor-concurrency-and-quota` (owns the cap and the
  concurrency evidence) and the current audit router (owns which vendor audits
  and the model-family invariant that `agy`'s multi-family model list makes
  necessary). This package SHALL NOT set the cap or the routing policy itself.
- **`@google/gemini-cli` is treated as installed-but-unused.** This change does
  not remove it and does not wire a lane to it.
