# Spec delta — grok as a lane-run vendor + headless recipe

EARS-phrased requirements. See `skills/foreman/references/five-part-spec.md`
for the phrasing keyword set. These extend the T5a vendor-isolation contract;
the launcher-absent frozen path is unchanged.

## ADDED Requirement: lane-run maps the grok vendor to an isolated GROK_HOME

WHERE `LANE_VENDOR=grok` is set, the implementer SHALL export `GROK_HOME`
pointing at the lane's normalized vendor-home directory
(`<worktree>/.harness/vendor-home/grok`, `cygpath -m`-normalized on Windows
per the T5a fix) into the spawned CMD's environment, on both the
launcher-present and launcher-absent spawn branches, and SHALL record the
value in the `ownership` event's `config_dir` field.

- WHEN `LANE_VENDOR=grok` and `LANE_CONFIG_DIR` is unset, the implementer
  SHALL default `GROK_HOME` to the provisioned grok vendor-home dir.
- WHEN `LANE_VENDOR=grok` and `LANE_CONFIG_DIR` is set, the implementer SHALL
  export that value verbatim (normalized) instead of the default.
- IF `LANE_VENDOR` is set to a value other than `grok|codex|claude`, THEN the
  implementer SHALL exit with a usage error (exit 2) before acquiring the
  lane lock — the frozen T5a rejection, now with `grok` accepted.

#### Scenario: grok vendor-home reaches CMD and the ownership event

- WHEN a lane runs with `LANE_VENDOR=grok` and no `LANE_CONFIG_DIR`
- THEN CMD observes `GROK_HOME` equal to the normalized provisioned dir
- AND the `ownership` event's `payload.config_dir` equals that same value.

## ADDED Requirement: the grok-implementer recipe is non-interactive and isolated

The lanes reference SHALL document the grok headless invocation as
`grok -p "<spec>" --cwd <worktree> --output-format json --always-approve
--session-id <uuid> --no-auto-update`, with stdout redirected to a
per-lane output file and `GROK_HOME` set per lane.

- The recipe SHALL use `--output-format json` (machine-readable) and
  `--always-approve` (unattended edits) so the invocation is fully
  non-interactive, satisfying lane-run's CMD non-interactive contract.
- WHERE a lane is resumed, the recipe SHALL use `grok -r <session-id>` with
  the same `GROK_HOME` and `--cwd`.
- The reference SHALL state the auth doctrine: `grok login --device-code`
  (browser-free) OR `XAI_API_KEY` in the environment; a fresh host needs one
  of these before the lane can run.

## ADDED Requirement: grok lanes refuse secrets-bearing worktrees

WHILE the whole-repo-upload behavior of Grok Build is unrefuted, WHEN a lane
runs with `LANE_VENDOR=grok`, the implementer SHALL scan the worktree for
secret material before spawning CMD and SHALL refuse the lane (exit non-zero,
emit an `alert` with `kind:"grok_secrets_refused"`) if any is found.

- The scan SHALL match at least `.env` files (any depth, excluding
  `.env.example`) and private-key patterns (`-----BEGIN * PRIVATE KEY-----`).
- IF no secret material is found, THEN the implementer SHALL proceed
  normally.

#### Scenario: a worktree with a .env file blocks the grok lane

- WHEN a `LANE_VENDOR=grok` lane targets a worktree containing `.env`
- THEN lane-run exits non-zero without spawning grok
- AND an `alert` event with `payload.kind=="grok_secrets_refused"` is emitted.

#### Scenario: a clean worktree proceeds

- WHEN the worktree contains only `.env.example` and no key material
- THEN the grok lane spawns normally.

## MODIFIED Requirement: the env manifest describes a real, resolvable grok install

The `grok` tool entry in `env/reference-manifest.toml` SHALL reflect the
verified install: `npm i -g @xai-official/grok` (avoids the Cloudflare-walled
`x.ai` installer host), the binary resolved from the npm global prefix, and
`grok login --device-code` as the headless-auth step.

## ADDED Requirement: grok authentication is a Setup-stage responsibility

WHERE the three-stage lifecycle (lifecycle-three-stage) is present, grok
authentication SHALL be performed and verified in the **Setup & Environment**
stage, not as an in-lane precondition, and the Use stage SHALL assume an
authenticated `GROK_HOME`.

- Setup SHALL probe grok auth (a minimal signed-in check under the lane's
  `GROK_HOME`) and mark the grok lane NOT-READY with the
  `grok login --device-code` instruction when unauthenticated.
- WHEN a grok Use lane is requested WHILE Setup reports grok NOT-READY, the
  implementer SHALL refuse at the door citing Setup, NOT authenticate
  mid-lane.
- The secrets-refusal preflight (above) remains an in-lane guard — it is a
  per-worktree safety check, not an environment-readiness concern.

#### Scenario: unauthenticated grok is caught in Setup, not mid-lane

- WHEN Setup runs with grok installed but not signed in
- THEN Setup marks grok NOT-READY with the device-code instruction
- AND a grok Use lane is refused citing Setup, with no mid-round auth attempt.
