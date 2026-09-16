# ForeDi credential manager and OpenBao operations: execution tasks

All unchecked work remains open. A specification is not an execution receipt.

- [ ] 1. Complete the existing approved openbao-credential-pilot Task 3. Verify binary identity, KV v2 ACLs, CAS races, seal and revoke behavior, worker leakage, and cleanup.
- [ ] 2. Add CredentialManagerPort and typed lifecycle capability results in packages/providers/src/credential-manager.ts with credential-manager.test.ts. Use docs/superpowers/plans/2026-09-15-openbao-authority.md for the bounded service task. Require fresh reads and no native fallback.
- [ ] 3. Extend packages/orchestration/src/pel-provider-live.ts with explicit OpenBao composition and fail-closed account resolution.
- [ ] 4. Add packages/orchestration/src/credential-cli.ts and credential-cli.test.ts. Integrate the existing Foreman router and package entry points.
- [ ] 5. Add bootstrap, least-privilege policy, audit, backup, unseal, and outage instructions to docs/guides/pel/openbao-credentials.md.
- [ ] 6. Run focused tests, npm run typecheck, packaged command tests, and independent cross-vendor review.

Task 2 must consume CredentialBackendIdentity without treating it as deployment attestation.
Task 3 must test unrecognized bao: references with zero fallback reads and zero worker launches.
Tombstoned account recovery remains a separately authorized future maintenance operation;
ordinary import must retain CAS0 semantics. These requirements do not mark the manager complete.

- [ ] 7. Add exact-account metadata/generation observation with separate least-privilege authority and no material output. Return current version, deletion/destruction status, and lifecycle generation.
- [ ] 8. Implement and verify the proposed single-key lifecycle envelope from design.md. Use CAS-advancing tombstone writes for managed deletion. Prove deletion-first, refresh-first, stale recovery, restart, strict state checks, administrative-deletion quarantine, and restricted-writer admission. The raw soft-delete operation cannot satisfy this gate.
- [ ] 8a. Qualify effective mount and key CAS, retention, and automatic-deletion policies for the deployed version. Prove current active and tombstone persistence, historical-pruning tolerance, and configuration-drift refusal. Do not depend on historical credential retention.
- [ ] 9. Bind production readiness to observed effective trust or explicit CA configuration and authenticated backend identity. Test relabeling refusal and anchor changes under an unchanged label.
- [ ] 10. Verify current-source build provenance for all packaged consumers. Test stale-artifact refusal, including direct invocation outside npm rebuild hooks.

## Production contract reconciliation

Use [the production contracts](../../../docs/superpowers/specs/2026-09-15-openbao-production-contracts.md) for production task interfaces and acceptance ownership.
WSL and Linux require separate production qualification with equal credential security gates.
Schema 1 requires explicit migration. Managed removal writes a schema 2 CAS tombstone.
Raw pilot soft deletion remains historical fixture behavior. It cannot implement managed removal or recovery authorization.
Accept pure Task 1A and Task 2A independently. Require dependency-specific briefs before later implementation.
Missing operator ownership, recovery objectives, host test authority, or provider ownership blocks the affected live qualification.
Keep existing unchecked tasks and historical receipts unchanged until candidate-scoped evidence satisfies them.

## Erasure policy closure and remaining implementation

- [ ] 11. Reconcile CM09 through CM14 with the approved erasure decision and verify the pure PEL specification with independent review.
- [ ] 12. Specify and implement the protected OpenBao installation/control store, identity reservations, and operation/epoch fencing. Test crashes at every transition.
- [ ] 13. Implement separately protected reconciliation authorization and exact-successor confirmation. Test manager-token clearance denial against real OpenBao.
- [ ] 14. Integrate observed control authority with production readiness and manager delivery. Prove sibling isolation and backend-wide refusal when control is missing.
- [ ] 15. Execute restart, administrative-erasure, delayed-writer, and reconciliation experiments with synthetic material and current-source provenance.

Task 11 closes the policy specification only. Tasks 12 through 15 remain production implementation and experiment gates.
Use `docs/superpowers/plans/2026-09-15-openbao-erasure-policy-closure.md` for Task 11.
