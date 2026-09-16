# Return of the ForeDi — release candidate notes

Return of the ForeDi brings checked Pel programs, durable execution, and candidate delivery into one Foreman command.
The same program describes implementation, host checks, independent review, bounded correction, and separately authorized publication.

**Status: unversioned release candidate, not an accepted final release.**
The numerical version remains `null`.
See the [remaining release roadmap](REMAINING-ROADMAP.md) for the integration sequence and required evidence.
The [implementation PR #59](https://github.com/CharlesHoskinson/foreman/pull/59), does not assign a version or authorize publication.

Except for the dated amendment below, these notes describe C2 source candidate `bb0c1e9f3868d6bf36a91f78ceec55800192fc5c`.
C3 metadata commit `c830fd5` records its evidence and remaining obligations.
That metadata commit does not replace the tested production candidate.
See the [candidate acceptance record](m6-instruction-acceptance.json) for exact identities and evidence hashes.

## 2026-09-15 amendment: OpenBao credential storage

This candidate addition is not covered by the historical C2 acceptance evidence.
It does not assign a release version or authorize live credential migration.

The shared `CredentialStorePort` supports AGY (Antigravity CLI), Codex, Claude, and Grok.
The OpenBao backend provides reads, compare-and-set writes, account listing, and explicit-version soft deletion.
References use `bao:<provider>:<account>`.
Production connections require HTTPS with certificate verification.
The host supplies an OpenBao token through a callback for each operation.

The release design makes OpenBao the sole durable credential authority for managed accounts.
Setup, qualification, and execution must share the selected account and revalidate its current generation.
No managed consumer may fall back to native profiles or environment credentials.
This consumer integration remains a release gate, not a delivered capability.

OpenBao KV v2 is a dependency when this backend is selected.
The local `bao` executable is required for local fixtures and CLI administration, not remote framework access.
The pilot binary baseline is OpenBao 2.6.2 on WSL/Linux amd64.
This baseline does not establish a minimum supported version or production qualification.

See the [interface and command guide](../../guides/pel/openbao-credentials.md)
and [dependency inventory](../../../dependencies/README.md#openbao-credential-backend).
The framework API exists in source. No `foreman credentials` or `foreman openbao` command is implemented.
Native login, refresh coordination, and default live-provider integration require separate qualification for each provider.
Soft deletion in OpenBao does not revoke a provider token.
It retains account metadata: reads return NotFound, listing retains the name, and create-only
re-import conflicts. Recovery requires separately authorized new material and the recorded generation.
The production package excludes the synthetic factory; tests use `@foreman/providers/testing`.
The [audit correction evidence](fable-corrections-2026-09-15.md) records source-bound builds,
external integrity receipt binding, backend configuration identity, and remaining integration gates.

The [release integration record](../../../openspec/changes/openbao-credential-pilot/release-integration.md)
tracks the remaining gates. Synthetic evidence cannot establish live account readiness.

### Administrative erasure policy

The [policy decision](../../superpowers/specs/2026-09-15-openbao-erasure-policy-decision.md) records independent GPT, Fable, and Grok advice and preserved disagreements.
CM09 through CM14 add provisioned control authority, evidence-bounded quarantine, explicit reconciliation, and exact confirmation requirements.
The [pure PEL specification](../../../examples/pel/openbao-erasure-policy.pel) has executable classification tests.
It grants no credential, readiness, or publication authority.
Account-only quarantine requires intact OpenBao evidence. Missing control authority blocks the backend.
OpenBao remains the sole durable credential and lifecycle authority.
These requirements do not implement the control store, manager, operator CLI, or provider migration.

## What users can do

| Milestone | Delivered capability |
| --- | --- |
| M1: Pel language | Write bounded programs with lexical bindings, closures, named arguments, callable lists, pipes, branches, loops, and asynchronous expressions. |
| M2: Plan authoring | Check source, inspect effects and dependencies, generate a bounded draft, and edit drafts interactively before execution. |
| M3: Model adapters | Select six exact profiles across four vendors, with explicit API/native transports, controls, schemas, and capability evidence. |
| M4: Durable execution | Run, inspect, cancel, and recover work through the existing journal, ledger, owner, and supervisor. |
| M5: Task delivery | Capture a real candidate, run registered checks, request independent review, correct within bounds, and publish with existing authority. |
| M6: Adoption | Install a self-contained Node package, migrate two closed legacy templates, select compatible retained builds, and inspect portable research and support evidence. |

M1–M5 are implemented. M6 implementation and adoption evidence are available, but its production-size acceptance target remains unmet.
The [feature catalog](EARS-CATALOG.md) and [test plan](TEST-PLAN.md) preserve the detailed requirement mappings.

## A source-visible delivery workflow

The standard example contains the complete implementation, verification, and review sequence:

```clojure
(fm/task :id "implement" :model "role:implementer"
  :input "artifact:approved-spec" :output "schema:candidate-v1")
|> (fm/verify :id "verify" :input ^ :gate "candidate-full")
|> (fm/review :id "review" :model "role:reviewer"
  :input ^ :policy "independent-review")
```

The default roles select `grok-4.6` through `grok-acp` and `gpt-5.6-sol` through `codex-app-server`.
Project settings can select different admitted exact profiles without changing this program.
Account access and the required exact transport qualification remain prerequisites.
The standard example ends after review. It does not publish or merge implicitly.

Host operations return ordinary Pel values.
Branches and bounded recursion make correction decisions visible in source.
The host still checks authority, evidence, scope, and limits before each external action.
Source text and model responses cannot grant those permissions.

Start with the [tutorial](../../guides/pel/tutorial.md), [quickstart](../../guides/pel/quickstart.md), and [example guide](../../guides/pel/examples.md).

## Language and authoring

Pel implements the explicit `pel-paper-v2-foreman-1` compatibility profile.
It supports immutable lexical bindings, recursive closures, defaults, positional or named arguments, ordered pairs, and callable lists.
ASCII `|>` carries the preceding value into `^`.
Lazy branches and dependency-aware asynchronous expressions keep control flow in the language.

Source diagnostics identify locations and registered signatures.
Finite limits cover parsing, values, reductions, iterations, and call depth.
Serializable continuations retain the consumed counters during recovery.
The evaluator does not execute arbitrary JavaScript or shell source.
The [compatibility reference](../../reference/pel/compatibility.md) documents paper interpretations, extensions, and errata.

```text
foreman check implement-verify-review.pel
foreman plan implement-verify-review.pel
foreman plan implement-verify-review.pel --json
```

File checking and planning do not start host work.
The human plan shows effects, exact models, controls, capabilities, resource scopes, gates, dependencies, and dynamic bounds.
C2 shortens this view while preserving the complete `--json` contract.
Unresolved results remain explicit. A bounded dynamic plan is not a complete static execution graph.
Successful checking does not establish live provider readiness or authorize a run.

Explicit `plan --prompt TEXT` generation requires exact `--model` and `--transport` selections.
Generation uses separate bounded reservations and permits at most two local repairs.
Interactive draft editing uses `foreman plan FILE --interactive`.
Draft operations include replacement, undo, repair, completion, export, and abort.
These authoring operations do not start the generated delivery workflow automatically.

## Install and configure

The candidate package supports **Linux x64 with Node.js >=24 <25**.
Installation requires no source checkout, package manager, Python, or TypeScript runner.
Provider execution can require additional native clients, host facilities, credentials, and qualification.
This candidate does not establish macOS, Windows, or other architecture support.

Verify the archive against its published SHA-256, then extract it into an empty directory.
Run its compiled installer:

```text
node /absolute/unpacked/runtime/dist/install.js --prefix /absolute/installation
/absolute/installation/bin/foreman --version --json
/absolute/installation/bin/foreman providers list --json
```

The installer validates payload hashes, file modes, required assets, and runtime identity.
It retains builds under `versions/BUILD_ID` and atomically selects `current`.
It creates `bin/foreman` without changing shell startup files.
See [installation](../../guides/pel/install.md) for prefix rules and failure outcomes.

From the target Git project, configure its existing authority and concrete inputs:

```text
foreman project configure --settings project-settings.json
foreman check implement-verify-review.pel
foreman plan implement-verify-review.pel
foreman run implement-verify-review.pel --json
```

The supplied [project settings](../../../examples/pel/project-settings.json) contain placeholders and must not run unchanged.
Replace them with the registered repository, state root, authority, bounded workspaces, artifacts, roles, gate, and credential references.
Use an isolated candidate worktree at its admitted immutable base.
The full gate has registered argv and an explicit environment binding.
Configuration references existing authority. It does not create task or publication grants.

## Exact models and readiness

The installed provider catalog contains these exact model/transport pairs:

| Profile | API transport | Native transport |
| --- | --- | --- |
| `grok-4.6` | `xai-responses` | `grok-acp` |
| `claude-opus-5` | `anthropic-messages` | `claude-code` |
| `claude-fable-5-1` | `anthropic-messages` | `claude-code` |
| `gpt-6-astra` | `openai-responses` | `codex-app-server` |
| `gpt-5.6-sol` | `openai-responses` | `codex-app-server` |
| `gemini-3.8-flash` | `google-interactions` | `gemini-cli` |

A catalog entry means that the selection is known. It does not prove account access or every declared capability.
No silent model substitution occurs.
API transports support admitted generation, predicates, and review. They do not substitute for native `fm/task` coding.
Grok ACP and Codex app-server have implemented coding boundaries.
Claude Code has a no-tools boundary. Unsupported native modes fail before dispatch.

The [September 13 qualification record](m6-live-qualification.md) reports twelve attempted cells on a separately identified bundle:

- All six API attempts lacked their selected environment credential.
- Grok and both Codex coding attempts lacked the selected credential.
- Claude Opus 5 passed generation, structured output, and no-tool policy through Claude Code 2.1.270.
- Claude Fable 5.1 returned its exact model identity, then encountered a rate limit.
- Gemini CLI ended without a confirmed provider outcome or model identity.

The Opus result does not qualify coding, workspace enforcement, permission enforcement, or publication.
These dated observations are not final-package or universal account-readiness claims.
Failed or incomplete attempts did not produce capability evidence.

Use the [qualification guide](../../guides/pel/qualification.md) to supply explicit limits and bindings:

```text
foreman providers qualify --profile grok-4.6 --transport grok-acp --credential-profile env:XAI_API_KEY --limits limits.json --binding binding.json --json
```

Qualification is explicit provider work and can incur cost.
The native coding host uses a disposable workspace and observes permitted writes, denied writes, unchanged Git metadata, and late writes.
Successful evidence retains its exact identity, controls, transport version, source hashes, and expiry.
Fixture evidence cannot qualify a product account.

## Durable runs, concurrency, and recovery

Admission retains the source, settings, limits, authority, schemas, and required inputs as immutable run artifacts.
The run ID is emitted after durable admission and before dispatch.
Later edits to project settings or working source do not replace those recovery inputs.

```text
foreman status RUN_ID --json
foreman resume RUN_ID --json
foreman cancel RUN_ID
```

Completed effects replay from validated receipts.
Intent is durable before external dispatch, and receipts are durable before the evaluator continues.
Linux kernel locks release ownership after process death while preventing competing owners.
The existing journal and ledger retain history and spend. Recovery does not create a second scheduler or reset allowances.

An unknown external outcome stays unresolved until observation, original-session continuation, or an authorized decision resolves it.
A missing acknowledgement does not authorize another external operation.
Cancellation distinguishes local cleanup from confirmed remote cancellation.
A cancelled run does not become a resumable pending run.

`fm/retry` accepts declared transient provider failures within the original bounds and applicable retry authority.
`fm/race` uses separate admitted child workspaces and records its winner before exposure.
Only the selected candidate is promoted for downstream checks and review.
Completed and abandoned child work remains charged. Unknown loser outcomes stay visible during recovery.
`fm/checkpoint` records a named durable point without requesting repetition of completed work.

The existing `resume --decision FILE` route validates explicit operator decisions under the original owner and authority.
A source revision also requires `--revision FILE` with its bound decision.
Revisions preserve validated completed top-level forms, prior receipts, failed-work counters, and the original admission envelope.
They cannot widen the original limits or authority.

## Candidate checks, independent review, and publication

`fm/task` captures candidate identity from actual Git and file observations.
The immutable commit, tree, diff, and manifest include additions, changes, deletions, executable modes, and symbolic links.
Capture preserves the worktree’s branch, HEAD, and index.
Out-of-scope changes or unsubstantiated provider artifact claims prevent successful completion.

`fm/verify` executes the registered gate and checks candidate identity before and after it runs.
The host exit status determines the result.
Exact reusable evidence avoids another gate execution and reservation.
Candidate, gate, environment, policy, attempt, provenance, and freshness must still match.
Failed checks return ordinary data and prevent review dispatch.

`fm/review` receives immutable candidate contents, the full manifest, diff, and verification evidence with tools disabled.
Approval requires an observed reviewer vendor different from the implementer’s vendor.
The report must identify the exact candidate. A new review attempt invalidates older approval for that candidate.
Host evidence and required milestones determine delivery success, not model status text alone.

`fm/publish` requires an existing grant for a registered Git destination.
It rechecks candidate evidence, authority, and the expected destination object before the existing publication transaction.
Missing authority returns needs-action before publication reservation.
Lost acknowledgement triggers destination observation. It does not cause an automatic second push.
Publication does not integrate a candidate implicitly or authorize a numerical release tag.

## Included workflows

| Example | Purpose |
| --- | --- |
| [implement-verify-review.pel](../../../examples/pel/implement-verify-review.pel) | Standard task, full gate, and independent review. |
| [conditional.pel](../../../examples/pel/conditional.pel) | Review only after successful candidate checks. |
| [repair-and-publish.pel](../../../examples/pel/repair-and-publish.pel) | At most one correction, with no-change and exhausted-bound results, then separately authorized publication. |
| [race-cancel.pel](../../../examples/pel/race-cancel.pel) | Two workspace-isolated contenders and a durable winner. |
| [resume-checkpoint.pel](../../../examples/pel/resume-checkpoint.pel) | Named checkpoint before the standard workflow. |
| [parallel-read.pel](../../../examples/pel/parallel-read.pel) | Concurrent reads of two admitted research bundles. |
| [research-prepare.pel](../../../examples/pel/research-prepare.pel) | Bounded advisory research before work. |
| [repair.pel](../../../examples/pel/repair.pel) | Corrected task-call syntax after an authoring error. |

Six additional profile examples demonstrate exact selection.
The task-only examples can return needs-action when the configured contract also requires checks and review.
Example presence and fixture execution do not establish native coding readiness for every model.

## Breaking changes and migration

Pel replaces the selected shell orchestration paths. It is not an old-argv compatibility layer.
Programs use checked source, registered resources, and existing authority instead of arbitrary shell command strings.
The language’s explicit compatibility profile replaces assumptions about unverified upstream behavior.

The installed importer accepts only the two registered RoundPlanV1/ExecutionContractV1 templates:
`implement-verify-review` and `bounded-rework`.

```text
foreman migrate round-v1.json --contract contract-v1.json --out workflow.pel
foreman check workflow.pel
foreman run workflow.pel
```

Migration writes a new Pel file and a hash-bound `.parity.json` file.
It requires the original scope, base, approved specification, models, gate, limits, and milestones.
It neither creates authority nor resets the ledger.
Unknown fields, arbitrary command vectors, V2 imports, queue layouts, and Council workflows have no import mapping.
See the [migration guide](../../guides/pel/migration.md) for the exact accepted command template.

Active legacy work retains its original controller.
The new runtime refuses automatic legacy restart, resume, and cancellation with `ActiveLegacyRun` before allocation or provider work.
Historical decoding and read-only `legacy-round` status remain available.
Existing records do not establish a verified original controller executable.
When that controller is unavailable, the new runtime cannot invent a restart path.
Council retains its existing preflight, blinding, quorum, and execution policy.

## Rollback and compatibility

```text
foreman install rollback --to BUILD_ID
```

Rollback validates the retained build and checks all registered state roots for active-state compatibility.
Unreadable or incompatible journals, checkpoints, and continuations prevent the switch.
Shared registry transactions coordinate registration, admission, revision, and rollback across installation prefixes.
These transactions finish before execution starts.

Rollback preserves run histories and identities. It does not rewrite checkpoints or redispatch work.
New runs and revisions require the selected runtime.
A terminal failed run without a later revision does not block selection.
Revising that run first requires a compatible retained build.
See [installation and rollback](../../guides/pel/install.md) for the complete behavior.

## Research and support

The installed portable research bundle works without an external vault.
It preserves captured source locations, raw and clean hashes, dates, claim classes, freshness, and extraction limits.

```text
foreman research query "provider constraints" --json --limit 5
foreman research status --json
foreman research refresh --bundle PATH
foreman support export --run RUN_ID --out support.json
```

Research refresh validates an explicitly selected captured bundle. It does not fetch websites or rewrite raw captures.
Optional `--vault PATH` reads bounded notes as unverified context and does not execute note instructions.
Research freshness means captured bytes match, not that an external website remains unchanged.
The [research guide](../../guides/pel/research.md) explains these boundaries.

Support export projects safe failure codes, sequence references, installation identity, and reproduction information.
It excludes credentials, environment values, provider session IDs, raw prompts, reasoning, and raw error messages.
It preserves `product`, `test-fixture`, or `unknown` provenance.
Identifiers can still disclose organizational context. Inspect the file before sharing it.
See the [support guide](../../guides/pel/support.md).

The C2 advisory Graphify 0.9.61 graph inventories 2,660 tracked entries, with 27,398 nodes and 57,120 edges.
Four syntax-warning files and 218 code paths without observed entities remain explicit.
Zero dangling endpoints does not prove complete extraction or normalization idempotence.
Historical semantic token usage remains unknown.
The separately qualified Graphify 0.9.48 graph is unchanged.

## Verification and acceptance limits

The [C2 verification record](m6-instruction-verification.json) reports **3,205 passed tests, seven skipped tests, and zero failures**.
The package passed **19 installed-product checks**.
Two productions generated identical archive bytes.
The configured-run test used the actual archive with explicit finite provider fixtures.
It did not establish live-account readiness.

The suites cover language conformance, checked plans, exact selections, real-store durability, process interruption, candidate capture, checks, review, publication, migration, rollback, and support.
The [acceptance record](m6-instruction-acceptance.json) binds the commands and artifacts.
Earlier milestone records retain their original candidate boundaries and test counts.

| Frozen M6 measure | Baseline | C2 | Acceptance |
| --- | ---: | ---: | --- |
| Production nonblank lines, at least 40% reduction | 6,916 | 48,912 | **FAIL**. Maximum permitted: 4,149. |
| Required instruction tokens, at least 50% reduction | 16,502 | 8,122 | **PASS**. Reduction: 50.78%. |

No threshold, cohort, tokenizer, or startup recipe changed to obtain the instruction result.
The [2026-09-13 scope amendment](scope-amendment-2026-09-13.md) defers only the production-code target to a separate cleanup release.
The original failed result remains unchanged. The 50% instruction target remains required on the final candidate.
Operational counts for workflow loops, provider conditionals, active owners, and authoritative histories remain unknown in the startup report.

The existing v0.5 predicates, designated-host requirements, exact-candidate cold audit, numerical reconciliation, and publication authority remain unresolved.
The [reconciliation record](reconciliation-proposal.md) records this authorized deferral.
Its other replacement mappings remain proposed. No other requirement is waived.
The [adoption obligations](adoption-obligations.json) preserve the original open requirements.

Command outcomes distinguish completion, failure, invalid admission, needs-action, and cancellation as exit codes 0, 1, 2, 3, and 4.
Read the command-specific result and next action before retrying.
An unresolved external outcome is not successful delivery, even when local cleanup completed.

## Planned: K semantics sprint

**PLANNED — not implemented in this candidate.**
M7 is the requested sprint-plan deliverable. Its implementation is outside this completion request.
The [K semantics proposal](../../../openspec/changes/foredi-07-k-semantics/proposal.md) describes the next semantics work.
The [semantics guide](../../guides/pel/semantics.md) explains its intended relationship to the current Pel implementation.
No K executable semantics, equivalence proof, or additional formal release guarantee is claimed here.
Current behavior remains governed by the implemented compatibility profile, source specifications, and recorded tests.

## GitHub validation observation

The first PR run reported six failures because the Linux job lacked the native test prerequisites.
The workflow now installs ripgrep and Bubblewrap before the workspace tests and checks the namespace boundary explicitly.
The affected 21 tests pass locally. The GitHub rerun remains pending at this documentation update.
See the [local regression output](evidence/m6/ci-prerequisites-local.txt) and [original CI run](https://github.com/CharlesHoskinson/foreman/actions/runs/34768912646).
