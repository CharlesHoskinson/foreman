## Purpose

Defines an independent-propose, selectively-deliberate, bias-checked decision protocol that preserves evidence and dissent instead of manufacturing consensus.

## ADDED Requirements

### Requirement: Round-zero proposals are independent
Every proposer SHALL receive the same task contract, rubric, output schema, and approved evidence scope, and Council SHALL seal each proposal before peer exposure.

#### Scenario: One proposer finishes early
- **WHEN** a proposer completes before its peers
- **THEN** Council withholds peer content until all eligible round-zero records close or time out

### Requirement: Candidate identity is blinded without rewriting substance
Council SHALL replace direct provider, model, CLI, worker, and author identity with random candidate identifiers while preserving candidate substance and recording a derived blinded artifact.

#### Scenario: Candidate exceeds the common size limit
- **WHEN** a proposal violates the contract-set size limit
- **THEN** Council marks it inadmissible instead of silently truncating or summarizing it

### Requirement: Deterministic checks precede deliberation
Council SHALL run schema, policy, citation, test, and reference checks before debate and SHALL exclude invalid candidates with machine-readable reasons.

#### Scenario: Candidate fails a required test
- **WHEN** a deterministic acceptance test fails
- **THEN** Council excludes that candidate before aggregation and ranking

### Requirement: Automatic quorum uses independent failure domains
Automatic proposal closure SHALL require at least three admissible independent proposals from at least two approved failure domains by default; raw worker count MUST NOT satisfy diversity.

#### Scenario: Three same-family workers agree
- **WHEN** all agreeing workers share one registered failure domain
- **THEN** Council denies automatic quorum and reports one independent domain

### Requirement: Completed review quorum counts substantive verdicts only
Automatic review closure SHALL require at least three completed substantive verdicts from at least two approved failure domains by default. Provider infrastructure failures, completed abstentions, and completed invalid responses MUST NOT count as substantive verdicts.

#### Scenario: Three completed reviewers abstain
- **WHEN** three identity-bound reviewers return completed typed abstentions
- **THEN** Council preserves the abstentions and reports zero substantive verdicts for review quorum

#### Scenario: Completed invalid responses do not manufacture quorum
- **WHEN** reviewers return only completed invalid responses or a mix of completed invalid responses and infrastructure failures
- **THEN** Council reports zero substantive verdicts for review quorum

### Requirement: Round-zero metrics are immutable
Council SHALL persist the unweighted vote, calibrated weighted vote, disagreement, admissible count, independent-domain count, evidence conflicts, and stop eligibility before critique.

#### Scenario: Debate changes the preferred result
- **WHEN** the final decision differs from round zero
- **THEN** Council identifies the new evidence or resolved falsifiable objection that caused the change

### Requirement: Confidence requires calibration
Council SHALL collect confidence before peer exposure and MUST use it as a bounded weight only when a current, versioned model-task calibration record exists.

#### Scenario: New model reports high confidence
- **WHEN** a model has no applicable calibration record
- **THEN** Council grants no confidence-weight advantage and records `confidence_uncalibrated`

### Requirement: Deliberation is selective and capped
Council SHALL open critique only for policy-defined disagreement, low calibrated confidence, unresolved evidence, minority guard, or high consequence, and MUST permit no more than two critique rounds.

#### Scenario: Round two remains unstable
- **WHEN** the second private re-vote does not meet closure conditions
- **THEN** Council stops critique and escalates, abstains, or synthesizes with explicit dissent

### Requirement: Critiques add testable information
An accepted critique SHALL introduce a falsifiable objection, failed rubric item, or new admissible evidence; restatement and social agreement MUST NOT extend deliberation.

#### Scenario: Critiques only repeat prior positions
- **WHEN** a critique round adds no accepted information
- **THEN** Council stops with `no_information_gain`

### Requirement: Ballots remain private
Council SHALL seal votes and confidence until all eligible ballots arrive or time out and MUST NOT expose running tallies to proposers or judges.

#### Scenario: Worker requests the active tally
- **WHEN** a worker requests votes before ballot closure
- **THEN** Council denies access with `ballot_sealed`

### Requirement: Judges are non-authors and order-checked
A model instance MUST NOT score its own candidate, and every decisive pairwise comparison SHALL run in both candidate orders with identical rubric, judge configuration, and evidence.

#### Scenario: Reversed order changes the winner
- **WHEN** A/B and B/A comparisons select different content
- **THEN** Council records a tie and escalates instead of using a chair tiebreak

### Requirement: Evidence-backed minority blocks closure
A minority candidate SHALL block automatic closure when it provides admissible material evidence contradicting the leader and that contradiction remains unresolved; raw confidence alone MUST NOT activate the guard.

#### Scenario: Minority supplies unique contradictory evidence
- **WHEN** verified contradictory evidence is absent from majority reasoning
- **THEN** Council requests external verification, an orthogonal judge, or human review

### Requirement: Rank precedes synthesis
Council SHALL rank only admissible candidates before synthesis and SHALL provide the synthesizer with top candidate artifacts, claim maps, rubric results, and unresolved dissent rather than only an unattributed transcript.

#### Scenario: Top candidates retain material disagreement
- **WHEN** a material conflict remains unresolved
- **THEN** synthesis preserves the disagreement and does not manufacture consensus

### Requirement: Completed advice, completed invalid response, infrastructure failure, and closure are separate outcomes
Council SHALL represent a completed `insufficient_evidence` response as a review abstention with the unmet condition, declared evidence reference, and available next action. Council SHALL represent a successful terminal turn whose designated structured output is schema-invalid, identity-invalid, or semantically inadmissible as a completed invalid response with a closed reason. Council SHALL represent prompt, dispatch, provider, transport, and parser failures as review infrastructure failures. Council SHALL represent `quorum_not_met`, `judge_unstable`, `policy_blocked`, `budget_exhausted`, `unsupported_claims`, and `outcome_unknown` as closure outcomes. Completed advice, completed invalid response, infrastructure failure, and closure MUST remain disjoint.

#### Scenario: Budget expires before quorum
- **WHEN** the hard budget expires before independent quorum exists
- **THEN** Council stops new work and returns `budget_exhausted` with partial evidence references

#### Scenario: Schema negotiation fails before a model turn
- **WHEN** a provider rejects its schema dialect before the model starts
- **THEN** Council returns a review infrastructure failure and records no abstention, verdict, or dissent

#### Scenario: Successful terminal with schema-invalid approved shape
- **WHEN** a provider completes a successful terminal turn and returns designated structured output that fails the closed review-response schema
- **THEN** Council returns a completed invalid response and records no abstention, verdict, dissent, or infrastructure failure

#### Scenario: Successful terminal with inadmissible insufficient-evidence body
- **WHEN** a provider completes a successful terminal turn and returns `insufficient_evidence` that fails identity or evidence-gap admission
- **THEN** Council returns a completed invalid response and does not count the attempt as a completed abstention or quorum participant
