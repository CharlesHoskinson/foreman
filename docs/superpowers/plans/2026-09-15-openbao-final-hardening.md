# OpenBao final hardening package

Use one complete test-driven correction implementer and independent review.
The user requested “Fix everything”. Preserve all previous audit and correction records.

## Evidence and ownership

Read /root/research/foreman-fable-followup-audit-yY0UIh/audit.json in full.
The exact Fable 5.1 verdict is WARNING, with evidence for all 19 preceding corrections,
no high or critical defect, and nine further concerns. Do not treat every inference as fact.

Worktree: /root/foreman-native-login-20260915. Read AGENTS.md and complete AGENT_TRAPS.md.
Use Node 24, TypeScript, Effect, and apply_patch. No new dependencies.
No commits, installed-runtime edits, live credentials, migrations, native transports, or qualification edits.
OpenBao remains the sole durable authority for managed credentials and lifecycle state.

Own OpenBao store/identity source and tests, pilot/controller/build/helpers/tests, guide,
pilot and foredi08/09 specs/plans/tasks. Add focused helpers/tests and a separate final-hardening
evidence document. Preserve previous fable audit/correction/follow-up records, parent ledger,
audit runner/config, and concurrent native-login files. Do not broaden package runtime packaging.

## Correct the actionable findings

1. Specify an implementable CM08 candidate, not an abstract impossible cross-key transaction.
   Use a future single-key versioned lifecycle envelope with active/tombstoned state. Managed deletion
   is a CAS-advancing tombstone WRITE, not the existing raw soft-delete operation. Refresh writes CAS
   the observed active version; deletion winning the CAS fences that writer. Recovery is an explicitly
   authorized CAS from the current tombstone to active with fresh material. Define race outcomes,
   restart behavior, metadata observation, and strict schema/state checks. All managed mutations go
   through the manager with restricted write authority. Out-of-band administrative soft deletion must
   quarantine/refuse, not recreate. Existing remove remains raw selected-version maintenance, usable
   for historical-version cleanup only after the lifecycle transition and never for normal managed
   deletion. This is an explicit proposed manager design and test gate, not a delivered implementation.
2. Make bundle provenance complete. Enable esbuild metafile and compare its complete input set against
   recorded hashes. Reject any missing/unexpected manifest input and any workspace dist input
   independently of filename extension. Handle .mts/.cts deliberately or reject them closed; unknown
   loaders must not silently bypass capture. Add a meaningful input-completeness negative control
   and an extension case. Unknown .node/.wasm currently may fail esbuild rather than bundle; preserve
   that qualification instead of asserting an unobserved bypass. Verify the actual build input set.
3. Derive pilotComplete from the exact required P01–P11 outcomes, with unique IDs, passed status and
   compatible passed flags. Test empty, missing, duplicate, unknown, failed and not-run cases, plus
   all eleven passed. This is not the deferred full evidence validator. Actual partial pilot stays false.
4. Exercise a real child spawn error, not only the executable permission precheck. Verify observeChild
   records spawnFailed true and controller failure/owned cleanup remain closed. Use disposable missing
   executable/interpreter fixtures and bounded children. Keep the existing precheck test named accurately.
5. Distinguish snapshot I/O failures from digest/provenance mismatches with a sanitized declared code.
   Add a disposable EEXIST/write-failure control and preserve caller interruption and cleanup.
6. Fix accepted HTTPS IPv6 literals so hostname brackets do not become a DNS query. Add meaningful
   validation/transport regression evidence and keep TLS certificate and hostname verification enabled.
7. Correct current task tracking and obsolete FOREMAN_PILOT_BAO_BINARY text. Check off only proven
   completed scoped work. Split or label compound server/fake-worker tasks if admission tests remain
   deferred. Do not mark P04/P07/P08/P09/P11 or release acceptance complete.

## Explicitly disposition the two advisory boundaries

8. systemTrustIdentity is a declarative policy label, not a certificate-store measurement. Do not
   claim it attests anchors or grants readiness. Require planned production readiness to bind an
   observed effective trust-store digest (or explicit CA bundle) and authenticated backend identity;
   arbitrary relabeling cannot substitute for qualification. Add concrete invalidation/refusal scenarios.
   Explain that conservative label changes do not by themselves grant authorization. Avoid implementing
   a new platform trust manager in this synthetic correction. If a small stronger binding is feasible,
   discuss it with the parent before changing the public contract.
9. Compiled package exports are the existing repository runtime contract. Do not replace the global
   packaging model to remove all need to build source. The pilot already excludes stale workspace dist.
   Record a separate production build/admission requirement that checks current-source provenance for
   all packaged consumers, with a stale-artifact refusal scenario. Qualify this as a broader release
   gate, not a new demonstrated store defect. Keep the existing compiled consumers compatible.

## Verification

Use focused RED/GREEN. Rebuild providers, run all affected suites with real-binary pins and zero skips,
default controller with explicit capability skip, whole-tree typecheck, strict affected specs and
tracked/untracked whitespace. Compile and execute from /tmp; verify complete build input coverage,
actual hashes, runtime identity, private snapshot/report mode, exit, cleanup, six passed/five not-run.

Binary /root/research/openbao-pilot-20260915-MYD9Qc/bao expected SHA256:
8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00.
Expected adjacent receipt SHA256:
d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef.
Do not derive expected trust values inside the verifier under test.

Report to .superpowers/sdd/openbao-final-hardening-report.md with exact evidence, all nine dispositions,
changed-file inventory, and remaining gates. Freeze executable files for parent checks, then all files
for the next independent review. No complete-release claim is authorized.
