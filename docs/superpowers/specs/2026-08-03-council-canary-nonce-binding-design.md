# Council Canary Nonce Binding Design

## Problem

The canary prompt tells a provider to copy the challenge nonce. The response
schema accepts any nonblank nonce and the host rejects a mismatch later.

Claude Sonnet 5 returned `"nonce":"refused"` in two bounded canaries. Both
terminal records completed successfully with designated structured output.

## Decision

Bind the exact challenge nonce in the generated canary response schema. Use one
string enum value for the `nonce` property.

Keep the host-side strict response decoder and nonce equality check unchanged.
The provider schema is a constraint. The host remains the verification
authority.

## Schema identity

The canary-response schema hash identifies the exact schema bytes. A new nonce
therefore produces new schema bytes and a new hash.

The review-response schema hash remains independent. The ready token continues
to bind the review-response schema, not the canary-response schema.

## Verification

Tests prove these conditions:

- The response schema includes the exact nonce enum.
- The same challenge produces identical schema bytes and hashes.
- Different nonces produce different schema bytes and hashes.
- Existing host nonce equality checks remain unchanged.

A fresh Claude relative-path canary proves the complete runtime path.
