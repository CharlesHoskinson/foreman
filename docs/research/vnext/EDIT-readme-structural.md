# EDIT: README — structural pass

Remit: architecture only. Section order, merges, splits, cuts, placement of
the v0.2.9 material. Prose belongs to `EDIT-readme-line.md`; factual claims
belong to `EDIT-readme-facts.md` — disproved claims are flagged in §5 below,
not corrected here. Read against: `README.md` (665 lines, all of it),
`ROADMAP.md` v0.2.9 entry, `openspec/changes/` (agy-lane-activation,
cross-vendor-audit-routing, graph-store-port, lock-primitive-hardening
proposals read in full or in part), `docs/research/vnext/SYNTHESIS.md`
conclusions as carried into the roadmap.

Line numbers refer to the current `README.md` at HEAD.

---

## 1. The diagnosis

The README declares its own charter at lines 16-19: "This README is the
teaching document: what Foreman is, how the lifecycle works, and an honest
account of what is shipped versus planned." That is three documents, and the
current structure interleaves them so each damages the other two:

1. **A concept paper** — the split, the roles, the five-part spec, reports
   are claims. This material is close to timeless and is the best writing in
   the file (§1, §2, §9, §11-12).
2. **An operator manual** — Setup flags, per-script exit codes, wt-merge
   error tables, docs-check tool configs. The README promises at lines 17-19
   to leave this to `docs/USAGE.md` ("every command, every flag,
   troubleshooting") and then does it anyway (§3's cleanup ordering, §10's
   exit-code table, §13's tool table). Two copies of reference material
   always drift; one of them is already drifting.
3. **A release ledger** — "Shipped / Stub / Partial stub" (§6), "As of
   v0.2.7.5 (worktree-hardening)..." (lines 296, 397, 485), "verified to 3
   lanes" (§7). This is the material v0.2.9 has already invalidated in
   several places (§5 below), and it will be invalidated again every
   release, because a README that carries version-stamped provenance is
   doing ROADMAP's job. Principle for the rebuild: **the README states what
   is; ROADMAP states when it became so.**

**Who reads it.** Three readers, in descending traffic: (a) an evaluating
engineer deciding in ten minutes whether to clone; (b) an operator at the
keyboard needing the first run; (c) a contributor or architect needing
doctrine and the honest ledger. The current order serves (c) at the expense
of (a) and (b): the evaluator meets `foreman-setup.sh --profile soft --lane
grok` at line 107 before learning what a lane is (§4, line 159), and the
five-part spec — the single interface the whole system rides on, invoked in
the opening paragraph at line 8 — is not defined until line 409, section 9,
after the quickstart that tells you to write one (line 387).

**The structure is already failing under maintenance.** At least four
numbered cross-references point at the wrong section, the fossil record of
an insertion that was never propagated:

- Line 224: "Write a five-part spec (section 8)" — the spec is section 9;
  section 8 is the quickstart.
- Line 228: "sends a cold diff to `codex-auditor` when the work is
  non-trivial (section 10)" — audit criteria are section 12; section 10 is
  worktrees.
- Line 134: "the soft loop (recon, implement, verify, audit — sections 5,
  9-11)" — audit is section 12.
- Line 591: "Prose quality is a human/architect judgment call (see section
  15)" — section 15 contains nothing on prose quality.
- Line 103: "(bash — Git Bash on Windows ... see section 7 for why)" — the
  actual why lives at lines 394-401, in section 8.

Recommendation carried through everything below: drop hard-numbered
cross-references for named anchors. The numbers have already lied to the
reader four times; after this restructure they would lie fifteen times.

**And the document has a hole where the release's center of gravity is.**
v0.2.9's two planes (work-DAG + knowledge plane), the fourth lane, and the
checker-soundness doctrine have no home in the current structure — §14
("Repo understanding (knowledge graph) and maintenance") frames the graph as
repo-maintenance trivia, which is the one framing v0.2.9 makes untenable.

## 2. Proposed section order

Fifteen sections become twelve. Order, with reasoning per move:

| # | Section | From | Why here |
|---|---|---|---|
| 1 | What Foreman is and the problem it solves | §1 | Unmoved. The strongest opening in the file; earns the reader in one paragraph. |
| 2 | The mental model | §2 | Unmoved, but rebuilt: lanes keyed by **model family**, not CLI name (see §4 below). "Four roles, four producers" (line 50) dies with the fourth lane. |
| 3 | The five-part spec | §9 | Moved up six positions. It is the contract every later section presumes — §4's lane table already leans on it ("when the spec fully determines the outcome", line 163). Defining the interface before the parties that speak it is the single highest-value move in this edit. |
| 4 | Lanes and vendor routing | §4 | Now reads as "who receives the spec." Gains the agy row; loses the codex CLI flag detail (lines 176-185) to `references/lanes.md`, which line 199-200 already links for exactly this purpose. |
| 5 | Soft mode — the loop | §5 | Effectively unmoved. All three broken cross-refs in it get named anchors. |
| 6 | Setup → Use → Cleanup, and the quickstart | §3 + §8 merged | §3's three-sentence frame is right; its script mechanics (lines 105-157: SIGINT ordering, pueued rules, lock sweeping) are USAGE.md material. What remains of §3 is exactly the preamble §8's quickstart needs — merge them, so the lifecycle is taught at the moment the reader is about to live it, not 230 lines earlier. |
| 7 | Worktree isolation | §10 | Doctrine and fan-out diagram stay; the exit-code table and per-script exit codes go to USAGE.md (fight #1, §6 below). |
| 8 | Reports are claims: evidence, verification, audit, checker soundness | §11 + §12 + one ¶ of §13 | These are one doctrine told in three installments. Merged, the section gains the v0.2.9 checker-soundness extension as its natural fourth movement: reports are claims — and so are checks. §13's docs stage survives as one paragraph + pointer inside the verification checklist (it is already step 4 of the checklist at line 553). |
| 9 | The record: event log, work-DAG, knowledge plane, store | new + remains of §14 | New section, placed after "reports are claims" because it answers the question that section raises: where do the claims, evidence and verdicts *live*, and what can be asked of them later. Absorbs §14's graphify-query material. Details in §4 below. |
| 10 | Hard mode — status | §6 | Moved after evidence/verification/record. Today §6 uses "evidence", "cold diff", and "gate" (lines 240-252) three sections before any of them is taught. After the move, GATE reads as the mechanized form of a doctrine the reader already holds. The Shipped/Stub table format stays — it is the honest-ledger house style — but its contents are fact-checker territory (§5). |
| 11 | Honest capabilities and limits | §7 | Stays late, but rebalanced: launcher trivia out (fight #3), doctrine-level limits in — the telemetry gap, agy isolation, bounded formal results, audit latency, TerminusDB longevity. Version-stamped provenance strings move to ROADMAP. |
| 12 | Further reading, security, layout, license, lineage | §15 | Unmoved. Absorbs §14's maintenance paragraph (lines 607-612) as a further-reading pointer; layout tree gains `formal/` (line editor / fact checker). |

**Merges:** §3+§8 (lifecycle into quickstart); §11+§12+part of §13 (one
"reports are claims" section); §14's two halves split into new-§9 and §12.
**Splits:** §3 (frame survives, mechanics leave); §14 (graph material
promoted, maintenance demoted). **Gone entirely as sections:** §13 and §14 —
their surviving content rides inside other sections.

## 3. Per-section verdict, all fifteen

| Old § | Title | Verdict | Reasoning |
|---|---|---|---|
| 1 | What Foreman is | **keep** | The failure-modes paragraph (lines 24-31) is the best argument in the file; nothing here needs structural help. |
| 2 | The mental model | **rewrite** | The four-box diagram (lines 53-74) and "Four roles, four producers" (line 50) cannot survive a fifth producer whose CLI serves three model families; re-key on family. |
| 3 | Three-stage lifecycle | **split** | The frame (lines 92-97) is load-bearing; the Setup/Cleanup mechanics (105-157) are the operator manual the README promised not to be — relocate to USAGE.md, merge the frame into the quickstart. |
| 4 | Lanes and vendor routing | **rewrite** | Gains the agy lane and the family-keyed invariant; sheds CLI flag detail to the `references/lanes.md` it already links at line 200. |
| 5 | Soft mode | **keep** | The loop diagram earns its place; only its broken cross-refs (224, 228) need repair. |
| 6 | Hard mode | **rewrite + relocate** | Moves after evidence/verification so GATE is read with the doctrine in hand; contents (GATE "Shipped", launcher "next release") are stale — flagged in §5. |
| 7 | Honest capabilities and limits | **rewrite** | The institution stays — it is house identity — but four of eight bullets are component trivia (see fight #3) crowding out the limits that decide adoption. |
| 8 | Quickstart | **keep + relocate** | The side-by-side table works; it moves up, fused with §3's frame, so reader (b) reaches it without wading through the hard-mode ledger. |
| 9 | Five-part spec | **keep + relocate** | Defined at line 409, first used at line 8; the definition moves to position 3. Content itself needs nothing. |
| 10 | Worktree isolation | **keep** | Doctrine and diagram stay; exit-code tables (473-480) and per-script codes go to USAGE.md (fight #1). |
| 11 | Evidence contract | **merge** | Into "reports are claims" with §12; the Grok bug walkthrough (527-544) trims to its principle (fight #2). |
| 12 | Verification and the audit lane | **merge** | Same section as §11 in all but heading; the merged section is where checker soundness lands. |
| 13 | Documentation stage | **merge** | It is already step 4 of §12's checklist (line 553); one paragraph + pointer inside the merged section, tool/config table to USAGE.md. Fixes the dead "(see section 15)" at line 591. |
| 14 | Repo understanding (knowledge graph) and maintenance | **cut (as a section)** | Its framing — graph as maintenance chore — is exactly what v0.2.9 refutes; the query material is absorbed into the new record section, the maintenance paragraph into further reading. |
| 15 | Further reading, security, layout, license, lineage | **keep** | Correct as the closer; absorbs §14's maintenance pointer; layout tree update is line-editor work. |

## 4. What is missing, and where it belongs

Four bodies of v0.2.9 material need homes. None of them is an appendix; each
displaces something.

**(a) The fourth lane, and the invariant re-keyed on model family.**
Belongs in new-§2 (mental model) and new-§4 (lanes) — not as an added
paragraph but as the organizing change. `agy` is a multi-model gateway
(gemini-*, claude-*, gpt-oss-*), so the identity that the cross-vendor
invariant compares can no longer be the CLI: an agy lane configured to a
claude-* model audited against a Claude-implemented diff is same-family
review wearing a different binary. `cross-vendor-audit-routing/proposal.md`
:64-66 states the rule the README must now teach: "The invariant moves to
model family, not CLI name... A gateway CLI serving another vendor's family
is treated as that family." Displaces: line 50's "Four roles, four
producers", the four-box diagram, and the CLI-name vocabulary of lines 44-46
and 165. The lane table in §4 gains one row — with its honest caveats
carried from the roadmap residuals (cap 1, shared home, isolation unsolved),
which belong in new-§11, not in the table.

**(b) The graph plane.** Belongs as the new section 9, "The record," after
"reports are claims" — because it is the answer to that section's implicit
question: the event log is the source of truth; the work-DAG is a
deterministic projection of it that no LLM ever writes; the knowledge plane
is graphify's, on two cadences with zero tokens in the per-merge path;
TerminusDB is a regenerable materialisation behind a `GraphStore` port with
a files-only fallback, never the system of record; and consumption is a
pre-serialized, content-hashed, token-budgeted context block — the only
design where the audit trail can prove what the worker saw. The section must
also carry the plane's honest frame from the roadmap: sold as cross-session
provenance and deterministic gate checks, never as retrieval accuracy
(BM-25 beat all nine GraphRAG systems; the falsification package carries ten
pre-registered kill criteria). Displaces: all of §14 — its graphify-query
how-to (lines 596-605) folds in as the consumption mechanics; its
maintenance paragraph (607-612) exits to further reading. Do not append this
material to §14's frame; §14's frame is the thing being replaced.

**(c) Checker soundness.** Belongs inside the merged "reports are claims"
section as its extension, not as a new section — the doctrine's arc is:
reports are claims (§11), so the architect re-verifies (§12), *and the
checks themselves are claims too*. The roadmap's formulation is already in
house voice and should survive nearly intact: "a test that never fires is
silent, whereas a checker whose predicate does not match its claim passes
loudly, and a loud pass is trusted." The three requirements (demonstrated to
fail against known-bad input; predicates bind to artifacts and content,
never exit codes or substrings; vacuous invariants reported as vacuous)
displace nothing — they complete the section they join.

**(d) The formal models and the telemetry gap.** Both belong in new-§11
(limits), which is where their honesty lives. Two to three lines each: three
Quint models (`formal/specs/*.qnt`), bounded depths 8-12 and 20k samples —
reachability and absence-within-depth, not unbounded correctness; and the
release's most consequential limit, currently absent from a ledger that
finds room for NTSTATUS byte-masking: Foreman today records no tokens, no
cost, no model identity, and verdicts live outside the lineage store. What
they displace: the four component-level bullets leaving §7 (fight #3).

## 5. Claims v0.2.9 has disproved — for the fact-checking editor

Flagged, not fixed. Evidence citations are in `ROADMAP.md` §v0.2.9 and the
named change packages.

1. **Line 251, GATE "Shipped — forbidden paths + hash drift + checks green +
   not BLOCKED."** Shipped, yes; sound as implied, no. `gate-eval.sh` reads
   `audit-verdict.json` with no freshness check while a failed re-audit
   leaves the previous round's APPROVED gating a reworked diff; an APPROVED
   verdict alongside a `critical` finding passes; only one of three gate
   inputs is content-bound; the gate-to-merge TOCTOU survives; WARNING
   silently authorises merge. Lines 562-567 (the verdict table's hard-gate
   column) inherit the same problem.
2. **Lines 152-153 and 501, lock soundness.** "Sweep this run's own stale
   lock directories" and "Serialize create/remove through the scripts
   (`flock` when available)" ride on a `mkdir` mutex that is not atomic on
   Ubuntu 26.04 (uutils `statx()` TOCTOU — 57 violations / 15 rounds
   measured, GNU 0), and `wt-new.sh:203` fails open after 30 seconds even
   with an atomic primitive.
3. **Lines 155-157 and 485-487, dirty-safety.** "Idempotent and dirty-safe"
   and the dirty-tree guards are poisoned on every installed clone:
   `install.sh:61-63` chmods 33 exec-bit-broken files in the working tree,
   leaving the clone permanently dirty when running Foreman on Foreman.
4. **Lines 44-46 and 165, the cross-vendor invariant stated as a system
   property.** "Same-vendor audit of a same-family worker is forbidden" and
   "vendor must differ from the worker" are enforced in exactly one place —
   `audit-run.sh:31-33`, hard mode only; soft mode is doctrine-only. And the
   identity compared must become model family once agy lands.
5. **Lines 259-261, "hard-mode-launcher ... executed next release, not in
   v0.2.7.5."** Now stale twice over: the package sits validated in
   `openspec/changes/` alongside `wsl-launcher-shipped` for v0.2.9.
6. **Line 665, "Change-folder conventions follow OpenSpec."** All sixteen
   pre-existing packages fail `openspec validate`; only the v0.2.9 packages
   validate strict.
7. **Lines 282-293, concurrency verified numbers.** Not wrong but no longer
   complete: the agy lane arrives capped at 1 with a shared home and
   unsolved isolation, and the independence argument behind cross-vendor
   review is itself qualified (nine frontier LLMs collapse to ~2 effective
   independent votes — the fourth lane is routing coverage, not added
   independence). The README should not oversell four lanes as four votes.
8. **`durable.enabled`.** I find no explicit README claim — the inert flag
   (`DURABLE_ENABLED` read by nothing) is documented in ROADMAP/config
   territory. The fact-checker should confirm no durability promise hides in
   §3's "Idempotent" language or in USAGE.md, and ensure the rebuilt README
   does not acquire one.
9. **Lines 296-297, 397, 485 — "As of v0.2.7.5 ..." provenance stamps.**
   Not disproved, but structurally guaranteed to rot; recommend the
   fact-checker strip release-stamps to ROADMAP wholesale.

## 6. The three cuts I would fight for

**Cut 1 — the exit-code tables in §10 (lines 473-480, with the per-script
codes at 462-463 and 467).** "| 2 | `jq` / Python required for metadata
update missing |" is lookup material, and the README promised at lines 17-19
that lookup material lives in USAGE.md. The author will say the README is
the teaching document; I will say exit code 4 has never taught anyone
anything, and a table maintained in two places is a table wrong in one of
them. The doctrine and the fan-out diagram stay; the codes go.

**Cut 2 — the Grok write-cancellation walkthrough in §11 (lines 527-544).**
Keep the war story's one perfect sentence — "the model narrates edits while
writing nothing; `DIG_B == DIG_A`" — and cut the rest: the
`--permission-mode` flag forensics, the five-line `grok --prompt-file`
invocation, the "Capitalized rule prefixes" paragraph. It is one vendor
CLI's bug workaround, already encoded in `agents/grok-implementer`, and with
four vendor lanes the README cannot carry per-CLI bug appendices as
doctrine. The author will resist hardest here, because this bug is the
proof the evidence contract isn't paranoia. The proof survives in the
sentence; the flags were never the proof.

**Cut 3 — the three launcher bullets in §7 (lines 311-324): nested Job
Objects, NTSTATUS byte-masking, jq-vs-python3.** The author will say the
honesty ledger is the house identity and cutting limits looks like hiding
them. The answer is that these are component-level limits with proper homes
(`launcher/README.md`, `reference-environment.md`) and their five lines
apiece crowd out the doctrine-level limits a reader actually needs before
adopting — a reader who stops at NTSTATUS masking never learns that Foreman
records no tokens, no cost, and no model identity. The ledger stays; it
trades trivia for the truth that matters.

---

*Structural editor, v0.2.9 doc pass. Companion documents:
`EDIT-readme-facts.md` (claims), `EDIT-readme-line.md` (prose).*
