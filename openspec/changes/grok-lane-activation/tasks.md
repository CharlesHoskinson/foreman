# Tasks — grok-lane-activation

Implementer: Sonnet 5 · Audit: Opus 4.8 · gate mutex on every bats run.

- [ ] **1. Verify the grok arm of T5a's vendor map** — confirm
  `LANE_VENDOR=grok` exports normalized `GROK_HOME` on both spawn branches
  and fills `ownership.config_dir`; add a grok case to
  `tests/vendor-isolation.bats` (or new `tests/grok-lane.bats`) mirroring the
  existing codex/claude cases + a real-binary skip-guarded case.
- [ ] **2. Secrets preflight** — add the `LANE_VENDOR=grok`-gated worktree
  scan (`.env` sans `.env.example`; PEM private-key headers) to lane-run;
  emit `alert{kind:grok_secrets_refused}` and exit non-zero on a hit; tests
  for both the refuse and the clean-proceed scenarios.
- [ ] **3. Manifest + tool-check truth-up** — correct the `grok` entry
  (`npm i -g @xai-official/grok`, npm-prefix binary, device-code login);
  tool-check reports present-but-not-signed-in distinctly; a config.bats or
  tool-check test if one fits.
- [ ] **4. Lanes reference recipe** — document the grok-implementer headless
  invocation, resume form, auth doctrine, and the secrets-refusal rule in
  `skills/foreman/references/lanes.md`.
- [ ] **5. Live acceptance** — route one real trivial spec to grok via
  `lane-run --round` (grok edits a throwaway worktree, gate + report),
  captured as the package's SC-style proof; Opus audits the resulting diff.
- [ ] **6. Verify** — `bash -n`; the new/updated bats files under the mutex;
  `bash tests/run.sh`; `docs-check.sh`. Paste evidence in the change's
  FOREMAN_REPORT.

Acceptance: grok runs a real audited `--round` lane; secrets preflight
proven both directions; manifest matches reality; full suite + docs-check
green. On ship: archive this folder to
`openspec/changes/archive/<date>-grok-lane-activation/`.
