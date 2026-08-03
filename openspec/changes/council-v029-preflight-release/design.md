# Design

## Release boundary

The release contains one self-contained ESM executable. The executable runs on Node.js 24.

The executable reads one bounded request from stdin. It writes one strict result to stdout.

Council compiles the ACE contract before it starts a provider process. A compile failure returns a typed prompt failure.

Foreman selects one closed provider family. Google fails before dispatch because the release has no Gemini adapter.

## Evidence flow

1. Build the executable from the exact candidate commit.
2. Run the local Council check from an absent bundle.
3. Run bounded canaries for Grok, Claude, and Codex.
4. Run one external repository workflow through Foreman.
5. Obtain a different-family audit for the external change.
6. Pass the target repository gate.
7. Preserve the Council shadow outcome without promoting a non-token-bound
   audit to a Council verdict.
8. Pass hosted Linux and Windows gates on the exact candidate.
9. Build the knowledge graph from the same candidate.

## Failure policy

A provider failure is infrastructure state. It is not approval, dissent, or abstention.

A `quorum_not_met` Council shadow outcome is not release approval. Council is
advisory. Foreman gates remain the release authority.

Gemini is outside this release. A Google request returns one static dispatch failure.

The release does not tag a commit with a missing criterion.
