# The audit-evidence-root contradiction — architect decision

**Raised by:** the Opus re-audit, as its self-consistency finding, and
independently by codex as "the audit evidence root is simultaneously required to
be external and to be a Git worktree".

**The finding:** `evidence-contracts` now specifies that an audit lane leaves
the reviewed worktree **unchanged**, and that a worktree mutation by an audit
lane is evidence of tampering. But **every audit report produced in this
release — including the report that raised the finding — was written to
`docs/research/vnext/`, inside the reviewed tree.** The specification forbids
the way the entire effort has been conducted.

It is not a drafting slip. Two constraints collide:

1. The write-evidence digest needs a git work tree to compute against.
2. The audit contract forbids writing into the reviewed one.

## Why the obvious answers are wrong

**"Relax the rule."** No. The rule exists because an auditor that can edit the
thing it audits can make its own findings disappear, and because a mutated
worktree destroys the diff the *next* lane will audit. It is the strongest
requirement in the package.

**"Write reports outside the repo."** This loses the property that makes the
reports useful: they are versioned with the code they describe, and a reader at
a commit can see what was known then. The reports are release artefacts, not
scratch output. Today's session is the proof — the value of `bugeventlog.md`
and the lane reports comes precisely from living in history alongside the work.

**"Just exempt `docs/`."** A path-prefix exemption is a hole an implementer can
drive anything through, and it is exactly the shape of predicate this release
keeps rejecting: it discriminates a *location*, not the *property* we care
about.

## The distinction that resolves it

The rule was written as "the worktree is unchanged". The property actually
wanted is narrower: **an audit must not alter the artefact under audit, or
anything that changes what a subsequent audit would see.**

Writing a new report *about* a diff does not alter that diff. Editing the code,
the specs, the tests, or a prior report does.

So the constraint is not location but **relationship to the reviewed set**:

- An audit lane declares a **reviewed set** (the paths under audit) and a
  **report path**.
- The reviewed set SHALL be byte-identical before and after. This is the
  tamper check, and it is what the digest actually measures.
- The report path SHALL be **disjoint from the reviewed set**, and SHALL be a
  path the lane creates rather than modifies. Appending to a pre-existing
  report is a modification and is refused.
- The report path MAY be inside the repository. Being in the same git work tree
  is what makes the digest computable — which dissolves the second constraint
  rather than trading it away.

Under this, every audit in this session is conformant: the reviewed set was
`openspec/changes/**` and the source tree; the report path was a new file under
`docs/research/vnext/`; the two are disjoint; no reviewed file was touched. The
re-audit lanes reported `unauthorized_git_activity: false` and named their only
write, which is the evidence this rule wants.

And it still catches the real failure: an auditor that edits a spec to match its
verdict has mutated the reviewed set, and a lane that overwrites a prior report
has modified rather than created.

## What must change

- `evidence-contracts`: replace "the reviewed worktree is unchanged" with the
  reviewed-set / report-path formulation, and require the audit lane to declare
  both **before** dispatch, so their separation is checkable rather than
  asserted afterwards.
- The digest requirement: state that it is computed over the **reviewed set**,
  not the whole work tree. This also removes a false positive nobody had noticed
  — a concurrent sibling lane writing elsewhere in a shared checkout would
  otherwise flip a whole-tree digest and be read as audit tampering. Three
  lanes ran concurrently in this repo today, so that is not hypothetical.

## Honest note

The re-audit found this by applying the release's own standard to the release.
That is the third time today the standard has caught something its own authors
missed, and the second time it has caught the architect. The rule was right; its
predicate discriminated the wrong property — the identical defect class the
workstream exists to eliminate.

---

## Superseded in part — the implemented form is better

Fix Round 2 Lane B implemented a sharper resolution than the one proposed
above, and it is the one that shipped.

This document framed the fix as *reviewed set* versus *report path*, with the
report permitted inside the repository. Lane B instead split the **roots** and
identified precisely why git was ever required:

- A **work root** — the worktree the lane operates on or reviews. It must be a
  git work tree, and its digest covers the declared deliverables under it
  **plus every path the status enumeration reports**. The enumeration is the
  part that needs git, because it is what catches writes the lane never
  declared.
- An **artifact root** — where the lane writes its required artifacts. It need
  **not** be a git work tree, and its digest covers exactly the declared
  deliverables, with no enumeration, because an orchestrator-owned run
  directory cannot receive undeclared writes from elsewhere.

For an audit lane the two must differ, and the artifact root is
`$FOREMAN_HOME/runs/<run-id>/reports/`. For implement, planning and research
lanes they may coincide.

That is better than the formulation above because it does not merely permit the
report to live somewhere — it explains **which property required git in the
first place** and confines that requirement to the root that actually needs it.
The apparent joint unsatisfiability was an artefact of treating one root as
two things at once.

Lane B also notes the plainer reading of this session: the `docs/research/vnext/`
documents are `research`-lane deliverables whose two roots legitimately
coincide, which the model permits with no exception at all.

**Three independent routes reached the same defect**, which is worth recording:
the Opus re-audit found the contradiction by applying the rule to the reports
themselves; the M4 Quint model proved `inv_d2_audit_roots_satisfiable` violated
pre-fix and holding post-fix; and Lane B found it while writing the repair. The
architectural reasoning above was correct about the shape and wrong about the
cut.
