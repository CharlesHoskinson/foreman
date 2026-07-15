# Foreman

**Cross-vendor architect / worker orchestration for coding agents.**

Foreman combines:

- **Soft mode** — Fable Advisor–style cost routing: high-judgment architect, Grok/Codex implementers, advisor at commitment boundaries, five-part specs, independent verification.
- **Hard mode** — original Foreman harness design: worktrees, host-side evidence, independent checks, cold-diff audit, deterministic merge gate → PR.

| Mode | Ready? | Needs |
|---|---|---|
| Soft | **Yes** | Claude Code (or Grok) + optional `grok` / `codex` CLIs |
| Hard | Partial scripts shipped | WSL2/bash, `git`, `jq`, `python3`; full Docker worker path still expanding |

## Install

### Windows (PowerShell)

```powershell
cd C:\Users\charl\foreman
.\install.ps1
```

### WSL / macOS / Linux

```bash
cd /path/to/foreman
chmod +x install.sh
./install.sh
```

This links `skills/foreman` into:

- `~/.claude/skills/foreman`
- `~/.agents/skills/foreman` (portable Agent Skills home)
- `~/.grok/skills/foreman`

and copies agents into `~/.claude/agents/`.

## Boot Claude (recommended dogfood)

```powershell
cd C:\Users\charl\foreman
claude
```

Inside the session:

```text
/model fable
/foreman
```

Project `CLAUDE.md` already pins architect doctrine. Example first prompt:

```text
Soft mode. Design and build the Foreman documentation website in site/.

Goal: a polished static site explaining how the combined Foreman skill works
(roles, lanes, five-part spec, soft vs hard mode, install/boot, security limits).

Write a five-part spec, route implementation to grok-implementer,
verify independently, consult foreman-advisor before locking information architecture.
```

**Requirements**

- Claude Code with Fable (or use `/model opus` and pin advisor to opus)
- [Grok CLI](https://x.ai/cli) authenticated for the default implementer lane
- Optional: [OpenAI Codex CLI](https://github.com/openai/codex) for races

Without Grok/Codex, agents report `STATUS: unavailable` — they never silently become Claude.

## Layout

```
foreman/
├── skills/foreman/          # portable skill (SKILL.md + references + scripts)
├── agents/                  # Claude Code subagents
├── config/foreman.toml.example
├── install.ps1 · install.sh
├── CLAUDE.md
├── site/                    # documentation website (dogfood target)
└── docs/
```

## Soft loop (always)

1. Architect decomposes and writes a five-part spec  
2. Route to `grok-implementer` (default) or race with `codex-implementer`  
3. Read diff + re-run verification  
4. Consult `foreman-advisor` at commitment boundaries  
5. Report done only with evidence  

## Hard loop (when enabled)

```
INIT → PLAN → IMPLEMENT → CHECK → AUDIT → GATE → PR
```

Scripts under `skills/foreman/scripts/`. Run state in `~/.foreman/runs/<task-id>/`.

## License

MIT — see [LICENSE](LICENSE).

## Lineage

- Soft routing doctrine inspired by [DannyMac180/fable-advisor](https://github.com/DannyMac180/fable-advisor)
- Hard harness design from the original Foreman orchestrator/worker spec
