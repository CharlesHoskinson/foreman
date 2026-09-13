# M3 EARS coverage

M3 has six features, 29 EARS requirements, and 29 catalog scenarios. The original catalog wording remains authoritative. The table names the executable acceptance targets and the behavior they test. All provider paths below are under `packages/providers/src` unless specified.

| Requirement / test | Executable target | Acceptance behavior |
| --- | --- | --- |
| R-M3-001 / T-M3-001 | profiles.test.ts | Six exact IDs and four families; unknown aliases fail. |
| R-M3-002 / T-M3-002 | profiles.test.ts | Every disallowed effort and native control combination fails before dispatch. |
| R-M3-003 / T-M3-003 | registry.test.ts | Exact source and capability evidence survive resolution; unknown required evidence fails. |
| R-M3-004 / T-M3-004 | transport-contract.test.ts | API and native identities stay distinct across all twelve cells. |
| R-M3-005 / T-M3-005 | native-prompt.test.ts | Native channels preserve 128 KiB UTF-8 prompts, quotes, newlines, and dollar signs. Launcher stdin has a real child-process test. |
| R-M3-006 / T-M3-006 | transport-contract.test.ts | Unsupported grammar, schema, and tool capabilities cause zero dispatches. |
| R-M3-007 / T-M3-007 | events.test.ts; transports/* tests | Fragmented events retain identity; refusal, truncation, malformed output, and duplicates remain distinct. |
| R-M3-008 / T-M3-008 | tools.test.ts; native transport tests | Exact host receipts and bounded content pass through the host port. The host owns durable deduplication and tool effects. |
| R-M3-009 / T-M3-009 | output.test.ts | Original schemas enforce keys, order, bounds, envelopes, and union values. |
| R-M3-010 / T-M3-010 | continuation.test.ts | Opaque bytes round-trip; changed identity, prefix, version, and expiry fail. |
| R-M3-011 / T-M3-011 | lifecycle.test.ts | Local cleanup cannot fabricate a remote cancellation acknowledgement. |
| R-M3-012 / T-M3-012 | lifecycle.test.ts | Existing-ID observation and uncertain resume never dispatch a replacement request. |
| R-M3-013 / T-M3-013 | readiness.test.ts | Discovery, auth, currency, identity, and capabilities remain independent. |
| R-M3-014 / T-M3-014 | readiness.test.ts | Only explicit signed-out evidence supports login remediation; uncertainty stays unknown. |
| R-M3-015 / T-M3-015 | readiness.test.ts | Protocol metadata establishes identity; missing or rerouted models cannot qualify. |
| R-M3-016 / T-M3-016 | conformance.test.ts | All twelve cells have positive and original-schema negative fixtures. |
| R-M3-017 / T-M3-017 | orchestration/src/pel-provider-qualification.test.ts | The compiled fixture CLI uses the actual bounded qualification harness and exact outcome codes. |
| R-M3-018 / T-M3-018 | orchestration/src/pel-provider-list.test.ts | The compiled list distinguishes fixture evidence and rejects product fixture selectors. |
| R-M3-019 / T-M3-019 | generation.test.ts | One immutable M2 generation request maps to one provider request, with no adapter repair loop. |
| R-M3-020 / T-M3-020 | usage.test.ts; qualification.test.ts | Known counters, dated prices, unknown cost, cumulative limits, terminal usage, and auxiliary accounting remain correct. |
| R-M3-021 / T-M3-021 | controls.test.ts | Closed nested controls retain defaults and reject unknown or unsupported fields. |
| R-M3-022 / T-M3-022 | observation.test.ts | Observation has typed pending, completed, cancelled, not-found, and unsupported results. |
| R-M3-023 / T-M3-023 | admission.test.ts | Product admission requires current exact live evidence; fixture binding cannot mint product authority. |
| R-M3-024 / T-M3-024 | transport-selection.test.ts | Ambiguity fails; explicit selection stays exact; API coding and unbounded native tools fail. |
| R-M3-025 / T-M3-025 | errors.test.ts | The shared 15-tag failure union has two transient tags. Real Pel retry selectors accept quoted data and reject syntax/nil-pair lists. |
| R-M3-026 / T-M3-026 | orchestration/src/pel-provider-cli.test.ts | Provider command outcomes map to exits 0–4; unresolved attached work never uses final exit 5. |
| R-M3-027 / T-M3-027 | credentials.test.ts | Exact injected credentials, lease cleanup, and AST-checked package import directions. |
| R-M3-028 / T-M3-028 | output-codec.test.ts | Canonical Pel output, duplicate-aware decoding, immutable schema IDs, and unsupported subsets. |
| R-M3-029 / T-M3-029 | transports/api-transports.test.ts; orchestration/src/pel-provider-live.test.ts | The serialized empty tool surface and exact response identity precede any reported no-tool boundary. Automatic tool choice, replay, refusal, incomplete output, identity mismatch, tool activity, and unrecognized action-bearing output produce no evidence. Request enforcement does not replace the native empty-catalog observation. |

Additional integration tests cover live generation admission, read-only evidence listing, explicit credential selection, existing preflight-record reuse, and launcher stream cleanup. `orchestration/src/pel-provider-readiness-live.test.ts` checks record freshness, executable/version matching, account-bound authentication, and metadata/workload separation. Deterministic tests cannot establish account access or live provider qualification.
