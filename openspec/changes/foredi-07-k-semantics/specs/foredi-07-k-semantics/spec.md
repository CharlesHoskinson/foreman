# Pel semantics in K

Status: **PLANNED**. These are future acceptance requirements; no K definition or proof is implemented by this change.

## ADDED Requirements

### Requirement: R-M7-001 Pinned profile and executable syntax

When the K semantics toolchain is selected, the semantics harness SHALL record its exact K revision, backend, executable hashes and Pel profile digest before compiling.

#### Scenario: T-M7-001

- **GIVEN** Pinned K7.1.337 and a mismatched executable hash.
- **WHEN** Compile a closed arithmetic definition, then repeat with the mismatched lock.
- **THEN** The matching toolchain executes the example; the mismatch is unavailable, never a passing skipped run.

### Requirement: R-M7-002 Pinned profile and executable syntax

When Pel source is parsed by the K definition, the definition SHALL produce the selected M1 syntax and source locations independently of the TypeScript parser.

#### Scenario: T-M7-002

- **GIVEN** Every lexical and grammar row in paper-v2.json, including escapes, quoted pairs, caret, malformed numbers and Unicode spans.
- **WHEN** Parse with K and TypeScript independently and compare normalized trees or diagnostic locations.
- **THEN** All selected syntax cases agree; unsupported syntax is a located rejection, not an assumed AST translation.

### Requirement: R-M7-003 Pinned profile and executable syntax

When numeric expressions execute, the K definition SHALL reproduce the finite binary64 and safe-integer restrictions of the selected Pel profile.

#### Scenario: T-M7-003

- **GIVEN** Negative zero,0.1+0.2,maximum safe integer,overflow,division by zero and out-of-range literals.
- **WHEN** Execute each expression and compare canonical tagged values or diagnostic codes.
- **THEN** Finite values agree bitwise after the profile normalization; invalid numbers reject. Unbounded K integers do not replace Pel numeric behavior.

### Requirement: R-M7-004 Values, closures and native control

When a Pel value or callable list is evaluated, the K definition SHALL preserve M1 tags, pair presence, nil, quoting and one-based selection.

#### Scenario: T-M7-004

- **GIVEN** Nil/empty list,standalone keyword,pair with explicit nil,quoted symbol,multiple indices,slices,index zero and missing key.
- **WHEN** Execute positive and distinguishing negative value fixtures.
- **THEN** Exact tagged values and selection errors match M1; syntax and closures cannot become ordinary host data.

### Requirement: R-M7-005 Values, closures and native control

When a closure is called, the K definition SHALL use its captured lexical environment and the selected argument-binding rules.

#### Scenario: T-M7-005

- **GIVEN** Shadowed capture,partial application,required versus nil-default parameter,strict/syntax arguments,mixed named/positional call and bounded recursion.
- **WHEN** Execute closure fixtures with distinct capture environments and deferred calls.
- **THEN** Default timing,capture identity,partial values and call errors match M1 without dynamic scoping.

### Requirement: R-M7-006 Values, closures and native control

When native control flow selects work, the K definition SHALL implement M1 non-strict branches, scoped loops, blocks and single-evaluation pipe injection.

#### Scenario: T-M7-006

- **GIVEN** If/case unselected host branch,for local scope,do/do-async,leading call chains,nested and repeated caret.
- **WHEN** Execute with a finite abstract host script and count emitted requests.
- **THEN** Only selected branches execute; pipe operands are evaluated once and source-defined scope is retained.

### Requirement: R-M7-007 Scheduling, bounds and diagnostics

When top-level dependencies become ready, the K definition SHALL reproduce ordered and automatic M1 evaluation with ready/already-emitted batches and the last-source result.

#### Scenario: T-M7-007

- **GIVEN** Independent requests with both receipt orders,dependent definitions,conflicting symbol bindings and a slow first expression.
- **WHEN** Run both M1 options and all bounded receipt schedules.
- **THEN** Request identity and ready batches agree; completion order does not change the selected last-source result. Permitted independent interleavings are compared explicitly.

### Requirement: R-M7-008 Scheduling, bounds and diagnostics

When a Pel semantic limit is reached, the K definition SHALL stop at the same pre-operation boundary and preserve the same counters as M1.

#### Scenario: T-M7-008

- **GIVEN** Source,token,AST,syntax depth,reduction,iteration,call depth and value-byte limits at N-1,N,N+1.
- **WHEN** Run limit boundary fixtures and repeat after serialization.
- **THEN** Counters and rejection boundaries agree; administrative K rewrites do not debit Pel counters.

### Requirement: R-M7-009 Scheduling, bounds and diagnostics

If execution encounters an invalid state or operation, then the K definition SHALL return a located domain diagnostic without inventing a host result.

#### Scenario: T-M7-009

- **GIVEN** Unknown symbol,arity/type errors,malformed closure graph,host failure and a deliberately stuck semantics rule.
- **WHEN** Execute invalid fixtures and remove one required rule in a temporary mutation definition.
- **THEN** Defined failures agree with M1; stuck/timeout/tool failure is harness failure, distinct from a Pel diagnostic.

### Requirement: R-M7-010 Abstract host effects

When a host expression suspends, the K definition SHALL emit a bounded abstract request and accept only its matching supplied receipt.

#### Scenario: T-M7-010

- **GIVEN** Two requests with separate IDs,success and failure receipts,print and natural-language predicate descriptors.
- **WHEN** Supply a finite data-only host script and project ordered boundary observations.
- **THEN** No provider or shell runs; requests,receipt consumption,pending sets and output observations match M1.

### Requirement: R-M7-011 Abstract host effects

If a receipt conflicts with source, registry, schema or request identity, then the K definition SHALL reject it without completing another request.

#### Scenario: T-M7-011

- **GIVEN** Wrong request/profile/registry,duplicate conflicting receipt,closure-bearing provider value and missing receipt.
- **WHEN** Inject each invalid receipt at the same suspension boundary.
- **THEN** Exact mismatches fail; missing external evidence stays suspended. No fabricated cancellation or authority is accepted.

### Requirement: R-M7-012 Abstract host effects

The K host model SHALL treat provider behavior, resource grants and publication authority as explicit external assumptions rather than derived language facts.

#### Scenario: T-M7-012

- **GIVEN** Abstract retry/race/checkpoint handlers and a publication-shaped ordinary data value.
- **WHEN** Execute request scripts with success,unknown and rejected host responses.
- **THEN** Only the supplied abstract response is modeled; no budget authority,remote completion or publication milestone is inferred from source data.

### Requirement: R-M7-013 Continuations and replay

When a suspended configuration is serialized and restored, the K definition SHALL preserve lexical values, pending identities, selected options and consumed counters.

#### Scenario: T-M7-013

- **GIVEN** Nested closures,syntax arguments,ready/already-emitted effects and malformed environment references.
- **WHEN** Roundtrip K state and the M1 continuation through the declared correspondence projection.
- **THEN** Equivalent configurations resume to identical observations; broken graph/profile bindings reject. Raw wire-byte equality is required only where explicitly specified.

### Requirement: R-M7-014 Continuations and replay

When completed-prefix replay or a source revision is modeled, the K definition SHALL preserve completed receipt bindings and the selected M1 replay boundary.

#### Scenario: T-M7-014

- **GIVEN** Completed pure prefix,pending suffix,changed executed effect argument,unchanged closure capture and changed options.
- **WHEN** Replay the retained prefix and compare accepted/rejected revisions with M1.
- **THEN** No completed host request is emitted twice; invalid revisions reject and original counters remain charged.

### Requirement: R-M7-015 Continuations and replay

When an M1 child continuation is allocated or merged, the K definition SHALL preserve one-based child identity and charge child counters exactly once.

#### Scenario: T-M7-015

- **GIVEN** Two child closures,duplicate merge,cancelled/failed child and nested child replay.
- **WHEN** Compare start-child and merge-child observations with the M1 public APIs.
- **THEN** Child identities,remaining limits and parent charges agree; M4 retry/race policy remains outside this language-model proof domain.

### Requirement: R-M7-016 Differential evidence and proof status

When differential conformance runs, the TypeScript harness SHALL compare independently specified expected observations, K execution and the existing M1 engine for every mapped fixture.

#### Scenario: T-M7-016

- **GIVEN** All paper-v2 rows and current M1 control,closure,limits,host,replay and child regression cases.
- **WHEN** Execute the closed corpus plus fixed-seed bounded programs using the same explicit host schedules.
- **THEN** Every included constructor has positive and negative cases; missing rows or mismatches fail and retain a minimal source/receipt counterexample.

### Requirement: R-M7-017 Differential evidence and proof status

When conformance evidence is recorded, the TypeScript harness SHALL bind source, K definition, toolchain, runtime, corpus and comparator digests to executed case counts.

#### Scenario: T-M7-017

- **GIVEN** One real execution report,missing K executable,stale source hash and interrupted child process.
- **WHEN** Run and validate reports with finite timeout/output bounds and scoped cleanup.
- **THEN** Only actually executed cases count; missing prerequisites are unavailable, interrupted cases incomplete, and stale evidence cannot pass.

### Requirement: R-M7-018 Differential evidence and proof status

When a semantic mutation changes a required rule, the conformance suite SHALL detect the changed observable behavior.

#### Scenario: T-M7-018

- **GIVEN** Mutations make indexing zero-based,evaluate both if branches,recapture closures dynamically,duplicate pipe effects or reset replay counters.
- **WHEN** Run each temporary mutation against its distinguishing unchanged fixture.
- **THEN** Every mutation is detected; merely parsing or compiling a definition cannot pass conformance.

### Requirement: R-M7-019 Differential evidence and proof status

When a mechanized claim is assessed, its claim record SHALL name its domain, assumptions, exact semantics digest, backend and checked result separately from differential evidence.

#### Scenario: T-M7-019

- **GIVEN** Claims for at-most-once receipt consumption and nondecreasing counters in a finite closed host-script domain,plus a deliberately false invariant.
- **WHEN** Use the pinned proof backend for the selected claims; retain counterexample,timeout or unsupported results.
- **THEN** Only discharged scoped claims say proved; the false control is not proved. No full TypeScript/K equivalence,host safety or termination theorem is inferred.

### Requirement: R-M7-020 Differential evidence and proof status

The semantics guide SHALL distinguish planned work, executable definitions, conformance evidence, mechanized claims and open correspondence assumptions.

#### Scenario: T-M7-020

- **GIVEN** No implementation,trace-only results,scoped proof results and a changed semantics digest.
- **WHEN** Render the status table and verify linked claim/trace artifacts and changed-domain invalidation.
- **THEN** PLANNED remains the current sprint state until implementation evidence exists. Changed semantics reopen affected claims; historical evidence remains intact.
