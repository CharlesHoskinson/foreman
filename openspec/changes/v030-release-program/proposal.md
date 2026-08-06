# Change: v030-release-program

## Why

Foreman v0.2.9.0 shipped, but the repository does not have one current plan for
v0.3.0. The remaining work is split across active OpenSpec packages, stale task
ledgers, divergent branches, release residuals, and knowledge-graph warnings.
This fragmentation has caused repeated review loops and lost implementation
time.

The release also needs a correctness measure that compares each proposed spec
with the complete v0.2.8.2 and v0.2.9.0 record. A Council review must detect an
omitted residual, a contradiction, or an invented completion before it accepts
a release plan.

## What changes

- Establish one canonical v0.3.0 program and sprint order.
- Bind the program to the canonical v0.2.8.2 and v0.2.9.0 accomplishment
  ledger.
- Add `SpecCorrectnessV1` as a required Council review metric.
- Reconcile stale authority files and task ledgers before implementation.
- Complete the Node.js 24 and TypeScript migration under the repository Iron
  Rule.
- Complete runtime-state, queue, project, session, Council, knowledge, and
  external-dogfood work in dependency order.
- Preserve a destruction log for every removed file, worktree, branch, or
  stale authority record.
- Require one exact-candidate release convergence run after all sprints.

## Impact

- **Authority:** This package becomes the release-level plan for v0.3.0.
- **Implementation:** Existing focused OpenSpec packages remain the detailed
  module contracts. This package maps them to one release program.
- **Review:** Council remains advisory. Its spec-correctness result is a typed
  input to the architect and does not replace deterministic gates.
- **Runtime:** All new executable code uses Node.js 24 and TypeScript. Effect
  owns fallible resources, cancellation, retries, timeouts, and concurrency.
- **Cleanup:** Destructive actions remain reversible until their recorded
  verification and approval conditions pass.
