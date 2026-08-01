## Purpose

Defines the sole source of Council authority through typed content classes, immutable task contracts, controlled amendments, and exact approvals.

## ADDED Requirements

### Requirement: Every model-bound field has an authority class
Council SHALL classify every field as `trusted_instruction`, `approved_contract`, `user_data`, `tool_metadata`, or `untrusted_evidence` before model use.

#### Scenario: Adapter returns an unclassified field
- **WHEN** a field has no valid authority class
- **THEN** Council excludes it from model context and records `authority_unclassified`

### Requirement: Task contracts are immutable and complete
Council SHALL canonicalize and hash a versioned task contract before workers see evidence, including roles, allowed outcomes, tool operations, resources, destinations, data classes, budgets, approvals, rubric, policy version, expiry, and evidence scope.

#### Scenario: Evidence requests a new recipient
- **WHEN** retrieved content proposes a recipient absent from the contract
- **THEN** Council denies the operation without changing the task contract

### Requirement: Authority changes create approved amendments
Council MUST represent any change to tools, resources, destinations, data classes, budget, or side-effect authority as a new contract version linked to its parent hash and explicit approval.

#### Scenario: Research discovers a necessary new domain
- **WHEN** work requires a destination outside the approved scope
- **THEN** Council pauses and requests approval for a new contract version before access

### Requirement: Approval binds exact normalized action data
Council SHALL bind approval to the normalized action, arguments, destination, policy version, contract hash, approver, and expiry.

#### Scenario: Destination changes after approval
- **WHEN** an approved action is changed to a different destination
- **THEN** Council invalidates the approval and requires a new one

### Requirement: Side-effect states are explicit
Council SHALL represent mutating operations as `not_started`, `in_flight`, `committed`, `compensated`, or `outcome_unknown` and MUST NOT collapse ambiguous outcomes into success or failure.

#### Scenario: Confirmation is unavailable
- **WHEN** Council cannot determine whether an external write committed
- **THEN** it returns `outcome_unknown` and blocks blind retry

### Requirement: Commitment decisions fail closed
Unknown policy, contract, approval, destination, capability, provenance, citation, or secret-scan status MUST block the related privileged operation.

#### Scenario: Policy engine is unavailable
- **WHEN** a privileged call cannot obtain a current policy decision
- **THEN** Council denies the call and records a typed fail-closed outcome
