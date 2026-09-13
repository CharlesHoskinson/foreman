---
title: Pel adoption and compatibility review
status: planning
captured_at: 2026-09-12
author: Foreman research session
source_url: https://arxiv.org/abs/2505.13453v2
---

# Adopt Pel and extend its execution contract

The user selected Pel as Foreman's common language for planning and execution.
Implement the paper's language in strict TypeScript on Node.js 24.
Publish the selected semantics, explicit corrections, and Foreman extensions together.
Avoid a second orchestration language beneath Pel.

This review read all 29 PDF pages, including the grammar, examples, runtime discussion, limitations, and references.
Sources are in [sources/pel](sources/pel/). [manifest.json](sources/pel/manifest.json) records retrieval results and SHA-256 digests.
The reviewed Foreman base is `441c3fb9f6acb2656760d03cc79e7c706fb8b7dd`.
This is a design review. It contains no implementation or conformance-test results.

## Upstream status and adoption boundary

The paper is Behnam Mohammadi's *Pel, A Programming Language for Orchestrating AI Agents*, arXiv `2505.13453v2`.
ArXiv dates v1 to April 3, 2025, and v2 to June 9, 2025.
The v2 change note reports an email update and a font-color change.
The PDF itself is dated June 8, 2025.

No official public implementation was verified on September 12, 2026.
The paper has runtime descriptions but no repository link.
The [author's homepage](https://aplaceofmind.notion.site/Behnam-Mohammadi-6104801661e0448998b58569b25d1d2e) states: “Pel will soon be generally available on Github.”
Three archived GitHub repository searches found no attributable Pel language implementation.
These searches establish the scope of this investigation. They do not prove that no implementation exists.

Consequently, there is no verified upstream commit, package version, code license, release activity, CI history, or test suite.
The paper describes Python objects and `asyncio` tasks. This does not establish a downloadable Python runtime.
The PyPI package named `pel` is an unrelated build system. Do not install it as this language.

The archived arXiv abstract links the arXiv nonexclusive distribution license.
This is a paper distribution statement, not a software license for a runtime.
Keep third-party source rights separate from Foreman's license.
Use an attributed implementation of the published design, without claiming an upstream fork or upstream test compatibility.
If an official repository appears, verify author linkage, license, commit, semantics, and tests before importing code.

The author's Notion page returned an HTML application shell through Scrapling.
The relevant statement was separately visible through web retrieval.
The capture note records that distinction.

## What Pel contributes

| Paper location | Published design | Foreman adoption |
|---|---|---|
| §§4.1–4.2, pp.10–12 | Parenthesized calls, evaluated bracket lists, symbols, keywords, pairs, numbers, strings, booleans, nil | Preserve the syntax and data model in a versioned language profile. |
| §4.3, pp.12–14 | Closures, lexical environment, fixed argument specifications, partial application, named arguments | Preserve pure closures and partial application. Reject mixed positional and named arguments. |
| §4.4, pp.14–15 | Rendered triangle pipe and recursive `^` insertion | Use the explicit ASCII normalization `\|>`. Specify placeholder scope and repeated insertion. |
| §4.5, pp.15–16 | Callable lists, indexing, slices, and key lookup | Preserve the concept. Resolve conflicting index examples explicitly. |
| §4.6, pp.16–18 | Non-strict built-in `if`, `case`, `for`, `do`, and `do/async` | Preserve selective evaluation. Bound all execution through the host contract. |
| §4.7, pp.18–19 | Natural-language predicates invoke an LLM | Make the invocation an explicit effect with a recorded result. |
| §5.1, pp.19–22 | Restarts retain completed work and allow expression replacement | Use durable results and validated plan revisions. Preserve existing execution limits. |
| §5.2, p.22 | Symbol dependency analysis schedules top-level forms concurrently | Extend dependency analysis with effect conflicts and resource ownership. |
| §6, pp.22–25 | Router agents generate Pel that invokes subordinate agents | Resolve agent symbols through one capability registry. Keep provider details outside the language. |

## Corrections and limits that the language profile must record

1. **Indexing conflicts.** Section 4.2 specifies one-based lists. Early §4.5 examples agree.
   Later examples return `6` for index `1` in `[5 6 7 8]` and iterate indices `0, 2, 4`.
   Select one-based indexing for the first profile. Reject zero rather than silently changing the earlier specification.
   Record the conflicting examples as errata, with proposed outputs `5` and `[5 6 7]` for the positional examples.
2. **Incomplete lexical rules.** The printed grammar has no separate caret production, but examples require a standalone caret placeholder. The PDF SYMBOL class excludes `|` and `>`, not caret.
   Define a separate caret token. Specify pipe precedence, quoting, escapes, Unicode, and token boundaries.
   The printed string regex does not implement the claimed C-style escapes.
3. **Arity conflicts.** Section 3 states that functions have fixed arity and no variadic arguments.
   Section 4.6.4 accepts multiple `do` expressions. Some `print` examples also suggest variable argument counts.
   Define sequence-taking built-ins precisely. Do not infer general variadic function support from examples.
4. **Nil and empty calls.** Section 4.2 treats `()` as nil despite the operator-first rule for calls.
   Preserve this explicit empty-form exception. Reject nil as a Boolean condition, since its truthiness is undefined.
5. **Grammar is not authorization.** An allowed file or network function can still receive a harmful argument.
   An allowed agent invocation can execute unrestricted code through its provider CLI.
   Restrict capabilities at dispatch and preserve process isolation, path constraints, credential isolation, and evidence checks.
6. **Grammar is not a security proof.** A generic symbol token does not itself enforce a function allowlist.
   An unrestricted balanced-parenthesis grammar is not equivalent to an ordinary finite-state regular expression.
   Some decoding engines support context-free grammars. Provider JSON-schema support does not imply support for arbitrary Pel grammar constraints.
7. **Name dependencies are insufficient for concurrency.** Two forms can write the same file without sharing a Pel variable.
   Serialize conflicting effects. Treat unknown effects conservatively. Permit parallelism only when dependencies and effects allow it.
8. **Restarts are not transactions.** Preserving local values does not undo remote writes or provider billing.
   Record completed effect receipts. Resume from receipts. Reconcile uncertain outcomes before retrying non-idempotent effects.
9. **Natural-language predicates are nondeterministic.** Record prompt, model identity, request identity, and the typed Boolean result.
   Replay that result. Keep release authorization and access decisions in deterministic host policy.
10. **Benefits remain hypotheses.** The paper supplies design arguments and examples, not a comparative benchmark suite or a safety theorem.
    Its learnability, cost, latency, and robustness claims need Foreman measurements.

## Minimal implementation structure

Create one language module inside `@foreman/orchestration`, unless measured coupling justifies a separate package.
Use pure TypeScript for tokenization, parsing, source spans, normalization, static validation, and dependency analysis.
Use Effect for resource ownership, bounded concurrency, cancellation, timeouts, provider invocation, and recovery.
Use an interpreter or typed bytecode. Do not translate model output into JavaScript for `eval`.

A Pel document is the authored plan. Its normalized AST is the machine representation of that same plan.
Bind execution to the document digest, language profile, capability registry digest, and approved execution contract.
Derived JSON is a cache or transport representation. It must not become a separately edited plan.

Keep Foreman extensions in a reserved `fm/` capability namespace.
Initial capabilities need only agent invocation, artifact inspection, verification, and audit requests.
Keep retry limits, deadlines, path authority, and publication authority in the existing typed execution contract.
Do not introduce new top-level language keywords for each provider, stage, or policy field.

Adapters translate a validated invocation into the provider transport and normalize its events and results.
They do not choose workflow order, grant authority, own retries, or decide acceptance.
Model identities and verified capabilities remain data in the registry.
The same Pel program must execute against recorded provider fixtures without changing its control flow.

Start with ordered execution and explicit `do/async`.
Add automatic concurrency only after conflict tests establish the scheduler's behavior.
Support durable expression replacement as a versioned plan amendment.
Completed effects remain bound to their original plan and receipt identities.
A replacement expression cannot expand authority or reset the execution budget.

## Simplification map

| Existing machinery | Target treatment | Evidence to retain |
|---|---|---|
| Workflow order spread across `lane-run.sh`, `vendor-multiround.sh`, and `audit-run.sh` | Move authored workflow composition into Pel. Remove duplicate sequencing after parity. | Existing stage and terminal-state tests. |
| Repeated provider argv and prompt details | One typed adapter per provider transport, with model profiles as data. | Exact argv boundaries, output capture, authentication probes, isolation tests. |
| Separate hand-maintained workflow representations | One Pel source with derived normalized forms and documentation. | Digest binding and deterministic normalization. |
| Repeated repair prompts and local retry loops | One bounded restart mechanism using execution receipts. | Retry exhaustion, cancellation, uncertain-result, and no-op evidence tests. |
| `round-reducer.ts` and execution policy | Retain as host invariants initially. Consolidate only duplicate ownership after migration. | Attempt identity, terminal rejection, bounds, authority, and recovery behavior. |
| `execution-ledger.ts`, event log, and SessionStore | Retain authoritative state and durable recovery. | Transactional identity, supersession, replay, and at-least-once delivery contracts. |
| `packages/launcher` supervision | Retain the process/resource boundary. | Process-tree cleanup, heartbeat, signal, and timeout behavior. |
| GraphStore, graphify, and wiki | Retain as derived knowledge views. Keep them outside execution authority. | Source provenance, freshness, explicit inferred edges. |

The current adapter design records real vendor differences and past failures.
Its shell implementation guidance is historical under the Node.js/TypeScript rule.
Keep those observed constraints while replacing the implementation language.
Simplification succeeds when duplicate control paths disappear, with required invariants intact.
Do not measure success only by DSL line count.

## Compatibility and release experiments

The first conformance corpus should distinguish paper-derived cases, errata decisions, Foreman extensions, and unsupported features.
Every case needs source section, input, normalized AST, result or typed error, and expected effects.
No claim of upstream compatibility is valid until a verified upstream implementation passes differential tests.

Required cases include:

- Calls versus bracket lists, keyword pairing, quoted keys, nil, numeric bounds, escaped strings, and malformed tokens.
- Closure capture, partial application, default arguments, excessive arguments, and mixed argument rejection.
- Pipe insertion at default, explicit, repeated, nested, and quoted positions.
- One-based indexing, inclusive slices, missing keys, empty lists, and invalid indices.
- Non-strict branch selection, `case` ordering, `for` result order, and `do/async` last-source-expression semantics.
- Independent reads, conflicting writes, dynamic dependencies, cancellation, and bounded parallelism.
- Crash after provider completion but before receipt publication, duplicate receipt delivery, and uncertain remote outcomes.
- Plan amendments that attempt to change authority, reset limits, reuse stale evidence, or alter completed effects.
- Cross-family audit checks against actual provider/model identity and the exact candidate digest.

Compare matched workloads under current Foreman and the Pel implementation.
Measure task correctness, real deliverables, orchestration-only latency, model calls, input/output tokens, repair rate, recovery success, and duplicate control paths.
Use identical recorded provider responses for deterministic comparisons.
Separate those results from live model performance and provider outages.
Require strict TypeScript checks, compiled Node.js 24 execution, focused conformance tests, and existing invariant tests before migration.

## Karpathy's durable wiki pattern

The [primary gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) is captured at revision `ac46de1ad27f92b28ac95459c782c07f6b8c964a`.
Its raw Markdown is [karpathy-llm-wiki.md](sources/pel/karpathy-llm-wiki.md).
The gist proposes three layers: immutable sources, an LLM-maintained linked wiki, and a schema that defines maintenance rules.
Its operations are ingest, query, and lint. A content index supports navigation, while an append-only log records changes.
Useful answers become durable pages. New sources can revise claims and expose contradictions.

For Foreman, separate source facts, proposed decisions, verified behavior, contradictions, and open questions.
Each claim should link to its source and capture date. Each decision should name its status and rationale.
Keep the execution ledger authoritative. Wiki prose and graph edges provide context, not permission to execute.
The gist is an optional pattern, not a requirement for embeddings, a hosted service, or a particular Obsidian plugin.
This review does not install or configure the vault.

## PDF glyph verification after the OpenSpec audits

Visual inspection corrected errors in the text extraction. The pipe prints as a hollow right-pointing triangle. The PDF keyword character class includes `*`, `<`, and `>`, and does not include caret. The extracted `^>` spelling is not reliable source syntax. The release uses `|>` as an explicit ASCII normalization, with `^` as the placeholder. See the [page images and inspection record](sources/pel/glyph-verification.md). Original PDF and text captures remain unchanged.
