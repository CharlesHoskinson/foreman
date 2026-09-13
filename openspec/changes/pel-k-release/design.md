# Integrate CI, documentation, and release evidence: design

## Context and decisions

Install the exact toolchain during an explicit CI setup stage. Tests never install prerequisites. Run the fixed corpus and commit seed tier for changes to Pel, K, comparators, generators, codecs, proofs, or locks. Run the full generated tier, all mutants, and all claims for release candidates. Nightly jobs may extend the corpus, but cannot replace required candidate evidence.

Set initial per-case execution bounds to 30 seconds, compilation bounds to 15 minutes per backend, and per-claim proof bounds to 30 minutes. Limit stdout and stderr separately to 8 MiB. Cap each K process at 8 GiB memory. Fail with an explicit incomplete status on exhaustion. Budget changes require a reviewed manifest change and fresh candidate evidence.

Package a source archive, toolchain lock, corpus and coverage manifests, proofs and logs, claim register, correspondence report, checksums, licenses, and the user guide. Keep K out of the mandatory production install. Compare deterministic source/package bytes across two clean environments. Proof logs may contain timings, so compare semantic result bindings separately from raw log hashes.

Choose numerical release identity only through the existing release program. A K1 artifact acceptance record cannot satisfy unrelated v0.5 P1-P15 predicates. Preserve code-reduction cleanup as its separate release. Publication requires an immutable candidate, authorized release journal, independent cold audit, annotated tag, remote asset checks, and postpublication target equality.

The release notes must embed the selected artwork and attach its bytes. Verify the image URL anonymously after publication. Reuse the existing ForeDi image only with an accurate caption that distinguishes it from newly commissioned K artwork.

## File ownership

- `.github/workflows/pel-k.yml`
- `formal/pel/release-manifest.schema.json`
- `packages/orchestration/src/pel-semantics-release.ts`
- `packages/pel/test/k/release.test.ts`
- `docs/guides/pel/semantics.md`
- `docs/guides/pel/k-mapping-audit.md`
- `docs/guides/pel/k-mapping-audit.json`
- `docs/releases/pel-k/README.md`
- `docs/releases/pel-k/RELEASE-NOTES.md`
- `README.md`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-release`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.
