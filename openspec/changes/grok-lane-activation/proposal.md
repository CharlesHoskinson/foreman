# Change: grok-lane-activation

## Why

Foreman's doctrine names `grok-implementer` (Grok Build) as the default
implementer lane, but the CLI was absent when v0.2.5 shipped, so the lane was
unverified and Sonnet-implements/Opus-audits was the working substitution.
During the v0.2.7.5 planning cycle Grok Build 0.2.103 was installed
(`npm i -g @xai-official/grok`) and verified end-to-end: signed in via
`grok login --device-code` as the account holder, and a one-shot headless
completion (`grok -p "…" --output-format plain`) returned rc 0. The default
lane is live on this host for the first time.

This change wires grok into the shipped lane machinery so a spec can actually
be routed to it, reusing the normalized vendor-home isolation T5a already
built. Grok stays **optional** — not promoted to default implementer — until
`t5b-concurrency-verdict` proves safe concurrency; promotion is a one-line
doctrine flip in that later change.

## What changes

- `lane-run.sh` vendor mapping gains `grok → GROK_HOME` (extends T5a's
  `lane_vendor_env_var`; `LANE_VENDOR=grok` provisions/relocates the grok
  config root per lane).
- A documented `grok-implementer` headless recipe in the lanes reference.
- `env/reference-manifest.toml` corrected: real npm install path, binary
  location, `grok login --device-code` headless-auth doctrine.
- A worktree secrets preflight: grok lanes refuse to run in a worktree
  containing `.env`/private-key material (mitigates the unrefuted
  whole-repo-upload report until it is disproven).

## Impact

- Affected: `skills/foreman/scripts/lane-run.sh`,
  `skills/foreman/references/lanes.md`, `env/reference-manifest.toml`,
  `env/tool-check.*`, `tests/vendor-isolation.bats` (or a new
  `tests/grok-lane.bats`).
- Backward compatible: `LANE_VENDOR` unset = today's behavior, byte-identical.
- Does NOT change the default implementer (still architect-chosen /
  Sonnet-in-this-era) until t5b greens grok.
