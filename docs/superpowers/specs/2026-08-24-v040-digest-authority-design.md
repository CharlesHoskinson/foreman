# v0.4 Digest Authority Design

## Goal

Remove private-key signing from the v0.4 release path. Use canonical evidence
digests and Endstop registration as the release authority.

## Scope

This change removes the unfinished Task 3.3 signing-fixture scaffold. It also
removes Ed25519 receipt issuance and verification requirements from the v0.4
OpenSpec design, policy types, and tests.

Cryptographic receipt signing is deferred beyond v0.4. No v0.4 command accepts
a private-key path. No v0.4 test requires access to a private key.

## Authority model

Each evidence file uses canonical JSON with one trailing LF. The policy hashes
the complete file bytes with SHA-256.

Endstop registration stores the exact evidence-bundle digest. Admission
requires the caller bundle digest to equal the registered digest. Admission
also validates the root, family, child, package, action, candidate, receipt
order, OpenSpec manifest, and task-plan identities.

The ledger remains the mutable authority boundary. Canonical bytes and digests
provide content identity. Git checks provide candidate and historical-source
identity.

## Components

1. `release-authority.ts` keeps closed schemas, canonical framing, bounds,
   source binding, and manifest validation.
2. Authority objects no longer contain signer fingerprints or signatures.
3. `release-admission.ts` evaluates canonical evidence and exact registration.
4. Endstop stores bundle and receipt digests. It does not store signer data.
5. Release CLIs do not issue signatures and do not read private keys.

## Migration

Delete the unfinished `release-admission.test.ts` signing-recipe scaffold.
Replace it with digest-only admission tests before admission implementation.

Update the active OpenSpec design and task plan in the same correction series.
Do not rewrite Git history. Preserve prior commits as superseded evidence.

## Failure behavior

Malformed or noncanonical evidence returns `invalid_evidence`. A digest mismatch
returns `registration_mismatch`. Git loader failures return
`git_resolution_failure`.

The policy returns closed results. It does not expose raw paths, bytes, or
dependency errors.

## Verification

Run the focused release-authority and release-admission tests. Run the policy
and orchestration typechecks. Run strict OpenSpec validation. Run the full
release gate before integration.
