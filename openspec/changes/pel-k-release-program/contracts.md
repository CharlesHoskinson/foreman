# Shared Pel K implementation contracts

Status: **PROPOSED**. These interfaces must be implemented by K01 before downstream dispatch.
All paths and commands in this file are planned, except existing repository build and validation commands.

## Identity and schema rules

Use UTF-8 JSON with closed records and explicit schema versions.
Reject unknown fields, duplicate object keys, duplicate IDs, invalid Unicode, nonfinite numbers, and out-of-bound values.
Hash exact source and artifact bytes with SHA-256.
A source digest alone does not cover normative profile decisions, tools, or the comparator.
Bind each of those inputs separately through the transitive manifest.

The identity envelope contains schema, candidateCommit, profileId, profileDigest, sourceDigest, registryDigest, optionsDigest, and inputManifestDigest.
A case identity additionally binds caseId, expectedDigest, hostScriptDigest, and its oracle class.
Oracle classes are independent-fixture, metamorphic-property, and differential-only.
The fixed required corpus uses independently reviewed expectations.

## PelKInputV1

Store the schema at formal/pel/host-script.schema.json.
Fields: identity, sourceBytesBase64, profileLimits, options, registry, receipts, schedule, and entry.
Entry is source or validated-ast. Validated-ast cases never contribute source-parser coverage.
A host schedule identifies semantic suspension boundaries and the ordered receipt IDs supplied at each boundary.
An absent receipt remains absent. No timer or random provider result supplies it implicitly.
All registry and receipt shapes follow the current public M1 contract, including contextual binding checks.

## PelKObservationV1

Store the schema at formal/pel/observation.schema.json.
Fields: identity, state, value, diagnostic, counters, trace, ready, pending, consumedReceipts, continuation, and comparisonPolicyId.
State is exactly done, suspended, or failed.
Done requires value and no diagnostic. Suspended requires a continuation and no final value.
Failed requires a diagnostic. Preserve optional failed continuation state when the profile provides it.
Use explicit null for absent observation components rather than silently omitted fields.

Encode values as tagged trees with references for syntax and closure graphs.
Represent numbers with a 16-digit binary64 hexadecimal payload after profile-defined negative-zero normalization.
Preserve data tags, duplicate-key order, and list order.
Preserve pair presence in syntax and retain syntax locations.
Compare environment graphs with a cycle-safe, root-preserving bijection.
The bijection must preserve edge labels, alias sharing, cycles, defaults, and captured argument modes.
It may rename internal graph IDs only. It must not rename observable request or child identities.

Trace events distinguish semantic reductions, request emission, receipt consumption, print output, child allocation, merge, and terminal results.
K01 freezes event fields and the charge-table schema before K03 integration.
K03 labels its operations and initial debits. K04 completes the table and mechanically checks its rule coverage.
Ready entries retain request fields and alreadyEmitted/replayOnly flags.
Counters preserve sourceBytes, tokens, astNodes, syntaxDepthPeak, reductions, iterations, callDepthPeak, and valueBytesPeak.
The K rewrite count is separate.
A child-charge total used in a proof is a ghost projection derived from accepted merges, not a new production counter.
Diagnostic fields preserve public structured data and byte/scalar spans.
The comparison policy lists each permitted normalization and its adversarial control.
No dependent effects may be sorted or erased.

## PelKRunReportV1

Store the schema at formal/pel/report.schema.json.
Fields: identity, toolchainDigest, definitionDigest, runtimeDigest, comparatorDigest, corpusDigest, tier, cases, claims, artifacts, and outcome.
Definition digest covers all transitive imports and configuration files.
Runtime digest covers the actual TypeScript implementation and compiled artifact used by the run.
Artifact records contain relativePath, byteLength, sha256, and role.
Resolve paths within the report bundle and reject traversal, duplicates, symlinks escaping the bundle, or missing bytes.

Each case records declared, started, completed, expectedObservationDigest, actualObservationDigests, and result.
Case results are pass, mismatch, unavailable, timeout, interrupted, stuck, or tool-error.
Only a completed comparison can pass. A caught tool exception cannot become a Pel failed observation.
Claims use planned, executable, tested, proved, refuted, unknown, or unavailable plus a separate freshness verdict.
An interrupted or exhausted proof is unknown with an explicit reason.

Aggregate outcome is pass, fail, or incomplete.
Exit 0 requires pass. Exit 1 means a completed failing check. Exit 2 means incomplete or unavailable evidence.
A required release predicate accepts only exit 0 plus a valid, complete report.
No CLI exit status alone establishes a proof or conformance result.

## Planned compiled commands

The entry point is packages/orchestration/src/pel-semantics-main.ts.
The build adds skills/foreman/runtime/dist/pel-semantics.js through scripts/build-runtime.ts.
Every command writes a validated report beneath formal/out/pel-k/ unless --output selects another bounded directory.

| Command suffix after node skills/foreman/runtime/dist/pel-semantics.js | Behavior |
| --- | --- |
| inventory --check | Re-extract current source/member/scenario closure and reject drift |
| toolchain --check | Verify locked tools and both backend smoke results |
| check --suite PACKAGE --case REQUIREMENT --tier commit | Execute both scenarios for one requirement, including refusal controls |
| check --suite PACKAGE --tier release | Execute the package's full cases and its required evidence checks |
| conformance --tier commit | Fixed corpus plus 300 generated programs and their declared schedules |
| conformance --tier release | Fixed corpus plus 10,000 generated programs and their declared schedules |
| mutations --tier release | Execute all mandatory semantic and comparator mutants |
| prove --claim K-P01 | Check the named claim, witness, helper closure, and controls |
| prove --all-required | Check all ten K1 claims and controls |
| correspondence --check | Validate R, coverage bindings, boundary traces, and host assumptions |
| release --check --manifest PATH | Validate KG01-KG12 and candidate-bound applicable release evidence without publishing |
| reproduce --manifest PATH | Replay the supplied archived manifest in the admitted clean environment |

PACKAGE and REQUIREMENT refer to identifiers in coverage.json and the child specs.
A missing suite or unknown case is an error, not an empty successful selection.
The suite dispatcher verifies domain artifacts. It cannot satisfy a requirement solely by unit-testing its own report constructor.
Publication uses the existing authorized release mechanism after release --check passes.
Do not add an automatic publisher to this development harness.

## Change and freshness rules

Schema changes require a version change or an explicitly compatible addition under a reviewed contract decision.
A changed definition, source, profile, registry, tool, corpus, comparison policy, or lemma invalidates its dependent results.
Maintain a dependency DAG so affected proof and conformance records reopen mechanically.
Preserve historical evidence with its original identities.

## Case expansion and proof invocation

A logical case ID hashes program identity, options/mode, complete host schedule, and oracle identity.
The expected-observation digest is null for differential-only cases. Record the explicit oracle class rather than inventing an expectation.
Freeze the program-to-case expansion before execution, including both modes and every admitted receipt order.
The K07 design defines exact program, logical-case, and engine-execution denominators.
A release suite for pel-k-proofs must invoke prove --all-required and validate all witness and control results.
Unit checks of a claim register cannot satisfy the proof-suite result.
