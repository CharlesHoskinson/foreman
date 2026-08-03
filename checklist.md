# v0.2.9.0 release checklist

This checklist is the current release authority. Evidence must name one exact candidate commit.

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

- [ ] Pass one bounded live Grok canary on the candidate commit.
- [ ] Pass one bounded live Claude canary on the candidate commit.
- [ ] Pass one bounded live Codex canary on the candidate commit.
- [ ] Preserve candidate-bound provider-neutral receipts without secrets.

## External dogfood

- [x] Run Foreman against a repository other than Foreman.
- [x] Produce one substantive Grok worker commit.
- [x] Obtain one independent different-family audit.
- [x] Pass the target repository native gate.
- [x] Preserve the Council shadow outcome for the exact external diff. The
      outcome is `quorum_not_met`; it is not approval or a release gate.

## Exact-candidate gates

- [ ] Pass the hosted Linux gate on the final candidate. The provisional
      `04e42be` workflow passed.
- [ ] Pass the hosted Windows gate on the final candidate. The provisional
      `04e42be` workflow passed.
- [ ] Pass the final local release gate.
- [ ] Rebuild the knowledge graph from the candidate commit.
- [ ] Validate graph integrity and current-source coverage.
- [ ] Publish current release notes, residuals, and cleanup records.
- [ ] Confirm that GitHub and local refs name the same candidate.

## Release actions

- [ ] Merge the accepted pull request.
- [ ] Re-run exact-main gates after merge.
- [ ] Create annotated tag `v0.2.9.0` only after all criteria pass.
- [ ] Publish the GitHub release from the same tag target.

## Explicit non-goals

- [x] Do not claim Gemini support.
- [x] Do not claim a complete Council review runtime.
- [x] Do not claim complete Python removal.
- [x] Do not publish an npm package.
- [x] Do not add formal or Tier 2 scope.
