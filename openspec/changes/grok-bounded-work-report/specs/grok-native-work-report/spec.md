# Grok native work and report

## ADDED Requirements

### Requirement: One bounded effect

WHEN Foreman admits native coding, the adapter SHALL retain one effect, deadline, reservation, and total resource envelope across coding and reporting.

#### Scenario: Reporting uses remaining resources

- **GIVEN** coding consumed part of the admitted allowance
- **WHEN** reporting becomes eligible
- **THEN** reporting receives only the remaining allowance
- **AND** no new phase resets any counter or extends the deadline

### Requirement: Supported hard resource limits

IF the native runtime cannot enforce an admitted hard limit, the adapter SHALL reject dispatch before a paid request.

#### Scenario: Token or monetary enforcement is unavailable

- **GIVEN** the selected runtime cannot establish an aggregate token or monetary cap
- **WHEN** the adapter checks admission
- **THEN** it returns an unsupported-capability result
- **AND** it starts no model request

### Requirement: Evidence-based phase transition

WHEN coding terminates successfully, Foreman SHALL confirm process cleanup and capture immutable candidate evidence before reporting.

#### Scenario: Late effects remain possible

- **GIVEN** the coding process has returned text
- **AND** owned descendants remain active or final file identity is unknown
- **WHEN** the adapter considers reporting
- **THEN** it refuses the phase transition
- **AND** it preserves an incomplete outcome

### Requirement: Reporting has no coding authority

WHILE reporting is active, the host SHALL deny workspace tool execution and provide no writable source mount.

#### Scenario: Reporter requests an edit

- **GIVEN** a reporting process with immutable evidence
- **WHEN** it requests an edit or command
- **THEN** the host denies execution
- **AND** no permission from the coding phase is reused

### Requirement: Exact terminal report

WHEN reporting ends, the adapter SHALL validate structured terminal metadata against the exact schema and observed reporting identity.

#### Scenario: Valid-looking progress is not a result

- **GIVEN** progress contains a JSON object that matches the schema
- **AND** terminal structured metadata is absent or invalid
- **WHEN** the adapter validates the report
- **THEN** it returns failure rather than extracting progress JSON

### Requirement: Unknown usage remains unknown

IF usage is missing, incomplete, duplicated, or inconsistent, the adapter SHALL preserve that uncertainty without replenishing resources.

#### Scenario: Native cost is omitted

- **GIVEN** a native response without a complete cost receipt
- **WHEN** Foreman reconciles the effect
- **THEN** it does not assign zero cost
- **AND** it does not substitute public API prices for native billing evidence

### Requirement: Cancellation prevents further work

WHEN cancellation, exhaustion, or an unknown coding outcome occurs, the adapter SHALL start no reporting process.

#### Scenario: Deadline expires between phases

- **GIVEN** coding has ended
- **AND** the original deadline has expired
- **WHEN** reporting is considered
- **THEN** no second process starts
- **AND** the original candidate evidence remains available as incomplete work

### Requirement: Report claims do not confer acceptance

The host SHALL derive candidate, verification, review, and publication status from their existing independent evidence mechanisms.

#### Scenario: Grok claims success without an edit

- **GIVEN** a schema-valid report claiming completion
- **AND** the required file change is absent
- **WHEN** Foreman evaluates the coding qualification
- **THEN** the qualification fails
- **AND** no product acceptance or publication authority is created

### Requirement: Native request veto precedes transmission

WHEN a configured trusted request authority denies a sampler request, the native runtime SHALL return a typed denial before HTTP execution.

#### Scenario: Streaming or nonstreaming request is denied

- **GIVEN** a trusted local authority that denies the outgoing request
- **WHEN** either sampler HTTP execution method is reached
- **THEN** the local test server observes zero requests
- **AND** the denial contains no request headers, credentials, URL, or body content

### Requirement: Admission denial is terminal

WHEN native sampling returns an admission denial, recovery SHALL preserve the denial without retry, authentication recovery, salvage, or compaction.

#### Scenario: Denial occurs near a context limit

- **GIVEN** an admission denial and a context state that would otherwise trigger compaction
- **WHEN** shell recovery handles the failure
- **THEN** it returns the typed denial before starting recovery work

### Requirement: Partial admission hooks do not confer budget capability

The host SHALL require qualified end-to-end budget enforcement before it admits a bounded native workload.

#### Scenario: Only the local request veto is implemented

- **GIVEN** a tested sampler veto without qualified session propagation or native billing bounds
- **WHEN** Foreman considers native dispatch
- **THEN** it retains its unsupported-capability result
- **AND** no fixture result substitutes for live budget qualification

### Requirement: Sampler reconstruction preserves trusted authority

WHEN native code rebuilds an admitted sampler configuration, it SHALL preserve the same in-memory request authority.

#### Scenario: Session or model configuration is rebuilt

- **GIVEN** a sampler configuration with a trusted request hook
- **WHEN** session reconstruction, model selection, subagent override, or auxiliary sampler routing rebuilds that configuration
- **THEN** the rebuilt configuration retains the same authority object
- **AND** the rebuild does not create a separate resource allowance

### Requirement: Persisted configuration does not create authority

WHEN native code reads persisted or catalog configuration, it SHALL NOT derive a request authority from that data.

#### Scenario: Configuration is restored without a trusted host binding

- **GIVEN** serialized sampler settings without a trusted in-memory authority
- **WHEN** native code restores those settings
- **THEN** the settings do not create an admission hook
- **AND** Foreman refuses bounded dispatch until the host establishes every required native boundary

### Requirement: Direct auxiliary requests require budget coverage

IF an auxiliary request lacks a qualified resource boundary, the host SHALL treat its budget coverage as unqualified.

#### Scenario: Tokenizer or web-search traffic uses a separate HTTP client

- **GIVEN** working sampler-hook propagation
- **AND** an auxiliary HTTP client outside that hook
- **AND** no qualified alternative resource boundary for that client
- **WHEN** Foreman evaluates complete native budget support
- **THEN** hook-propagation tests do not qualify the auxiliary client
- **AND** Foreman retains its unsupported-capability result until every required path has qualified enforcement
