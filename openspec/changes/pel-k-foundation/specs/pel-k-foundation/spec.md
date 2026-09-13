# Freeze the Pel K contract and toolchain

## ADDED Requirements

### Requirement: K01-001 Inventory closure

The inventory gate SHALL bind every current profile member, fixture, regression scenario, and normative source to an owner and distinguishing case.

#### Scenario: K01-001-P Accepted behavior

- **GIVEN** The released mapping audit and current source at the candidate commit.
- **WHEN** Extract tokens, AST tags, value tags, builtins, operations, diagnostics, limits, and continuation fields.
- **THEN** Pass only with zero missing members, zero duplicate ownership identities, and zero stale hashes.

#### Scenario: K01-001-N Distinguishing refusal

- **GIVEN** Add a builtin or delete a required fixture without updating its ownership row.
- **WHEN** The same requirement check runs.
- **THEN** Fail coverage. Do not shrink the denominator or accept a file-level link as executed coverage.

### Requirement: K01-002 Toolchain admission

The runner SHALL verify the frozen toolchain and declarative artifact admission before compiling either backend.

#### Scenario: K01-002-P Accepted behavior

- **GIVEN** A clean host with the exact locked tools and approved formal-artifact policy.
- **WHEN** Compile and execute a closed numeric smoke definition on LLVM and Haskell.
- **THEN** Record backend and executable hashes with each result. Both observations match the independent expected value.

#### Scenario: K01-002-N Distinguishing refusal

- **GIVEN** Change an executable hash or add a Python wrapper.
- **WHEN** The same requirement check runs.
- **THEN** Refuse admission. Missing tools are unavailable, never a successful skipped gate.

### Requirement: K01-003 Closed observation contracts

The harness SHALL validate versioned inputs, observations, and reports before comparing results.

#### Scenario: K01-003-P Accepted behavior

- **GIVEN** A done value, suspended request, and failed diagnostic with complete bindings.
- **WHEN** Roundtrip each closed record and compare numeric bits and closure graph identities.
- **THEN** Preserve source identity, options, counters, diagnostic locations, and ordered effect observations.

#### Scenario: K01-003-N Distinguishing refusal

- **GIVEN** Supply unknown fields, duplicate IDs, nonfinite data, or an invalid graph reference.
- **WHEN** The same requirement check runs.
- **THEN** Reject the record. Do not coerce malformed data into a Pel diagnostic or passing observation.

### Requirement: K01-004 Scoped execution

The runner SHALL enforce input, output, time, memory, and cancellation limits without invoking a shell or provider.

#### Scenario: K01-004-P Accepted behavior

- **GIVEN** A bounded run in a temporary directory containing spaces and metacharacters.
- **WHEN** Run the smoke case and interrupt a child that retains inherited streams.
- **THEN** Preserve exact arguments and reap owned descendants. Record interruption with no successful case count.

#### Scenario: K01-004-N Distinguishing refusal

- **GIVEN** Use a stale build cache, output flood, network-dependent tool, or definition import outside the lock.
- **WHEN** The same requirement check runs.
- **THEN** Refuse the run or stop it within its bound. Never reuse another definition digest.

### Requirement: R-M7-001 Pinned profile and executable syntax

When the K semantics toolchain is selected, the semantics harness SHALL record its exact K revision, backend, executable hashes and Pel profile digest before compiling.

#### Scenario: T-M7-001

- **GIVEN** Pinned K7.1.337 and a mismatched executable hash.
- **WHEN** Compile a closed arithmetic definition, then repeat with the mismatched lock.
- **THEN** The matching toolchain executes the example; the mismatch is unavailable, never a passing skipped run.
