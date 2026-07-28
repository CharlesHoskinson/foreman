## Approach

### Evidence loop (digest + termination reason + bounded re-prompt)

Every lane round — implement, audit, planning, research — under every vendor adapter (grok, codex, claude, gemini, others) follows the same outer contract:

1. **Pre-round digest.** Before the adapter is invoked, compute a write-evidence digest over workspace change state (git-status / changed-file-set / content-hash family; porcelain status hashed is a valid illustration, not a hard-locked pipeline).
2. **Invoke via adapter.** Call the vendor through vendor-adapter-contract; this package does not define argv, flags, or prompt-file plumbing.
3. **Capture termination reason.** Record whatever stop/cancellation field the vendor CLI or API surfaces (stopReason, cancellationCategory, etc.) even when exit code is 0.
4. **Post-round digest.** Recompute the digest. If it is unchanged, the round produced no write evidence: mark the round non-success regardless of agent narration or exit code.
5. **Bounded re-prompt.** If the round failed for lack of write evidence (or other lane-type artifact criteria), re-prompt within a configured budget. On budget exhaustion without a qualifying digest change, enter a **loud terminal failure** — visible in run status, blocking downstream gates, never a silent pass-through.

Empty burst and cancelled writes both look like “unchanged digest + exit 0.” The digest alone cannot tell them apart; the stored termination reason is the differentiator for humans and automation after the fact.

This generalizes the property that grok-multiround.sh already proved valuable for grok implement lanes: the only reliable distinguisher between work and narration was the pre/post digest, not the process status.

### Mutation probe in checks-run.sh

Agent-written tests do not reliably improve defect catch rate; external adversarial checks do. Property-based and example-based suites catch partially non-overlapping defect classes; some rule classes are invisible to LLM review but trivial for deterministic checkers. Evidence-contracts therefore adds a **scoped mutation probe** stage conceptually inside checks-run.sh:

- Mutate **only** lines touched by the relevant diff (never whole-repo mutation).
- For each mutant, re-run the existing test suite.
- If no test fails, report an **unprotected changed line** (coverage defect of the diff, not a product failure).
- **Primary cadence: merge-gate.** Per-changed-line mutation is too slow to mandate on every commit or intermediate gate; merge is the single choke point where integrated-diff coverage is worth the cost. Optional/on-demand invocation remains available outside that gate.

### Ownership split

| Concern | Owner |
|--------|--------|
| Per-vendor CLI argv / flags / invocation | vendor-adapter-contract |
| Positive control (checkers must be able to fail) | test-infrastructure-hardening |
| Write-evidence digest, bounded loop, termination-reason capture, mutation probe | evidence-contracts (this package) |

Lane self-claims about files written or tests passing are a special case of the vacuous-check class: they pass loudly if trusted alone. This package fixes that by requiring artifact-based corroboration (digest + required artifacts). The sibling owns making generic checkers prove they can fail.

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

### False-positive digest changes

Incidental file touches (logs, lockfiles, temp caches, editor swap files) can change the digest without producing the intended deliverable. Mitigation: scope the digest to relevant paths where practical; pair digest change with lane-type required-artifact checks (named report files, expected paths) so an incidental touch alone does not count as success.

### Mutation-probe latency and cost at merge-gate

Even scoped to diff-touched lines, mutation can add meaningful wall time and CI cost at merge. Mitigation: primary cadence is merge-gate only (not every commit); optional on-demand for local debugging; keep mutants limited to changed lines so cost scales with diff size, not repo size.

### Vendor termination-reason heterogeneity

Not every vendor CLI surfaces a clean stopReason / cancellationCategory. Mitigation: capture best-available termination metadata per adapter (with an explicit “unknown/unavailable” bucket); still fail on unchanged digest, but label diagnosis confidence when the reason field is missing.

### Over-aggressive re-prompt budgets

A high round budget burns tokens on lanes that cannot write (e.g. persistent permission cancellation). Mitigation: record termination reason early; short-circuit or reduce budget when cancellation class is clear; always end in loud failure rather than silent green.
