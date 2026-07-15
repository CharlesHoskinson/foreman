# Lanes and CLI adapters

## Soft-mode lanes

| Lane | Producer | Claude agent | Direct CLI (headless) |
|---|---|---|---|
| Routine implementer | Grok 4.5 | `grok-implementer` | `grok --prompt-file … -m grok-4.5 --permission-mode acceptEdits` |
| Cross-vendor implementer | GPT-5.6 Sol (high) | `codex-implementer` | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --sandbox workspace-write` |
| **Audit (default)** | **GPT-5.6 Sol (high)** | **`codex-auditor`** | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --sandbox read-only` |
| Judgment | Fable / Opus | `foreman-advisor` | Session model or `model: fable` agent |

### Default pairing

```
Grok implements  →  architect re-runs checks  →  Codex Sol audits  →  architect ships
```

If Codex implemented, **do not** call `codex-auditor`. Use architect review or a
non-OpenAI auditor and say so explicitly.

### Grok worker flags (soft)

- `--prompt-file` — never shell-interpolate large specs
- `-m grok-4.5` (or pinned model from config)
- `--permission-mode acceptEdits` — not blanket always-approve for host soft mode
- `--cwd` / working directory explicit
- Wall clock ~600s when `timeout`/`gtimeout` exists

### Codex implementer flags (soft)

- `codex exec` with prompt on stdin
- `--model gpt-5.6-sol`
- `-c model_reasoning_effort=high`
- `--sandbox workspace-write` (never danger-full-access in soft mode)
- `--skip-git-repo-check` when needed
- `--output-last-message` for report capture

### Codex auditor flags (soft) — GPT-5.6 Sol

- `codex exec` with audit prompt on stdin (cold criteria + diff)
- `--model gpt-5.6-sol` (pinned)
- `-c model_reasoning_effort=high`
- **`--sandbox read-only`** (never workspace-write for audit)
- `--skip-git-repo-check` when needed
- `--output-last-message` for verdict JSON
- Wall clock ~600s when timeout exists
- After run: `git status --porcelain` must show no auditor mutations

### Preflight

```bash
command -v grok && grok --version     # implementer
command -v codex && codex --version   # implementer race + default auditor
```

Missing CLI → `STATUS: unavailable` with install hint. **Never** silently substitute
the host model under that lane’s name.

## Hard-mode adapters

Scripts under `scripts/adapters/` normalize:

```
run_worker  → event log + result envelope
run_audit   → verdict JSON (APPROVED | WARNING | BLOCKED)
```

| CLI | Worker (in container only) | Audit (host, read-only) |
|---|---|---|
| Claude | `claude -p … --output-format stream-json --dangerously-skip-permissions` | `claude -p … --json-schema` + disallowed write tools |
| Codex | `codex exec --json …` | **`codex exec --model gpt-5.6-sol --sandbox read-only`** (default when worker is Grok) |
| Grok | `grok … --output-format streaming-json --always-approve` | JSON verdict extraction |

Default hard audit: **Codex GPT-5.6 Sol** when worker vendor is `grok`.

Note: Grok uses `streaming-json`; Claude uses `stream-json`.

## Config (`.foreman/config.toml`)

```toml
mode = "soft"   # soft | hard

[worker]
vendor = "grok"       # claude | codex | grok — must differ from orchestrator in hard mode
model  = "grok-4.5"

[audit]
vendor = "codex"      # default auditor family
model  = "gpt-5.6-sol"
# must differ from worker.vendor; empty = auto (prefer codex when worker is grok)

[checks]
command = "npm test"  # or auto-detect

[limits]
max_rework_rounds = 3
round_timeout_min = 30

[gate]
forbidden_paths = ["tests/**", ".github/**", ".foreman/**", "*.lock", "package-lock.json"]
hash_paths = ["tests/**", ".github/**"]
```
