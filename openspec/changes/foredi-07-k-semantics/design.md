# Pel K semantics design

Status: **PLANNED**. No definition, conformance result or theorem is delivered by this planning change.

## Normative domain

The target is the selected Foreman Pel profile, not an invented upstream implementation. Bind `packages/pel/src/profile.ts`, `docs/reference/pel/compatibility.md`, `docs/reference/pel/extensions.md`, the M1 OpenSpec and `packages/pel/test/fixtures/paper-v2.json` by exact source hashes. Inventory all current constructors and builtin signatures before implementing rules. M4's retry, race, transport, ledger and publication policies are external host behavior; model their M1 child interfaces without claiming those policies proved.

The paper's compatibility decisions and independent fixture expectations constrain both implementations. A mismatch is a counterexample to investigate, not permission to automatically copy the TypeScript result into K. Changes to the normative profile need their own compatibility decision and invalidate affected evidence.

## Toolchain and source observations

The official [K user manual](https://kframework.org/docs/user_manual/) describes rewrite-based definitions, result sorts and evaluation contexts. Use explicit control frames where Pel is non-strict; do not attach blanket strictness to branches. The [evaluation-order lesson](https://kframework.org/k-distribution/k-tutorial/1_basic/14_evaluation_order/) distinguishes unordered strictness from sequential argument evaluation. The [configuration lesson](https://kframework.org/k-distribution/k-tutorial/1_basic/15_configurations/) supplies the cell model.

Plan against [K v7.1.337](https://github.com/runtimeverification/k/releases/tag/v7.1.337), revision `4a46d1231473b599c699160132fd6e76a5c46406`. This is a selected reproducible starting version, not a claim that it will remain latest. On 2026-09-13, local `kompile --version` reported v7.1.337. No Pel definition was compiled. Pin actual executable/backend/artifact hashes before implementation. Use LLVM for concrete execution; select and verify the Haskell proof backend separately for scoped claims. Missing tools must report unavailable. Do not install tools or download code automatically during a test.

Read-only Moriarty reference checkout: `/home/charl/Moriarty`, observed HEAD `0990144b8f318383e899c8d247ff409066a6cc7a`. These exact files informed the style:

- `openspec/sprints/sp03-executable-bounded-semantics-in-k.md`: specified-only status, file/interface map, independent expected results, explicit domains and separate correspondence obligations.
- `experiments/moriarty-language/spec/semantics.md`: separate authority/observation assumptions; a source example or trace is not a proof or ledger acceptance.
- `experiments/moriarty-language/formal/k/moriarty.k`: explicit computation and result cells with structured rejection rules.
- `experiments/moriarty-language/formal/k/expression-v1.k`: separate semantic phases and located rejection observations.
- `experiments/moriarty-language/formal/k/toolchain.lock.json`: actual version/revision/backend and executable hashes.

The sprint's proposed `claims.json` was absent in that checkout. Existing K files do not establish completion of Moriarty's proposed metatheorems. Its Python/MJS wrappers are observations, not Foreman implementation templates. Moriarty status was read without dispatching work. All official URLs above were consulted on 2026-09-13.

## Proposed file and interface map

| Future path | Responsibility |
| --- | --- |
| `formal/pel/toolchain.lock.json` | Exact K/backend/tool hashes and supported host prerequisites |
| `formal/pel/{syntax,values,control,host,continuation,pel}.k` | Declarative syntax, small-step rules and top-level definition |
| `formal/pel/{claims.k,claims.json}` | Scoped claim statements, assumptions and actual result references |
| `packages/pel/test/k/*.test.ts` | Cases named by the catalog; independent expected observations |
| `packages/pel/test/k/fixtures/*.json` | Frozen corpus, explicit receipt schedules and counterexamples |
| `packages/orchestration/src/pel-semantics-{contract,runner,main}.ts` | Closed observation codec and bounded development-tool execution |
| `docs/guides/pel/semantics.md` | Scope, examples, evidence interpretation and unresolved correspondence |

These outputs are planned. Do not create a second expression parser in a TypeScript wrapper. K parses Pel independently for syntax comparisons; a separate validated AST import supports configuration-level tests. The AST import cannot establish source-parser correctness. All executable glue stays TypeScript/Node24. Reuse existing process services and scoped cleanup. Run with explicit argv, finite input/output/time limits and a temporary build directory; no shell fragments, network or provider tools. Do not add a new durable store, authority registrar or workflow owner.

## Configuration and steps

Proposed cells: `k` for the current computation; `tasks` and `ready` for finite dependency tasks; `envs` for immutable lexical environment records; `values` for task results; `pending` and `receipts` for host boundaries; `counters` and `limits`; `options` and `profile`; `lastSource` for result selection; `diagnostic`; and `trace` for observable semantic steps. Reference lexical environments by identifiers so capture sharing and cycles are explicit. Define data, syntax and closure sorts separately.

Each computational rule corresponds to a named M1 semantic operation. Administrative heating/cooling and data projection are not Pel reductions. Define exactly which rule charges each counter, and reject before crossing its bound. Never compare `krun` rewrite counts directly with M1 reductions. Numeric semantics must model finite binary64 values, safe integer results and normalized negative zero; K's unlimited integers are not a substitute. First implement distinguishing rounding and overflow cases before extending arithmetic.

For automatic mode, explicitly derive the allowed ready set and stable request identities. Compare the same externally supplied receipt schedule against both machines. Independent interleavings may use a declared partial-order projection; dependent ordering and effects cannot be sorted away. Ordered mode must preserve its deterministic order. Both modes select the final source expression's value, not the last completed task.

`PelKObservationV1` is a proposed closed test record containing profile/source/options identities, state (`done`, `suspended`, `failed`), canonical value, located diagnostic, semantic counters, ready and already-emitted requests, pending identities, consumed receipt identities and the continuation projection. Closure comparison uses graph identity correspondence, not printed function text. Compare request arguments and schema bindings before any normalization.

Host events are finite input data. Print becomes an observed output event. A language predicate receives a supplied typed Boolean or failure. Unknown completion stays pending. Source data never supplies filesystem permission, a budget reservation or publication evidence. The definition cannot execute an LLM, Git command, shell or HTTP request.

## Continuation and evidence boundaries

Map every supported M1 continuation component to K cells, including captured defaults, syntax arguments, counters, options, pending requests and child merge markers. Validate graph references and exact source/profile/registry bindings. Compare restoration at semantic boundaries; byte equality applies only to a deliberately shared canonical wire format. K internal configuration serialization is not automatically the M1 checkpoint format.

Use the M1 public child/replay APIs as the differential reference. Model completed-prefix restrictions, receipt reuse and exactly-once child charging. M4's crash persistence, ledger atomicity, native cancellation and external authority remain separate production requirements.

## Conformance and proof status

Use three inputs to a comparison: independent expected outcome, K observation and TypeScript observation. Cover every paper/profile row and current M1 regression family. Add fixed-seed finite programs and distinguishing mutations. Retain source, receipt schedule, expected/actual observations and all definition/tool/runtime/comparator hashes for a failure. Missing K, timeout, stuck execution and a Pel rejection are different outcomes.

Each claim record names statement, domain, assumptions, source/definition digest, backend, command, limits, result and artifact hashes. Status values are `planned`, `executable`, `tested`, `proved`, `refuted`, `unknown` or `unavailable`; `tested` never implies `proved`. Required scoped claims are at-most-once matching receipt consumption and nondecreasing semantic counters for the finite closed host-script domain. A false-invariant control must fail. A timeout leaves the claim unknown and prevents completion of that required claim.

General determinism, termination, parser preservation, evaluator correspondence, host safety and full equivalence are separate open claims unless a checked proof establishes their precise domains. Differential tests support a correspondence hypothesis; they do not discharge it. The assumptions include correctness of the pinned K tool/backend, numeric encoding, observation projection and supplied abstract host responses. Report these assumptions rather than importing host guarantees into the theorem.

## Sprint acceptance

All twenty catalog scenarios must execute, every included constructor must have positive and negative coverage, mutation controls must detect changed behavior, and the two scoped claims must have checked results on the exact definition. The guide must keep broader correspondence open. No current task is complete. This sprint does not change the M6 metric cohort or thresholds, numerical-release reconciliation, Council policy, recovery ownership or production authority.
