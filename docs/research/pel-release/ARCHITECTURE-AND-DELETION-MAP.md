# Pel adoption: architecture and deletion map

Status: planning proposal. No implementation or deletion is authorized by this document.
Source baseline: `441c3fb9f6acb2656760d03cc79e7c706fb8b7dd`.

Adopt Pel as the orchestration language. Extend its runtime boundary to reuse Foreman's existing controls.
The main simplification is one executable plan with one interpreter and one event history.
Models propose plans and supply task results. The host validates plans and controls effects.

The current branch contains the v0.5.0 bootstrap tranche. This inventory does not establish completion of v0.5.0.
The Pel paper analysis defines which language constructs belong to upstream Pel.
The additions below are Foreman design proposals, not claims about upstream syntax.

## Observed architecture

Foreman already has useful deterministic foundations. The graph identifies `canonicalize()` as a hub with degree 165.
`sha256Hex()` has degree 88. `makeLiveEndstopLedgerLayer()` has degree 51.
These graph metrics identify reuse candidates. They do not establish correctness or deletion safety.

The source contains several separate representations of an execution:

- `ExecutionContractV1` binds objectives, acceptance, paths, authorization, deadlines, and limits in `packages/orchestration/src/execution-contract.ts`.
- `RoundPlanV1` binds one attempt, command, report, and gate in `packages/orchestration/src/round-contract.ts`.
- The round reducer controls implementation, verification, completion, and recovery in `packages/orchestration/src/round-reducer.ts`.
- The queue owns fixed provider groups in `packages/orchestration/src/queue-admission.ts`.
- Shell adapters construct worker commands in `skills/foreman/scripts/adapters/` and `skills/foreman/scripts/lib/worker-cmd.sh`.
- Council has separate provider ports, schema lowering, canary adapters, prompt materialization, and terminal decoding in `components/council/packages/`.

There is a concrete transport mismatch. Worker prompts cannot use stdin through the retained worker launcher contract.
Council's Codex canary writes prompt bytes to stdin.
A shared adapter must expose transport capabilities explicitly. Copying the canary invocation into the worker path would lose its prompt.

`vendor-multiround.sh` owns a bounded re-prompt loop and detects file changes.
The execution ledger also owns limits. The supervisor owns resume decisions.
Pel should centralize the plan-level loop while preserving the ledger and process safety boundaries.

## Proposed target

Use one Pel program as authored input. Parse it into a versioned, checked representation.
Bind the program and profile to a digest before admission. Bind effects to that digest and attempt identity.
Admitted host calls suspend evaluation and return recorded results as ordinary Pel values.
Native Pel control flow consumes those values. Previews mark future-dependent values as unresolved within checked capability and budget envelopes.
Execute through one Effect runtime. Project its event history into existing status and evidence views.

Keep four concepts distinct:

| Concept | Owner | Purpose |
| --- | --- | --- |
| Pel program | Planner and user | Describe task order, data flow, and bounded control flow. |
| Checked representation | Pel analyzer | Resolve static names and capabilities. Bound future-dependent effects without creating another authored workflow language. |
| Admission policy | Existing policy and execution ledger | Authorize paths, budgets, provider identity, and release operations. |
| Transport adapter | Provider integration | Encode requests and decode observations without owning workflow policy. |

Start with two new TypeScript packages: `packages/pel` and `packages/providers`.
Keep the language evaluator in `packages/pel`. Keep admitted host execution in `packages/orchestration`.
Use Node.js 24 and strict TypeScript. Use Effect for resources, cancellation, retries, timeouts, and concurrency.
Do not add Python or shell implementation files. Keep research tooling external to the repository.

The provider registry separates model identity from transport identity.
Grok 4.6, Opus 5, Fable 5.1, GPT 6, GPT 5.6 sol, and Gemini 3.8 Flash become requested profiles.
A profile remains unavailable until its provider, exact model ID, transport, and capability evidence are verified.
Do not silently map a requested model to another model.

Each transport implements capability discovery, request encoding, event decoding, cancellation, and usage normalization.
A model profile supplies limits and supported capabilities. It does not supply a scheduler or a second plan language.
Council uses the same provider interface for review tasks.
Its independence, blinding, quorum, and admission rules remain policy modules.

## Replacement and retention map

All paths below are relative to the repository root. A replacement is a proposal until its migration gate passes.

| Existing files or directory | Decision | Pel destination or retained role | Migration gate |
| --- | --- | --- | --- |
| `packages/orchestration/src/round-contract.ts` | Replace authored form, retain compatibility decoder | Compile Pel into the attempt-bound execution contract. | Decode recorded rounds and reproduce identical attempt and report identities. |
| `packages/orchestration/src/round-transaction.ts` | Generalize | Use its event sink, checkpoint, report, and command ports as interpreter effects. | Match event order for success, failure, timeout, and interrupted verification. |
| `packages/orchestration/src/round-reducer.ts` | Retain first, then consolidate | One plan reducer owns new plan execution. The old decoder remains for historical records. | Replay old and new histories without accepting invalid transitions or conflicting outcomes. |
| `packages/orchestration/src/resume-decision.ts` | Retain and adapt | Derive resume from the same plan reducer and durable instruction position. | Reject corrupt, unordered, unbound, and wrong-attempt history. |
| `packages/orchestration/src/resume-queue-execution.ts` | Consolidate | Resume invokes the interpreter's durable effect dispatcher. | A restart cannot duplicate admitted work or bypass attempt limits. |
| `packages/orchestration/src/supervisor.ts` | Simplify | Keep run discovery and leases. Replace workflow-specific branching with interpreter recovery. | Preserve ownership-derived worktrees, exclusive leases, and bounded resume. |
| `packages/orchestration/src/execution-contract.ts` | Retain enforcement | Compile Pel budgets and authorization requirements into this contract. | No plan can expand paths, time, retries, actions, or milestones after admission. |
| `packages/orchestration/src/execution-ledger.ts` | Retain | Keep durable admission, reservations, and accounting. | Crash tests preserve reservation identity and prevent budget reuse. |
| `packages/orchestration/src/execution-terminal-policy.ts` | Retain | Normalize interpreter termination through the existing terminal policy. | Success requires all required milestones and evidence. |
| `packages/orchestration/src/queue-admission.ts` | Replace fixed topology incrementally | Derive resource pools from admitted provider capabilities. Keep Pueue as a temporary transport. | Existing queue refusal, quoting, readiness, and accounting cases remain equivalent. |
| `skills/foreman/scripts/vendor-multiround.sh` | Retire behavior | Express bounded attempts and progress checks in Pel. | Preserve path-bound progress evidence and reject manufactured progress artifacts. |
| `skills/foreman/scripts/lib/worker-cmd.sh` | Retire behavior | Use the typed provider request encoder. | Preserve argv, prompt bytes, cwd, environment, and exit status across transports. |
| `skills/foreman/scripts/adapters/{grok,codex,claude,agy}.sh` | Replace with thin adapters or retire | Provider transports live in `packages/providers`. | Prove each advertised transport on the exact installed CLI or API version. |
| `components/council/packages/adapter-{grok,claude,codex}/src/preflight.ts` | Extract reusable codecs | Use shared provider transports with canary-specific policy inputs. | Retain terminal-event validation, usage bounds, and designated structured-output rules. |
| `components/council/packages/application/src/schema-lowering.ts` | Retain and share | Lower response schemas according to verified provider capability profiles. | Reject weakening transformations without executable host validation. |
| `components/council/packages/application/src/ports.ts` | Consolidate transport ports | Share process and provider observations. Keep review-specific ports local. | Compiler checks and contract tests preserve error and cancellation semantics. |
| `components/council/packages/application/src/prompt-preflight.ts` | Retain policy, simplify transport assembly | Bind trusted instructions and untrusted evidence into the shared request envelope. | Preserve trust separation, artifact hashes, output schema, and ready-token binding. |
| `packages/orchestration/src/vendor-preflight-{contract,manifest,live,store}.ts` | Consolidate capability records | Use a versioned provider registry with observed and declared evidence. | Preserve unknown, missing, unauthenticated, outdated, and unsupported outcomes. |
| `packages/orchestration/src/credential-profile*.ts` | Retain | Resolve secrets and profile leases outside Pel source. | Plans and logs contain secret references, not secret values. |
| `packages/launcher/src/supervise.ts` | Retain | Supervise CLI transport effects with scoped child lifetime. | Preserve timeout, cancellation, stream bounds, and process-tree cleanup. |
| `launcher/src/` | Review for retirement | Treat retained launcher code as migration evidence. | Confirm all callers use the Node.js runtime before removing obsolete paths. |
| `packages/event-log/src/` | Retain | Use one append-only execution history with versioned plan events. | Replay, monotonic sequencing, identity, and corruption tests pass. |
| `packages/core/src/` | Retain | Canonical bytes, strict decoding, hashes, and typed failures. | Avoid a second canonicalization or identity implementation. |
| `packages/policy/src/` | Retain policy, reduce duplicate configuration | Resolve Pel requirements against current admission and release policy. | Preserve authorization and exact-candidate evidence checks. |
| `packages/session-store/src/`, `packages/graph-store/src/`, `packages/memory/src/` | Retain | Store sessions and derived knowledge projections. | Plan state remains reconstructible from its authoritative history. |
| `packages/orchestration/src/graph-context.ts` | Retain | Supply bounded, source-bound context as a read effect. | Advisory knowledge cannot authorize an effect or promote release authority. |
| `skills/foreman/scripts/{lane-run,worker-run,audit-run,resume,watch,lane-supervise}.sh` | Reduce to thin adapters, then retire | One `foreman plan/run/resume/status` interface dispatches compiled plans. | Preserve existing CLI compatibility until callers migrate. |
| `skills/foreman/runtime/dist/` | Rebuild only | Generated output from TypeScript packages. | Runtime verification confirms source and bundle parity. |
| `formal/specs/` | Retain and extend later | Review plan lifecycle and effect admission against existing properties. | State formal coverage precisely. Do not claim proof from a graph or simulation alone. |

## Simplification acceptance criteria

Measure complexity before implementation. Record production lines, executable entry points, provider conditionals, workflow loops, and durable state owners.
Use the source inventory to define the baseline. Exclude generated bundles from line counts.

The first vertical slice must satisfy these criteria:

1. Author one Pel plan for implement, verify, and review.
2. Execute it through one interpreter and the existing ledger.
3. Use two provider profiles without changing the plan's control flow.
4. Resume from an interrupted effect without duplicating a completed side effect.
5. Produce existing evidence identities and release-policy inputs.
6. Delete one complete legacy orchestration path after parity tests pass.

Do not count a second wrapper layer as simplification.
Do not remove safety checks merely to reduce line counts.
Target one owner for plan execution, one owner for admission accounting, and one transport implementation per protocol family.

A later slice migrates Council review to the same execution path.
Another slice replaces fixed provider queues with capability-bound resource pools.
Retire legacy command interfaces only after all callers use the new path.

## Graph coverage and limits

`SOURCE-INVENTORY.json` hashes all 1,917 tracked files at the source baseline.
The first-party AST pass covers 522 files, including Bash, Python, and PowerShell.
The code graph contains 6,714 nodes and 18,237 directed edges.
Its HTML shows 219 aggregated communities because the full graph exceeds 5,000 nodes.

The separate vendor fragment covers 62 supported files, including four extensionless Bash scripts.
Vendored HTML and CMD files have inventory coverage only.
Seventy-seven first-party code files lack supported extraction: 68 Bats files, five Quint files, HTML, CSS, and two Dockerfiles.
Twenty-seven generated JavaScript bundles have inventory coverage only.
The deliberately invalid launcher-build fixture has partial AST coverage.

The Markdown pass covers headings and explicit links in 807 tracked files.
It does not provide semantic review of their claims. Forty text documents have inventory coverage only.
Historical documents and code remain evidence of their own contents, not current release authority.

Raw first-party extraction contains 1,554 dangling import edges, 41 self-loops, 717 exact duplicate edges, and 1,206 directed edge collapses.
There are 23 duplicate node IDs before graph construction.
The broad code graph therefore supports navigation but cannot establish complete dependency absence.
Deletion gates must combine graph queries with direct source searches and execution tests.

Every dangling first-party edge is an import reference. Council barrel exports and external module references account for visible examples.
The research aggregate can preserve these edges with explicit unresolved-reference nodes.
Those nodes establish an emitted reference, not a resolved declaration.

The existing canonical graph remains unchanged. Its qualifier requires Graphify 0.9.48 and zero model tokens.
The advisory graph uses Graphify 0.9.61. Upgrade qualification in a separate implementation change with deterministic replay and freshness tests.
