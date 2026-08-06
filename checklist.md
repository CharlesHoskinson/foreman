# v0.2.9.0 release record

This checklist records completed evidence for exact release commit
`fbe23257fc389036d6feaa8f38e7b377f3106406`.

The canonical inventory is
`docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`.

## Product boundary

- [x] Ship one Node.js 24 TypeScript executable named `council-preflight`.
- [x] Read one bounded closed request from stdin.
- [x] Write one strict provider-neutral result to stdout.
- [x] Compile and validate ACE before any provider process starts.
- [x] Support bounded Grok, Claude, and Codex canary transports.
- [x] Fail closed for Google because the release has no Gemini adapter.
- [x] Pass the local Council gate from an absent generated bundle.
- [x] Obtain independent code review for the implementation stack.

## Live evidence

- [x] Record live canary evidence on exact canary candidate
      `2ec886c3454b49420405aec87afaa6594ccbfdf8`.
- [x] Confirm xAI Grok 4.5, Anthropic Claude Sonnet 5, and OpenAI GPT-5.4
      returned nonce-bound `ready` receipts with completed terminal state,
      exit code 0, zero pending or failed tool calls, and empty standard
      error.
- [x] Cite GitHub evidence
      <https://github.com/CharlesHoskinson/foreman/pull/22#issuecomment-5171848075>.
- [x] Confirm the Council package tree is byte-identical at candidate
      `2ec886c` and release commit
      `fbe23257fc389036d6feaa8f38e7b377f3106406`. Both resolve
      `components/council/packages` to tree
      `fe0af13811a6bbed482af60a57eb869fbebde075`.
- [x] Confirm the only Council path changed after the canary candidate is
      `components/council/vitest.config.ts`.
- [x] Do not claim exact-merge canary receipts. Do not claim the canaries
      ran on the release commit.
- [x] Preserve provider-neutral receipts without secrets.

## External dogfood

- [x] Run Foreman against a repository other than Foreman.
- [x] Produce one substantive Grok worker commit.
- [x] Obtain one independent different-family audit.
- [x] Pass the target repository native gate.
- [x] Preserve the Council shadow outcome for the exact external diff. The
      outcome is `quorum_not_met`. It is not approval or a release gate.

## Exact-candidate gates

- [x] Pass the hosted Linux gate on the release commit. Run
      `30860945352`.
- [x] Pass the hosted Windows gate on the release commit. Run
      `30860945387`.
- [x] Pass the final local release gate. 708 passed, 0 failed, and 19
      skipped Bats cases.
- [x] Rebuild the knowledge graph from the release commit.
- [x] Validate graph integrity and current-source coverage. Graph digest
      `0a513b5c971fac3fbb5301e53ae35ffb0d57b0a654dc51787be254f964be9dc2`.
- [x] Publish current release notes, residuals, and cleanup records.
- [x] Confirm that GitHub and local refs name the same release commit
      `fbe23257fc389036d6feaa8f38e7b377f3106406`.

## Release actions

- [x] Merge the accepted pull request. Merge commit
      `fbe23257fc389036d6feaa8f38e7b377f3106406`.
- [x] Re-run exact-main gates after merge.
- [x] Create annotated tag `v0.2.9.0` at
      `fbe23257fc389036d6feaa8f38e7b377f3106406`.
- [x] Publish the GitHub release from the same tag target.
      <https://github.com/CharlesHoskinson/foreman/releases/tag/v0.2.9.0>
- [x] Close post-release authority work. PR 26 merged as
      `e298d29835a9ac93f8ef0313143a0f6bff7e2324`.

## Explicit non-goals

- [x] Do not claim Gemini support.
- [x] Do not claim a complete Council review runtime.
- [x] Do not claim complete Python removal.
- [x] Do not publish an npm package.
- [x] Do not add formal or Tier 2 scope.
