# ForeDi native credentials for AGY, Codex, Claude, and Grok: execution tasks

All unchecked work remains open. A specification is not an execution receipt.

- [ ] 1. Capture supported native interfaces for each installed vendor without importing credentials or refreshing accounts.
- [ ] 2. Bind managed setup and execution to the same OpenBao credential manager and selected reference. Test generation changes and unavailable records without native fallback. Preserve explicit unmanaged native and profile routes until approved cutover.
- [ ] 3. Implement provider adapters in packages/providers/src/credentials/{agy,codex,claude,grok}.ts and corresponding .test.ts files.
- [ ] 4. Implement host refresh ownership in packages/orchestration/src/credential-refresh-owner.ts and its cross-process tests.
- [ ] 5. Implement migration state transitions in packages/orchestration/src/credential-migration.ts with interruption and recovery tests.
- [ ] 6. Run synthetic lifecycle and worker-boundary tests for all four providers.
- [ ] 7. After account-specific approval, run native qualification on selected accounts and bind sanitized results to exact versions, transports, candidate, and host.
- [ ] 8. Obtain independent security review. Keep unsupported required native operations as release blockers.
- [ ] 9. Bind refresh, deletion, and recovery to the proposed CM08 single-key lifecycle envelope. Verify stale-owner refusal after CAS-advancing deletion, administrative-deletion quarantine, owner crash, and nonparticipating-native-writer refusal. Prove provider-side ownership separately before migration.

## Production contract reconciliation

Use [the production contracts](../../../docs/superpowers/specs/2026-09-15-openbao-production-contracts.md) for production task interfaces and acceptance ownership.
WSL and Linux require separate production qualification with equal credential security gates.
Schema 1 requires explicit migration. Managed removal writes a schema 2 CAS tombstone.
Raw pilot soft deletion remains historical fixture behavior. It cannot implement managed removal or recovery authorization.
Accept pure Task 1A and Task 2A independently. Require dependency-specific briefs before later implementation.
Missing operator ownership, recovery objectives, host test authority, or provider ownership blocks the affected live qualification.
Keep existing unchecked tasks and historical receipts unchanged until candidate-scoped evidence satisfies them.
