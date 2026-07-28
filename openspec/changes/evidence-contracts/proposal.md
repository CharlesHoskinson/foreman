## Why

Four times today across three vendors, lanes exited 0 while producing no real work: a codex audit lane announced its report was ready, checked that the file was absent, and still wrote nothing; a grok council lane wrote one of four required files after 191k tokens and 85 tool calls then waited on a nonexistent background notification; two further grok lanes emitted narration with zero tool calls. In every case the process exit code claimed success. The only signal that distinguished real work from narration was a pre/post git-status write-evidence digest — the same class of check grok-multiround.sh already uses for grok implement lanes alone. Planning, audit, research, and every non-grok vendor currently lack that protection and can narrate indefinitely while being reported successful.

## What Changes

- Make lane success depend on artifacts and their content, never exit code, never agent self-report, never substring matches on agent output — for implement, audit, planning, and research alike.
- Compute a write-evidence digest before and after every lane round; an unchanged digest is a failed round regardless of self-reported status.
- Generalize the bounded re-prompt / evidence loop from grok-only implement lanes to every vendor (via vendor-adapter-contract) and every lane type, with a loud terminal failure when the round budget is exhausted without a qualifying digest change.
- Capture vendor termination/stop reason alongside digest results so empty-burst (narration-only) can be distinguished after the fact from cancelled-writes (permission-gate blocks).
- Add a scoped mutation probe stage to checks-run.sh that mutates only diff-touched lines, asserts the suite kills each mutant, and reports survivors as unprotected changed lines; primary cadence is merge-gate (optional on-demand elsewhere), not every commit.
- Treat vendor-adapter-contract and test-infrastructure-hardening as co-requisites: this package owns evidence digests and the mutation-probe stage, not adapter argv shape or positive-control checker requirements.

## Impact

- **grok-multiround.sh** (or its successor): generalize from grok implement-only re-prompt into a vendor- and lane-agnostic evidence-loop mechanism (digest pre/post, budget, terminal loud failure).
- **lane-run.sh / lane-supervise.sh** (or equivalent orchestration entry points): capture pre/post write-evidence digests and vendor termination reasons for every lane round; feed results into success predicates and reports.
- **checks-run.sh**: add a new scoped mutation-probe stage (diff-touched lines only), wired primarily at merge-gate with optional manual invocation.
- **Downstream gates and status reporting**: must consume the evidence-loop terminal failure state so unchanged-digest / budget-exhausted outcomes cannot pass as green.
- **Cross-package**: depends on vendor-adapter-contract for how each CLI is invoked; does not duplicate test-infrastructure-hardening positive-control work.
