## Specification

- [x] 1. Recover the native Codex baseline and inspect the other provider boundaries.
- [x] 2. Scrape and verify the scoped official OpenBao documentation.
- [x] 3. Obtain approval for the local synthetic pilot direction.
- [x] 4. Write the design and EARS acceptance requirements.
- [x] 5. Obtain review of the written specification.
- [x] 6. Write the implementation plan with exact files, interfaces, and test commands.

## Implementation after written review

- [x] 7. Establish affected-module baseline tests and official OpenBao binary provenance.
- [x] 8. Implement strict references and credential records with failing tests first.
- [x] 9. Implement the bounded KV client and restricted host broker.
- [x] 10a. Implement the disposable server controller and compiled fake-worker entry point.
- [ ] 10b. Integrate the fake worker into P07 and prove its success and failure leakage boundaries.
- [ ] 11. Run experiments P01 through P11 from the canonical design.
- [x] 12a. Run strict type checks and affected-module regressions for the delivered partial pilot.
- [ ] 12b. Repeat verification after the remaining experiments and worker integration are complete.
- [ ] 13. Review sanitized evidence and record remaining provider-specific gates.

The Fable correction package covers the ten interim audit findings; see
[the candidate evidence](../../../docs/releases/return-of-the-foredi/fable-corrections-2026-09-15.md).
It does not complete task 11: P04/P07/P08/P09/P11 remain not-run.
The final-hardening package records 66 passing affected tests with verified binary pins and zero skips.
See [the final-hardening evidence](../../../docs/releases/return-of-the-foredi/openbao-final-hardening-2026-09-15.md).
These scoped completions do not admit the manager, native lifecycle, migration, or release.

## Explicitly separate work

- [ ] 14. Specify production bootstrap, TLS, unseal ownership, and recovery.
- [ ] 15. Establish single-owner native refresh for each provider.
- [ ] 16. Qualify Codex, Grok, Claude, and AGY through their actual transports.
- [ ] 17. Approve and execute live credential migration with recovery procedures.

## Production contract reconciliation

Use [the production contracts](../../../docs/superpowers/specs/2026-09-15-openbao-production-contracts.md) for production task interfaces and acceptance ownership.
WSL and Linux require separate production qualification with equal credential security gates.
Schema 1 requires explicit migration. Managed removal writes a schema 2 CAS tombstone.
Raw pilot soft deletion remains historical fixture behavior. It cannot implement managed removal or recovery authorization.
Accept pure Task 1A and Task 2A independently. Require dependency-specific briefs before later implementation.
Missing operator ownership, recovery objectives, host test authority, or provider ownership blocks the affected live qualification.
Keep existing unchecked tasks and historical receipts unchanged until candidate-scoped evidence satisfies them.
