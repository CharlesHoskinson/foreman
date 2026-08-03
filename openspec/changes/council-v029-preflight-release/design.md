# Design

## Release boundary

The release contains one self-contained ESM executable. The executable runs on Node.js 24.

The executable reads one bounded request from stdin. It writes one strict result to stdout.

Council compiles the ACE contract before it starts a provider process. A compile failure returns a typed prompt failure.

Foreman selects one closed provider family. Google fails before dispatch because the release has no Gemini adapter.

The Node runtime normalizes relative host paths before artifact access or
provider dispatch. It resolves `cwd`, the observed diff path, and artifact
paths against the CLI invocation directory. It does not change the provider
executable value.

The canary materializer binds the exact challenge nonce in the provider
response schema. The host still verifies nonce equality after terminal
classification and strict response decoding.

## Evidence flow

1. Build the executable from the exact candidate commit.
2. Run the local Council check from an absent bundle.
3. Normalize all relative host paths at the Node runtime boundary.
4. Bind the challenge nonce in the canary response schema.
5. Run bounded canaries for Grok, Claude, and Codex.
6. Run one external repository workflow through Foreman.
7. Obtain a different-family audit for the external change.
8. Pass the target repository gate.
9. Preserve the Council shadow outcome without promoting a non-token-bound
   audit to a Council verdict.
10. Pass hosted Linux and Windows gates on the exact candidate.
11. Build the knowledge graph from the same candidate.

## Failure policy

A provider failure is infrastructure state. It is not approval, dissent, or abstention.

A `quorum_not_met` Council shadow outcome is not release approval. Council is
advisory. Foreman gates remain the release authority.

Gemini is outside this release. A Google request returns one static dispatch failure.

The release does not tag a commit with a missing criterion.
