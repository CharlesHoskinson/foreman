# Foreman — Cross-Vendor Orchestrator/Worker Skill: Design

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan
**Repo:** new standalone public repo (`foreman`), MIT license

## 1. Summary

Foreman is a single portable skill (Agent Skills standard, agentskills.io) plus a set of
deterministic harness scripts that implement a two-role, cross-vendor coding-agent pattern:

- **Orchestrator/Auditor** — whichever coding CLI the user invokes the skill from
  (Claude Code, OpenAI Codex, or xAI Grok Build). Owns planning, task envelopes,
  evidence, the audit, and the merge gate.
- **Worker** — a *different vendor's* CLI, run headlessly inside a hardened container,
  which implements the task in an isolated git worktree.

The design descends from `masterslave.md` (Codex-supervises-Grok architecture) with every
blocking finding from its critical review (`slaverev.md`) resolved mechanically rather than
by prompt. Cross-vendor role separation is retained because decorrelated failure modes are
the one defensible multi-agent review pattern; CI remains the final authority on merges.

## 2. Goals

1. One skill directory, installable once, usable natively from all three CLIs
   (`/foreman` in Claude Code and Grok; `$foreman` in Codex).
2. Full task loop in v1: task → worktree → plan → sandboxed implement → independent
   checks → evidence → cross-vendor audit → bounded rework → PR.
3. All security-critical enforcement in deterministic scripts, never in prompts.
4. WSL2 as the reference environment: Ubuntu (26.04 reference box), Docker, the three
   CLIs, git, jq, **Scrapling** (research/fetch layer) and **Graphify** (repo knowledge
   graph) installed by `install.sh` and baked into the worker image.
5. Dogfood validation: the first real task executed through the harness is the harness
   building one of its own components.

## 3. Non-Goals (v1)

- No custom Agent Control Plane, task API, policy engine, or evidence service
  (slaverev.md §6: premature until the thin harness demonstrably fails to scale).
- No CI workflow templates (candidate v2; CI is assumed to exist and is the merge gate).
- No MCP servers mounted into the worker (injection surface; revisit post-v1).
- No Windows-native (non-WSL2) execution path.
- No guarantee of absolute isolation — containers are defense-in-depth; documented honestly.

## 4. Locked Decisions

| Decision | Choice |
|---|---|
| Skill shape | One portable Agent Skills-standard skill; launching CLI = orchestrator |
| Environment | WSL2-centric; sandbox and tooling built around it |
| Worker selection | `.foreman/config.toml` per repo; fallback = first other-vendor CLI installed |
| Home | New standalone public repo, MIT |
| Toolkit | Scrapling + Graphify included in reference environment and worker image |
| v1 scope | Full loop through PR; CI/merge outside the skill |
| First validation | Dogfood — harness implements one of its own components |
| Architecture | Skill + deterministic harness scripts (no MCP service, no protocol-only skill) |

## 5. Repository Layout

```
foreman/
├── README.md · LICENSE · install.sh        # checks WSL2/Docker/CLIs; installs skill + tools
├── skills/foreman/
│   ├── SKILL.md                            # orchestrator protocol (name+description frontmatter)
│   ├── references/
│   │   ├── roles.md                        # the two role contracts
│   │   ├── audit-checklist.md              # audit dimensions + verdict schema
│   │   ├── security-model.md               # threat model; script-enforced vs. operator-enforced
│   │   └── cli-adapters.md                 # verified flag matrix for claude/codex/grok
│   └── scripts/
│       ├── task-new.sh                     # serialized worktree creation + task envelope + hash snapshot
│       ├── worker-run.sh                   # dispatches to adapters/, launches container
│       ├── adapters/claude.sh · codex.sh · grok.sh
│       ├── checks-run.sh                   # tests from pristine checkout, network-off container
│       ├── evidence-collect.sh             # host-side, writes outside any worktree
│       ├── audit-run.sh                    # read-only cross-vendor audit → verdict JSON
│       ├── gate-eval.sh                    # deterministic pass/fail
│       └── pr-open.sh                      # push branch + open PR with evidence summary
├── sandbox/
│   ├── Dockerfile.worker                   # pinned toolchain + worker CLIs + Scrapling + Graphify
│   └── docker-run.sh                       # hardened docker run wrapper
├── config/foreman.toml.example
└── docs/                                   # specs (this document), architecture notes
```

**Installation.** `install.sh` copies `skills/foreman/` to `~/.agents/skills/` (scanned
natively by Codex and Grok per their official docs) and symlinks it into
`~/.claude/skills/` for Claude Code. Grok additionally reads `.claude/skills/` unchanged.
One skill body serves all three CLIs.

**Per-repo config** (`.foreman/config.toml` in the target repo):

```toml
[worker]
vendor = "grok"            # claude | codex | grok; must differ from orchestrator (enforced)
model  = "grok-4.5"        # pinned; model names are moving targets

[checks]
command = "npm test"       # the repo's own check entrypoint; auto-detected if omitted
                           # (package.json → npm test, pyproject.toml → pytest, etc.),
                           # exit 2 on unknown stacks rather than guessing

[limits]
max_rework_rounds = 3
round_timeout_min = 30
max_tokens_per_round = 400000

[gate]
forbidden_paths = ["tests/**", ".github/**", ".foreman/**", "*.lock",
                   "package-lock.json", "scripts/run_checks*"]
```

**Run state.** `~/.foreman/runs/<task-id>/` holds the task envelope, plan, worker event
logs, check results, evidence bundle, audit verdicts, and gate decisions. This directory
is on the host, outside every repo and worktree, and is never mounted into the worker
container.

## 6. Roles and Task Loop

```
INIT → PLAN → IMPLEMENT → CHECK → AUDIT → GATE ──pass──→ PR (CI = final authority)
                 ↑___________________________│ fail (≤ max_rework_rounds, then FAIL + human summary)
```

1. **INIT** (`task-new.sh`): serialized worktree creation under `flock` (parallel
   `git worktree add` races on `.git` locks — verified upstream issue); task envelope
   `task.md` (goal, constraints, done-when); SHA-256 snapshot of `tests/**`, check
   scripts, and CI config; `core.hooksPath=''` set for the worktree and used on every
   harness git invocation.
2. **PLAN**: orchestrator runs Graphify to map the repo into a queryable knowledge graph,
   then writes `plan.md` + acceptance criteria to the run directory. All handoff is via
   files and git — never chat context.
3. **IMPLEMENT** (`worker-run.sh`): worker CLI launched headlessly *inside* the hardened
   container with only the worktree mounted read-write. The prompt is passed as a file —
   never string-interpolated into shell. Streaming JSON events captured to the run dir.
   Full-auto approval flags are acceptable here solely because the container is the
   security boundary. The worker contract requires committing its work in the worktree;
   uncommitted changes are not eligible for CHECK or AUDIT.
4. **CHECK** (`checks-run.sh`): the orchestrator re-runs all checks itself from a
   **pristine checkout of the worker's commit** (not the dirty worktree) in a
   `--network none` container whose dependency layer was pre-populated at image build
   (resolving the install-vs-no-network contradiction). The worker's own claim that tests
   pass is never treated as evidence (reward-hacking defense).
5. **AUDIT** (`audit-run.sh`): the auditor is invoked read-only with **only the cold
   diff** and acceptance criteria — no worker chat history. Verdict is schema-forced
   JSON. The auditor's output is untrusted input to the gate, not a verdict to relay.
6. **GATE** (`gate-eval.sh`), deterministic conjunction:
   - diff touches no forbidden path;
   - pre-run hash snapshot unchanged;
   - checks green;
   - audit verdict ≠ `BLOCKED` (any `WARNING` findings attach to the PR).
7. **PR / REWORK** (`pr-open.sh`): pass → push branch, open PR embedding the evidence
   summary. Fail → findings appended to the task envelope; worker gets a fresh bounded
   round; after `max_rework_rounds`, stop and produce a human-readable failure summary.

## 7. Security and Enforcement Model

Every blocking finding in slaverev.md maps to a mechanism:

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

Honest limits, documented in `security-model.md`: containers share the WSL2 kernel;
this is defense-in-depth, not a hard boundary. Escalation to gVisor/microVMs is a
documented option, not a v1 deliverable.

## 8. Vendor Adapters

Each adapter exposes the same contract:

```
run_worker <worktree> <prompt-file> <session-id>   → normalized event log + result envelope
run_audit  <diff-file> <criteria-file>             → verdict JSON
```

Verified per-CLI facts the adapters encapsulate:

| CLI | Worker invocation | Audit invocation | Gotchas |
|---|---|---|---|
| Claude Code | `claude -p --output-format stream-json --dangerously-skip-permissions` (in-container only) | `claude -p --json-schema` read-only tool allowlist | `--bare` may become default for `-p`; cost reported in result JSON |
| Codex | `codex exec --json -C <dir>` | `codex exec --output-schema -s read-only -` (diff on stdin) | `codex review --json` **does not exist** (open request); `-p` means `--profile`; stderr/stdout split; needs git repo or `--skip-git-repo-check` |
| Grok Build | `grok -p <file> --output-format streaming-json --always-approve` (in-container only) | same, read-only prompt + schema-forced verdict | `streaming-json` ≠ Claude's `stream-json`; detect xAI binary vs community grok-cli sharing `~/.grok/` |

Verdict schema (all auditors):

```json
{ "verdict": "APPROVED | WARNING | BLOCKED",
  "findings": [ { "severity": "...", "file": "...", "line": 0,
                  "summary": "...", "evidence": "..." } ] }
```

Orchestrator ≠ worker vendor is enforced by `worker-run.sh` (exit 2 if violated).

## 9. Error Handling

- **Exit-code contract** on every script: `0` pass, `1` gate/check failure, `2` config
  error, `3` required CLI missing.
- Worker CLI missing → actionable install message. Audit CLI missing → **gate fails
  closed**; no silent skip.
- Per-round wall-clock timeout and token budget from config; breach → kill container,
  round counts as failed.
- Same error three times in one round → kill session, respawn fresh (ralph-loop lesson).
- `git worktree remove` only after `git status --porcelain` is clean; dirty trees are
  preserved and reported.
- All git object-store mutations (worktree add/remove, fetch) serialized via `flock`.

## 10. Testing Strategy

1. **Script unit tests** (bats + fixture git repo): gate logic, hash-drift detection,
   forbidden-path matching, exit codes, worktree serialization under parallel creation.
2. **Red-team fixtures** (run in CI of the foreman repo itself):
   - task whose "solution" edits a test → gate must fail;
   - repo README containing a prompt-injection payload → worker may be steered, but the
     gate still holds (no forbidden-path edits, hashes intact, checks honest);
   - forged worker transcript claiming success with failing tests → CHECK stage catches it.
3. **Dogfood validation** (acceptance test for v1): from Claude Code as orchestrator with
   Codex or Grok as worker, run one real task through the full loop where the worker
   implements a foreman component (candidate: `pr-open.sh`) from a task envelope, and the
   resulting PR carries a complete evidence bundle.

## 11. Key Research Inputs

- **Agent Skills standard** (agentskills.io; spec repo `agentskills/agentskills`): all
  three CLIs support SKILL.md natively; vendor-neutral `~/.agents/skills/` scanned by
  Codex and Grok; Grok reads Claude skills unchanged.
- **openai/codex-plugin-cc** (~27.5k★): vendor-blessed template for cross-vendor
  review/rescue commands inside Claude Code.
- Community audit recipe (hamelsmu/claude-review-loop, shimo4228/codex-review, boyand,
  alecnielsen/adversarial-review): read-only auditor, cold diff, machine-checkable
  verdict, bounded loops, degrade-gracefully exit codes; cross-vendor agreement =
  high-confidence finding.
- **Corrections adopted:** no `codex review --json` (use `codex exec --output-schema`);
  git worktree creation races; orchestrator must re-run checks itself (Anthropic
  reward-hacking findings); sandbox-escape CVE patterns motivate keeping state outside
  the workspace.
- **Unverified, flagged:** cross-model review may be directionally asymmetric (one
  source: Claude-reviews-Codex helped, reverse hurt). Worth a dogfood-phase experiment;
  do not hard-code direction assumptions.

## 12. Open Questions (deferred, not blocking)

1. Repo name — `foreman` is the working name; final name checked for collisions before
   the repo goes public.
2. v2 candidates: CI workflow templates (re-run gate in GitHub Actions from committed
   SHA, attestations), third-vendor tiebreak audits, MCP-server lift of `scripts/`,
   gVisor/microVM runner class.
3. Whether Scrapling-backed research runs host-side only (current design: yes — the
   worker has no network) or gets a broker with an allowlist in v2.
