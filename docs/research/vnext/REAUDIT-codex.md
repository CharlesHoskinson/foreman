# Foreman v0.2.9 Fix-Round Re-audit — Codex GPT-5.6 Sol

## Verdict

**BLOCKED.** The fix round closes several important pieces, especially the
same-diff interrupted-audit hazard, the duplicate ownership of the evidence
helper, M5 ownership, explicit uncomputable metric states, and the
`GraphNode.graphify_version` schema mismatch. It does not close the workstream
as a whole. Weighted most heavily, the new acceptance predicates introduce
fresh false-positive and undefined-state paths: `"directed": true` does not
establish preservation of parallel same-direction edges; a pre-existing
schema-valid artifact lets a no-op audit/planning lane pass; the audit evidence
root is simultaneously required to be external and to be a Git worktree; the
tree digest is undefined for a valid deletion; the four-code lock refusal enum
has no state for an available but unusable/unsafe `flock`; and multiple kill
criteria violate their own one-metric/one-fixed-number rule or have undefined
zero-denominator cases. In addition, the landing-order script derives its
headline from a truncated, nonexistent path and its current output does not
match the committed summary. Strict OpenSpec validation remains green because
these are semantic and cross-file defects.

## Findings closed

1. **Prior finding 1's same-diff interrupted-attempt defect is genuinely
   closed.** `three-outcome-verdicts/specs/audit-verdict/spec.md:73-114`
   allocates and records the attempt before spawn, replaces the old verdict
   with `UNVERIFIED/in_progress`, and makes the gate compare the published
   attempt and `state == complete` (`:401-469`). The control at
   `design.md:337` is the right known-bad case: an approved same-diff audit is
   superseded and then killed. This prevents inheritance of the prior approval.
   The evaluated-tree half of finding 1 is not closed; see below.

2. **Prior finding 2's duplicate ownership is closed.**
   `evidence-contracts` is the sole owner of `lib/evidence.sh` and
   `vendor-multiround.sh`; `vendor-adapter-contract` is a consumer and expressly
   may not redefine the predicate
   (`evidence-contracts/specs/evidence-contracts/spec.md:222-240`;
   `vendor-adapter-contract/specs/vendor-adapters/spec.md:208-247`). The old
   porcelain-string digest is also no longer the deciding predicate, and the
   three previously reproduced content-blind cases have explicit controls.

3. **The core per-lane split requested by prior findings 2 and 3 is present.**
   Implement requires a declared-deliverable content change plus validation;
   audit accepts an unchanged reviewed tree only with an external
   schema-valid verdict; planning/research require every named artifact and
   validation (`evidence-contracts/specs/evidence-contracts/spec.md:93-142`).
   The package now explicitly rejects a missing audit artifact, a one-of-four
   plan, and heading-only skeletons. New defects in freshness and evidence-root
   composition prevent full closure of those findings.

4. **Prior finding 7's M5 duplicate definition is closed at the normative-spec
   level.** `release-metrics/specs/release-metrics/spec.md:186-210` makes
   `graph-eval-falsification` the sole formula/threshold owner and leaves
   release-metrics as a claim-discipline consumer. The stale proposal wording
   should be cleaned up, but I found no second normative M5 formula.

5. **The missing-input state is now explicit for M1, M3, M4 and M6, and M9-M13
   are deferred from the v0.2.9 report.**
   `release-metrics/specs/release-metrics/spec.md:40-78,110-184,212-243,299-333`
   names the absent input and blocking package/state rather than rendering zero
   or blank. This closes the silent-computation part of prior finding 8,
   although M4's phase definition remains inconsistent.

6. **The TerminusDB ingest schema mismatch is closed in the package text.**
   `terminusdb-schema/design.md:81-89` declares
   `GraphNode.graphify_version` as `Optional xsd:string`;
   `terminusdb-adapter/specs/store-adapter/spec.md:430-448` requires the caller
   value and stamps every written document. `Task.subtask_of`,
   `Task.depends_on`, and `Artifact.artifact_depends_on` are distinct in
   `terminusdb-schema/specs/store-schema/spec.md:43-73`, and the operations
   cycle query is scoped only to `Task.depends_on`
   (`terminusdb-operations/design.md:61`).

7. **The lock package chooses flat locking consistently.**
   `lock-primitive-hardening/specs/locking/spec.md:346-383` forbids nesting and
   requires runtime `FM_LOCK_NESTED`; it no longer simultaneously grants an
   ordering permission. The owner-aware, per-lock reclamation split also fixes
   the previous `el_init`/NATS/index sweep contradiction.

## Findings NOT closed

1. **Prior finding 1 remains open for the evaluated-tree identity.**
   `three-outcome-verdicts/specs/audit-verdict/spec.md:128-136` defines
   `tree_sha256` as the `HEAD` tree plus path, mode, and SHA-256 of bytes for
   every porcelain-reported path. A valid deleted path is reported as ` D
   path`, but has no bytes or working-tree mode to hash. I reproduced that
   state in a temporary Git repository: porcelain reported
   ` D deleted.txt`, while both `stat` and `sha256sum` failed because the path
   did not exist. The package supplies no deletion/type-change/symlink/rename
   encoding. Under its fail-closed rule, an audit containing a deletion can
   become permanently `UNVERIFIED`; an implementer who invents a sentinel
   creates a non-specified canonical format. `three-outcome-verdicts/design.md:
   104-106` also contains a contradictory orphan sentence saying “only
   `diff_sha256` is the gate predicate” immediately after requiring the tree
   predicate.

2. **Prior findings 2 and 3 remain open under already-satisfied and non-Git
   audit roots.** A deliverable set must be non-empty and recorded before
   dispatch, which fixes empty/after-the-fact declaration
   (`evidence-contracts/specs/evidence-contracts/spec.md:17-30`), but there is no
   requirement that the required artifact be produced by the current attempt.
   Lines `69-77` explicitly classify unchanged evidence plus already-complete
   artifacts as success. The audit schema accepts
   `{"verdict":"APPROVED","findings":[],"summary":""}`; it has no attempt,
   diff, tree, freshness, non-empty-summary, or analysis evidence fields. A
   lane can therefore start with that valid artifact present, do nothing, leave
   the reviewed tree unchanged, and pass.

   The audit contract also assigns its evidence root to the external report
   location (`:107-126`), while the same package says a non-Git evidence root
   fails before the first invocation (`:164-178`). The run directory outside
   the reviewed worktree is normally not a Git worktree. The spec needs two
   separately named roots/digests (reviewed tree and external artifact) and an
   attempt-fresh production predicate.

3. **Prior finding 12 is not implemented by the package plan.**
   `test-infrastructure-hardening/specs/test-harness/spec.md:195-243` adds a
   mechanically derived inventory, but `tasks.md` has no task to implement that
   scanner or define its release base/range and check grammar. T8 still says to
   audit four named checks (`tasks.md:84-102`), and T10 still closes with a
   universal manual assertion (`:145-147`). Scanning “checks added or changed
   in the diff” also misses an unchanged checker newly promoted to a release
   gate, and can miss a sibling package when packages land sequentially unless
   “the release diff” is defined cumulatively from a fixed release base. The
   known-bad unregistered-check scenario exercises only a syntactically obvious
   new gate, not either omission class.

4. **Prior findings 9 and 10 remain open in regression-harness-tiers.**
   Tier 0 still uses “materially larger” and “normal noise” without a number
   (`specs/regression-harness/spec.md:59-82`; `tasks.md:8-13`). Tier 1 still
   requires every distinct `bugeventlog.md` failure class while targeting
   10-12 transcript-based rounds (`spec.md:175-203`; `tasks.md:21-36`); it was
   not narrowed to decision/vendor-response classes, so shell, CRLF, lock, and
   load failures remain incompatible with its transcript/decision-trace
   mechanism.

   The normative spec cuts Tier 3 and makes Tier 2 on-demand, but the task plan
   still orders Tier 2 “per release,” still contains four live Tier-3 build
   tasks, and still budgets Tier 3 (`tasks.md:38-76`). Budgets still have no
   numeric ceilings—“seconds,” “low seconds,” and “material margin” remain in
   `spec.md:255-270` and `tasks.md:68-75`. The new record/comparison schema
   makes a future chosen budget mechanically comparable; it does not choose an
   executable budget.

5. **Prior finding 5 is only partly closed.** The `mkdir` fallback now consumes
   a trusted/current syscall-evidence verdict and refuses an untrusted local
   probe (`lock-primitive-hardening/specs/locking/spec.md:86-146`). But
   `flock` is declared trusted solely because the command exists (`:12-24`).
   There is no verdict for an available `flock` on a filesystem where advisory
   locks are unsupported or do not coordinate the relevant writers; the design
   itself acknowledges weaker network and `/mnt` guarantees
   (`design.md:91-103`). WSL preflight's `/mnt` refusal does not cover arbitrary
   NFS/CIFS/FUSE mounts or a broken/shadowed `flock`.

6. **The claimed MENTIONS correction is not package-wide.** The amended
   normative line correctly forbids a `Mention` document
   (`graph-store-port/specs/store/spec.md:197-205`), but
   `graph-store-port/tasks.md:116` still orders “Reify `Mention`,”
   `proposal.md:83-88` says it is reified now, and `design.md:177-189` makes the
   same decision. An implementer cannot satisfy both.

## NEW defects introduced by the fix round

1. **[Critical] The directedness gate can pass after the claimed parallel-edge
   property has failed.** `knowledge-plane-refresh/specs/graphify-integration/
   spec.md:44-65` claims that `build_from_json(..., directed=True)` preserves
   parallel typed edges and makes the published document's
   `"directed": true` field the gate. Directedness distinguishes `A→B` from
   `B→A`; it does not make a simple `DiGraph` a `MultiDiGraph`. Multiple typed
   edges with the same ordered `(source,target)` can still collapse while
   `"directed": true` and `"multigraph": false`. The predicate therefore does
   not discriminate the property it authorizes.

   The post-build diagnostic cannot repair this: the same spec correctly notes
   at `:51-55,83-89` that a diagnostic over an already-built artifact cannot
   recover discarded edges. A zero collapsed-edge count on that artifact is
   not proof that the discarded source edges never existed. The gate must bind
   to a multigraph-preserving construction and require/verify
   `"multigraph": true`, or compare the pre-build edge multiset to the
   published edge multiset by typed identity.

   The concurrent edit also left direct contradictions:
   `knowledge-plane-refresh/tasks.md:30` and `design.md:17,45-49` still require
   `graphify update --directed`, while the amended spec says that command does
   not accept the flag and forbids passing it (`spec.md:47-50,76-81`).

2. **[High] The new lane contract proves artifact validity, not current-lane
   production.** The known-bad “audit did nothing” fixture covers only a missing
   file (`evidence-contracts/design.md:103`). It does not cover a stale,
   pre-created, schema-valid file. Because unchanged evidence plus complete
   artifacts is explicitly success, an absent/no-op lane can inherit an old
   audit or plan. This is the same attempt-freshness defect fixed correctly in
   `three-outcome-verdicts`, reintroduced one layer earlier in the general
   evidence contract.

3. **[High] The landing-order derivation's headline path is a regex artifact,
   and the committed count is stale.** `contention-derive.py:19-22` accepts
   `.toml` without a following path boundary. It therefore matches the prefix
   `config/foreman.toml` inside the actual path
   `config/foreman.toml.example`. The seven cited packages reference the
   `.example` file; `config/foreman.toml` does not exist in this checkout.
   `LANDING-ORDER.md:19-20,34` consequently names a nonexistent/truncated file
   as the most contended file.

   Re-running the script produced peak 7, but **22** files claimed by more than
   one package, not the committed **20** at `LANDING-ORDER.md:21`. The n>=3
   rows happen to match; the summary does not.

   The heuristic can materially under-count:

   - tasks are claiming only when the physical line itself begins with a
     checkbox (`contention-derive.py:42-47`), so wrapped continuation lines in
     the same task are discarded;
   - one negation token suppresses every path on the line, including a positive
     claim elsewhere on a mixed line;
   - the extension allowlist excludes `.md`, `.py`, `.qnt`, extensionless
     executables, and other real write targets, so this is not a general file
     contention inventory;
   - the repository root is hard-coded to `/root/foreman`, despite the document
     calling the script reproducible.

4. **[High] The four-code lock refusal scheme is not total.**
   `lock-primitive-hardening/specs/locking/spec.md:148-176` says every refusal
   is exactly one of no-atomic-primitive, untrusted-probe, timeout, or nested.
   It has no code/state for failure to open the lock path, permission/readonly
   errors, descriptor exhaustion, unsupported `flock`, or an available
   `flock` whose filesystem semantics are not trusted. Some of those must
   refuse before a spin but are neither a `mkdir` probe failure nor nesting.
   Worse, the last state can proceed on an unsafe mechanism because presence of
   the command is the whole selection predicate. The closed enum and
   “provably atomic” claim are therefore both false.

5. **[High] The nineteen kill criteria do not satisfy their own atomic/fixed
   threshold schema.** The register says each entry has exactly one metric and
   exactly one fixed numeric threshold
   (`graph-eval-falsification/specs/evaluation/spec.md:238-278`), but:

   - KC-2a, KC-2b, and KC-6 use the subsequently measured confidence
     half-width as their threshold (`:287-298,323-328`), not a fixed number;
   - KC-8 embeds 10% plus two confidence-half-width comparisons in one derived
     predicate (`:339-347`);
   - KC-13 is a three-branch disjunction (non-completion, dirty diff, or >15
     minutes), not one metric/one number (`:394-401`);
   - KC-15 requires both all-three correctness and a 2x latency bound
     (`:408-415`).

   Several criteria can also become unable to fire without recording failure:
   KC-4 precision is undefined if the shadow checker predicts zero blocks;
   KC-5 M5 is undefined when there are zero gate-blocking findings; KC-12's
   percentage reduction is undefined when the before-window occurrence rate is
   zero. Only the `<30 lane-starts` case has a “not evaluated” branch for KC-12
   (`:545-573`); the zero-baseline case does not.

   KC-7 measures whether a citation-required claim carries a syntactically
   valid in-block edge ID (`:329-338`), not whether that edge supports the
   claim. A lane can attach any valid edge ID to every claim and score 100%.
   The 72% threshold is therefore a compliance threshold presented as citation
   correctness.

6. **[Medium] Release metrics still contains predicates it calls fixed but
   cannot implement consistently.** M4 calls four phases “collectively
   exhaustive” and then adds a fifth `unaccounted` phase
   (`release-metrics/specs/release-metrics/spec.md:150-176`). The reduced report
   says it ships five metrics “fully computed” while requiring M3 and M4 to be
   rendered uncomputable (`:299-326`). Marking missing telemetry explicitly is
   correct; it does not resolve the taxonomy or the contradiction in the
   completeness claim.

7. **[Medium] The positive-control inventory can still be green while the
   release relies on an uncovered check.** The diff scan has no fixed release
   base or semantic definition of “gate/probe/assertion.” It therefore
   demonstrates rejection only for a newly added, scanner-recognizable check.
   An unchanged check promoted by configuration, a check added in an already
   landed sibling outside the chosen diff, or an equivalent predicate hidden
   behind a wrapper can remain absent from the inventory. Stale-entry detection
   does not detect those missing-entry classes.

## Self-consistency: does the workstream now survive its own standard?

**No.** The workstream's standard is that a predicate earns trust only by
rejecting a known-bad input and by not passing vacuously. At least five new
predicates fail that standard:

1. `"directed": true` accepts a directed simple graph that has already collapsed
   parallel same-direction typed edges.
2. “unchanged tree + schema-valid artifact” accepts a no-op lane that inherited
   an already-valid artifact.
3. the positive-control diff inventory has no demonstration for unchanged or
   sibling checks outside its scan range.
4. KC-7 accepts syntactically valid but semantically unrelated citations, while
   KC-4/KC-5/KC-12 have undefined zero-event populations.
5. the landing-order regex reports a path that was never claimed as written and
   omits real claim forms it does not recognize.

The strongest fixes use the right pattern: the same-diff killed re-audit, the
old porcelain digest's three blind cases, and Tier-1 fail/pass pairs all name an
opposite arm. The release does not apply that discipline consistently to the
new predicates above, so it cannot yet pass its own checker-soundness gate.

## What I checked and found correct

- Created this report skeleton before reading the prior report or any scoped
  package content, then filled that existing artifact.
- Read the prior Codex infrastructure audit and compared each claimed closure
  against the current proposal/design/spec/tasks, rather than treating strict
  validation as truth.
- Re-ran `openspec validate <package> --strict` for all 14 scoped packages; all
  14 exited zero. This establishes structural validity only.
- Re-ran `docs/research/vnext/contention-derive.py`. Peak claims contention is
  7 and peak mentions contention is 8, but the script reports 22 multiply
  claimed files, exposing the committed 20 mismatch.
- Verified the evidence helper's proposed content record includes path,
  existence, mode and byte hash and explicitly covers the three old
  porcelain-blind cases plus a no-write negative control.
- Verified audit pre-publication ordering and gate comparison cover the killed
  same-diff attempt.
- Verified the M5 normative owner split, explicit uncomputable metric strings,
  and v0.2.9 M9-M13 deferral.
- Verified `GraphNode.graphify_version`, distinct task/artifact relation names,
  the adapter's required ingest argument, and operations' dependency-cycle
  scope agree across the TerminusDB packages.
- Verified the graph-store normative reification line now states the intended
  `MENTIONS` exclusion; the contradictory proposal/design/task text is reported
  above.
- Did not invoke Graphify and did not read, build, or refresh a knowledge graph.
- Made no package, script, or landing-order edits; the only repository write was
  this required report.

## What I could not check, and why

- I did not independently reproduce the claimed post-fix 5/5 live TerminusDB
  run. The durable file
  `docs/research/vnext/VERIFY-terminusdb-schema-live.md` still records the
  **pre-fix** four checks, including rejection of undeclared
  `graphify_version`; no amended 5/5 transcript/result artifact is present in
  the scoped evidence. The schema amendment uses the same `Optional` form as
  other accepted fields and is internally consistent, but the claimed live
  rerun is not independently auditable from the repository artifact.
- I did not run the future Bats suites, mutation probes, live vendor Tier-2
  experiments, lock tests on MSYS2/NFS/CIFS, or TerminusDB ingest implementation
  because these are OpenSpec packages, not implemented changes, and several
  tasks still contradict the amended specs.
- I did not validate Graphify CLI/API behavior or inspect a graph artifact,
  because the operational constraint expressly forbids running Graphify or
  building/refreshing a graph. The directed-vs-multigraph defect follows from
  the package's own required artifact fields and claimed property; it does not
  depend on executing Graphify.
- I did not coordinate with or read the parallel Opus lane's developing report.
