# Fable correction re-audit

Verdict: WARNING. This is a standalone advisory audit, not Foreman release acceptance.
Fable found evidence for all ten original corrections and no high or critical defect in the
implemented storage, broker, or partial pilot. It raised two medium and seven low concerns.

## Verified receipt

- Requested, initial, and assistant model: `claude-fable-5-1`.
- Terminal exit: 0. Tool catalog verified; no host-action tools or session persistence.
- Full-file snapshot: `8e0171adfb9aa0b260d253737e609871515130245312bd2770cb5d533ef5a261`.
- Prompt: `17f5e1677c1246ed2acd30eba75f565d8ac2e6f6e238b2467db967a57c16b927`.
- Receipt: `/root/research/foreman-fable-corrections-retry-EAqkpk/audit.json`.
- Receipt SHA-256: `c5f82996f32351757359010cdb208a71fb4e45aea690e7b1af6afddabeccaff7`.
- No selected file changed between snapshot creation and audit completion.

The parent independently checked model identities, terminal status, snapshot and prompt hashes,
and the unchanged-file observation. The complete original verdict remains in the receipt.
All implementation, tests, requirements, and untracked files were included in full. Five large
existing documentation files were represented by complete candidate diffs against HEAD.
The manifest binds full hashes for all 55 selected files.

An earlier bounded attempt in `/root/research/foreman-fable-corrections-K1hCQP` ended unverified.
It has no accepted verdict. The retry used the same full-file snapshot and medium effort.
Neither attempt changes the historical [BLOCKED audit](fable-audit-2026-09-15.md).

## Follow-up concerns and parent assessment

| Concern | Required response |
| --- | --- |
| Recovery authorization and generation observation | The experiment proves conditional recovery, not manager authorization. Specify metadata access and serialized tombstone/refresh/recovery policy. A positive CAS alone does not prevent resurrection after soft deletion. Keep the manager deferred. |
| Synthetic exposure through source imports | Source imports do not establish production exposure by themselves. Parent search found the broker reachable only from the synthetic pilot and tests, with no orchestration index export. Add fresh default-entry reachability controls and precise claims. |
| Binary hash-to-launch race | Bind launch to verified owned bytes and state the same-UID/root trust boundary. A rehash alone does not remove a path race. |
| Compiled provenance test description | Align the test name with actual cwd/build/runtime assertions. Retain the separate meaningful poisoned-dist and changed-source controls. |
| Administrative proxy behavior | Reproduce under a disposable proxy-enabled Node process, then make synthetic loopback requests explicitly direct and bounded. |
| Store and identity composition | Construct both from one validated configuration snapshot. Specify separate least-privilege operation roles without claiming manager enforcement. |
| Report canaries and child exit | Include deletion-experiment canaries in the leak guard and preserve signal/spawn-failure evidence. |
| Readiness status | Do not treat uninitialized or sealed responses as healthy. Test transitions and deadlines. |
| Built-entry test freshness | Bind default-entry assertions to a fresh build from current source rather than an arbitrary existing dist. |

The proxy behavior is documented by the [Node.js project](https://github.com/nodejs/learn/blob/main/pages/http/enterprise-network-configuration.md).
The local negative control remains required; documentation alone does not prove the test host behavior.

The parent preserves qualifications instead of treating each reviewer inference as an established
defect. In particular, the synthetic import concern is an exposure-test gap, and separate store
instances can represent distinct operation roles without changing every token callback.

## Next gate

The user requested correction of all findings. The bounded follow-up plan is
[Fable follow-up corrections](../../superpowers/plans/2026-09-15-fable-followup-corrections.md).
Fresh tests and independent review must verify the resulting candidate.
The manager, native lifecycle, live credentials, five deferred pilot scenarios, and release
admission remain open. This WARNING verdict does not close them.
