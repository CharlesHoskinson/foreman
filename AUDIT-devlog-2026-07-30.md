# Adversarial audit — `devlog/2026-07-29.md`

Auditor: independent lane, 2026-07-30. Read-only against `/root/fm-wt/integrate`
@ `b3bbdc3` (branch `integrate/v029-w1`). No source modified. The full bats suite
was deliberately not run (another run holds the host mutex); every claim below is
carried by a command or a commit that already exists in the tree.

**Question audited:** not "is the devlog accurate?" but *did the 2026-07-29 record
create a false impression of release readiness that the 2026-07-30 work refuted?*

VERDICT: BLOCKED

---

## 0. A process finding, before the audit proper

The brief states that `/root/fm-wt/integrate/AUDIT-devlog.md` "currently ends
`VERDICT: PENDING`". It does not:

```bash
ls /root/fm-wt/integrate/AUDIT-devlog.md
# -> No such file or directory
```

The previous lane produced no artifact at all. `RESUME-2026-07-30.md:100` asserts
the file's contents ("still reads `VERDICT: PENDING`") for a file that was never
created. This is the same class as the devlog defects found below: a document
asserting the state of an artifact nobody checked. Recorded so it is not
re-investigated, and because it is ledger-shaped.

This report is written to `AUDIT-devlog-2026-07-30.md` and is the only audit
artifact for this question.

---

## 1. Scope and method

The devlog is a self-report by the actor. Its evidentiary value to an auditor is
in what it omits, so the method was:

1. Read the record in full and enumerate its material claims.
2. Check each against the tree's own history (`git log`, `git show`) and against
   the six established 2026-07-30 facts, none of which appear in the devlog.
3. Ask separately, of the document as a whole, what decision a reader holding
   only this record would make.

Corroborating sources, all in-tree: `AUDIT-2026-07-30-fullsuite.md`,
`RESUME.md` (2026-07-29 17:52), `RESUME-2026-07-30.md`, commits `d44461e`,
`d39cc52`, `af04a53`, `0669b9c`, `1ca6bcc`, and `tests/baseline.tsv` /
`tests/skip-budget.tsv`.

Judgement is on the record, not on the actor. Section 3 states explicitly which
defects are dishonesty (none) and which are omission.

---

## 2. Claim-by-claim adjudication

### 2.1 Provenance and headline counts

| # | Claim | Verdict |
|---|---|---|
| A1 | "Written from the day's commits and audit reports, not from memory." | **OVERSTATED** |
| A2 | "Twenty-two commits on `main`" | **REFUTED** |
| A3 | "nine feature branches" | **OVERSTATED** |
| A4 | "twelve audits — every one BLOCKED, none a false alarm" | **UPHELD** as stated; **OVERSTATED** as a readiness signal |

**A2 evidence.**

```bash
git log --format="%cd" --date=short origin/main | grep -c 2026-07-29
# -> 16
```

Sixteen, not twenty-two. Fifteen at the moment the devlog itself was committed
(`02def97` is third-newest on `main`). No counting rule reproduces 22 for `main`;
48 non-merge commits exist across all refs for that date, so the number appears to
be neither.

**A3 evidence.** Fourteen package branches were merged into `integrate/v029-w1`
on 2026-07-29 (`git log --merges --date=short`, filtered to that date), and
`RESUME.md` — written 62 minutes after the devlog, by the same actor — tabulates
seventeen branch heads. "Nine" was a mid-afternoon snapshot presented without a
timestamp.

**A1 follows from A2 and A3.** The document's first sentence asserts its own
evidentiary provenance, and the two counts in its second sentence do not
reproduce. The release's own **Standing Rule 2**, adopted in this very document,
says *"a premise states behaviour and carries its check command."* The document's
opening premise carries no check command and fails on measurement. This is the
`round-ownership-default` defect the devlog itself itemises in §3 ("Nobody ever
ran the grep") reproduced in the document reporting it.

**A4.** "None a false alarm" is a false-*positive* claim and it holds — no audit
in the twelve was shown to have blocked on a non-issue. It is silent on the
false-*negative* rate, which is what a readiness reader needs. Twelve BLOCKED
audits across fourteen merged packages did not surface: a test that had never once
passed (§2.4), a test that was not hermetic on the primary dev platform, eight
test files registered in no policy file, or a gating formal row with a ~9%
false-failure rate. The audit regime was package-local and rigorous within a
package; the record offers "twelve, twelve BLOCKED" as evidence of a rigour that
had not been applied at the integration or test-infrastructure level.

### 2.2 The S1 narrative (§1)

| # | Claim | Verdict |
|---|---|---|
| B1 | crlf: six rounds, defect relocated five times, class closed by inverting the predicate | **UPHELD**, with an omission |
| B2 | lock: seven rounds / four sub-packages; L1 rework closed six findings and introduced three; L2 register shipped deliberately empty; integration audit found four HIGH | **UPHELD** |
| B3 | "at 16:10 the nine packages were integrated onto one branch for the first time" | **REFUTED as stated** |

**B1.** The narrative is accurate and is the most instructive content in the
document. The omission: the class was **not** closed on 2026-07-29. F2 and F3
were still owed — `RESUME.md` §2 says so under the heading "crlf is BLOCKED — F2
and F3 owed" — and they did not land until `60850ab` on 2026-07-30. The devlog's
"the class only closed when the predicate was inverted" reads as a completed
closure; the same actor's resume document, an hour later, records it as open.

**B2.** Fully corroborated. The 2026-07-30 audit read `lib/lock.sh` in full
(1631 lines) and found the acquisition protocol sound, including refuting one
hypothesised release-path defect. The devlog understates rather than overstates
here.

**B3.** Internally inconsistent with the same document's §5 ("Nine packages
implemented; **six** integrated"), and both figures are superseded by the day's
own history: fourteen package branches merged into `integrate/v029-w1` on
2026-07-29. The "for the first time" framing is correct; the count is not.

### 2.3 "What went right" (§2)

| # | Claim | Verdict |
|---|---|---|
| C1 | Spec-derived test found what eleven audits missed; committed red | **UPHELD**, and stronger than claimed |
| C2 | Unison settled by counting: 97 mechanisms, 3 (3.09%), 53.6% logic/spec | **UPHELD**, not independently recounted |
| C3 | Derived inventory caught four `100644` bash files across a merge | **UPHELD** |
| C4 | "Telemetry cannot block a merge, proven rather than asserted" | **UPHELD**, with a material caveat |
| C5 | Skeleton-first writing saved rounds | **UPHELD** |

**C1.** The claim is true and the discipline held better than the record says. The
red test (`tests/lock.bats`, *"uncovered filesystem refuses before acquisition and
names its class"*) was made green by fixing the **implementation**, not the
assertion: `0669b9c` — *"fix(lock): name the filesystem class in
FM_LOCK_FS_UNSUPPORTED"* — same day. The test now asserts `detected_class=network`
and `covered_classes=local` against real output. The devlog's present tense ("The
test is committed red") was stale within hours, which is harmless.

**C2.** Recorded as accepted, not re-derived. The decision is committed
(`6245963`, D13) and no 2026-07-30 evidence contradicts it. Flagged only so that
"UPHELD" is not read as "independently recounted."

**C4 caveat.** The proof is real, but `tests/telemetry.bats` was registered in
**neither** `tests/baseline.tsv` nor `tests/skip-budget.tsv` until 2026-07-30
(`d44461e`), and the suite containing it had never completed on the integrated
tree. So on 2026-07-29 the file's status on the merged branch was *unobserved*,
and no policy layer would have noticed if it had stopped running. The claim was
true; its standing on the tree being described was not established.

**The structural point about §2.** Four of its five "what went right" items —
C1, C3, C4, and the lock suite — are claims *about tests*. Every one of them was
asserted on a tree whose test suite had never been run to completion. The
document's evidentiary base is a test layer whose own aggregate status was
unknown when the document was written.

### 2.4 "What went wrong" (§3)

**UPHELD in full.** Fix rounds carrying new defects, five itemised personal errors
(the `--chmod=+x` index revert, `pgrep -f` self-match, four WSL heredoc-trap hits,
the L3 mis-partition, the double false-positive reaper), the false
`DURABLE_ENABLED` premise, nine strandings, and 77 minutes of dead time. This is
the most reliable section of the document and nothing in the 2026-07-30 record
disputes any of it.

Its candour is what makes the §5 omission conspicuous. An actor willing to itemise
five of their own errors and a false premise was not concealing anything. The gap
is in what counted as an error, not in what was disclosed.

### 2.5 Standing rules (§4)

| # | Rule | Verdict |
|---|---|---|
| E1 | Rules 1-5, 7, 8 | **UPHELD** as adopted |
| E2 | Rule 6: "Every new gate lands in shadow mode, promoted only after ten of our own runs with no false positive" | **REFUTED by the same day's own commit** |

**E2 evidence.** `af04a53` (2026-07-29) — *"feat(formal): reproducible model
runner, coverage drift gate, and the first CI job"* — introduced both
`.github/workflows/formal.yml` and this row in `formal/expectations.tsv`:

```
eventlog_concurrency  main=toctou  seq_uniqueness  VIOLATED  simulation  2000x40  commit  yes  architect-VERIFY
```

`tier=commit`, `gating=yes`. It went live gating on the day it was written, with
zero shadow runs. Measured on 2026-07-30 (`d39cc52`):

> "at the manifest bound 2000x40 the search finds the violation for only ~91% of
> seeds... Measured hit rate 118/130 = 90.8%, miss about 1 run in 11"

A gate that fails roughly one run in eleven for no reason in the tree is the exact
failure mode Rule 6 exists to prevent, and `formal.yml` was therefore laundering a
flaky check rather than verifying anything. The rule holds for the bats gate
(`tests/run.sh` defaults `TEST_GATE_MODE=shadow`) and fails for the formal gate.
The devlog states the rule and does not record that the day's only shipped CI job
violated it.

### 2.6 "Where things stand" (§5)

| # | Claim | Verdict |
|---|---|---|
| F1 | "nothing on `main` yet" | **UPHELD** |
| F2 | "The integration merged with one conflict — both were kept, being purely additive" | **UPHELD** as merge mechanics; **OVERSTATED** as integration health |
| F3 | "roughly 24 of 33 packages remain unimplemented" | **REFUTED** as an end-of-day figure |
| F4 | Deferred: D5 Git-Bash pin; `three-outcome-verdicts` before verdict-lineage; "no CI job runs `bats` on any platform" | **UPHELD** |

**F2 is the load-bearing defect.** This one sentence is the entirety of the
document's integration risk assessment. It is true — the `durable-lanes.md`
conflict was additive on both sides — and it is the only thing the record says
about whether fourteen packages that had never been run together work together.
A textual merge result is presented in the position where an integration verdict
belongs.

**F3.** Fourteen packages had code by end of day (`RESUME.md`: *"Fourteen packages
have code"*, and its own table lists seventeen branch heads). "Roughly 24 of 33
remain" implies nine implemented. The error is in the conservative direction and
misleads nobody about readiness, but it is a third headline count in the same
document that does not reproduce.

**F4.** All three deferrals confirmed still-true on 2026-07-30. Note carefully
what the third one says and does not say: *"no CI job runs `bats` on any
platform"* is a statement about **CI**. It is adjacent to the material omission
and could easily be mistaken for it. "No CI runs the suite" and "nobody has ever
observed the integrated tree pass its own suite locally" are different facts. The
record states the first and omits the second.

---

## 3. What the record omitted

### 3.1 The omission that decides the verdict

**The 41-file suite had never completed on the integrated tree, and the devlog
nowhere says so.**

This was known when the devlog was written. `RESUME.md`, committed at 17:52 the
same day by the same actor, makes it heading number one under "What is NOT done":

> "### 1. The full suite has never completed uncontended
> **This is the most important open item.**"

and states the correction verbatim:

> "Until that passes, 'fourteen packages merged clean' means *they merged*, not
> *they work together*."

The knowledge existed. It did not reach the narrative record. The devlog does not
contain the word "suite" at all.

Even the suite's size was misknown: `RESUME.md` calls it 33 files because
`tests/baseline.tsv` had 33 rows. It is 41. Eight files were registered in neither
policy file — `decision-events`, `evidence`, `graph-project`, `line-endings`,
`lock`, `readme-structure`, `release-metrics`, `telemetry` — every one added by a
v0.2.9 package, i.e. by the very work the devlog narrates.

**What the first completed run found** (`d44461e`, `AUDIT-2026-07-30-fullsuite.md`):

```
TOTAL pass=434 fail=6 skip=15 tests=455 bare_skip=0 platform=wsl
RESULT FAIL test_failures=6
```

### 3.2 Test-layer validity, none of it in the devlog

Zero of the six failures were product defects. That is the mitigating fact, and it
is why §4 does not call the record dishonest. But each failure is a defect in the
evidence layer the devlog's §2 relies on:

- **`worker-run` 5 could never have passed.** The `init-firewall` banner goes to
  stdout, bats merges it into `$output`, and the assertion was `[ "$output" = ok ]`.
  Banner and assertion landed in the **same commit**, `1ca6bcc` (2026-07-19), so
  the test had never once passed with Docker present. Verified directly:
  `git show 1ca6bcc -- tests/worker-run.bats` contains `[ "$output" = ok ]`;
  `git show 1ca6bcc -- sandbox/init-firewall.sh` contains
  `echo "init-firewall: applied (OUTPUT DROP, ...)"`. Ten days in-tree, through
  twelve audits. Its sibling `!= root` assertion was vacuous for the same reason.
- **`lane-queue` 7 was not hermetic.** On POSIX there is no PATHEXT rule, so the
  `.exe` shim never shadowed a real `pueue` and the test bound
  `/usr/local/bin/pueue 4.0.4`. Its own teardown comment
  (`tests/lane-queue.bats:266-269`) asserts the opposite: *"they never talk to the
  real binary at all."* The corrective comment now in the file at line 384 records
  the contradiction.
- **Committed baselines were platform-unreachable.** `launcher.bats` carried
  `baseline=14` recorded on Windows against a WSL ceiling of `pass=4`. Under
  `TEST_GATE_MODE=enforce`, the suite would have failed on the project's own
  primary dev platform for policy reasons alone.
- **A lane shipped a dead predicate and reported success.**
  `__disabled_for_independent_proof__` survived in `lane-run.sh`, disabling the
  refusal branch that the `round-ownership-default` package existed to add. What
  caught it was a **registered pass baseline disagreeing 8-vs-7** — a tripwire
  that exists only because the policy layer was recalibrated on the morning of
  2026-07-30. **On 2026-07-29's policy state, that tripwire did not exist.** The
  devlog's Rule 3 ("derive tests from the specification") is sound and would not
  have caught this; the mechanism that did catch it was not in place on the day
  the record claims the discipline was working.

### 3.3 The decision a reader would have made

Take a competent reader holding only `devlog/2026-07-29.md` and asked: can
`integrate/v029-w1` merge to `main`?

They find a day of twelve BLOCKED audits with no false alarms, five evidenced
successes, a candid and specific failure section, eight standing rules, a clean
additive merge, and **exactly three named deferrals** — none of which is "the
suite has never run." Nothing in the document flags integration health as open.
They merge.

Merging at that point would have put six failing tests and eight unregistered test
files onto `main`. That is a wrong decision induced by the record. The record did
not have to state anything false to induce it; the three deferrals it does name
create the impression that the open set is enumerated, and it is the completeness
of that list, not the truth of any sentence, that misleads.

### 3.4 Dishonesty: no. Overstatement: yes.

Stated plainly, per the brief. Nothing in this document is a lie. §3 volunteers
five of the actor's own errors, a false premise the actor authored, and 77 minutes
of self-attributed dead time — behaviour incompatible with concealment. The
corrective statement existed in `RESUME.md` sixty-two minutes later. The failure is
that the narrative record and the handoff record were written to different
standards, and only the narrative record ships on `main`.

The refutation was also benign: zero product defects, and the tree reached
`pass=447 fail=0 skip=19` at `0c884d7`. **The product was sound; the record was
not entitled to say so.**

---

## 4. Verdict

Two findings are blocker-grade against the record as it stands on `main`:

1. **The readiness omission (§3.1).** The single fact most determinative of
   release readiness — that the integrated tree's suite had never completed — was
   known to the author on the day and is absent, while §5 presents an enumerated
   list of open items that a reader will take as complete. Fourteen packages
   "merged clean" is left to mean what `RESUME.md` explicitly says it must not
   mean.
2. **A standing rule stated and broken in the same day's commits (§2.5, E2).**
   Rule 6 requires ten clean shadow runs before promotion; `af04a53` shipped the
   day's only CI job with a `gating=yes` commit-tier row measured at 90.8% power.
   A rules section that records a rule the record's own day violated is not a
   doctrine document, it is an aspiration.

Supporting, not independently blocking: three headline counts that do not
reproduce (A2, A3, F3), an internal contradiction on the integration count (B3),
and a closure claim for crlf that the same actor's handoff records as open (B1).

The remedy is cheap, bounded, and has precedent in this repo — `3b293a5`,
*"docs(devlog): correct a wrong resume instruction"*, amends a devlog by commit.
Required before this record ships with the release:

1. Append a dated correction block to `devlog/2026-07-29.md` stating that the
   41-file suite had never completed on `integrate/v029-w1` when the entry was
   written; that eight of its files were registered in no policy file; that the
   first completed run (2026-07-30, `d44461e`) found six failures, all test-side;
   and that the tree subsequently reached `pass=447 fail=0`.
2. In the same block, correct the three counts (commits on `main`: 16; packages
   merged that day: 14; packages with code: 14 of 33) and reconcile §1's "nine
   packages integrated" with §5's "six".
3. Record Rule 6's same-day exception against `formal.yml` and `af04a53`, with the
   measured 118/130 and the resolution at `d39cc52`.
4. Correct B1: crlf F2/F3 were owed at the time of writing and landed at
   `60850ab`.

Nothing here requires a product change. The blocker is on the record, not the
release content — which is the strongest available argument that the amendment
should be made rather than argued about.

VERDICT: BLOCKED
