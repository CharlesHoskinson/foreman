# Return of the ForeDi audit

Status: the host corrected and checked the final specifications. The recorded Opus verdicts apply to their frozen input snapshots. Implementation and runtime qualification remain open.

## Authors and independent reviews

Three native GPT-6 agents drafted M1–M2, M3/M6, and M4–M5. The [author record](authors.json) states their selected model and the available identity evidence. Three separate Opus roles reviewed all six milestones: language, execution, and release.

Each Opus process selected `claude-opus-5` at high effort. The CLI terminal results confirm canonical model `claude-opus-5` and nonzero output tokens. Tools were disabled. Reviewers received frozen source bundles. The follow-up bundle also included six PixelRAG PDF page images: pages 11, 14, 18, 20, 21, and 22. The host visually read all 29 pages.

| Review role | Initial verdict | Initial findings | Follow-up verdict | Follow-up findings |
| --- | --- | --- | --- | --- |
| language | [needs_revision](audits/initial/language-review.json) | 23 | [needs_revision](audits/revised/language-review.json) | 17 |
| execution | [needs_revision](audits/initial/execution-review.json) | 22 | [needs_revision](audits/revised/execution-review.json) | 18 |
| release | [needs_revision](audits/initial/release-review.json) | 26 | [needs_revision](audits/revised/release-review.json) | 23 |

The initial reviews contain 71 findings. The follow-up reviews contain 58 findings, including duplicate reports of shared defects. Each finding retains its review file and ID. Do not add these counts as if each row were a distinct defect.

The authors corrected the follow-up findings. The host checked the corrections, catalog consistency, source references, and build ownership. A [complete resolution record](audits/resolution.json) maps every follow-up finding to its correction, files, EARS requirements, and planned tests. The [final source manifest](audits/final-spec-inputs.json) binds that assessment to the corrected files. There was no third Opus pass. The `needs_revision` verdicts have not been rewritten as approvals.

## Concrete corrections

- Pel now defines case and pipe scope, optional dependency execution, canonical closure arguments, replay accounting, and explicit paper-versus-extension attribution. PixelRAG corrected the extracted lexical glyphs. Print returns its input value.
- Authoring owns the shared descriptors, snapshot generation, CLI factory, and initial fixture entry. Later stages add handlers. Providers use an injected credential service and a defined JSON-to-Pel conversion.
- Execution preserves pending requests for recoverable uncertainty and missing publication authority. Child continuations, race decisions, retry charges, failed-step counters, and final outcome classification have durable contracts.
- Migration names its legacy targets. Packaging names an archive producer. Tests use explicit fixture manifests. Command exit codes and measurement membership are fixed.

The host also read the existing [ledger, journal, build, and credential sources](audits/host-source-review.json). This identified the V1/V2 evaluation-action distinction and the event-log size and depth bounds. The specifications reuse existing authority and immutable artifacts.

## Verification and limits

The [catalog validation](catalog-validation.json) checks unique IDs, complete feature coverage, reciprocal requirement/test links, exact EARS bodies, complete test records, and milestone dependencies. All six changes pass strict OpenSpec validation. The [test plan](TEST-PLAN.md) describes future runtime tests; those tests have not run against a Pel implementation.

The [final verification record](verification.json) contains the static validation, source and archive hashes, graph integrity, and vault lint results. Model qualification remains per exact profile and transport. The audits did not establish live behavior for all six models.

Initial and follow-up directories retain input hashes, exact input archives, request settings, structured reviews, terminal CLI results, and identity receipts. Author resolution maps preserve the history of intermediate corrections. Only the final manifest binds the host assessment to the final specification files.
