## 1. Workspace and Architecture Guardrails

- [ ] 1.1 Create the pnpm TypeScript workspace, strict compiler configuration, formatting, linting, Vitest, package scripts, and pinned dependency baseline.
- [ ] 1.2 Create focused `schema`, `domain`, `application`, `platform-node`, `runtime-node`, `mcp-server`, `testing`, and `adapter-conformance` package boundaries.
- [ ] 1.3 Add automated dependency-direction and forbidden-import checks that keep the domain runtime-free and provider DTOs out of public exports.
- [ ] 1.4 Add CI for formatting, linting, type checking, unit tests, architecture tests, OpenSpec validation, and clean generated artifacts.

## 2. Versioned Contracts and Pure Domain

- [ ] 2.1 Define branded identifiers, authority classes, lifecycle unions, closed error unions, envelopes, and versioned schema decoding rules in `@council/schema`.
- [ ] 2.2 Implement immutable run state, commands, authoritative events, and total `decide`, `evolve`, and `replay` functions in `@council/domain`.
- [ ] 2.3 Add terminal-state, event-sequence, checkpoint, cancellation, and late-evidence invariants with unit and property tests.
- [ ] 2.4 Add pure budget reservation and reconciliation with concurrent-final-reservation property tests.
- [ ] 2.5 Add task-contract, amendment, exact-approval, side-effect-state, and fail-closed commitment decision logic.
- [ ] 2.6 Add pure failure-domain quorum, confidence-calibration eligibility, deliberation-stop, and typed-abstention policies.

## 3. Effect Application Shell

- [ ] 3.1 Define narrow Effect service ports for clock, identifiers, event store, observations, artifacts, scheduler, policy, capabilities, providers, tools, audit, and telemetry.
- [ ] 3.2 Implement application command handlers that decode once, call the pure domain, append before publish, and map boundary failures to closed errors.
- [ ] 3.3 Implement run, stage, branch, attempt, and process scopes with structured concurrency and reverse-order finalization tests.
- [ ] 3.4 Implement bounded stdout, stderr, observation, event, and audit streams with durable-record-before-capacity-release behavior.
- [ ] 3.5 Implement deterministic test Layers for time, randomness, identifiers, stores, providers, policy, tools, and failure injection.

## 4. Durable Storage, Artifacts, and Recovery

- [ ] 4.1 Implement SQLite WAL migrations for authoritative events, observations, outbox records, leases, checkpoints, snapshots, projections, idempotency, and audit records.
- [ ] 4.2 Implement atomic expected-version appends that commit non-empty event batches with outbox and idempotency changes in one transaction.
- [ ] 4.3 Implement run leases, idempotent projections, projection-lag reporting, snapshot verification, and replay fallback.
- [ ] 4.4 Implement immutable content-addressed artifacts with atomic publication, metadata, validation status, parents, and transformation references.
- [ ] 4.5 Implement native-filesystem readiness checks that reject hot SQLite or artifact-write paths across unsuitable WSL filesystem boundaries.
- [ ] 4.6 Prove crash recovery at each required checkpoint and verify completed advisers are not rerun.

## 5. Process Ownership, Scheduling, and Budgets

- [ ] 5.1 Implement shell-free subprocess launch and bounded stdout/stderr spooling behind a platform process-guard interface.
- [ ] 5.2 Implement POSIX process-group ownership and parent-death cleanup for Linux and macOS.
- [ ] 5.3 Implement native Windows Job Object ownership and dual Windows-to-WSL process-tree cleanup through a minimal versioned helper.
- [ ] 5.4 Implement dependency-ready scheduling, duplicate-objective rejection, workspace serialization, and total/provider/tool concurrency limits.
- [ ] 5.5 Implement shared wall-time, token, cost, tool, turn, retry, event, artifact, and concurrency reservations with usage classification.
- [ ] 5.6 Implement cancellation intent persistence, admission stop, graceful termination, bounded drain, hard tree termination, and terminal classification.
- [ ] 5.7 Implement singular capped exponential full-jitter retry ownership with overall deadlines and explicit ambiguous side-effect outcomes.

## 6. Authorization, Capabilities, Credentials, and Egress

- [ ] 6.1 Implement canonical immutable task contracts and parent-linked amendments that require exact approval for authority expansion.
- [ ] 6.2 Implement exact normalized approvals and one-time mutating capabilities bound to run, branch, attempt, contract, tool, operation, resource, destination, data class, limit, expiry, and subject.
- [ ] 6.3 Implement isolated worker workspaces, environment allowlists, bounded resources, sibling-state separation, and deny-by-default execution.
- [ ] 6.4 Implement structured destination requests, DNS and pinned-address validation, special-use IP blocking, finite redirect reauthorization, and SSRF property tests.
- [ ] 6.5 Implement an opaque-reference credential broker that injects secrets only at the final approved connector hop.
- [ ] 6.6 Implement secret and restricted-data scanning across prompts, arguments, transport, logs, artifacts, OCR, errors, and final release.
- [ ] 6.7 Implement fail-closed policy, capability, approval, provenance, citation, and scan decisions with sanitized incident records.

## 7. Provider Adapters and Readiness

- [ ] 7.1 Define adapter identity, discovery, doctor, invocation, frame decoding, terminal classification, resume, cancellation, capability-evidence, and failure-domain interfaces.
- [ ] 7.2 Build golden-fixture and stream-fuzz conformance suites that prohibit spawning, persistence, scheduling, retry, approval, and policy in adapters.
- [ ] 7.3 Implement and certify the Claude subscription CLI adapter and read-only live canary.
- [ ] 7.4 Implement and certify the Codex subscription CLI adapter and read-only live canary.
- [ ] 7.5 Implement and certify the Gemini subscription CLI adapter, including unauthenticated and credential-shadowing diagnostics.
- [ ] 7.6 Implement and certify the Grok subscription CLI adapter plus its separately tested Claude-compatibility lane.
- [ ] 7.7 Implement the aggregate readiness doctor, capability degradation, version compatibility, sanitized environment inventory, and no-substitution admission behavior.

## 8. Supervised Research Gateway

- [ ] 8.1 Implement the Tool Gateway with per-attempt inputs, process ownership, capabilities, budgets, immutable outputs, provenance, and quarantine.
- [ ] 8.2 Integrate Scrapling 0.4.12 with targeted extraction, destination validation, selectors or crawl policy, robots and rate policy, and page/time/redirect/byte limits.
- [ ] 8.3 Integrate PixelRAG 0.4.0 with single-flight browser setup, source-bound atomic manifests, tile count/dimension checks, nonblank sampling, and output hashes.
- [ ] 8.4 Integrate Graphify 0.9.32 with graph-first queries, recorded vocabulary expansion, confidence/source preservation, and separate mutation authorities.
- [ ] 8.5 Implement inert bounded evidence extracts while keeping raw bytes, text, pixels, OCR, metadata, graphs, and tool outputs quarantined as `untrusted_evidence`.
- [ ] 8.6 Test traversal, undeclared outputs, blank captures, crawl limits, direct-binary bypass, hidden instructions, and graph-mutation denial.

## 9. Evidence Provenance and Claim Verification

- [ ] 9.1 Implement content-bound artifact identities and PROV-compatible entity, activity, agent, derivation, attribution, association, and primary-source relationships.
- [ ] 9.2 Implement transformation metadata for tool version, configuration hash, policy, inputs, outputs, and deterministic seed.
- [ ] 9.3 Implement independent lineage-integrity, signer-trust, source-quality, factual-support, instruction-authority, and validation states.
- [ ] 9.4 Implement exact span, page, timestamp, image-region, and graph-source claim locators with support relations.
- [ ] 9.5 Implement citation resolution, artifact-hash, quoted-fidelity, and semantic-support verification outside synthesis.
- [ ] 9.6 Implement candidate lineage for every material claim, recommendation, objection, and dissent in synthesis.

## 10. Council Deliberation

- [ ] 10.1 Implement equal-contract independent proposal fan-out and sealed round-zero artifacts.
- [ ] 10.2 Implement identity-only blinding, common-limit admissibility, and deterministic schema, policy, citation, test, and reference checks.
- [ ] 10.3 Implement immutable unweighted and calibrated round-zero metrics with independent failure-domain quorum.
- [ ] 10.4 Implement selective critique triggers, private ballots, accepted-information tests, and a hard two-round cap.
- [ ] 10.5 Implement non-author judging, decisive A/B plus B/A comparison, order-reversal ties, and provider-affinity diagnostics.
- [ ] 10.6 Implement the admissible-evidence minority guard and external-verification, orthogonal-judge, or human-review escalation paths.
- [ ] 10.7 Implement admissible-candidate ranking, dissent-preserving synthesis, claim lineage, and typed abstention outcomes.

## 11. Audit, Replay, and Incidents

- [ ] 11.1 Implement the canonical secret-safe audit envelope, monotonic sequence, hash chain, protected checkpoints, and bounded spool.
- [ ] 11.2 Implement audit integrity verification before approval, replay, privileged continuation, and finalization.
- [ ] 11.3 Implement structural replay with schema, hash, version, and state-evolution verification.
- [ ] 11.4 Implement recorded-input replay Layers for clock, randomness, DNS, transport, model, policy, and tool inputs with deterministic decision comparison.
- [ ] 11.5 Implement live replay with new artifacts and explicit divergence reporting.
- [ ] 11.6 Implement incident quarantine, capability revocation, privileged-work stop, and sanitized evidence preservation.

## 12. MCP Control Plane and Native Plugins

- [ ] 12.1 Implement versioned provider-neutral doctor, start, status, events, approval, cancel, resume, artifact, and result application operations.
- [ ] 12.2 Implement the MCP stdio server with protocol-only stdout, bounded redacted stderr, and public-schema conformance tests.
- [ ] 12.3 Implement per-run research facades and recursion-depth enforcement that prevents provider workers from controlling Council.
- [ ] 12.4 Create the Claude native wrapper with portable paths, MCP registration, deny-by-default permissions, and lifecycle conformance tests.
- [ ] 12.5 Create the Codex native plugin manifest, skills, portable paths, MCP registration, marketplace metadata, and lifecycle conformance tests.
- [ ] 12.6 Create the Gemini native wrapper with portable paths, MCP registration, deny-by-default permissions, and lifecycle conformance tests.
- [ ] 12.7 Create the Grok native wrapper and Claude-compatibility package with separate conformance tests.
- [ ] 12.8 Implement wrapper/core/schema compatibility and stale-cache detection without granting authority during installation.

## 13. Evaluation and Release

- [ ] 13.1 Build equal-budget fixtures for best-single-model, independent vote, calibrated vote, pairwise rank-and-fuse, one critique round, and two critique rounds.
- [ ] 13.2 Measure correctness or human preference, evidence quality, schema validity, calibration, order reversal, affinity, minority recovery, wrong overturns, latency, tokens, and cost quality.
- [ ] 13.3 Build adaptive text, HTML, PDF, image, OCR, tool, graph, redirect, DNS, secret-canary, cross-worker, and recursive-control security evaluations with benign-utility controls.
- [ ] 13.4 Run crash, stream-fuzz, cancellation, recovery, storage, and owned-process cleanup tests across Linux, macOS, Windows, and Windows-to-WSL.
- [ ] 13.5 Publish reproducible evaluation manifests with sample counts, seeds, versions, hashes, confidence intervals, exclusions, and failed attacks.
- [ ] 13.6 Require all design release gates, strict OpenSpec validation, clean dependency boundaries, and signed wrapper manifests before the first release.
