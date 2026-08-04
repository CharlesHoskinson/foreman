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

- [x] Pass one bounded live Grok canary on the release commit. Exact-merge
      nonce-bound ready receipt.
- [x] Pass one bounded live Claude canary on the release commit. Exact-merge
      nonce-bound ready receipt.
- [x] Pass one bounded live Codex canary on the release commit. Exact-merge
      nonce-bound ready receipt.
- [x] Preserve release-bound provider-neutral receipts without secrets.

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
