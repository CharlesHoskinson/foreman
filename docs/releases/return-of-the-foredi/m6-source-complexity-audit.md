# Fixed-union source complexity audit

Candidate: `f734d99caf17c3ac5e958a161627eecdc6e43494`.
Authority: `/tmp/foreman-dsl-research/m6-final-simplification.json` and `docs/release-metrics/foredi-baseline.json`.
Read-only audit; no source changes, builds, test runs, commits, or revised acceptance rules.

## Result

The candidate fails the required simplification target by a large margin. The fixed baseline is 6,916 nonblank production lines. The 40% reduction permits at most 4,149 integer lines. The candidate has 48,873, so it must remove at least **44,724 counted lines (91.51% of the current total)**. Required instruction tokens also fail: 17,477 against a baseline of 16,502 and a target of 8,251.

There are credible architectural reductions. They should be pursued, not replaced with a new metric or acceptance claim. This audit does **not** establish a feature-preserving implementation below 4,150 lines. It also does **not** prove that such an implementation is mathematically impossible. The evidence establishes that local adapter retirement or ordinary deduplication cannot close this gap. A passing implementation would require a much more radical architecture, including substantial simplification of retained infrastructure as well as the new language and providers.

## Exact accounting

The script used the metric's existing file rows unchanged. For each path it read the fixed baseline Git object, counted its nonblank lines, and classified new versus preexisting files. The complete derived inventory is `/tmp/foreman-dsl-research/m6-complexity-inventory.json`.

| Counted group | Files | Candidate lines | Baseline lines in these same paths |
|---|---:|---:|---:|
| Original 15-file cohort survivors | 3 | 1,053 | 1,464 |
| Other preexisting full files included by the frozen union | 32 | 17,605 | 17,899 |
| New Pel engine, `packages/pel` | 25 | 10,274 | 0 |
| New provider package | 28 | 6,775 | 0 |
| New `pel-*` host/adoption files, excluding fixture-named files | 77 | 11,381 | 0 |
| New fixture-named support files, still counted by the fixed rule | 11 | 1,637 | 0 |
| Other new counted source/examples | 17 | 148 | 0 |
| **Total** | **193** | **48,873** | **19,363** |

The original cohort itself is substantially retired: 12 files are absent and its three survivors total 1,053 lines. That fact does not establish the required net reduction. New files contribute 30,215 lines. Preexisting counted files contribute 18,658 and are 705 lines smaller than their corresponding baseline contents. Thus the result combines real new implementation size with the mandated inclusion of full retained files. Neither part may be silently excluded.

`packages/orchestration/src/pel-simplification.ts:75–88` fixes the relevant classification and union. It counts full changed source files, all production under `packages/pel` and `packages/providers`, and surviving original cohort paths. Reverting a necessary export, moving functions, renaming fixture helpers into an excluded directory, minifying declarations, or replacing source with an opaque generated payload would not be a product simplification. I propose none of those actions.

Largest retained files: execution ledger 2,461; fm-session main 1,838; run journal 1,401; terminal policy 1,295; execution contract 1,147; secret scanner 1,122. The first five alone total **8,142**, already 3,993 above the entire permitted result. This is a **conditional lower bound if these implementations are retained unchanged**, not a lower bound on every possible implementation of their requirements. It shows why deleting every newly added line would still be insufficient while retaining the current infrastructure.

Largest new components: evaluator 2,075; abstract analysis 1,625; API transport 977; generation workflow 910; host contract 860; continuation validation 828; Grok ACP 804; compiled fixture main 761; host arguments 705; provider profiles 701; authoring snapshot 696; run contract 695; recovery 609; Pel journal 584; authoring CLI 574; Gemini transport 565; host descriptors 557.

## Three architectural simplifications worth implementing

Estimates below are net physical nonblank source lines at the present formatting, after adding the shared replacement. They are bounded engineering estimates, not measured deletions or guaranteed acceptance. Tests must keep all current semantics. The ranges should be replaced by actual candidate measurements after each change.

### 1. One bounded structural codec foundation, with explicit semantic validators

**Observed duplication:** `packages/pel/src/host-contract.ts:152–240` implements strict records, dense arrays, exact keys, bounded JSON and freezing. `host-arguments.ts:25–105` implements related strict shape and bounded graph primitives. Snapshot, runtime validation, continuation, provider output, host receipt and execution binding decoders repeat portions. The current continuation already imports `exact`, `boundedJson` and `runtimeValidators`; do not pretend all 828 lines are duplicate. Its task graph, counter, effect and lexical identity checks are essential.

**Change:** consolidate strict data traversal and reusable field codecs into one small bounded, descriptor-safe implementation. Define immutable record schemas once and reuse their validators and field lists. Keep graph reference resolution, canonical hashes, scope/counter consistency and authority checks as named semantic functions. Do not merge authentic registry brands with arbitrary user JSON or erase per-format byte/depth/node limits. Preserve old serialized formats and environment identity.

**Pool:** roughly 4,000–5,000 lines across host contract/arguments, snapshot, runtime validation, continuation and selected host/provider decoders. **Estimated net removal: 800–1,400 lines.** The estimate excludes type-only compression and JSON schema generation tricks. A first pilot should target the repeated low-level validators; expect 150–300 actual deleted lines before expanding.

**Required evidence:** existing host-contract, host-arguments, continuation, snapshot and runtime-validation suites; duplicate/nonenumerable/getter/sparse-array and bounds rejection; distinct captured environments; continuation roundtrip and revision replay; M4 crash tests and M5 receipt-provenance tests. A wire digest change is a compatibility change, not a routine cleanup.

### 2. One native transport session kernel; keep vendor wire dialects explicit

**Observed duplication:** `packages/providers/src/transports/grok-acp.ts` (804), `gemini-cli.ts` (565), `claude-code.ts` (239), and `codex-app-server.ts` (244) repeat request-binding validation, schema selection, output accumulation, identity-keyed active/observed maps and terminal/cancellation cleanup. `native-process.ts` already owns bounded framing and process supervision; retain it. The API transports already share the 977-line `api-transport.ts`; replacing four API dialects with another abstraction is not a new saving.

**Change:** extract a scoped session kernel for identity registration, exactly-once terminal projection, output/usage accumulation and observed cancellation state. Each dialect supplies only protocol handshake, event decoding, permission reply encoding and supported resume/observe behavior. Reuse a pure validated request-selection function in authoring, execution and qualification assembly where the exact checks match. Keep the M2 generation attempt budget separate from the M4 durable action ledger; those are different authority scopes and cannot be merged merely to reduce lines.

**Pool:** 1,852 native dialect lines plus selected repeated setup in provider-generation/execution/readiness. **Estimated net removal: 450–850 lines.** Grok delayed permission acknowledgement, Codex approval semantics and Gemini's unavailable bidirectional tool mode are essential differences; a generic callback must not hide or weaken them.

**Required evidence:** full eight-transport fixture matrix; exact model/control/prompt/schema tests; Grok durable permission-before-allow tests; native process SIGKILL/cancellation; confirmed versus unknown remote outcomes; provider tool/cursor replay; generation accounting and exact live qualification evidence on the claimed supported cells. Council adapters must retain their existing identities and behavior.

### 3. Finish retiring duplicate legacy command ownership, preserve readers and shared authority

**Observed residue:** counted legacy shell files total 2,679 lines excluding the 118-line clock preflight. Largest are `lib/eventlog.sh` 496, `lib/evidence.sh` 445, vendor concurrency test 355, `wt-new.sh` 240, config 220, telemetry 219, worktree cleanup 215 and merge gate 210. These are not all dead code. `gate-eval.sh` and `checks-run.sh` still source evidence/telemetry; NATS setup sources config; cleanup sources eventlog and invokes worktree cleanup; the search agent still instructs `wt-new.sh`. A no-match search limited to TypeScript would miss those callers.

**Change:** choose a complete vertical slice: merge-gate freshness and cleanup/report archival. Route still-supported commands to the existing candidate/publication transaction and Git/worktree services after matching the old assertions; retain a thin CLI adapter only where a caller needs it. Remove the second shell implementation and its now-unreferenced helpers. For supervisor legacy state, retain the strict round decoder, ownership observations and terminal/no-controller diagnostics; remove only obsolete dispatch plumbing proven unreachable. `supervisor.ts:312–431` still computes read-only resume decisions and then reports `LegacyControllerRequired`, so its entire body is not dead. `round-reducer.ts` (538 lines) is a required historical reader, not a spare scheduler.

**Estimated net removal: 500–900 lines** for a properly migrated first slice. The entire 2,679-line shell residue is only an upper bound on available source, not an authorized deletion amount. New TypeScript integration counts too. Do not claim savings for transferring the same logic elsewhere.

**Required evidence:** old merge freshness/release-policy/dirty-worktree archival assertions; concurrent Git/worktree safety; historical event/cursor identity; live ownership and no-controller behavior; Council/search/NATS caller smoke tests where affected; architecture pin retirement backed by the actual caller map; M5 publication/CAS recovery. This slice needs an explicit contract-preserving migration, not deletion based on age.

## Feasibility and next decision

The three estimates total **1,750–3,150 real lines**, leaving approximately **45,723–47,123** counted lines. Even their optimistic end remains more than eleven times the allowed total. They are useful product simplifications but cannot honestly be presented as an M6 target plan.

A larger reduction may exist in the dual concrete/abstract evaluator and its extensive serialized state. However, both execute different required semantics: concrete closures/counters/recovery versus bounded static alternatives/capability previews. I found no basis in this bounded audit for deleting either engine. A shared semantic operation layer is a research hypothesis, not an estimated 10,000-line removal. Likewise, the host handlers reuse the existing ledger, journal and owner; the mere number of `pel-*` files is not evidence of 87 competing controllers.

Recommended implementation order: first the codec pilot, then the native session kernel, then one complete legacy retirement slice. Require each to delete duplicated responsibilities and pass unchanged behavioral tests. Measure the same fixed union after each. In parallel, before promising release acceptance, write a feature-to-component size budget for a radical redesign that includes the 8,142-line retained authority/journal/session set. If that design cannot demonstrate a credible route under 4,150 lines while keeping all M1–M6, Council, recovery and authority behavior, report the fixed requirement as unmet. Do not label the current growth a simplification success.

The metric diagnoses an important product problem even though full-file inclusion magnifies its numerator: the user-facing five-line workflow now rests on 30,215 new source lines and extensive retained infrastructure. The next work should reduce those responsibilities and duplicated implementations, not make the five-line example stand in for the total implementation cost.
