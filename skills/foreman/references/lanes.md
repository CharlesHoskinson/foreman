# Lanes and CLI adapters

## Soft-mode lanes

| Lane | Producer | Claude agent | Direct CLI (headless) |
|---|---|---|---|
| Routine implementer | Grok 4.6 | `grok-implementer` | `grok --prompt-file … -m grok-4.6 --allow "Write" --allow "Edit"` |
| Cross-vendor implementer | GPT-5.6 Sol (medium) | `codex-implementer` | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=medium --sandbox workspace-write` |
| **Audit (default)** | **GPT-5.6 Sol (high)** | **`codex-auditor`** | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --sandbox read-only` |
| High judgment | GPT-6 Astra | Architect or Council reviewer | `codex exec --model gpt-6-astra --sandbox read-only` after an exact-model canary |
| Advisory | Fable 5.1 | `foreman-advisor` | `model: claude-fable-5-1` agent after an exact-model canary |

### Default pairing

```text
Grok 4.6 implements  →  architect re-runs checks  →  Codex Sol audits  →  architect ships
```

If Codex implemented, **do not** call `codex-auditor`. Use architect review or a
non-OpenAI auditor and say so explicitly.

The current agent and adapter defaults still name `grok-4.5`. Set
`WC_GROK_MODEL=grok-4.6` in the lane process before
`adapter_implement_argv`. Without this override, report a route mismatch and
do not claim Grok 4.6 identity. This skill update does not migrate runtime
defaults or installed user configuration.

### Grok worker flags (soft)

- `--prompt-file` — never shell-interpolate large specs
- `-m grok-4.6` for the current soft route
- `--allow "Write" --allow "Edit"` — auto-approve file writes only
- Older observed releases accepted `--permission-mode acceptEdits` but ignored
  it. Current help text does not prove changed behavior. Keep the allow rules.
- `--cwd` / working directory explicit
- Wall clock ~600s when `timeout`/`gtimeout` exists
- grok `--prompt-file` is single-burst → write-first specs; exploratory work
  → `vendor-multiround.sh`

### Grok headless recipe (lane-run, durable lanes)

`lane-run.sh` (durable lanes / `--round` mode) drives grok non-interactively,
distinct from the architect-orchestrated `grok-implementer` agent dispatch
above:

```bash
grok -p "<spec>" --cwd <worktree> -m grok-4.6 --output-format json \
  --always-approve --session-id <uuid> --no-subagents --disable-web-search \
  --verbatim
```

- `--output-format json` — machine-readable (one JSON object at the end)
- `--always-approve` — unattended edits; no interactive tool-approval prompt
- `--session-id <uuid>` — a fresh, unique session per lane round
- `--no-subagents` — keep the provider identity and author lane closed
- `--disable-web-search` — disable built-in web search when the spec does not authorize web research
- `--verbatim` — send the five-part spec without CLI prompt rewriting
- `GROK_HOME` is set per lane by `lane-run.sh`'s `LANE_VENDOR=grok` plumbing
  (see the vendor-home isolation contract above) — never shared across lanes

Resuming a lane reuses the same session and vendor home, stdout still
redirected to the lane's own per-lane output file:

```bash
grok -r <session-id> --cwd <worktree> -m grok-4.6 \
  --output-format json --always-approve --no-subagents \
  --disable-web-search --verbatim
```

**Auth doctrine:** grok authentication is a **Setup-stage** responsibility,
never an in-lane one — `grok login --device-code` (browser-free; alias of
`--device-auth`) or an `XAI_API_KEY` environment variable, verified once in
Setup before any Use-stage lane routes to grok. A grok Use lane requested
while Setup reports grok NOT-READY is refused at the door citing Setup; the
lane never attempts its own auth.

**Secrets-refusal:** WHILE the whole-repo-upload behavior of Grok Build is
unrefuted, `lane-run.sh` scans the worktree SOURCE (excluding its own
`.harness/` scaffolding) for `.env` files (any depth, excluding
`.env.example`) and private-key material (`-----BEGIN * PRIVATE KEY-----`)
before ever spawning grok, and refuses the lane
(`alert{kind:"grok_secrets_refused"}`, non-zero exit, CMD never spawned) if
either is found.

The July 18, 2026 concurrency evidence applies to the tested model and CLI.
It does not prove Grok 4.6 identity or concurrency behavior. Run the current
exact-model canary and current CLI probe before the first Grok 4.6 dispatch.

Grok is a **verified default-eligible implementer** as of the 2026-07-18
live authenticated T5b run (real-vendor destructive-concurrency
verification), which came back GREEN at N=2 and N=3 — see
`docs/research/vendor-concurrency-results.md`. Its pueue cap is raised to
**3** accordingly (codex to **2**, green at N=2). Grok being eligible does
not change the standing-era default (Sonnet implements, Opus audits); it
means grok may be dispatched as an implementer up to its cap without the
prior "one lane, unverified" restriction.

### Codex implementer flags (soft)

- `codex exec` with prompt on stdin
- `--model gpt-5.6-sol`
- `-c model_reasoning_effort=medium` — faster; the spec determines the outcome,
  so high reasoning is wasted wall-clock and risks the 600s timeout. Escalate to
  `=high` only for correctness-critical/subtle tasks the architect flags; `=low`
  for purely mechanical changes when the spec says so.
- `--sandbox workspace-write` (never danger-full-access in soft mode)
- `--skip-git-repo-check` when needed
- `--output-last-message` for report capture

**Codex auth doctrine (observed version 0.144.x):** codex authentication is
also a **Setup-stage** responsibility, never an in-lane one. `codex login
--device-auth` is the **interactive** path — it falls back to a
**localhost:1455** browser callback flow whose local server dies the moment
the launching shell detaches, so it must be **operator-run** in a persistent
foreground shell (`! codex login`), never orchestrator-launched-and-detached.
For unattended/**headless** auth, use `--with-api-key` instead, piping the
key on stdin (never as a CLI argument, never logged):
`printenv OPENAI_API_KEY | codex login --with-api-key`. A codex Use lane
requested while Setup reports codex NOT-READY is refused at the door citing
Setup, same as grok.

### Codex auditor flags (soft) — GPT-5.6 Sol

- `codex exec` with audit prompt on stdin (cold criteria + diff)
- `--model gpt-5.6-sol` (pinned)
- `-c model_reasoning_effort=high` — auditors always run at the highest level;
  judgment is the point, and audit is where deep reasoning pays off
- **`--sandbox read-only`** (never workspace-write for audit)
- `--skip-git-repo-check` when needed
- `--output-last-message` for verdict JSON
- Wall clock ~600s when timeout exists
- After run: `git status --porcelain` must show no auditor mutations

### GPT-6 Astra judgment flags

- `codex exec --model gpt-6-astra` with the decision bundle on stdin
- Use a read-only sandbox for Council and architecture review
- Bind the model response to the exact prompt and candidate hashes
- Treat a completed model turn as advice, not as an audit or gate verdict
- Keep GPT-5.6 Sol for the cheaper independent audit and fallback roles

### Preflight

```bash
command -v grok && grok --version     # implementer
command -v codex && codex --version   # implementer race + default auditor
command -v claude && claude --version # Fable advisory canary
```

Missing CLI → `STATUS: unavailable` with install hint. **Never** silently substitute
the host model under that lane’s name.

## Hard-mode adapters

Scripts under `scripts/adapters/` normalize:

```text
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
model  = "grok-4.6"

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

## Known limits per CLI (soft mode, headless)

| Lane | Limit | Consequence for specs |
|---|---|---|
| Grok headless | Older observed releases silently ignored `--permission-mode acceptEdits`. Grok 1.0.13 lists the mode, but help output does not prove write behavior. | Keep the two explicit allow rules until a current destructive-write probe proves the new behavior. Treat zero-change evidence digests as a cancelled-writes signal. |
| Grok 1.0.13 | `--no-auto-update` is absent from current help. | Do not copy that obsolete flag into new direct-CLI recipes. Probe flags after each CLI update. |
| Grok headless | Shell tool prompt-cancelled (no headless approver); cannot delete/rename/chmod or run commands | Wrapper runs verification; deletions go to `ARCHITECT_ACTIONS`; never spec a deletion to Grok |
| Grok headless | May narrate success without writing; may attempt git commits | Evidence contract (head/status digests) is mandatory; git-write ban is standing |
| Codex exec | `workspace-write` sandbox: no writes outside workspace, no network installs | Keep file set inside the worktree; pre-install deps via bootstrap |
| Both | No conversation context | Five-part spec must be self-contained; include Standing constraints verbatim |
| GPT-6 Astra | Official guidance reports that the model can stop for clarification, react strongly to skill conflicts, delegate less than desired, and test too broadly. | State priority, authorized scope, delegation policy, and proportional verification in the decision prompt. |
| Frontier reviewers | Model cards report residual factual, authorization, scope, and monitorability failures. | Require terminal-first admission, hash-bound evidence, non-author review, independent checks, and preserved dissent. |
