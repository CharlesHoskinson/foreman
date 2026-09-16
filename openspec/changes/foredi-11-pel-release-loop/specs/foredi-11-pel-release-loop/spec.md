## ADDED Requirements

### Requirement: PL01 Existing execution owner

WHEN release work executes, Foreman SHALL use one existing Pel owner, Endstop authority, and durable journal for the run.

#### Scenario: Resume after interruption

- **WHEN** a run resumes from a persisted checkpoint
- **THEN** it retains candidate identity, completed receipts, and consumed counters

### Requirement: PL02 Bounded correction

WHEN candidate checks or review reject work, the loop SHALL attempt at most two authorized correction rounds.

#### Scenario: Correction exhausted

- **WHEN** two corrections fail to produce an approved candidate
- **THEN** the result is needs-action with reason correction-limit and no further dispatch

### Requirement: PL03 No progress stop

IF a correction produces no product change, THEN the loop SHALL stop with a typed needs-action result.

#### Scenario: No-change correction

- **WHEN** the worker returns no-change
- **THEN** no additional worker call occurs

### Requirement: PL04 Independent review

WHEN checks pass, the host SHALL admit a reviewer from a different provider than the implementer and bind review to that checked candidate.

#### Scenario: Same-provider review selection

- **WHEN** the configured reviewer and implementer share a provider
- **THEN** the host refuses review admission

#### Scenario: Explicit work-package auditor

- **WHEN** the OpenBao work package requires Fable 5.1
- **THEN** the host binds its audit to the exact claude-fable-5-1 profile, verified transport, and checked candidate
- **AND** an unavailable route leaves the audit pending without model substitution

### Requirement: PL05 Readiness and missing authority

IF readiness, evidence, or required authority is unavailable, THEN the loop SHALL preserve the blocker and start no unauthorized effect.

#### Scenario: Invalid setup result

- **WHEN** setup reports NOT-READY
- **THEN** the implementation queue remains empty

### Requirement: PL06 Secrets outside Pel

The Pel program SHALL carry only credential references and sanitized receipts, never credential material or bootstrap tokens.

#### Scenario: Credential operation evidence

- **WHEN** the host records a credential-management outcome
- **THEN** the Pel value and journal contain no secret bytes

### Requirement: PL07 No implicit publication

The completion loop SHALL stop after verification and review without publishing, tagging, pushing, or modifying live credentials.

#### Scenario: Approved package

- **WHEN** a candidate receives approved review
- **THEN** the program returns its delivery result without fm/publish

### Requirement: PL08 Dependency admission

WHEN a package depends on prior work, the host SHALL require accepted dependency evidence before admitting its implementation artifact.

#### Scenario: Unqualified credential foundation

- **WHEN** native lifecycle work requires an unfinished storage integration
- **THEN** the host refuses advancement and records the missing dependency

#### Scenario: Production credential admission gates

- **WHEN** production credential work lacks operator ownership, recovery objectives, account authority, host test authority, or required evidence
- **THEN** PEL SHALL refuse the affected live operation and preserve a sanitized blocker
- **AND** accepted pure and synthetic tasks MAY proceed within their explicit authority
- **AND** readback receipts SHALL contain only identity metadata and comparison outcomes without material or reusable credential digests
