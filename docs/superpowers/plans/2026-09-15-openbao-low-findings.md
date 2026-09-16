# OpenBao LOW finding corrections

Scope: The nine LOW findings in the final-hardening Fable audit.
The audit snapshot is `96a6facaf20981976dc70fe0f1e0a3da2bee519a41a0e1549de5bea0a3a618f0`.
This plan preserves historical evidence and the current release gates.

1. Replace immediate snapshot interruption with an observed filesystem-request boundary and a correct input digest.
2. Assert independent certificate trust and IP SAN properties for both IPv6 fixtures.
3. Exercise a token-service method through an explicit receiver closure.
4. Document callback, schema, HTTP status, CLI exit, provenance, and instrumentation contracts.
5. Add effective KV policy qualification requirements to the proposed CM08 design.
6. Run focused tests, the configured synthetic suite, typecheck, and relevant specification validation.
7. Freeze executable files for independent parent verification.
8. Record exact results and coverage limits in a new evidence report.

No production behavior change is planned. New tests check existing behavior.
Snapshot interruption coverage does not establish standalone partial-file cleanup.
The controller owns runtime cleanup. Existing phase tests check that ownership separately.
Manager implementation, full pilot acceptance, native integration, and release admission remain deferred.
