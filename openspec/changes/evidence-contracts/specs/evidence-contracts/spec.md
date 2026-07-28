## ADDED Requirements

### Requirement: Artifact-based lane success predicate

WHEN a lane of any type (implement, audit, planning, research) completes a round, the orchestrator SHALL determine success solely from required artifacts and their content. The orchestrator SHALL NOT treat process exit code zero, substring matches against agent output, or the agent's own account of its state as sufficient conditions for marking the lane successful. "The agent said it succeeded" and "the process returned 0" SHALL NEVER be sufficient conditions for a successful lane outcome.

#### Scenario: Exit code zero with no required artifact

- WHEN a lane process exits with code 0 but a required output artifact is absent or empty
- THEN the orchestrator SHALL mark the round as failed (non-success) regardless of the exit code

#### Scenario: Agent self-report of success without corroborating artifacts

- WHEN agent output claims work is complete (e.g. "report ready", "files written") but the write-evidence digest or required artifacts do not corroborate that claim
- THEN the orchestrator SHALL mark the round as failed and SHALL NOT promote the lane to a successful terminal state

### Requirement: Write-evidence digest per round

WHEN a lane round starts and WHEN that round ends, the orchestrator SHALL compute a write-evidence digest over the workspace change state (in the family of git-status / changed-file-set / content-hash of tracked and untracked paths; e.g. a porcelain status stream hashed). An UNCHANGED digest across a round SHALL mean the lane produced nothing, REGARDLESS of what the lane reported about itself, and the orchestrator SHALL treat that outcome as a failure / non-success for that round.

#### Scenario: Digest changes after a productive round

- WHEN a lane round writes or modifies required deliverable files and the post-round write-evidence digest differs from the pre-round digest
- THEN the orchestrator MAY treat the round as having produced write evidence (subject to any additional artifact-content checks for the lane type)

#### Scenario: Digest unchanged after a claimed-success round

- WHEN a lane round completes with exit code 0 and self-reported success, but the post-round write-evidence digest equals the pre-round digest
- THEN the orchestrator SHALL treat the round as failed / non-success for lack of write evidence

### Requirement: Vendor- and lane-agnostic bounded evidence loop

WHERE a lane may need multiple attempts to produce qualifying write evidence, the orchestrator SHALL run a bounded re-prompt (evidence-loop) mechanism that applies to every vendor reachable via vendor-adapter-contract (grok, codex, claude, gemini, and others) and every lane type (implement, audit, planning, research). WHEN the configured round budget is exhausted without a qualifying digest change (and without other required artifact success criteria for that lane type being met), the orchestrator SHALL enter an explicit terminal failure state that is LOUD: visibly reported, blocks downstream gates, and never silently passes through as success. Per-vendor CLI argv shape remains owned by vendor-adapter-contract; this requirement owns only the evidence loop that rides on top of the adapter invocation.

#### Scenario: Qualifying digest change within budget

- WHEN a lane produces a changed write-evidence digest on a round within the configured budget
- THEN the evidence loop SHALL stop retrying for write-evidence reasons and SHALL allow downstream artifact checks for that lane type to proceed

#### Scenario: Round budget exhausted without digest change

- WHEN the round budget is exhausted and every completed round left the write-evidence digest unchanged
- THEN the orchestrator SHALL record a terminal failure state, SHALL surface it visibly in run status / reports, and SHALL block downstream gates that depend on that lane

### Requirement: Termination-reason capture for empty-burst vs cancelled-writes

WHEN a lane round ends with an unchanged write-evidence digest, the orchestrator SHALL capture and record the vendor-owned termination or stop reason (e.g. stopReason, cancellationCategory, or the equivalent field surfaced by the vendor CLI/API) alongside the digest result. Empty burst (narration-only / no tool calls) and cancelled writes (permission-gate blocked attempts such as PermissionCancelled for an unlisted tool verb) present identically from the outside (unchanged digest, exit 0); the orchestrator SHALL NOT attempt to infer which mode applied from the digest alone, and SHALL retain the captured termination reason so humans and downstream automation can distinguish the two after the fact.

#### Scenario: Empty burst with unchanged digest

- WHEN a lane produces no tool calls or only narration, exits 0, leaves the write-evidence digest unchanged, and the vendor termination reason indicates a normal/self stop without a permission cancellation
- THEN the orchestrator SHALL fail the round for unchanged digest and SHALL record the termination reason as evidence of empty-burst class failure

#### Scenario: Cancelled writes with unchanged digest

- WHEN a lane attempts writes that are blocked or cancelled by a permission gate, exits 0 or otherwise non-diagnostic, leaves the write-evidence digest unchanged, and the vendor termination reason indicates cancellation / permission denial
- THEN the orchestrator SHALL fail the round for unchanged digest and SHALL record the termination reason as evidence of cancelled-writes class failure, distinct from empty-burst

### Requirement: Scoped mutation probe on diff-touched lines

WHERE verification must catch defects that agent-written tests miss, checks-run.sh SHALL support a scoped mutation probe stage that mutates ONLY lines touched by the relevant diff (never the whole repository), re-runs the existing test suite against each mutant, and asserts that at least one test fails per mutant. WHEN a mutant survives (no test fails), the probe SHALL report that changed line as unprotected — a defect in test-suite coverage of the actual diff, not a product-code failure. Primary cadence: the mutation probe SHALL run at merge-gate time (and MAY be invoked optionally / on-demand outside that gate). It SHALL NOT be mandatory on every commit or every intermediate gate, because full per-changed-line mutation is too slow to gate every commit under the measured cost constraint; merge-gate is the justified primary cadence as a single high-value choke point where coverage of the integrated diff matters most.

#### Scenario: Mutant killed by existing suite at merge gate

- WHEN the merge-gate mutation probe mutates a diff-touched line and at least one existing test fails
- THEN the probe SHALL treat that mutant as detected (killed) and SHALL not flag the line as unprotected

#### Scenario: Surviving mutant reported as unprotected changed line

- WHEN the merge-gate mutation probe mutates a diff-touched line and the test suite still passes
- THEN the probe SHALL report an unprotected changed line for that mutant and SHALL fail or flag the mutation-probe stage accordingly

### Requirement: Co-requisite ownership boundaries

WHERE this package defines evidence contracts, it SHALL depend on vendor-adapter-contract for per-vendor CLI/argv construction and invocation mechanics, and SHALL depend on test-infrastructure-hardening for positive-control / checker-can-fail requirements. This package SHALL NOT re-specify adapter argv shape, flag names, or per-vendor invocation mechanics, and SHALL NOT restate the positive-control requirement for checks. Lane claims about their own state (files written, tests passing, work done) SHALL be corroborated by write-evidence digest and required artifacts (artifact-based evidence), which is the narrow evidence-contract instance of the broader vacuous-check problem class; the sibling package owns making checkers prove they can fail.

#### Scenario: Adapter invocation remains out of scope

- WHEN a new vendor is added under vendor-adapter-contract
- THEN the evidence-contracts package SHALL apply the same digest, termination-reason, and bounded-loop rules to that vendor without defining that vendor's argv or flags in this package

#### Scenario: Positive-control ownership remains with sibling package

- WHEN a checker predicate is vacuous or matches its own success string (e.g. grep for "violation" matching "[ok] No violation found")
- THEN remediation of positive-control / can-fail requirements SHALL be attributed to test-infrastructure-hardening; evidence-contracts SHALL only require that lane self-claims are never trusted without write-evidence digest corroboration
