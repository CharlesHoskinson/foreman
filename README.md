# Foreman

Foreman is a portable Agent Skill plus a set of deterministic harness scripts that
implement a cross-vendor orchestrator/worker pattern for coding agents: the CLI you invoke
it from (Claude Code, OpenAI Codex, or xAI Grok Build) becomes the **orchestrator and
auditor**, while a *different vendor's* CLI runs headlessly as the **worker** inside a
hardened, network-isolated container to implement the task in its own git worktree.
Every security-critical decision — sandboxing, evidence collection, hash-drift and
forbidden-path detection, the merge gate — is enforced by scripts, never by prompting the
model to behave; CI remains the final authority on any merge.

## Stage flow

```
INIT → PLAN → IMPLEMENT → CHECK → AUDIT → GATE ──pass──→ PR (CI = final authority)
                 ↑___________________________│ fail (≤ max_rework_rounds, then FAIL + human summary)
```

1. **INIT** — `task-new.sh` creates a serialized git worktree, a task envelope, and a
   SHA-256 snapshot of protected paths.
2. **PLAN** — the orchestrator (optionally aided by the Graphify knowledge graph) writes
   `plan.md` and acceptance criteria.
3. **IMPLEMENT** — `worker-run.sh` launches the worker CLI headlessly inside the sandbox;
   it must commit its work to be eligible for the next stages.
4. **CHECK** — `checks-run.sh` re-runs checks itself from a pristine checkout of the
   worker's commit, in a `--network none` container. The worker's own claims are never
   trusted.
5. **AUDIT** — `audit-run.sh` invokes a cross-vendor auditor read-only against only the
   cold diff and acceptance criteria; the verdict is schema-forced JSON.
6. **GATE** — `gate-eval.sh` is a deterministic conjunction: no forbidden path touched, no
   hash drift on protected files, checks green, audit verdict not `BLOCKED`.
7. **PR / REWORK** — `pr-open.sh` pushes and opens a PR with an embedded evidence summary
   on pass; on fail, verified findings go back to the worker for a bounded rework round
   (default `max_rework_rounds = 3`), after which a human-readable failure summary is
   produced instead.

## Requirements

- **WSL2** (reference environment: Ubuntu 26.04) — foreman is not supported on
  Windows-native or macOS/Linux-native execution paths in v1.
- **Docker**, running inside WSL2, used to build and run the hardened worker sandbox
  (`sandbox/Dockerfile.worker`, `sandbox/docker-run.sh`).
- **At least two** of the supported vendor CLIs installed and authenticated: Claude Code,
  OpenAI Codex, xAI Grok Build. One acts as orchestrator/auditor, a different one as
  worker — the harness enforces this and refuses to run otherwise.
- `git`, `jq`, `python3` (3.11+, for `tomllib`), `flock`.

## Quickstart

```bash
git clone <this-repo> foreman && cd foreman
./install.sh
docker build -t foreman-worker:latest -f sandbox/Dockerfile.worker sandbox/

# in the repo you want foreman to work on:
mkdir -p .foreman
cp /path/to/foreman/config/foreman.toml.example .foreman/config.toml
# edit .foreman/config.toml: set [worker] vendor/model, [checks] command, [gate] paths

# then, from your orchestrator CLI:
export FOREMAN_ORCHESTRATOR=<claude|codex|grok>   # your own vendor
/foreman        # Claude Code, Grok Build
$foreman        # Codex
```

`install.sh` copies the skill to `~/.agents/skills/foreman` (override with
`FOREMAN_SKILLS_HOME`) and symlinks it into `~/.claude/skills/foreman` (override with
`FOREMAN_CLAUDE_SKILLS`), installs Scrapling and Graphify, and reports which vendor CLIs
are present. It is idempotent — re-run any time. Pass `--skip-tools` to skip the
WSL2/tool checks and Scrapling/Graphify install (used by the test suite; useful if you're
just re-syncing the skill directory).

## Security model

| Threat | Enforcement | Where |
|---|---|---|
| Worker outside sandbox / always-approve flags | Worker runs inside Docker: `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, read-only root + tmpfs, pids/memory limits; only the worktree is mounted read-write | `sandbox/docker-run.sh` |
| Tamperable evidence | Evidence collected by host-side scripts into `~/.foreman/runs/`, never mounted into the container | `evidence-collect.sh` |
| Audit gamed via test edits | Pre-run SHA-256 snapshot of tests/check scripts; drift fails the gate; forbidden-path globs checked against the diff | `gate-eval.sh` |
| Prompt injection via repo content | Network-off worker (no exfiltration egress); no MCP mounted into the worker; auditor sees only the cold diff; worker output always treated as untrusted data | adapters, prompt templates |
| Git hooks as an escape vector | Hooks disabled (`core.hooksPath=`) at worktree creation and on every harness git call | `task-new.sh`, all scripts |
| Secrets exposure | Container receives only the single vendor API key it needs, env-injected at launch; orchestrator credentials never enter the container | `worker-run.sh` |
| Reward hacking | Orchestrator re-runs checks from a pristine commit checkout; auditor is proven not to mutate the tree | `checks-run.sh`, `audit-run.sh` |
| Workspace-config escape | Run state and config live outside the workspace; the harness never executes anything the worker could have written | layout invariant |

**Honest limits:** containers share the WSL2 kernel, so this is defense-in-depth, not a
hard security boundary — a determined worker with a kernel exploit is not stopped by
`--cap-drop ALL` alone. Escalating to gVisor or microVMs is a documented option for
higher-assurance environments, not a v1 deliverable. See
`skills/foreman/references/security-model.md` for the full write-up.

## Further reading

- Design spec: `docs/superpowers/specs/2026-07-10-foreman-orchestrator-worker-skill-design.md`
- Orchestrator protocol: `skills/foreman/SKILL.md`
- References: `skills/foreman/references/roles.md`,
  `skills/foreman/references/audit-checklist.md`,
  `skills/foreman/references/security-model.md`,
  `skills/foreman/references/cli-adapters.md`
