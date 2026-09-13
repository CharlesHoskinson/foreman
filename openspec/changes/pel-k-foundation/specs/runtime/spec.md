# Declarative Pel K artifact admission

## ADDED Requirements

### Requirement: K01-005 Narrow formal-artifact admission

Before adding K definitions, the foundation change SHALL adopt an explicit exception to the controlling Node.js TypeScript executable-source requirement.
The exception SHALL admit only declarative definitions and claims under formal/pel/**/*.k.
The implementation SHALL reconcile the controlling runtime contract and AGENTS.md before admitting those artifacts.
All repository runners, generators, comparators, tests, and resource owners SHALL remain strict TypeScript targeting Node.js 24.
The exception SHALL prohibit repository-authored foreign-language wrappers, executable snippets, and new product authority owners.
The architecture gate SHALL verify this exact scope and retain all historical controller pins.

#### Scenario: K01-005-P Admitted formal definition

- **GIVEN** An adopted runtime exception and a declarative formal/pel/values.k definition.
- **WHEN** The architecture gate compares the candidate to its merge base.
- **THEN** It admits the definition and its compiled Node.js TypeScript runner.

#### Scenario: K01-005-N Escaping the exception

- **GIVEN** A Python wrapper, a K source outside formal/pel, or a definition that invokes source-selected shell commands.
- **WHEN** The architecture gate evaluates the candidate.
- **THEN** It rejects the candidate without broadening the restored-controller admissions.
