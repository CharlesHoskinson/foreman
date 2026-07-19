# Design — grok-lane-activation

## Research basis (2026-07-18, verified)

- Product: **Grok Build** (xAI's terminal coding agent), install
  `npm i -g @xai-official/grok` (npm mirror avoids the Cloudflare-walled
  `x.ai/cli` host); binary `grok` at the npm global prefix. Source mirror
  `github.com/xai-org/grok-build`; community `superagent-ai/grok-cli` is
  UNAFFILIATED — do not use.
  Refs: docs.x.ai/build/overview, docs.x.ai/build/cli/reference.
- Headless flags (verified against docs.x.ai/build/cli/reference,
  2026-07-18): `-p/--single`, `--output-format plain|json|streaming-json`,
  `-r/--resume [ID]`, `-c/--continue`, `--session-id <UUID>`, `--cwd <PATH>`,
  `--always-approve`, `--no-alt-screen`, `--no-auto-update`. No
  `--output-file` flag — redirect stdout.
- Config root: `GROK_HOME` (default `~/.grok` / `%USERPROFILE%\.grok`) —
  relocates the whole config root; maps directly onto T5a's per-lane
  vendor-home. Ref: docs.x.ai/build/settings.
- Auth: browser OAuth cached in the system keyring; `grok login
  --device-code` for browser-free hosts; `XAI_API_KEY` skips OAuth. Verified
  live on this host: signed in as the account holder, `grok -p` returns rc 0.
- Windows support is xAI-"best-effort, not tested from this tree" per the
  repo README; WSL is the tested fallback. No documented Git-Bash-specific
  runtime bug, but treat Git Bash as primary-yet-unverified-by-xAI.
- **Security flag (single-source, unrefuted):** a wire-level gist
  (cereblab, grok 0.2.93) reports the CLI uploads the entire repo incl. git
  history and unredacted `.env` regardless of telemetry toggles. Not
  independently reproduced; treated as a RISK, hence the secrets-refusal
  preflight, not a blocker.

## Approach

Reuse everything T5a shipped: `grok` is already a permitted `LANE_VENDOR`
value in the isolation plumbing (grok/codex/claude mapping) — this change
verifies and exercises the grok arm, adds the headless recipe + manifest
truth-up + the secrets preflight, and proves one real `--round` lane.

The secrets preflight is a small bash scan (find `.env` excluding
`.env.example`; grep for PEM private-key headers) gated on
`LANE_VENDOR=grok`, emitting an `alert` and refusing on a hit — cheap,
fail-safe, removable once the upload claim is refuted.

Promotion of grok to *default* implementer is deliberately NOT in this
change; it is a one-line doctrine flip in `t5b-concurrency-verdict`, gated on
green concurrency evidence.

## Execution

Implementer lane: **Sonnet 5**. Audit/review: **Opus 4.8**. The first real
grok `--round` lane (once this change's plumbing lands) is itself audited by
Opus — cross-vendor invariant holds (worker xAI ≠ auditor Anthropic).
