# Implement closures, arguments, and control

## ADDED Requirements

### Requirement: K03-001 Lexical closures

The closure rules SHALL preserve lexical capture, default timing, partial application, and graph sharing.

#### Scenario: K03-001-P Accepted behavior

- **GIVEN** A closure captured before shadowing, a nil default, a required parameter, and a partial application.
- **WHEN** Invoke each closure after its surrounding environment changes.
- **THEN** Use the captured environment and the declared default-evaluation phase.

#### Scenario: K03-001-N Distinguishing refusal

- **GIVEN** Supply malformed environment references or exceed the profile recursion restriction.
- **WHEN** The same requirement check runs.
- **THEN** Reject at the correct boundary without dynamic recapture or lost sharing.

### Requirement: K03-002 Argument binding

The argument rules SHALL implement every builtin signature and strict or syntax parameter mode.

#### Scenario: K03-002-P Accepted behavior

- **GIVEN** Each builtin ArgSpec with positional and named calls tested separately.
- **WHEN** Bind valid calls and exercise deferred syntax arguments.
- **THEN** Preserve required/default presence and evaluation order for every parameter.

#### Scenario: K03-002-N Distinguishing refusal

- **GIVEN** Mix prohibited named and positional arguments, duplicate names, or use incorrect arity.
- **WHEN** The same requirement check runs.
- **THEN** Return the exact argument diagnostic before forbidden argument effects execute.

### Requirement: K03-003 Native control

The control rules SHALL execute only selected branches and preserve the scope of loops and blocks.

#### Scenario: K03-003-P Accepted behavior

- **GIVEN** If and case with a host call in an unselected branch, plus scoped for and do forms.
- **WHEN** Run each control form with explicit host observations.
- **THEN** Unselected branches emit zero requests. Loop-local bindings do not escape.

#### Scenario: K03-003-N Distinguishing refusal

- **GIVEN** Move a definition outside its permitted scope or use an invalid condition type.
- **WHEN** The same requirement check runs.
- **THEN** Reject according to the profile without evaluating another branch as a fallback.

### Requirement: K03-004 Single evaluation pipes

The pipe rules SHALL evaluate each left operand once and preserve nested caret scope.

#### Scenario: K03-004-P Accepted behavior

- **GIVEN** A left operand that emits one host request and a right expression using caret twice.
- **WHEN** Execute ordinary, chained, and nested pipes.
- **THEN** Both caret references reuse one value and one effect identity.

#### Scenario: K03-004-N Distinguishing refusal

- **GIVEN** Use caret outside its scope or mutate the pipe rule to reevaluate the operand.
- **WHEN** The same requirement check runs.
- **THEN** Reject the first case. Detect duplicate effects in the mutation control.

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
