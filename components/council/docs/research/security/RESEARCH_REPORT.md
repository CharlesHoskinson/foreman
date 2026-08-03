# Council Security Research Report

Date: 2026-08-01

Scope: indirect prompt injection, browser and tool isolation, provenance and citations, SSRF, secret redaction, untrusted multimodal evidence, audit logs, and reproducible deep research for a cross-CLI Council plugin.

## Bottom line

Council must assume that prompt injection succeeds sometimes. Model training, delimiters, classifiers, and critic agents reduce risk but do not create an authorization boundary. The enforceable boundary must be outside every model: untrusted evidence cannot change control flow, grant capabilities, select privileged tools, disclose secrets, or widen network scope.

## Evidence-backed findings

1. **External content is an attacker-controlled instruction channel.** Greshake et al. demonstrate remote injection through retrieved content, including API manipulation and data theft. AgentDojo confirms that tool-returned data can hijack agents and that security and benign utility must be tested together. ([Greshake et al.](https://arxiv.org/abs/2302.12173), [AgentDojo](https://proceedings.nips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract-Datasets_and_Benchmarks_Track.html))

2. **Deterministic control/data separation is stronger than prompt-only defenses.** CaMeL derives control flow from the trusted query and checks capability and information-flow policy when tools are called. Its v2 abstract reports 77% task completion under its stated provable-security property versus 84% undefended. This is a useful design direction, not a universal proof for arbitrary agents. ([CaMeL](https://arxiv.org/abs/2503.18813))

3. **Production defenses retain measurable residual risk.** Anthropic states that a 1% browser-agent attack success rate is still meaningful and scans hidden text, manipulated images, and deceptive UI. OpenAI reports stronger residual failure in some multimodal prompt-injection tests than text-only tests and uses a system-level ban on constructing arbitrary URLs to contain exfiltration. ([Anthropic](https://www.anthropic.com/research/prompt-injection-defenses), [OpenAI Deep Research System Card](https://deploymentsafety.openai.com/deep-research/browsing))

4. **Browser sandboxing requires separate process, origin, and network controls.** Chromium treats sandboxed renderer processes and one-site-per-process isolation as security boundaries, with privileged enforcement in the browser process. OWASP adds URL allowlisting where possible, strict scheme and IP validation, redirect checks, DNS-rebinding protection, private/link-local/metadata blocking, and network egress restrictions. ([Chromium Site Isolation](https://www.chromium.org/developers/design-documents/site-isolation/), [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html))

5. **Provenance is lineage, not truth or authority.** W3C PROV-O provides entity, activity, agent, derivation, generation, attribution, and primary-source relations. C2PA adds signed multimedia lineage and typed validation results, but its explainer says provenance cannot establish that content is true, accurate, or factual. Valid provenance must never elevate evidence into instructions. ([W3C PROV-O](https://www.w3.org/TR/prov-o/), [C2PA 2.2](https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html), [C2PA Explainer](https://c2pa.org/specifications/specifications/2.2/explainer/Explainer.html))

6. **Citations require verification and claim-level lineage.** NIST AI 600-1 calls for source and citation review, retrieval-data provenance, retained TEVV history, monitoring, incident response, and measurement of provenance errors. A link in a final answer is not proof unless the cited span supports the claim and the retrieved artifact is identifiable. ([NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf))

7. **Audit completeness and secret minimization must coexist.** NIST AU controls require event type, time, location, source, outcome, associated entities, time correlation, retention, and protection against alteration. OWASP says access tokens, passwords, connection strings, encryption keys, session identifiers, and unnecessary PII should be removed, masked, hashed, or encrypted and that event data must be sanitized against log injection. ([NIST SP 800-53 Rev. 5](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf), [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html))

8. **A successful tool exit is not evidence of a successful capture.** The first PixelRAG PDF capture returned success but contained a blank browser viewer. Inspecting the pixels caught the failure. The successful C2PA HTML pass showed recursive ingredient validation, typed failure states, explicit warnings for invalid provenance, and separation among content binding, signer trust, and action history. See `notes/visual-pass.md`.

## Concrete Council security requirements

- **SEC-001 — Authority labels:** Tag every message and field as trusted instruction, user data, tool metadata, or untrusted evidence. Only trusted instructions may change plan or policy.
- **SEC-002 — Immutable task contract:** Compile the user request into an immutable action plan and capability set before exposing models to evidence. Evidence may fill data slots but may not add steps, tools, recipients, or privileges.
- **SEC-003 — Capability broker:** Issue short-lived capabilities bound to Council run, worker, tool, operation, resource, and destination. Recheck policy at every tool call. Deny undeclared transitive calls.
- **SEC-004 — Read-only research default:** Browser, repository, and connector tools are read-only unless the user separately authorizes a side effect. Require human confirmation for external writes, sends, purchases, credential use, or scope expansion.
- **SEC-005 — Evidence quarantine:** Preserve raw fetched bytes outside model context. Feed only size-limited, selector-scoped, hidden-content-sanitized extracts. Mark all text, OCR, alt text, metadata, annotations, and tool outputs as untrusted.
- **SEC-006 — Injection containment:** Detect suspicious instruction-like evidence, but never rely on detection for safety. A detection may block or quarantine; a non-detection grants no authority.
- **SEC-007 — Worker isolation:** Give each CLI worker an ephemeral filesystem and browser profile, a read-only evidence bundle, no ambient host credentials, and no access to other workers' private scratch state. Exchange typed result objects, not executable prompts.
- **SEC-008 — Browser isolation:** Use a sandboxed browser in an outer container/VM with site isolation enabled. Separate privileged orchestration from renderers. Use controlled download staging, MIME/content validation, size limits, and no automatic opening of downloaded files.
- **SEC-009 — Network egress broker:** Allow only `https` and justified `http`; block `file`, `data`, `javascript`, `gopher`, FTP, local sockets, loopback, RFC1918, link-local, multicast, and cloud metadata. Resolve and classify all A/AAAA records, pin the validated destination for the request, and revalidate every redirect. Apply allowlists when scope permits.
- **SEC-010 — URL exfiltration defense:** Models cannot construct or navigate arbitrary URLs containing evidence or secret-derived values. Separate search/navigation intents from network requests and strip credentials, fragments, and unapproved query parameters.
- **SEC-011 — Secret firewall:** Scan prompts, tool arguments, URLs, headers, outputs, logs, saved extracts, screenshots/OCR, and error reports. Never persist plaintext tokens, passwords, cookies, connection strings, private keys, or session IDs. Replace correlatable secrets with keyed opaque references, not reversible masking.
- **SEC-012 — Multimodal zero trust:** Treat pixels and all derived OCR/VLM text as untrusted evidence. Compare rendered pixels with accessible text and extracted layers; flag large discrepancies, invisible text, overlays, and instructions embedded in images. Do not let image content approve actions.
- **SEC-013 — Provenance graph:** For each artifact record canonical and final URL, retrieval time, media type, byte hash, extractor and version, transformations, parent artifacts, producer tool/worker, and validation status. Model it as entity/activity/agent relations compatible with PROV-O concepts.
- **SEC-014 — Claim-to-evidence citations:** Store a mapping from each material report claim to exact artifact IDs and spans/pages/regions. Automatically check that each citation resolves and supports the adjacent claim. A citation's reputation affects confidence, not instruction authority.
- **SEC-015 — Typed provenance status:** Preserve `valid`, `invalid`, `untrusted`, `unknown`, `inaccessible`, and reason codes. Recursively validate source lineage where supported. Never collapse presence of metadata into `trusted=true`.
- **SEC-016 — Tamper-evident audit:** Log run ID, worker/CLI and version, task-contract hash, event type, UTC timestamp, source/destination, tool and capability ID, sanitized arguments, artifact hashes, policy decision, outcome, and approval identity. Time-correlate across workers, protect integrity, restrict access, and retain by policy.
- **SEC-017 — Reproducible research manifest:** Save the sanitized query, approved plan, source allow/deny scope, sources considered/selected/rejected with reasons, retrieval metadata and hashes, tool/model versions, relevant configuration, claim-evidence map, and final report hash. Record that a replay of mutable web sources may differ.
- **SEC-018 — Security/utility evaluation:** Maintain benign task-success and adaptive attack-success metrics. Include text, HTML, images, PDFs, OCR mismatches, poisoned citations, tool-output injection, redirect/DNS attacks, cross-worker propagation, secret canaries, and attempts to alter the task contract.
- **SEC-019 — Fail closed at commitment boundaries:** If provenance, destination, capability, citation support, or secret scan is unknown at a side-effect boundary, stop before the action. Research collection may continue in quarantine when safe.
- **SEC-020 — Incident response:** Quarantine the artifact and downstream outputs, revoke run capabilities, preserve redacted evidence and tamper-evident logs, identify affected workers and tools, and support replay from the last trusted state.

## Important disagreements and trade-offs

- **Probabilistic versus architectural defenses:** Vendor training and classifiers improve robustness but admit residual failures. CaMeL offers stronger guarantees within a narrower task model and loses some utility. Council should combine them, with deterministic capability enforcement as the authority boundary.
- **Broad research versus URL allowlisting:** Deep research benefits from broad browsing, while SSRF defense prefers allowlists. Council should use a policy-enforcing network broker, risk-tiered domain scope, and explicit expansion rather than unrestricted model-directed fetches.
- **Complete audits versus data minimization:** Raw prompts and responses ease replay but can contain secrets and PII. Council should retain hashes, typed metadata, redacted extracts, and separately protected evidence rather than indiscriminate raw logs.
- **Provenance versus truth:** W3C and C2PA make lineage interoperable and tamper-evident; C2PA explicitly rejects a truth guarantee. Council must present lineage, source quality, factual corroboration, and instruction authority as separate dimensions.
- **Isolation versus performance:** Chromium documents memory and latency costs; CaMeL reports a task-utility cost. Council should not weaken boundaries silently. Any lower-isolation mode needs an explicit risk label and must disable secrets and side effects.

## Evidence limitations

- Vendor system cards and engineering posts are self-reported and only partly reproducible.
- Research benchmarks do not cover every Council workflow or adaptive attacker.
- Mutable web pages can change after retrieval; local hashes identify the inspected versions.
- C2PA can validate provenance integrity but not factual accuracy, completeness, or benign intent.

Full source metadata and local artifacts are in `SOURCES.json` and `source-index.md`.
