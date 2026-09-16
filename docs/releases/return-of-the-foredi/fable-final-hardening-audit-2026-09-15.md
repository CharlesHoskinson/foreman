# Fable final-hardening audit assessment

The verified verdict is WARNING. There are nine low-severity findings and no high or medium findings.
Fable confirmed supporting implementation and tests for the preceding corrections.
This standalone advisory audit does not authorize release acceptance.

## Receipt

- Requested, initialized, and responding model: `claude-fable-5-1`.
- Terminal exit: 0. Permitted tool catalog verified. Session persistence disabled.
- Selected-file changes during review: none.
- Snapshot: `96a6facaf20981976dc70fe0f1e0a3da2bee519a41a0e1549de5bea0a3a618f0`.
- Prompt SHA-256: `e93aaa41f9a5632295427bef9c8d161f1353ee28e074d3e287ae1eb9bcd731fa`.
- Receipt: `/root/research/foreman-fable-final-hardening-nCvWmj/audit.json`.
- Receipt SHA-256: `12c788b00972f4ce761e93f14a11e35b105dc7dee5b2b3c8d56b656b3629f9a7`.

The parent independently checked these bindings and the unchanged-file observation.
The receipt remains immutable. Its verdict applies to the snapshot, not later corrections.

## Assessment and bounded follow-up

1. Strengthen the snapshot interruption test. Immediate interruption with a mismatched digest does not prove mid-I/O cancellation.
2. Strengthen the IPv6 fixture evidence. Closed error codes intentionally do not expose TLS internals.
3. Document the token callback contract. Callers must bind receiver-dependent methods or use an arrow closure.
   A detached method does not carry its original receiver; the store cannot infer that receiver.
4. Document the strict response schema and current status mapping. Future server compatibility needs explicit qualification.
5. Document CLI exit 1. Both incomplete execution and controller failure use it; consumers must inspect the report.
6. Bound provenance claims to loaded modules and the measured output. Esbuild configuration and resolution inputs are not a complete reproducible-build proof.
7. Document the trusted in-process instrumentation boundary. An option callback already has host execution authority; provenance does not sandbox it.
8. Preserve the historical documentation targets. All 125 local links resolved in the parent's check.
   The audit prompt omitted some historical records to reduce duplication. Their absence from that prompt is not a broken repository link.
9. Specify effective KV retention, expiration, and mandatory-CAS admission requirements for CM08.
   The proposed lifecycle must not rely on historical secret versions remaining available.

The fresh bounded follow-up owns tests and explicit contracts, not live migration or a new credential manager.
The exact Node 24.18 IPv6 normalization behavior was reproduced by parent and implementer.
The tool-free reviewer could not execute that reproduction. This is a review capability limit, not contradictory test evidence.

## Remaining gates

The [subsequent LOW corrections](openbao-low-findings-2026-09-15.md) are complete within their stated scope.
They change tests, comments, and documentation, not production behavior.
Parent verification passed 67 configured tests with no skips, whole-tree typecheck, and all five strict OpenSpecs.
The parent also reviewed the changes and verified the current compiled partial report and cleanup.
Fable has not audited these subsequent edits. The WARNING verdict above remains bound to its original snapshot.
Deterministic partial-read/write interruption coverage remains unproven; the test now states its actual boundary.

P04/P07/P08/P09/P11, manager implementation, native lifecycle, qualification, migration, and release acceptance remain open.
No live credentials or installed runtime changed in this correction package.
