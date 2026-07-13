# Security and Enforcement Model

Every blocking finding from the harness's design review (`slaverev.md`, the critical
review of the original `masterslave.md` Codex-supervises-Grok architecture) maps to a
mechanism enforced by a script, never by a prompt. This table is verbatim from the design
spec, §7:

| Threat (slaverev.md) | Enforcement | Where |
|---|---|---|
| S1 worker outside sandbox, `--always-approve` | Worker inside Docker: `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, read-only root + tmpfs, pids/memory limits; only worktree mounted rw | `docker-run.sh` |
| S2 tamperable evidence | Evidence collected by host-side scripts into `~/.foreman/runs/`, never mounted into the container | `evidence-collect.sh` |
| S3 audit gamed via test edits | Pre-run SHA-256 of tests/check scripts; drift fails the gate; forbidden-path globs on the diff | `gate-eval.sh` |
| S4 prompt injection via repo content | Network-off worker (no exfiltration egress); no MCP in worker; cold-diff-only auditor context; worker output delimited as untrusted data wherever consumed | adapters, prompt templates |
| S5 git hooks as escape vector | Hooks disabled at worktree creation and on all harness git calls | `task-new.sh`, all scripts |
| S6 secrets exposure | Container receives only the single vendor API key it needs, env-injected at launch; orchestrator credentials never enter the container | `worker-run.sh` |
| Reward hacking (Anthropic research; METR) | Orchestrator re-runs checks from pristine commit checkout; before/after `git status --porcelain` snapshots around the audit prove the auditor mutated nothing | `checks-run.sh`, `audit-run.sh` |
| Workspace-config escape (CVE-2026-25725 pattern) | Run state and settings live outside the workspace; harness never executes config the worker could have written | layout invariant |

## Honest limits

Containers sharing the WSL2 kernel are **defense-in-depth, not a hard boundary**. A
sufficiently capable escape from the worker's container would land in the same kernel
that runs the orchestrator's own tooling, the host filesystem, and any other containers
on the box — the isolation here is meant to raise the cost and blast radius of a
compromised or maliciously-steered worker, not to provide a formally verified sandbox.
Escalation to gVisor or microVMs (Firecracker-class isolation, a separate kernel per
worker) is a documented option for hardening this boundary further, but it is explicitly
**not a v1 deliverable** — it is deferred to v2 alongside CI workflow templates,
third-vendor tiebreak audits, and an MCP-server lift of `scripts/`. Anyone deploying
foreman v1 in an environment where the worker's blast radius must be strictly bounded
(not just economically discouraged) should treat the current container hardening as a
starting point, not a finished answer.

## Session (mcp) transport posture

The mcp transport trades container isolation for subscription economics and live
visibility. The worker session runs ON THE HOST with vendor-native guardrails only
(Codex `workspace-write` sandbox; Claude Code permission modes with Bash allowed;
Grok `--always-approve` with NO vendor-native sandbox — the weakest-guarded vendor).
No `--network none`, no cap-drop, no read-only root: a hostile worker could reach
the network or the wider filesystem to whatever extent the vendor's own sandbox
permits.

Compensating controls that remain fully authoritative: forbidden-path diff check,
hash-drift snapshot over protected files, independent checks from a pristine
checkout, cross-model audit (model-family decorrelation), deterministic gate,
bounded rework, CI as final merge authority.

**Posture:** mcp mode assumes a non-malicious-but-fallible worker and defends the
merge, not the host. For untrusted or injection-risky inputs, use container mode.
