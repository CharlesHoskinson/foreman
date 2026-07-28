## Approach

### The predicate this package originally proposed was unsound in both directions

The first draft made a sha256 of `git status --porcelain` the verdict. It was measured, on 2026-07-28, giving wrong answers in both directions.

**False negative, reproduced deterministically in ten seconds.** `git status --porcelain` collapses an untracked directory to a single `?? pkg/` line however many files it holds, so writing files 2..N inside it produces a byte-identical digest. It is also blind to content changes inside untracked files. The most common Foreman planning task — create `openspec/changes/<name>/` and write four files into it — becomes invisible to the digest after the first write. That is exactly how a lane that had written all four package files correctly was reported `EMPTY-BURST FAILED` (`bugeventlog.md`, 2026-07-28, root-cause entry).

**`-uall` fixes one of the two, not both.** `git status --porcelain -uall` lists each untracked file individually and does change the digest when files are added. Verified. It remains blind to content changes within a path whose status string does not change — a rewritten untracked deliverable, or a second edit of an already-modified tracked file. Also verified. Therefore a path-level digest cannot be the mechanism; it can only be one signal.

**False positive, from our own doctrine.** Creating a skeleton changes the digest and satisfies the predicate without completing the artifact. The release's write-first doctrine ("create the skeleton first") manufactures this false positive on every lane that follows it.

### Evidence loop (content digest + lane-type contract + termination reason + bounded re-prompt)

Every lane round — implement, audit, planning, research — under every vendor adapter follows the same outer contract:

1. **Declare the deliverable set.** Before dispatch, resolve and record the explicit, non-empty list of entries — each a path plus a required end state of `present` or `absent` — this round must produce, modify or remove, together with the lane-type evidence contract (work root, artifact root, required artifacts, validation command, report location). The set is resolved by the orchestrator from lane type and lane assignment; nothing the lane writes can amend it. A round whose success cannot be evaluated is not dispatched.
2. **Pre-dispatch baseline.** Compute the pre-round content digest, and evaluate the lane-type final-state conditions *before* the vendor runs. If they already hold, the round is not dispatched at all: the loop ends if the run record attributes the artifacts to a completed round of this lane, and otherwise refuses with a stale-artifact error.
3. **Invoke via adapter.** Call the vendor through vendor-adapter-contract; this package does not define argv, flags, or prompt-file plumbing.
4. **Capture termination reason.** Record whatever stop/cancellation field the vendor surfaces, even when exit code is 0.
5. **Post-round content digest + artifact assertion.** Recompute the content digest per root and evaluate the lane-type artifact assertion: attempt-fresh production against this round's own baseline, plus the lane type's conditions on the final state (existence, non-emptiness, absence, schema validity, validator exit).
6. **Decide.** `INCONCLUSIVE` describes the *mechanism*, not the round. An untrusted or uncomputable comparison is `INCONCLUSIVE` and contributes nothing in either direction; a trusted unchanged comparison is a fact about the attempt and the artifact assertion decides. A changed digest alone is never sufficient — a skeleton and a one-of-four package both change it.
7. **Bounded re-prompt.** Re-prompt within budget; on exhaustion, enter a loud terminal failure naming both the evidence result and the failed artifact assertion.

Empty burst and cancelled writes both look like "unchanged evidence + exit 0." The evidence comparison alone cannot tell them apart; the stored termination reason is the differentiator after the fact.

### One predicate cannot serve four lane types

An implementation lane is expected to change tree content. A correct audit lane is expected to change nothing in the tree it reviews and to write a schema-valid verdict somewhere else. Planning and research lanes are expected to produce named, complete artifacts. The single workspace-change predicate rejected a conforming audit (which must not mutate) and accepted a partial package. Each lane type therefore declares its own evidence root, required artifacts, validation command and report location.

The audit lane's worktree-immutability check is a content digest, not a status-string comparison, for the same reason as above: editing an already-modified file leaves the porcelain output identical, so a status-only tamper check cannot see the tamper it exists to detect.

### `INCONCLUSIVE` was over-generalised, and the contradiction was reachable

The first fix said *unchanged evidence is inconclusive, never terminal*, and the implement-lane contract said *an implement round that changes nothing SHALL NOT be recorded successful*. Both applied to one concrete input: **attempt 2 of an implement lane whose attempt 1 already wrote every deliverable and left the suite green.** Digest unchanged, deliverables present and validating. The first rule records it successful; the second forbids that. A do-nothing round was re-admitted by the fix for a different hole.

Scoping the first rule to non-implement lanes would remove the contradiction and leave the same hole open for audit, planning and research. The resolution here is causal instead of a carve-out, and it starts from why the 2026-07-28 incident happened at all.

That incident was **not** a case of "unchanged evidence, complete artifacts." The lane wrote four files; the *mechanism* could not see them, because a path-level porcelain digest collapses an untracked directory. The verdict was wrong because the instrument was blind, not because unchanged evidence needs an exemption. So:

- **`INCONCLUSIVE` is a property of the mechanism.** If the mechanism failed any planted-write control for the run, or the comparison could not be computed, the observation is `INCONCLUSIVE` and contributes nothing in either direction. The old porcelain digest fails the untracked-directory control by construction, so the 2026-07-28 verdict is unreachable — for the right reason.
- **A trusted unchanged comparison is a fact, not an exemption.** Its meaning is: this attempt produced nothing. That is not a lane-type-specific meaning, so no lane type is exempt from it.
- **Attempt-fresh production moves into every lane-type artifact assertion.** The assertion asks whether *this attempt* produced something, not whether the artifact exists. Both rules then decide the empty implement round the same way, and the contradiction is structurally impossible rather than resolved by precedence.

The two branches are mutually exclusive on the trust flag, so no round can fall under both.

### One evidence root could not satisfy the audit contract

The audit contract required the verdict artifact to live **outside** the reviewed worktree, and the fail-closed rule required *the* evidence root to be a git work tree. The run directory is `$FOREMAN_HOME/runs/<run-id>/`, which defaults to `$HOME/.foreman` — outside every repository and not a work tree. There was no satisfying assignment: any location outside the reviewed worktree that is *also* a git work tree is a different repository, which is not where a lane's report belongs.

The defect was the singular. A lane has two roots doing two different jobs:

| | Work root | Artifact root |
|---|---|---|
| What it is | the worktree the lane operates on or reviews | where the lane's required artifacts are written |
| Git work tree required | yes | no |
| Digest domain | declared deliverables under it **plus** the status enumeration | exactly the declared deliverables under it |
| Audit lane | the reviewed worktree | `$FOREMAN_HOME/runs/<run-id>/reports/` |
| Implement / planning / research | the lane worktree | may be the same directory |

The status enumeration is what needs git, and it is only needed where the lane may touch paths nobody declared. Under the artifact root every relevant path is declared by construction, so content records over the declared set are sufficient and no repository is required. `audit` is the one lane type for which the two roots must differ, because its work root is a tree it is forbidden to write.

### Deletion had no encoding, so a correct removal looked like an empty round

`path, mode, SHA-256 of bytes` is undefined for the state porcelain most often reports. Reproduced: porcelain prints ` D f`, and both `stat` and `sha256sum` fail. Omitting the record makes a lane that correctly deleted a file byte-identical to a lane that did nothing — the exact discrimination the whole package exists to make.

The record is therefore fixed-arity with an explicit state character, and **absence is a value**: `-`, `000000`, sixty-four zeros. A removal changes the digest exactly as a write does. Three consequences worth stating:

- An **unreadable** path is *not* absent. Collapsing them would let a permissions failure impersonate a deletion, so it stays uncomputable and fails closed on its own reason.
- A **symlink** hashes its target string, not its referent, so a retarget is visible and a link pointing outside the tree is still hashable.
- A **type change** is visible in the state character even where the two hashes happen to collide.

Because a deletion can now be a legitimate deliverable, each declared entry carries a required end state. `present` means exists and non-empty; `absent` means does not exist. Without it the artifact assertion would demand that a deleted file exist.

### Declared-set timing: already-satisfied, empty, and forged sets

Three questions, three answers, all binding before dispatch.

- **Can a lane declare a set it has already satisfied?** No round is dispatched into a satisfied contract. The pre-dispatch baseline evaluates the final-state conditions *before* the vendor runs; if they hold, either the loop ends (the run record attributes them to a completed round of this lane) or dispatch is refused with a stale-artifact error. A do-nothing round is never given the opportunity, and attempt-fresh production is the second barrier if one is evaluated anyway. Two sequencing points make this safe rather than obstructive. The baseline is taken *after* any lane-type pre-dispatch invalidation, so the audit lane's own in-progress publish is not mistaken for a pre-existing artifact and a legitimate re-audit is not refused as stale. And the rule is scoped to a single lane assignment's evidence loop, so a rework round answering audit findings still dispatches even though the previous assignment's files are present and valid — it is attempt-fresh production, not this rule, that stops such a round being credited for doing nothing.
- **Empty or wrong set?** Unresolvable, with the ground recorded: empty, an entry under neither declared root, an entry without an end state, or no assignment artifact and no lane-type default. Unresolvable refuses dispatch; it never falls back to a whole-tree scan.
- **Forged set?** The set is orchestrator-resolved and never read from the lane's output stream, from a manifest the lane writes, or from any file the lane can write. At evaluation the set in hand is compared byte-for-byte with the recorded set, and a mismatch is a configuration failure that is not evaluated under *either* set. A lane that can name its own deliverables can satisfy its own contract, which is the write-evidence instance of a checker grading its own homework.

### Interaction with the in-tree-audit-report contradiction (architect owns this)

The re-audit observed that every audit and review report in this workstream — `AUDIT-*.md`, `REVIEW-*.md`, `RECONCILE.md`, `REAUDIT-opus.md`, `REAUDIT-codex.md` — is written into `docs/research/vnext/` **inside the tree under review**, which the audit-lane rule defines as tampering. The specification forbids the way this effort has been conducted. That is the architect's to resolve; this package's job was not to make it worse. Two changes here bear on it, and both cut toward resolvability:

1. **The tamper predicate is now scoped to paths outside the round's recorded declared deliverable set**, instead of every path in the reviewed worktree. Previously any in-tree write failed the audit unconditionally, including a write the orchestrator itself had declared. Now, WHERE a lane contract deliberately places a report inside the work root, that one declared path is not tampering and every other path still is. The mechanism the architect needs already exists; what remains is a policy decision about whether to use it.
2. **The default is unchanged and deliberately conservative.** The audit artifact root defaults to the run directory, outside the repository, and for `audit` lanes the artifact root SHALL NOT lie inside the work root. So the scoping in (1) does *not* silently legalise in-tree audit reports for the automated lane type; it only makes an explicit contract able to express one. Nothing here decides whether these planning-round research documents are `audit`-lane artifacts at all — the plainer reading is that they are `research`-lane deliverables whose work root and artifact root coincide, which the two-root model permits without any exception.

Recorded so that the resolution is a choice rather than a rediscovery.

### Mutation probe in checks-run.sh

Agent-written tests do not reliably improve defect catch rate; external adversarial checks do. Property-based and example-based suites catch partially non-overlapping defect classes; some rule classes are invisible to LLM review but trivial for deterministic checkers. Evidence-contracts therefore adds a **scoped mutation probe** stage conceptually inside checks-run.sh:

- Mutate **only** lines touched by the relevant diff (never whole-repo mutation).
- For each mutant, re-run the existing test suite.
- If no test fails, report an **unprotected changed line** (coverage defect of the diff, not a product failure).
- **Primary cadence: merge-gate.** Per-changed-line mutation is too slow to mandate on every commit or intermediate gate; merge is the single choke point where integrated-diff coverage is worth the cost. Optional/on-demand invocation remains available outside that gate.

### Ownership split

`lib/evidence.sh` and `vendor-multiround.sh` were claimed by two packages. Exactly one owns them now.

| Concern | Owner |
|--------|--------|
| Per-vendor CLI argv / flags / invocation, `adapter_caps` | vendor-adapter-contract |
| General positive control (checkers must be able to fail) | test-infrastructure-hardening |
| `lib/evidence.sh`, `vendor-multiround.sh`, evidence predicates, lane-type contracts, termination-reason capture, mutation probe, the planted-write control for this mechanism | evidence-contracts (this package) |

The assignment goes this way because the correctness of `lib/evidence.sh` is decided entirely by the predicates specified here. A helper whose semantics live in one package and whose implementation lives in another is how the two incompatible definitions arose in the first place. vendor-adapter-contract remains a declared consumer: it supplies `adapter_implement_argv` and `adapter_caps`, and `vendor-multiround.sh` calls them.

Lane self-claims about files written or tests passing are a special case of the vacuous-check class: they pass loudly if trusted alone. This package fixes that by requiring artifact-based corroboration (content digest over a declared deliverable set + a lane-type artifact assertion). The sibling owns making generic checkers prove they can fail.

## Alternatives Rejected

### Trust a stricter agent self-report / “confirm completion” prompt

**Rejected.** Prompting cannot fix permission-gate cancellations the agent may not surface correctly, and it cannot stop pure narration lanes that already claim success. Observed failures included agents that checked for missing files and still stopped — self-report is not evidence.

### Full-repo mutation testing on every commit

**Rejected.** Full-repo mutation testing is far too slow to gate every commit. Even scoped mutation of every changed line is expensive enough that the primary cadence is merge-gate, not per-commit.

### Substring-match agent final messages for success keywords

**Rejected.** This was a concrete failure mode today: a checker grepping for `"violation"` matched the success string `"[ok] No violation found"`. Matching agent prose for “done” / “success” / “report ready” is the same class of bug — account-based, not artifact-based.

### Exit-code-only success for non-implement lanes

**Rejected.** Audit, planning, and research lanes were observed exiting 0 with zero or partial deliverables. Restricting evidence contracts to implement-only (current grok-multiround.sh scope) leaves the same hole open for every other lane type and vendor.

## Risks

### False-positive evidence changes

Two distinct false positives. First, incidental file touches (logs, lockfiles, temp caches, editor swap files) change a whole-tree digest without producing the intended deliverable. Second, and produced by our own write-first doctrine, creating a skeleton changes the digest and satisfies a change-based predicate without completing the artifact. Mitigation for both: the digest is computed over a *declared* deliverable set, and a changed digest is never sufficient — the lane-type artifact assertion (existence, non-emptiness, schema validity, validator exit) must also pass. A skeleton fails the validator; an incidental touch is not in the declared set.

### Mutation-probe latency and cost at merge-gate

Even scoped to diff-touched lines, mutation can add meaningful wall time and CI cost at merge. Mitigation: primary cadence is merge-gate only (not every commit); optional on-demand for local debugging; keep mutants limited to changed lines so cost scales with diff size, not repo size.

### Vendor termination-reason heterogeneity

Not every vendor CLI surfaces a clean stopReason / cancellationCategory. Mitigation: capture best-available termination metadata per adapter (with an explicit "unknown/unavailable" bucket); label diagnosis confidence when the reason field is missing. Note that unchanged evidence is `INCONCLUSIVE` on its own, so a missing termination reason degrades diagnosis, not the verdict — the lane-type artifact assertion still decides the round.

### Over-aggressive re-prompt budgets

A high round budget burns tokens on lanes that cannot write (e.g. persistent permission cancellation). Mitigation: record termination reason early; short-circuit or reduce budget when cancellation class is clear; always end in loud failure rather than silent green.

## Demonstrated rejection — what each predicate here is shown to reject

The workstream's own standard: checker output is evidence only if the predicate discriminates the claimed property. Applied to this package's own predicates. Each row names the known-bad input the predicate is demonstrated to reject, and the fixture that demonstrates it. A predicate with no row is not implementable under this change.

| Predicate | Known-bad input it is demonstrated to reject | Demonstration |
|---|---|---|
| Deliverable-set content digest | A round that rewrites the contents of an already-untracked deliverable and changes no status string | Fixture writes `pkg/a.md`, snapshots, rewrites `pkg/a.md`, snapshots; digests must differ. The old porcelain predicate is asserted to FAIL this fixture. |
| Deliverable-set content digest | A round that adds files 2..N inside a directory that became untracked on the first write | Fixture adds `pkg/b.md`, `pkg/c.md` after `pkg/` is untracked; digests must differ. Old predicate asserted to FAIL. |
| `-uall` requirement on any path-level digest | The same untracked-directory collapse, at the path level | Fixture asserts the built command contains `--untracked-files=all` and that the digest changes when the second file is added. |
| Path-level digest as sole verdict (rejected mechanism) | Any content-only change | Explicitly demonstrated to fail: the fixture above shows `-uall` still cannot see a content rewrite. This is why the path digest may never be the verdict. |
| Lane-type artifact assertion, planning/research | A one-of-four package, and a heading-only skeleton — both of which change the digest | Fixture writes one required file, then four empty skeletons; both must be recorded as failures despite a changed digest. |
| Lane-type artifact assertion, audit | An audit lane that exits 0, touches nothing, and writes no verdict artifact | Fixture runs a no-op audit; the round must fail for a missing artifact, not pass as a clean read-only audit. |
| Lane-type artifact assertion, audit | An audit lane that exits 0 and touches nothing **while a schema-valid `APPROVED` from an earlier attempt stands at the report location** | Fixture plants the stale verdict, then runs the no-op audit. The artifact the gate reads must be the in-progress record the orchestrator published before spawn; the round must fail. The pre-fix assertion — existence plus schema validity — is asserted to PASS this fixture, which is why existence alone was insufficient. |
| Two-root composition | The audit contract's own conjunction: an artifact location required to be simultaneously outside the reviewed worktree and a git work tree | Fixture dispatches an audit whose artifact root is the non-git run directory. It must dispatch and be able to pass. The single-root rule is asserted to REFUSE it before the first vendor invocation, which is the joint unsatisfiability. A companion fixture with a non-git *work* root must still refuse. |
| Canonical record, deletion | A round that correctly removes a declared deliverable, versus a round that leaves it untouched | Two fixtures over the same declared set with end state `absent`. The removal must change the digest via the absent-state record; the do-nothing round must leave the record identical and fail for an unsatisfied end state. The pre-fix definition is asserted to be **uncomputable** on the removal fixture — `stat` and `sha256sum` both fail on ` D f` — which is the undefined state. |
| Canonical record, unreadable vs absent | A declared deliverable that exists but cannot be read | Fixture chmods the path unreadable. The result must be uncomputable naming the path, and must NOT equal the identity the deletion fixture produces. A digest encoding unreadable as absent is asserted to FAIL this pair. |
| Canonical record, type and target | A regular file replaced by a symlink of the same name; a symlink retargeted | Two fixtures; both must change the digest. A digest hashing the symlink's referent rather than its target string is asserted to FAIL the retarget fixture. |
| Audit worktree-immutability content digest | A tamper consisting of a second edit to a file that was already modified before the audit | Fixture modifies `f`, snapshots, modifies `f` again; the content digest must differ. A porcelain-string comparison is asserted to FAIL this fixture (non-blocking finding 5). |
| `INCONCLUSIVE` scoped to an untrusted mechanism | The 2026-07-28 false negative itself: a blind mechanism reporting no change for a round that wrote four correct package files | Fixture replays it against the old porcelain predicate, which fails the untracked-directory control. The comparison must be `INCONCLUSIVE` naming the failed control, and no terminal failure may be reachable from it. Under the trusted content digest the same round reports a **change**, so the exemption is never needed. |
| `INCONCLUSIVE` scoped to an untrusted mechanism | **Attempt 2 of an implement lane whose attempt 1 wrote every deliverable and left the suite green**, with a *trusted* mechanism reporting no change | Fixture runs attempt 1 to green, then an attempt 2 that writes nothing. The round must be recorded UNSUCCESSFUL, must NOT be recorded `INCONCLUSIVE`, and must NOT be recorded successful. **The pre-fix text is asserted to accept this input** — both requirements applied to it and decided it oppositely; that is the defect this row exists to demonstrate. |
| Attempt-fresh production, all four lane types | A round whose declared deliverables all exist, are non-empty and pass validation, and whose canonical records are identical to that round's own pre-dispatch baseline | Fixture per lane type: implement attempt 2, planning package predating the round, research report predating the round, audit lane with a valid verdict already on disk. All four must FAIL naming absent attempt-fresh production. The pre-fix assertion, which tested only final state, is asserted to PASS all four. |
| Never dispatch into a satisfied contract | A lane pointed at a report location where a schema-valid artifact from an unrelated run already stands | Fixture places the artifact, then dispatches. The orchestrator must refuse dispatch with a stale-artifact configuration error, or end the loop where the run record attributes it to a completed round of this same lane. It may not dispatch and then credit the round. |
| Declared-set unforgeability | A lane that writes a manifest naming its own deliverables — including the honest case, where the manifest names a file the lane really did write | Fixture runs a lane that emits such a manifest; the round is evaluated against the recorded set only, and a set differing from the recorded one at evaluation is a configuration failure evaluated under neither. The honest case is included deliberately: a rule that only rejects dishonest manifests is a rule that reads manifests. |
| Declared-set resolvability | An empty set; a set with an entry under neither declared root; a set with an entry missing its end state | Three fixtures, three refusals to dispatch, each naming its ground. Asserted that no fixture falls back to a whole-tree scan. |
| Planted-write positive control | A write-evidence mechanism that cannot see a planted write | The control corpus is the three verified blind cases plus a no-write negative control; any control failure marks the mechanism unavailable and no empty-burst verdict may be emitted from it. |
| Fail-closed evidence computation | A digest command that exits non-zero, read as "no change" | Fixture forces a non-zero hash exit; the outcome must be `INCONCLUSIVE` with a computation-failure reason and a blocked downstream gate. |

The control that matters most is the last line of T4: the corpus is run against the *old* predicate and must fail it. A positive control that both the old and the new predicate pass demonstrates nothing about the fix.

## Residual limits, stated so they are not rediscovered

- The content digest covers the declared deliverable set and the paths the status enumeration reports within the work root. A write to a path that is neither declared nor reported — outside both declared roots, or ignored by `.gitignore` — is still invisible. Declaring the deliverable set is what closes this, and it is why an unresolvable set refuses dispatch instead of falling back to a whole-tree scan.
- Content hashing costs more than a status string. The cost scales with the declared deliverable set, not with repository size, which is why the set is declared rather than discovered.
- A lane that writes correct-looking but wrong content passes every predicate here. Evidence contracts establish that work happened, not that it is right; that is the audit's job, and this package deliberately does not claim it.
- Attempt-fresh production can be satisfied by a trivial write to a declared deliverable — a whitespace change satisfies it. It is a necessary condition, never a sufficient one; the lane-type final-state conditions and the validation command carry the rest, and neither is satisfied by a trivial edit to a file that must also validate. What it closes is the *empty* round, not the *lazy* one.
- The artifact root is not covered by a status enumeration, so a write under it to a path nobody declared is invisible. That is intentional and is why the artifact root need not be a repository; the cost is that the artifact root cannot detect an incidental touch the way the work root can.
- The tamper predicate excludes the round's recorded declared deliverable set. Its strength therefore rests entirely on that set being orchestrator-resolved and unforgeable — which is a separate requirement here, and the reason it is stated as strongly as it is.
