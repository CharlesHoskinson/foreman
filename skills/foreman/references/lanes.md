# Lanes and CLI adapters

## Soft-mode lanes

| Lane | Producer | Claude agent | Direct CLI (headless) |
|---|---|---|---|
| Routine | Grok 4.5 | `grok-implementer` | `grok --prompt-file … -m grok-4.5 --permission-mode acceptEdits` |
| Cross-vendor | GPT-5.6 Sol (high) | `codex-implementer` | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --sandbox workspace-write` |
| Judgment | Fable / Opus | `foreman-advisor` | Session model or `model: fable` agent |

### Grok worker flags (soft)

- `--prompt-file` — never shell-interpolate large specs
- `-m grok-4.5` (or pinned model from config)
- `--permission-mode acceptEdits` — not blanket always-approve for host soft mode
- `--cwd` / working directory explicit
- Wall clock ~600s when `timeout`/`gtimeout` exists

### Codex worker flags (soft)

- `codex exec` with prompt on stdin
- `--sandbox workspace-write` (never danger-full-access in soft mode)
- `--skip-git-repo-check` when needed
- `--output-last-message` for report capture

### Preflight

Before invoking a lane:

```bash
command -v grok && grok --version   # or: command -v codex && codex --version
```

Missing CLI → `STATUS: unavailable` with install hint. **Never** silently implement
as the host model under that lane’s name.

## Hard-mode adapters

Scripts under `scripts/adapters/` normalize:

```
run_worker  → event log + result envelope
run_audit   → verdict JSON (APPROVED | WARNING | BLOCKED)
```

| CLI | Worker (in container only) | Audit (host, read-only) |
|---|---|---|
| Claude | `claude -p … --output-format stream-json --dangerously-skip-permissions` | `claude -p … --json-schema` + disallowed write tools |
| Codex | `codex exec --json …` | `codex exec --sandbox read-only --output-schema` |
| Grok | `grok … --output-format streaming-json --always-approve` | JSON verdict extraction |

Note: Grok uses `streaming-json`; Claude uses `stream-json`.

## Config (`.foreman/config.toml`)

```toml
mode = "soft"   # soft | hard

[worker]
vendor = "grok"       # claude | codex | grok — must differ from orchestrator in hard mode
model  = "grok-4.5"

[checks]
command = "npm test"  # or auto-detect

[limits]
max_rework_rounds = 3
round_timeout_min = 30

[gate]
forbidden_paths = ["tests/**", ".github/**", ".foreman/**", "*.lock", "package-lock.json"]
hash_paths = ["tests/**", ".github/**"]
```
