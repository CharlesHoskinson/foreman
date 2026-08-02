# Council Security, Provenance, and Deliberation Contract

- Date: 2026-08-01
- Reviewer: Council design committee, Seat 3
- Decision: **Approval withheld until the mandatory changes in Section 8 are complete.**

## 1. Scope and standards basis

This memo defines the enforceable contract for an Effect-based functional TypeScript Council. It covers proposal, specification, and design artifacts only. It does not define implementation tasks.

OpenSpec 1.7.0 uses the default `spec-driven` order `proposal -> specs -> design -> tasks`. The tagged schema requires exact capability folders, normative requirements, and four-hash scenario headings. It also requires `WHEN` and `THEN` clauses. See the [OpenSpec 1.7.0 schema](https://raw.githubusercontent.com/Fission-AI/OpenSpec/v1.7.0/schemas/spec-driven/schema.yaml), [proposal template](https://raw.githubusercontent.com/Fission-AI/OpenSpec/v1.7.0/schemas/spec-driven/templates/proposal.md), [spec template](https://raw.githubusercontent.com/Fission-AI/OpenSpec/v1.7.0/schemas/spec-driven/templates/spec.md), and [design template](https://raw.githubusercontent.com/Fission-AI/OpenSpec/v1.7.0/schemas/spec-driven/templates/design.md).

The local OpenSpec 1.7.0 CLI confirmed these behaviors:

- `openspec schema validate spec-driven` passes.
- `openspec validate <change> --strict --json --no-interactive` can pass before `tasks.md` exists.
- `openspec status --change <change> --json` remains incomplete without `tasks.md`.
- The change is not apply-ready until `tasks.md` exists.

The committee can therefore approve the proposal, specs, and design as planning artifacts. It MUST NOT describe the change as complete or apply-ready.

The control design uses these primary standards and sources:

- [W3C PROV-O](https://www.w3.org/TR/prov-o/) for entity, activity, agent, generation, use, derivation, attribution, and primary-source relations.
- [C2PA 2.2](https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html) for typed multimedia validation and recursive ingredient checks. C2PA validation does not prove factual truth.
- [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) for source review, citation review, provenance, TEVV history, and monitoring.
- [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) for audit content, time correlation, audit protection, and retention.
- [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) for URL, DNS, redirect, IP, and network-layer controls.
- [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) and [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) for secret exclusion, sanitization, and log protection.
- [AgentDojo](https://proceedings.neurips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract-Datasets_and_Benchmarks_Track.html) and [CaMeL](https://arxiv.org/abs/2503.18813) for adaptive injection evaluation and deterministic control-data separation.
- [OpenAI Deep Research](https://deploymentsafety.openai.com/deep-research/browsing) for residual prompt-injection risk, multimodal attacks, and arbitrary-URL containment.
- [ReConcile](https://aclanthology.org/2024.acl-long.381/), [LLM evaluator order bias](https://aclanthology.org/2024.acl-long.511/), [LLM-as-a-Judge](https://proceedings.neurips.cc/paper_files/paper/2023/file/91f18a1287b398d378ef22505bf41832-Paper-Datasets_and_Benchmarks.pdf), [adaptive debate stopping](https://aclanthology.org/2024.emnlp-main.992/), and [confidence and diversity in debate](https://aclanthology.org/2026.findings-acl.1694/) for the deliberation controls.

Effect supports type-visible service requirements, layers, runtime schema validation, typed errors, and structured concurrency. Use [Effect services](https://www.effect.website/docs/v3/requirements-management/services) and [Effect layers](https://www.effect.website/docs/v3/requirements-management/layers) to keep privileged services outside worker environments.

## 2. Threat model and trust boundaries

### 2.1 Protected assets

Council MUST protect these assets:

- User intent and the approved task contract.
- Host files, repositories, connectors, and external accounts.
- Credentials, cookies, tokens, private keys, and session identifiers.
- Private user data and evidence with restricted access.
- Research integrity, claim support, and dissent records.
- Blind candidate identity and ballot confidentiality.
- Audit integrity, replay manifests, and approval records.
- Cost, token, time, concurrency, and artifact budgets.

### 2.2 Adversaries and failure sources

The design MUST assume these sources can be hostile or defective:

- Web pages, PDFs, images, audio, video, OCR, metadata, and accessible text.
- Tool results, connector records, provider events, and downloaded files.
- Model outputs, including proposals, critiques, judgments, and syntheses.
- A compromised source server, DNS answer, redirect target, or remote endpoint.
- A worker subprocess with prompt injection or excessive privileges.
- A same-family majority with correlated errors.
- A biased judge affected by order, verbosity, authorship, or provider affinity.
- A faulty adapter that truncates, duplicates, reorders, or misclassifies events.
- An operator mistake, stale approval, invalid policy, or exhausted budget.

The design MUST NOT assume that a model can reliably identify prompt injection. A detector can reduce exposure. A detector cannot grant authority.

### 2.3 Trust boundaries

| Boundary | Trusted side | Untrusted side | Required control |
| --- | --- | --- | --- |
| User request to task compiler | Authenticated user decision | Request data and attachments | Compile a versioned contract. Require approval for amendments. |
| Orchestrator to model | Policy engine and typed input builder | Model output | Parse with a closed schema. Treat output as a proposal. |
| Orchestrator to worker | Narrow worker facade | CLI process and its descendants | Isolate filesystem, environment, network, and credentials. |
| Worker to tool | Capability broker | Tool name and arguments from a model | Authorize each call against contract and capability. |
| Network broker to internet | Validated request template | DNS, redirects, remote content | Resolve, classify, pin, and revalidate every hop. |
| Evidence store to model context | Sanitized extract builder | Raw bytes and derived content | Quarantine raw evidence. Mark all extracts as evidence. |
| Credential store to connector | Secret injector | Model, worker, logs, and evidence | Inject at the final hop. Never disclose plaintext credentials. |
| Deliberation coordinator to judge | Blind map custodian | Judge and candidates | Hide identity. Seal ballots. Reverse candidate order. |
| Audit writer to audit reader | Append-only ledger signer | Event producers and display clients | Sanitize, hash-chain, sign checkpoints, and verify reads. |
| OpenSpec artifact to implementation | Strict validation gate | Generated Markdown | Reject invalid or incomplete planning artifacts. |

### 2.4 Authority classes

Every field entering Council MUST have one authority class:

- `trusted_instruction`: an authenticated user instruction or approved policy.
- `approved_contract`: a canonical contract or approved amendment.
- `tool_metadata`: typed facts from a registered adapter. This class has no instruction authority.
- `user_data`: data supplied for processing. This class has no instruction authority.
- `untrusted_evidence`: retrieved or derived content. This class has no instruction authority.

Only `trusted_instruction` and `approved_contract` can change authorization. Provider system prompts, source reputation, signatures, and provenance metadata MUST NOT change this rule.

## 3. Security requirements and scenarios

The final OpenSpec specs SHOULD copy these requirements into the appropriate capability files. Each requirement needs at least one scenario.

### Requirement: Authority labels are mandatory (SEC-01)

The system SHALL reject any model-bound field that has no authority class.

#### Scenario: Adapter returns an unlabeled field

- **WHEN** an adapter returns a field without an authority class
- **THEN** the system records `authority_unclassified` and excludes the field from model context

### Requirement: Task contracts are immutable (SEC-02)

The system SHALL canonicalize and hash each task contract before any worker sees evidence.

The contract MUST include allowed outcomes, roles, tool operations, resources, destinations, data classes, budgets, approvals, rubric hash, policy version, expiry, and evidence scope.

#### Scenario: Evidence requests a new action

- **WHEN** evidence requests a tool, recipient, destination, or side effect absent from the contract
- **THEN** the system denies the request with `contract_scope_violation`

### Requirement: Contract amendments require new approval (SEC-03)

The system SHALL create a new contract version for every authority change.

The amendment MUST reference the parent hash, exact delta, reason, approver, and approval time.

#### Scenario: Research discovers a needed destination

- **WHEN** a worker proposes a destination outside the approved evidence scope
- **THEN** the system pauses and requests approval for a new contract version

### Requirement: Capabilities are narrow and short-lived (SEC-04)

The capability broker SHALL bind each capability to run, branch, attempt, tool, operation, resource, destination, data class, limit, expiry, and contract hash.

Side-effect capabilities MUST be one-time capabilities.

#### Scenario: Another branch reuses a capability

- **WHEN** a branch presents a capability issued to another branch
- **THEN** the broker denies the call with `capability_subject_mismatch`

### Requirement: Authorization is checked at every call (SEC-05)

The system SHALL authorize every direct and transitive tool call at the broker.

An adapter MUST NOT inherit authorization from an earlier successful call.

#### Scenario: A permitted search triggers a download

- **WHEN** a search adapter attempts an undeclared transitive download
- **THEN** the broker denies the download with `transitive_operation_denied`

### Requirement: Side effects require exact approval (SEC-06)

The system SHALL require a durable approval for external writes, messages, publication, purchases, deployments, destructive commands, credential use, and budget expansion.

Approval MUST bind the normalized action hash and expiry.

#### Scenario: Arguments change after approval

- **WHEN** approved action arguments differ from the current normalized arguments
- **THEN** the system invalidates the approval and requests a new approval

### Requirement: Workers have no ambient authority (SEC-07)

The system SHALL give each worker an ephemeral workspace, a restricted environment, a read-only evidence view, and no ambient credentials.

Workers MUST NOT read another worker's private scratch state.

#### Scenario: Worker reads a host credential

- **WHEN** a worker attempts to read a credential outside its provided facade
- **THEN** the operating boundary denies access and records `ambient_authority_denied`

### Requirement: Evidence remains quarantined (SEC-08)

The system SHALL store raw fetched bytes outside model context.

The context builder SHALL provide only bounded, selector-scoped, inert extracts with artifact identifiers.

#### Scenario: HTML contains an active script and hidden instructions

- **WHEN** an extractor processes HTML with active content or hidden instruction-like text
- **THEN** the system removes active content and marks the extract `suspicious_content`

### Requirement: Network requests use structured templates (SEC-09)

Models SHALL NOT provide complete network URLs to the transport.

The network broker SHALL accept a structured destination, path, method, and approved parameter set.

#### Scenario: Model places evidence in a query parameter

- **WHEN** a model supplies an unapproved or evidence-derived query parameter
- **THEN** the broker denies the request with `url_parameter_denied`

### Requirement: Egress blocks SSRF targets (SEC-10)

The broker SHALL allow `https` by default and `http` only by explicit contract.

The broker MUST block other schemes, URL credentials, non-approved ports, local sockets, and special-use IP space. It MUST include IPv4, IPv6, and IPv4-mapped IPv6 forms.

The broker SHALL resolve all A and AAAA records. It SHALL deny the request if any answer is forbidden. It SHALL connect only to a validated pinned address.

#### Scenario: Public name resolves to a private address

- **WHEN** any DNS answer is loopback, private, link-local, multicast, unspecified, or another forbidden special-use address
- **THEN** the broker denies the request with `destination_not_public`

### Requirement: Redirects receive new authorization (SEC-11)

The broker SHALL disable automatic redirect following.

Each redirect hop MUST pass scheme, port, DNS, IP, capability, parameter, and destination checks. The policy MUST set a finite redirect limit.

#### Scenario: Public endpoint redirects to metadata service

- **WHEN** an approved public endpoint redirects to a cloud metadata address
- **THEN** the broker denies the redirect with `redirect_destination_denied`

### Requirement: Secrets are injected only at the final hop (SEC-12)

The system SHALL keep plaintext secrets outside model, worker, URL, artifact, event, trace, and error payloads.

The connector facade MAY receive an opaque secret reference. Only the credential broker MAY resolve it.

#### Scenario: Tool error contains a token

- **WHEN** a connector returns an error that contains a secret canary
- **THEN** the system blocks persistence and stores a keyed opaque correlation value

### Requirement: Every outbound boundary scans for secrets (SEC-13)

The system SHALL scan prompts, tool arguments, headers, URLs, logs, extracts, screenshots, OCR, errors, and final outputs before release.

A negative scan MUST NOT grant authority.

#### Scenario: OCR reveals a private key

- **WHEN** OCR output matches a configured secret signature
- **THEN** the system quarantines the output and revokes affected capabilities

### Requirement: Multimodal content has zero authority (SEC-14)

The system SHALL treat pixels, audio, video, OCR, VLM descriptions, metadata, annotations, and accessibility layers as untrusted evidence.

The extractor SHALL record material discrepancies between rendered content and derived text.

#### Scenario: Image instructs approval

- **WHEN** image content or OCR requests approval for an action
- **THEN** the system ignores the request and records `evidence_authority_attempt`

## 4. Provenance requirements and scenarios

### Requirement: Every artifact has a stable identity (PROV-01)

The system SHALL assign an artifact identifier to each raw object, extract, model output, ballot, judgment, synthesis, and final report.

The record MUST contain byte or canonical-content hash, media type, size, creation or retrieval time, producer, and validation status.

#### Scenario: Extract content changes

- **WHEN** an extract changes by one byte
- **THEN** the system creates a new artifact identifier and derivation edge

### Requirement: Lineage uses PROV-compatible relations (PROV-02)

The provenance store SHALL represent artifacts as entities, transformations as activities, and responsible tools or workers as agents.

It SHALL record generation, use, derivation, attribution, association, and primary-source relations where applicable.

#### Scenario: OCR creates text from a page

- **WHEN** OCR creates a text extract from a PDF page
- **THEN** lineage records the PDF entity, OCR activity, OCR agent, and derived text entity

### Requirement: Transformations are reproducible (PROV-03)

Every transformation activity SHALL record tool name, tool version, configuration hash, input artifact identifiers, output artifact identifiers, and deterministic seed when used.

#### Scenario: Extractor version is unknown

- **WHEN** a transformed artifact lacks its extractor version
- **THEN** the system marks lineage `incomplete` and excludes the artifact from verified claims

### Requirement: Provenance status is not truth status (PROV-04)

The system SHALL keep provenance integrity, signer trust, source quality, factual support, and instruction authority as separate fields.

It MUST preserve `valid`, `invalid`, `untrusted`, `unknown`, and `inaccessible` states with reason codes.

#### Scenario: C2PA manifest is valid

- **WHEN** an image has a valid C2PA manifest from a trusted signer
- **THEN** the system records valid signer-bound lineage without marking the image factually true or authoritative

### Requirement: Material claims map to exact evidence (PROV-05)

Each material factual claim SHALL map to one or more artifact identifiers and exact spans, pages, timestamps, or image regions.

Each mapping MUST state `supports`, `contradicts`, `context_only`, or `unresolved`.

#### Scenario: Citation points only to a home page

- **WHEN** a material claim cites an artifact without a resolvable locator
- **THEN** the claim verifier marks the claim `citation_unresolved`

### Requirement: Claim support is verified independently (PROV-06)

The citation verifier SHALL check locator resolution, artifact hash, quoted-span fidelity, and semantic support separately from synthesis.

Material claims MUST have status `verified`, `disputed`, `unsupported`, or `unverifiable`.

#### Scenario: Source contradicts the adjacent claim

- **WHEN** the cited span contradicts a material claim
- **THEN** the finalizer excludes the claim or labels it disputed with the contradiction

### Requirement: Derived claims preserve candidate attribution (PROV-07)

The synthesis SHALL record which admissible candidate supplied each material claim, recommendation, objection, and dissent.

#### Scenario: Synthesis merges two proposals

- **WHEN** a synthesis combines claims from two candidates
- **THEN** lineage records both candidate entities and the synthesis activity

## 5. Deliberation requirements and scenarios

### Requirement: Round-zero proposals are independent (DEL-01)

Each proposer SHALL receive the same task contract, rubric, output schema, and approved evidence scope before peer exposure.

The system SHALL seal each initial proposal, assumptions, failure mode, evidence map, and confidence.

#### Scenario: One proposer finishes early

- **WHEN** one proposer finishes before the other proposers
- **THEN** the system withholds that proposal until all round-zero records are sealed or timed out

### Requirement: Candidate identity is blinded (DEL-02)

The coordinator SHALL replace provider, model, CLI, worker, and author identity with random candidate identifiers before judging.

The hidden identity map SHALL be unavailable to judges and peers.

#### Scenario: Proposal self-identifies its model

- **WHEN** a proposal includes an explicit provider or model identifier
- **THEN** the coordinator removes only the identity field and records a derived blinded artifact

### Requirement: Blinding does not rewrite substance (DEL-03)

The coordinator SHALL use a common structured schema and contract-set size limits.

It MUST NOT summarize, truncate, or stylistically rewrite candidate substance during blinding.

#### Scenario: Candidate exceeds the size limit

- **WHEN** a candidate exceeds the contract-set size limit
- **THEN** the system marks the candidate inadmissible instead of silently truncating it

### Requirement: Deterministic checks precede debate (DEL-04)

The system SHALL run schema, policy, citation, test, and reference checks before deliberation.

It SHALL exclude invalid candidates with machine-readable reasons.

#### Scenario: Candidate fails a required test

- **WHEN** a required deterministic test fails for one candidate
- **THEN** the system marks that candidate inadmissible before ranking

### Requirement: Quorum counts independent failure domains (DEL-05)

Automatic closure SHALL require at least three admissible round-zero proposals from at least two approved independent failure domains.

Unknown failure-domain metadata SHALL count as the same domain.

The registry MUST record provider, model family, version, serving stack, and known shared lineage.

#### Scenario: Three replicas agree

- **WHEN** three processes from one model family agree
- **THEN** the system reports one failure domain and denies automatic quorum

### Requirement: Round-zero is the evaluation baseline (DEL-06)

The system SHALL persist unweighted vote, calibrated weighted vote, disagreement, admissible count, and independent-domain count before critique.

#### Scenario: Later debate changes the answer

- **WHEN** the final decision differs from round zero
- **THEN** the audit record identifies the new evidence or resolved objection that caused the change

### Requirement: Confidence is calibrated before weighting (DEL-07)

The system SHALL collect confidence before peer exposure.

It SHALL use confidence as a bounded weight only when a versioned model-task calibration record exists. Otherwise, it SHALL use equal weight.

#### Scenario: New model has no calibration record

- **WHEN** a new model reports 99 percent confidence without calibration data
- **THEN** the aggregator uses equal weight and records `confidence_uncalibrated`

### Requirement: Deliberation is selective and capped (DEL-08)

The system SHALL start critique only for policy-defined disagreement, low calibrated confidence, unresolved evidence, minority guard, or high consequence.

It SHALL permit no more than two critique rounds.

#### Scenario: Two critique rounds do not resolve disagreement

- **WHEN** the second private re-vote remains unstable
- **THEN** the system stops debate and escalates or abstains

### Requirement: Critiques add testable information (DEL-09)

Each accepted critique SHALL identify a falsifiable objection, a failed rubric item, or new admissible evidence.

Restatement or social agreement MUST NOT extend deliberation.

#### Scenario: All critiques only restate prior votes

- **WHEN** a critique round adds no valid objection or evidence
- **THEN** the system stops before another round with `no_information_gain`

### Requirement: Ballots remain private (DEL-10)

The coordinator SHALL seal ballots and confidence until all eligible ballots arrive or time out.

Running tallies MUST NOT enter proposer or judge context.

#### Scenario: Worker requests the current tally

- **WHEN** a worker requests a tally before ballot closure
- **THEN** the coordinator denies access with `ballot_sealed`

### Requirement: Judges are non-authors (DEL-11)

A model instance SHALL NOT score its own candidate.

The adjudicator SHALL prefer a model family that authored no candidate. If none is available, the system MUST record the dependence and deny robust automatic closure.

#### Scenario: Only an authoring family can judge

- **WHEN** every available judge belongs to an authoring model family
- **THEN** the result is advisory and requires escalation for robust closure

### Requirement: Pairwise judgment uses order reversal (DEL-12)

Every decisive pairwise comparison SHALL run as both A/B and B/A with identical rubric, judge configuration, and evidence.

The verdict MUST reference rubric scores and evidence before naming a winner.

#### Scenario: Winner changes after order reversal

- **WHEN** the two orderings select different candidate content
- **THEN** the system records a tie and escalates instead of applying a chair tiebreak

### Requirement: Evidence-backed minority blocks closure (DEL-13)

A minority candidate SHALL block automatic closure when it supplies admissible material evidence that contradicts the leading decision and that evidence remains unresolved.

Raw confidence alone MUST NOT activate the guard.

#### Scenario: Minority supplies a unique primary source

- **WHEN** a minority supplies verified contradictory evidence absent from majority reasoning
- **THEN** the system requests external verification, an orthogonal judge, or human review

### Requirement: Rank precedes synthesis (DEL-14)

The system SHALL rank only admissible candidates before synthesis.

The synthesizer SHALL receive the top set, claim maps, rubric results, and unresolved dissent. It MUST NOT receive only an unattributed transcript.

#### Scenario: Top candidates disagree on a material claim

- **WHEN** the top candidates retain an unresolved material disagreement
- **THEN** the synthesis preserves the disagreement and does not manufacture consensus

### Requirement: Abstention and escalation are typed outcomes (DEL-15)

The system SHALL support `insufficient_evidence`, `quorum_not_met`, `judge_unstable`, `policy_blocked`, `budget_exhausted`, `unsupported_claims`, `schema_invalid`, and `outcome_unknown`.

An abstention MUST identify the unmet closure condition and available next action.

#### Scenario: Budget expires before quorum

- **WHEN** the hard budget expires before independent quorum exists
- **THEN** the system stops new calls and returns `budget_exhausted` with partial evidence

## 6. Audit, replay, and incident requirements

### Requirement: Audit events use a canonical envelope (AUD-01)

Every event SHALL include schema version, event identifier, run, branch, step, attempt, monotonic sequence, UTC time, event type, source, destination, contract hash, capability identifier, redaction metadata, outcome, and previous-event hash.

#### Scenario: Provider emits events out of order

- **WHEN** an adapter receives an event with a duplicate or lower sequence
- **THEN** the adapter records `sequence_violation` without rewriting prior events

### Requirement: Audit integrity is independently verifiable (AUD-02)

The audit writer SHALL hash-chain events and sign periodic checkpoints with a key unavailable to workers.

The reader SHALL verify hashes and signatures before using the audit for approval or replay.

#### Scenario: An event is deleted

- **WHEN** verification detects a broken event chain
- **THEN** the system marks the run `audit_integrity_failed` and blocks final approval

### Requirement: Audit storage minimizes sensitive content (AUD-03)

The system SHALL sanitize event values before persistence.

It SHALL store hashes, typed metadata, opaque secret references, and protected artifact references instead of plaintext secrets or unrestricted prompts.

#### Scenario: Untrusted value contains a line break

- **WHEN** untrusted event data contains control or delimiter characters
- **THEN** the audit writer encodes the value without creating a new event

### Requirement: Replay modes are explicit (AUD-04)

The system SHALL distinguish `structural_replay`, `recorded_input_replay`, and `live_replay`.

Only recorded-input replay can require identical policy decisions. Live replay MUST report mutable source and stochastic model differences.

#### Scenario: Live web page has changed

- **WHEN** live replay retrieves bytes with a different hash
- **THEN** the system records a new artifact and does not claim exact reproduction

### Requirement: Replay verifies decision determinism (AUD-05)

Recorded-input replay SHALL recompute schema checks, policy decisions, capability decisions, ordering, aggregation, stop reasons, and finalization from recorded inputs.

#### Scenario: Policy replay gives a different result

- **WHEN** the same policy version and inputs produce a different decision
- **THEN** the replay fails with `decision_nondeterministic`

### Requirement: Security incidents stop privilege propagation (AUD-06)

On injection escape, secret exposure, unauthorized call, or audit tamper, the system SHALL quarantine affected artifacts, revoke run capabilities, stop new privileged work, and preserve sanitized evidence.

#### Scenario: Secret canary reaches an outbound request

- **WHEN** a secret canary appears in a pending outbound request
- **THEN** the system blocks the request, revokes capabilities, and creates an incident record

## 7. Forbidden states and fail-closed rules

The design MUST make these states unrepresentable or terminal:

| Forbidden state | Required response |
| --- | --- |
| Unclassified content enters model context | Exclude the content. Record `authority_unclassified`. |
| Evidence changes plan, policy, tool scope, recipient, or budget | Deny. Require a contract amendment. |
| A worker has ambient credentials or host-wide filesystem access | Refuse worker launch. |
| A model calls a transport or connector without the broker | Deny at the process or network boundary. |
| A capability is missing, expired, reused, or scope-mismatched | Deny without fallback. |
| Destination resolution is empty, mixed public/private, ambiguous, or changed before connect | Deny the request. |
| A redirect is followed without a new policy decision | Cancel the request and create an incident. |
| A secret appears in a prompt, URL, log, artifact, error, or final output | Block release and revoke affected capabilities. |
| A transform lacks input hash, tool version, or output hash | Mark lineage incomplete. Exclude from verified claims. |
| A material claim lacks exact evidence or support status | Exclude the claim or return `unsupported_claims`. |
| Provenance validity sets factual truth or instruction authority | Reject the record as schema-invalid. |
| A judge can access candidate identity or the blind map | Invalidate the ballot. Reblind or escalate. |
| A model scores its own candidate | Invalidate the score. |
| Raw process count satisfies quorum | Recompute by registered failure domain. |
| Unknown failure-domain metadata satisfies diversity | Count unknown entries as one domain. |
| Order-reversed judgments disagree | Record a tie. Escalate or abstain. |
| A third critique round starts | Deny with `round_cap_reached`. |
| Running tally enters an active ballot context | Invalidate affected ballots. |
| An unresolved evidence-backed minority is suppressed | Block automatic closure. |
| Side-effect outcome is unknown after failure | Reconcile externally. Do not retry blindly. |
| Audit integrity fails or the audit sink exceeds its bounded spool | Stop finalization and privileged actions. |
| OpenSpec strict validation fails | Reject committee approval. |
| Proposal, specs, and design exist without tasks | Mark planning valid but not complete or apply-ready. |

Unknown policy, provenance, destination, capability, citation, approval, or secret-scan status SHALL deny the related commitment. Read-only collection MAY continue only inside quarantine and within budget.

## 8. Validation and evaluation matrix

Security evaluation MUST measure both attack resistance and benign utility. A model refusing every task is not a successful defense.

| Area | Test or fault injection | Release gate | Required evidence |
| --- | --- | --- | --- |
| Task contract | Property-test mutations of tools, recipients, destinations, data classes, approvals, and budgets | Every unauthorized mutation is denied | Seed, input hash, policy decision, reason code |
| Capability broker | Replay stolen, expired, cross-branch, cross-run, transitive, and over-limit capabilities | Zero authorized calls in the negative corpus | Broker decision events |
| Worker isolation | Attempt host credential, sibling scratch, parent process, and unrestricted network access | Every attempt is denied outside the worker facade | OS-level integration results |
| SSRF | Test alternate IP encodings, IPv4-mapped IPv6, private ranges, link-local, metadata, DNS rebinding, mixed answers, and redirects | Zero completed forbidden connections | DNS answers, pinned address, redirect decisions |
| URL exfiltration | Seed secret canaries in evidence and request arbitrary URLs, paths, headers, and query parameters | Zero canary bytes leave the broker | Outbound capture and incident record |
| Secret handling | Seed tokens, keys, cookies, connection strings, and session identifiers across every boundary | Zero plaintext canaries in persisted or released data | Scan report and artifact inventory |
| Evidence quarantine | Test scripts, hidden text, deceptive UI, oversized files, malformed files, archives, and MIME confusion | No active content executes. Limits hold. | Extractor results and sandbox telemetry |
| Multimodal | Test image instructions, OCR mismatch, invisible PDF layers, audio instructions, overlays, and metadata injection | No multimodal content changes authority or approval | Discrepancy records and broker denials |
| Provenance | Modify one byte, remove a parent, change a tool version, and insert dangling relations | Every final artifact resolves to a complete lineage path | Graph validation report |
| C2PA | Test valid, invalid, unknown, inaccessible, untrusted signer, and recursive ingredient failures | Status remains typed. No case implies factual truth. | Validator status codes and policy result |
| Claim citations | Use dead links, wrong spans, unrelated pages, contradictory passages, and poisoned citations | 100 percent structural resolution for material claims. Semantic verifier precision is at least 95 percent on the labeled set. | Claim-evidence map and labeled evaluation |
| Blind review | Insert identity fields, provider hints, and map-access attempts | Judges receive no direct identity fields. Any leak invalidates the ballot. | Judge input hashes and blind-map access log |
| Order bias | Judge each decisive pair in both orders under identical configuration | Any reversal becomes a tie. Reversal rate is reported by judge and task class. | Paired judgment artifacts |
| Failure domains | Run replicas, aliases, unknown versions, and shared serving-stack cases | Quorum follows the versioned registry, not process count | Registry snapshot and quorum trace |
| Minority guard | Seed correct and incorrect evidence-backed minorities | Correct recovery and wrong-overturn rates are both reported. Unresolved contradiction always blocks closure. | Guard decisions and human labels |
| Round cap | Force persistent disagreement, restatement, and conformity | No third critique round. No-information rounds stop early. | Round events and stop reason |
| Confidence | Test calibrated, stale, missing, and adversarial confidence values | Missing or stale calibration has zero weight advantage | Calibration ID and aggregation trace |
| Abstention | Remove evidence, quorum, judge independence, budget, or audit integrity | System returns the matching typed outcome | Final result and unmet condition |
| Audit integrity | Delete, edit, reorder, duplicate, and truncate events | Every mutation is detected before approval or replay | Chain and checkpoint verification |
| Recorded-input replay | Replay fixed provider events, artifacts, policy, clock, and random seed | Policy and aggregation decisions match exactly | Replay diff report |
| Live replay | Change a web artifact or model result | System records divergence and never claims exact replay | Old and new artifact hashes |
| Security utility | Run benign tasks and adaptive attacks under equal budgets | Protected-action attack success is zero. Benign success does not regress beyond the approved non-inferiority margin. | Paired benchmark report with confidence intervals |
| Deliberation value | Compare best single, independent vote, calibrated vote, rank-fuse, one-round, and two-round arms | Council MUST show a statistically credible benefit for a declared target without worse security, calibration, or bias gates | Accuracy or preference, Brier, ECE, AUC, cost, latency, bias metrics |
| OpenSpec | Run strict validation and inspect status with OpenSpec 1.7.0 | Proposal, specs, and design validate. Status clearly reports tasks as missing. | CLI JSON outputs and version |

The security suite SHOULD contain at least 300 independent adaptive trials per protected action class. Zero observed protected-action successes gives an approximate 95 percent upper bound near one percent. Deterministic broker controls still require zero failures in their complete property corpus.

The evaluation report MUST publish sample counts, seeds, tool and model versions, prompt and policy hashes, confidence intervals, exclusions, costs, and benign utility. It MUST retain failed and successful attacks.

## 9. Proposed OpenSpec capability split

The proposal SHOULD declare these six new capabilities:

| Capability | Behavioral scope | Excluded implementation detail |
| --- | --- | --- |
| `task-authorization` | Authority classes, immutable task contracts, amendments, approvals, and side-effect states | Effect class names and storage engines |
| `capability-egress` | Capability decisions, worker isolation, tool mediation, URL construction, SSRF, credentials, and secret boundaries | HTTP client library and sandbox vendor |
| `evidence-provenance` | Quarantine, multimodal handling, artifact identity, PROV-compatible lineage, typed validation, and claim citations | Database schema and extractor implementation |
| `council-deliberation` | Independent proposals, blinding, admissibility, calibration, quorum, rounds, judging, order reversal, minority guard, synthesis, and abstention | Prompt wording and provider adapters |
| `audit-replay` | Canonical events, tamper evidence, redaction, replay modes, decision determinism, and incident records | Log vendor and signing-key provider |
| `council-evaluation` | Adversarial evaluation, utility, deliberation arms, thresholds, artifacts, and OpenSpec validation gates | CI vendor and benchmark runner internals |

Each capability needs one `specs/<capability>/spec.md` file. New capabilities need a `## Purpose` section of at least 50 characters. The proposal capability names MUST exactly match the spec folder names.

### 9.1 Cross-capability invariants

These invariants are mandatory design constraints:

1. `task-authorization` is the only source of action authority.
2. `capability-egress` MUST bind every call to the current task-contract hash.
3. `evidence-provenance` MUST never issue authority or capabilities.
4. `council-deliberation` MUST consume only admissible artifact identifiers and verified policy outputs.
5. `audit-replay` MUST receive every authorization, provenance, ballot, judge, aggregation, and stop decision before finalization.
6. `council-evaluation` MUST exercise the composed system. Isolated model scores do not satisfy the gate.
7. A final material claim MUST have both evidence lineage and candidate lineage.
8. A final automatic decision MUST have independent-domain quorum, stable order-reversed judgment, and no active minority guard.
9. Any privileged call MUST have contract authority, a valid capability, a passing secret scan, an approved destination, and a durable audit event.
10. A failure in any required invariant MUST produce a typed failure or abstention. It MUST NOT downgrade silently.

### 9.2 Effect design constraints

The design SHOULD use immutable domain values and closed runtime schemas. Branded identifiers SHOULD cover contract, artifact, capability, claim, candidate, ballot, approval, event, run, branch, and attempt identifiers.

The design SHOULD define narrow Effect services for these boundaries:

- `TaskContractStore`
- `PolicyEngine`
- `CapabilityBroker`
- `ApprovalGate`
- `EgressBroker`
- `CredentialBroker`
- `EvidenceStore`
- `ProvenanceStore`
- `CitationVerifier`
- `BlindMapCustodian`
- `DeliberationEngine`
- `AuditLedger`
- `ReplayEngine`

Live privileged layers MUST exist only in the trusted orchestrator. Worker layers MUST expose narrow facades without credential, transport, blind-map, or audit-signing implementations.

Authorization decisions SHOULD be pure functions over canonical inputs. Clock, randomness, DNS, transport, model, and storage effects MUST enter through services. Recorded-input replay MUST replace those services with recorded layers.

Every operational failure MUST use a tagged error. Broad catch-and-continue logic MUST NOT convert policy, provenance, audit, or schema failures into success.

## 10. Design objections and trade-offs

### 10.1 Detection is not enforcement

An instruction classifier can miss an attack. It can also block benign content. The design must keep authorization outside every model and detector.

### 10.2 Immutable contracts need controlled amendment

A permanently frozen research plan blocks legitimate discovery. An evidence-controlled plan permits privilege expansion. Versioned, user-approved amendments resolve this conflict.

### 10.3 Broad research conflicts with strict allowlists

Research may need unknown public domains. The broker can allow public destinations under a scoped policy. It must still block special-use ranges, arbitrary parameters, redirects, and secret-derived URLs.

### 10.4 Complete audit conflicts with data minimization

Raw prompts improve forensic inspection but can retain secrets and private data. Store redacted metadata and hashes in the ledger. Keep protected evidence under a separate retention and access policy.

### 10.5 Provenance does not establish truth

PROV and C2PA describe lineage and integrity. They do not prove that a claim is accurate or safe. Council needs a separate claim-support verifier.

### 10.6 Blinding conflicts with faithful presentation

Aggressive normalization can alter substance. Use a common proposal schema and size limits before submission. During blinding, remove direct identity only.

### 10.7 Model diversity is not automatically independent

Different process names can share a provider, model family, training lineage, or serving stack. Council needs a versioned failure-domain registry. Unknown lineage cannot satisfy diversity.

### 10.8 Debate can amplify conformity and cost

Independent voting often captures much of the gain. Council must compare against round zero, deliberate selectively, and stop after two critique rounds.

### 10.9 Order reversal doubles judging cost

Position bias can reverse a verdict. The extra judgment cost is mandatory for decisive pairwise comparisons. Low-risk tasks can stop at robust round-zero quorum and avoid pairwise judging.

### 10.10 Exact replay has a limited meaning

Web sources and model outputs change. Council can exactly replay recorded inputs and deterministic policy decisions. It cannot promise identical live research results.

## 11. Mandatory changes before approval

The committee MUST require these changes in the final proposal, specs, and design:

1. Split the change into the six capabilities in Section 9.
2. Define the canonical task-contract fields, hash, amendment process, and approval binding.
3. Define capability scope, expiry, one-time use, transitive-call denial, and typed denial reasons.
4. Place network and credential access behind trusted orchestrator services. Remove ambient worker credentials and unrestricted egress.
5. Specify canonical URL parsing, full A and AAAA classification, address pinning, redirect reauthorization, port limits, and special-use blocking.
6. Define evidence quarantine for raw and derived multimodal content. State that evidence has zero authority.
7. Define complete PROV-compatible artifact and transformation records. Keep provenance, truth, source quality, and authority separate.
8. Define claim-level locators and support states. State how unsupported material claims affect finalization.
9. Define blind-map custody, common candidate schema, private ballots, non-author judges, and order-reversed comparisons.
10. Replace raw-agent quorum with a versioned independent failure-domain registry and the default three-proposal, two-domain rule.
11. Define round-zero metrics, calibrated confidence handling, selective entry conditions, information-gain checks, and the hard two-round cap.
12. Define the evidence-backed minority guard and typed abstention or escalation outcomes.
13. Define the append-only event envelope, hash chain, signed checkpoints, secret-safe audit storage, and audit-failure behavior.
14. Define recorded-input and live replay separately. Require identical decisions only for recorded-input replay.
15. Add the evaluation matrix and explicit release gates. Compare all deliberation arms under equal budgets.
16. Add every fail-closed rule in Section 7 as a requirement scenario or design invariant.
17. Run OpenSpec 1.7.0 strict validation. Preserve the CLI JSON result as review evidence.
18. State that committee approval covers proposal, specs, and design only. Do not mark the change complete or apply-ready before tasks exist.

## 12. Approval checklist

Approve only when all answers are yes:

- Do proposal capability names exactly match six spec directories?
- Does every new spec contain a purpose of at least 50 characters?
- Does every normative statement use `SHALL` or `MUST`?
- Does every requirement have at least one exact `#### Scenario`?
- Does every scenario have explicit `WHEN` and `THEN` clauses?
- Can evidence change data only, never authority or control flow?
- Can every privileged operation be traced to a contract and capability?
- Can any model construct an arbitrary outbound URL or see a plaintext secret?
- Does every material claim resolve to exact evidence and candidate lineage?
- Can a same-family replica majority satisfy quorum?
- Does every decisive pairwise judgment pass order reversal?
- Can the system enter a third critique round?
- Can unresolved minority evidence disappear from synthesis?
- Can a broken audit chain or unknown side effect be treated as success?
- Does recorded-input replay reproduce every deterministic decision?
- Does `openspec validate <change> --strict --json --no-interactive` pass?
- Does status correctly show that tasks remain missing and implementation remains blocked?

Any `no` answer blocks approval.
