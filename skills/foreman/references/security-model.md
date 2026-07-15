# Security model

## Honest limits

Containers (hard mode) share the host/WSL2 kernel — **defense-in-depth, not a
hard boundary**. Soft mode runs implementer CLIs on the host with their native
sandboxes only. Do not claim absolute isolation.

## Threat → enforcement map

| Threat | Soft mode | Hard mode |
|---|---|---|
| Worker over-permissioned | Prefer `acceptEdits` / `workspace-write`; re-run checks yourself | Docker: `--network none`, `--cap-drop ALL`, no-new-privileges, read-only root, worktree rw only |
| Tamperable evidence | Architect re-runs verification | Host `~/.foreman/runs/` evidence; never mounted into worker |
| Test/CI gamed | Spec forbids; review diff | Pre-run SHA-256 of hash_paths; forbidden_paths on gate |
| Prompt injection via repo | Cold five-part spec; advisor reads code carefully | Cold-diff auditor; worker output delimited untrusted; no MCP in worker |
| Git hooks as escape | Normal caution | `core.hooksPath=` on worktree + harness git |
| Secrets exposure | Don't paste keys into specs | Container gets only worker vendor API key |
| Reward hacking ("tests pass") | Re-run verification command | Pristine commit archive for checks |
| Same-vendor blind spots | Prefer cross-vendor implementer + Claude architect | Enforce worker ≠ orchestrator; audit ≠ worker |

## Soft mode residual risk

- Implementer can modify any file the host CLI can write
- No automatic forbidden-path gate — architect must enforce via review
- Use hard mode (or at least worktrees + careful review) for high-stakes autonomy

## Operator rules

1. Never pass orchestrator credentials into a worker container
2. Never skip gate on "looks good"
3. Prefer failing closed when audit or checks infrastructure is missing
