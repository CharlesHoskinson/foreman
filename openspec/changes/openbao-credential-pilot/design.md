# OpenBao pilot design

The canonical design is [the written pilot specification](../../../docs/superpowers/specs/2026-09-15-openbao-credential-pilot-design.md).

The user approved the local synthetic pilot direction on 2026-09-15.
The user approved the written specification on 2026-09-15.

Use OpenBao KV v2 behind a host-side credential broker.
Give the fake worker only its selected synthetic access credential.
Keep administrative tokens, broker tokens, and refresh credentials outside the worker boundary.

Run a disposable loopback development server with synthetic values only.
Do not infer production security from this fixture.
Keep real provider profiles unchanged.

The existing CredentialPort remains the product boundary for later integration.
The first pilot uses an experimental harness and cannot qualify a live provider account.

Native refresh ownership, persistent deployment, and live migration remain separate changes.

The [Fable correction evidence](../../../docs/releases/return-of-the-foredi/fable-corrections-2026-09-15.md)
supersedes earlier green-count claims. Tests import source; compiled workspace inputs resolve to
source and record their exact hashes. Binary provenance binds an externally verified receipt
using independently supplied binary and receipt digests, not a controller claim of GPG verification.
Build and runtime Node identities are separate. The synthetic factory is a testing-only entry.
P10 includes tombstone semantics and recorded-generation new-material conditional recovery on the
disposable server. This is an ordinary KV update, not proof of manager maintenance authorization.
KV ACLs cannot distinguish it from refresh; manager lifecycle serialization remains deferred.
P05 records sealed and closed-endpoint responses; separate hanging-peer tests establish deadlines.
P04/P07/P08/P09/P11 remain not-run and pilotComplete remains false.

## Production contract reconciliation

Use [the production contracts](../../../docs/superpowers/specs/2026-09-15-openbao-production-contracts.md) for production task interfaces and acceptance ownership.
WSL and Linux require separate production qualification with equal credential security gates.
Schema 1 requires explicit migration. Managed removal writes a schema 2 CAS tombstone.
Raw pilot soft deletion remains historical fixture behavior. It cannot implement managed removal or recovery authorization.
Accept pure Task 1A and Task 2A independently. Require dependency-specific briefs before later implementation.
Missing operator ownership, recovery objectives, host test authority, or provider ownership blocks the affected live qualification.
Keep existing unchecked tasks and historical receipts unchanged until candidate-scoped evidence satisfies them.
