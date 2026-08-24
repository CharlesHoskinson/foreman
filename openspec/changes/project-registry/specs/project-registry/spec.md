# Project registry specification

## ADDED Requirements

### Requirement: Stable local identity

Foreman SHALL bind one project UUID to one physical Git common directory and
one SessionStore location. Linked worktrees with the same Git common directory
SHALL resolve to the same project UUID.

#### Scenario: Linked worktrees resolve

- **WHEN** two worktrees share one physical Git common directory
- **THEN** both worktrees resolve to one project UUID
- **AND** both worktrees resolve to one SessionStore

### Requirement: Backward-compatible registration

Existing session commands SHALL work without a registry record. Explicit
registration SHALL add project metadata without changing entity rows.

#### Scenario: An existing store registers

- **WHEN** the operator registers an existing project store
- **THEN** every existing entity remains byte-equivalent
- **AND** the registry records one project and operation UUID

### Requirement: Honest freshness

Foreman SHALL run freshness checks in the repository bound to the selected
store. Foreman SHALL return `unknown` when that repository is unavailable.

#### Scenario: Another repository is current

- **WHEN** an operator selects project A's store while standing in project B
- **THEN** Foreman does not use project B for the freshness result
- **AND** it returns `unknown` when project A has no valid registry binding

### Requirement: Closed registry storage

The registry SHALL use bounded canonical JSON under `FOREMAN_HOME`. It SHALL
reject linked files, unknown fields, duplicate keys, duplicate bindings, and
relative paths.

#### Scenario: A conflicting store registers

- **WHEN** a store or Git common directory already belongs to another project
- **THEN** registration refuses before mutation
- **AND** the existing registry bytes remain unchanged

### Requirement: Project-bound projections

Each external `EntityRef` and projection identity SHALL include `project_id`.
Rehydration SHALL use only the matching registered project store.

#### Scenario: Recall names the wrong project

- **WHEN** a semantic result contains another project UUID
- **THEN** Foreman does not rehydrate that result
- **AND** it reports the result as unavailable

### Requirement: No custom signing protocol

The project registry SHALL NOT create or consume private keys, signatures,
approval keys, or recovery keys.

#### Scenario: An operator registers a project

- **WHEN** the registration command succeeds
- **THEN** it writes only public project and store metadata
- **AND** it does not create key material
