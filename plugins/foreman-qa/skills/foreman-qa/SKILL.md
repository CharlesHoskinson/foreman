---
name: foreman-qa
description: Use before claiming any Foreman work is done, verified, or passing - the evidence rules that separate a measured result from a plausible claim.
---

# Foreman QA

## The rule

A plausible claim is not a verified result. Verification requires fresh evidence whose predicate can discriminate, whose execution reached the claimed path, and whose output binds to the claimed artifact.

Read [the full evidence rules](references/evidence-rules.md) before making a decision-changing claim. Use [the failure catalogue](references/failure-catalogue.md) to recognize known failure shapes.

## Core discipline

- Treat every report as a claim. Re-run the verification command yourself and read its output. “Should work” and summaries without command output mean **NOT DONE**. [Why](references/evidence-rules.md#a-report-is-a-claim)
- Read the actual diff before accepting work from a subagent, vendor lane, or prior session. A completion report cannot establish what changed. [Why](references/evidence-rules.md#read-the-diff)
- Never infer the result from an exit code alone. Read the declared `RESULT` token and every named field; `SHADOW` and `ERROR` are neither `PASS` nor ordinary `FAIL`. [Why](references/evidence-rules.md#an-exit-code-is-not-a-result)
- Require diagnostic probes to survive the failure they exist to report and to print an outcome on every path. Scope errexit off around the probe; silence is not success. [Why](references/evidence-rules.md#silence-is-not-success)
- Record an absent measurement as `unavailable` or `unmeasured`, never `0`. Zero is a measured value. [Why](references/evidence-rules.md#an-absent-figure-is-data)

## Discrimination

- A check that cannot fail is not coverage. In the same run, make its predicate answer **NEGATIVE** on known-bad input and **POSITIVE** on known-good input before trusting it. [Why and incidents](references/evidence-rules.md#require-both-polarities)
- The two arms must differ in the property the check actually reads, not merely in file name or path. Naming the same file as both `known_bad_input` and `known_good_input` cannot demonstrate discrimination. [Why and incident](references/evidence-rules.md#require-both-polarities)
- Reject unanchored substring predicates when opposing outcomes share words. `violation found` and `No violation found` both contain `violation`; substring presence cannot distinguish them. [Why and incident](references/evidence-rules.md#require-both-polarities)
- Look for every form of a predicate that cannot go red: exit-code proxies, vacuous invariants, checks against the wrong module, and literal comparisons that can never be true. [Checker failures](references/failure-catalogue.md)
- Do not call two executions of the same predicate corroboration. Require a different predicate, mechanism, or actor; otherwise label the result **uncorroborated**, not verified. [Why](references/evidence-rules.md#require-independent-corroboration)
- Make empty selection an error. A green suite over zero selected tests or a zero-row inventory proves no coverage. [Why and incident](references/evidence-rules.md#reject-empty-selection)

## Provenance

- Rank findings produced by executing code above findings produced by reading it. This repository measured five of five execution-derived defect claims as true and three of three inspection-derived counts as false. [Measured comparison](references/evidence-rules.md#rank-claims-by-provenance)
- Treat inherited claims from reports, commits, sessions, and agents as leads to measure, never settled facts. Apply this rule especially before deleting anything. [Why and incident](references/evidence-rules.md#treat-inherited-claims-as-leads)
- A documented or official API is a claim about behavior, not evidence of it, until something executes the call and reports the verbatim outcome. A plan must not hand an implementer a cause or fix it has not verified this way. [Why and incident](references/evidence-rules.md#an-authority-citation-is-not-verified-behavior)

## Reachability and artifacts

- A CI pass proves only the paths CI actually reached. Establish that the runner has the capability and configuration needed to execute the claimed behavior before citing green CI as evidence for it. [Why and incident](references/evidence-rules.md#ci-is-not-proof-of-coverage)
- A "not found" result may mean unreachable, not absent. Check whether the tool exists off `PATH` before writing an install step or an absence-based skip reason. [Why and incident](references/evidence-rules.md#a-not-found-result-is-not-proof-of-absence)
- A local gate that scans the working tree, not the index, can fail for reasons no clean checkout at the same commit will reproduce. Reconcile `git status --porcelain` or reproduce in a clean worktree before recording its red as a defect. [Why and incident](references/evidence-rules.md#a-local-gate-is-not-ci)
- Bind success to a named artifact and its required content. Exit `0` with an absent, empty, or malformed deliverable is failure; name the bad artifact in the verdict. [Why](references/evidence-rules.md#bind-the-predicate-to-the-artifact)
- Parse only known outcome tokens. Output matching no known `PASS`, `FAIL`, `SKIP`, or other declared state is `ERROR`, never success by default. [Why](references/evidence-rules.md#reject-unknown-outcomes)

## Stop honestly

If available tools cannot verify a claim, say **UNVERIFIED**. Name the exact command, capability, or artifact that would settle it; never translate missing evidence into “likely,” “should,” or pass. [Stopping rule](references/evidence-rules.md#when-to-stop)

Before claiming completion, state the claim, the discriminating predicate, the evidence just observed, the artifact or path reached, and any missing corroboration. If any element is absent, narrow the claim.
