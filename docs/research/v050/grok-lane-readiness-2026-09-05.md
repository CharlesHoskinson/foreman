# Grok lane readiness, 2026-09-05

Commit `7670716`, WSL2 reference host, Grok CLI 1.0.13, credential profile
`grok-default`.

| Check | Command shape | Result |
|---|---|---|
| Setup | `foreman-setup.sh --profile soft --lane grok` | `grok ok 1.0.13`, `LANE_READY: grok=yes` |
| Canary with the lane's flags | `--prompt-file canary.md -m grok-4.6 --output-format json --always-approve --no-subagents --disable-web-search --verbatim --max-turns 2 < /dev/null` | exit 0 in 7.3 s, `num_turns 1`, `modelUsage` key `grok-4.6-build`, 19,093 input tokens |
| Headless edit round | same flags, `--max-turns 6`, a one-file spec with the wrong line pasted and the exact replacement stated | exit 0 in 12.9 s, `num_turns 3`, `add.ts` changed as specified |

The earlier note that the Grok CLI times out headless (2026-09-03) was
measured with `grok -p` in the default home. It does not reproduce with the
lane's profile home and flags. The 2026-09-05 pidns round (pueue 1455) ran
Grok for 16 minutes and failed its gate on type errors in the model's own
edits, which is a spec-shape outcome (trap 7), not a lane-health outcome.

Fixes landed with this record: adapter default model `grok-4.6`, verified
CLI `1.0.13`, the agent definition names Grok 4.6 and carries the footgun
checklist, and the adapter digest is re-pinned in the architecture policy.
