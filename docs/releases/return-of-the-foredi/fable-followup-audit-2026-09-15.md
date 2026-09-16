# Fable follow-up audit assessment

The verified verdict is WARNING for snapshot
`5fb80f832e7e741bdb1f6f0808a8fde350eca36ef8a1fb1cea66f06f062948c9`.
Fable found supporting code or tests for all ten original and nine follow-up concerns.
It found no high or critical defect and raised two medium and seven low concerns.
This is a standalone advisory audit, not release acceptance.

## Receipt

- Model requested, initialized, and responding: `claude-fable-5-1`.
- Exit: 0. Permitted tool catalog verified; no host tools or session persistence.
- Selected-file changes during review: none.
- Prompt SHA-256: `7f477f223d98ee7996841b838f4969f5836326fcc38d51d8673b004bac7fe7b5`.
- Receipt: `/root/research/foreman-fable-followup-audit-yY0UIh/audit.json`.
- Receipt SHA-256: `f34989173b010a6b2ef3e2dfcd67d471ede1144ff84481c4db5a4e967c2c3bca`.

The parent independently checked identity, terminal status, prompt and snapshot hashes,
and the unchanged-file observation. The complete verdict remains unchanged in that receipt.

## Actionable corrections

1. Specify an implementable single-key lifecycle design. Managed deletion must advance CAS through
   a tombstone write; raw soft deletion cannot fence a stale refresh writer. Manager implementation
   remains deferred and requires restricted mutation authority, state checks, and race tests.
2. Compare every esbuild metafile input against captured hashes. Reject uncaptured inputs and
   workspace dist independently of filename extension. Test an extension outside the old filter.
3. Derive pilotComplete from the exact P01–P11 outcome set. Do not implement the deferred full
   evidence validator or relabel unexecuted scenarios.
4. Test an actual child spawn error, separately from the permission precheck.
5. Distinguish private-snapshot I/O failure from an integrity mismatch with closed errors.
6. Correct IPv6 literal hostname handling without disabling TLS verification.
7. Reconcile completed scoped tasks and obsolete binary environment-variable documentation.

## Qualified advisory boundaries

The system trust label is explicitly configuration metadata, not trust-store attestation or readiness.
Relabeling alone does not authorize delivery. The manager remains unimplemented. Its readiness design
must require observed effective trust configuration or explicit CA anchors and authenticated backend
identity. This requirement must not be presented as a delivered trust manager.

The compiled package entry is an existing repository contract. The root package.json already rebuilds
providers through pretest, pretest:providers, pretest:pel-authoring, pretest:adoption, and build scripts.
The statement that only the pilot mitigates stale provider bundles omits these supported hooks.
Direct invocation can bypass those hooks; the guide must name that boundary. Runtime @foreman/core
imports resolve to current src/index.ts, not a compiled dist. Broader release admission still needs
current-source artifact evidence, but changing all package exports is not justified by this finding.

Unknown .node or .wasm imports may fail esbuild rather than silently bundle. The input-manifest gap
must be demonstrated with a supported input and fixed, without repeating an unobserved bypass claim.

## Next gate

The [final hardening plan](../../superpowers/plans/2026-09-15-openbao-final-hardening.md)
covers the seven corrections and two advisory dispositions. Preserve every previous verdict.
Fresh verification and independent review remain required. No live account, native lifecycle,
full-pilot, or release completion claim follows from the 57-test candidate.
