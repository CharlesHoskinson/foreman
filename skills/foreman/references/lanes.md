# Lanes and CLI adapters

## Soft-mode lanes

| Lane | Producer | Claude agent | Direct CLI (headless) |
|---|---|---|---|
| Routine implementer | Grok 4.5 | `grok-implementer` | `grok --prompt-file … -m grok-4.5 --allow "Write" --allow "Edit"` |
| Cross-vendor implementer | GPT-5.6 Sol (medium) | `codex-implementer` | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=medium --sandbox workspace-write` |
| **Audit (default)** | **GPT-5.6 Sol (high)** | **`codex-auditor`** | `codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --sandbox read-only` |
| Judgment | Fable / Opus | `foreman-advisor` | Session model or `model: fable` agent |

### Default pairing

```text
Grok implements  →  architect re-runs checks  →  Codex Sol audits  →  architect ships
```

If Codex implemented, **do not** call `codex-auditor`. Use architect review or a
non-OpenAI auditor and say so explicitly.

### Grok worker flags (soft)

- `--prompt-file` — never shell-interpolate large specs
- `-m grok-4.5` (or pinned model from config)
- `--allow "Write" --allow "Edit"` — auto-approve file writes only; NOT
  `--permission-mode acceptEdits` (the grok CLI accepts that flag value but
  silently ignores it, and headless prompt-cancellation then kills every
  write); shell stays gated
- `--cwd` / working directory explicit
- Wall clock ~600s when `timeout`/`gtimeout` exists

### Grok headless recipe (lane-run, durable lanes)

`lane-run.sh` (durable lanes / `--round` mode) drives grok non-interactively,
distinct from the architect-orchestrated `grok-implementer` agent dispatch
above:

```bash
grok -p "<spec>" --cwd <worktree> --output-format json --always-approve \
  --session-id <uuid> --no-auto-update
```

- `--output-format json` — machine-readable (one JSON object at the end)
- `--always-approve` — unattended edits; no interactive tool-approval prompt
- `--session-id <uuid>` — a fresh, unique session per lane round
- `--no-auto-update` — skip grok's own background update check (required in
  scripts/CI/any automated environment)
- `GROK_HOME` is set per lane by `lane-run.sh`'s `LANE_VENDOR=grok` plumbing
  (see the vendor-home isolation contract above) — never shared across lanes

Resuming a lane reuses the same session and vendor home, stdout still
redirected to the lane's own per-lane output file:

```bash
grok -r <session-id> --cwd <worktree> --output-format json --always-approve \
  --no-auto-update
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

### Preflight

```bash
command -v grok && grok --version     # implementer
command -v codex && codex --version   # implementer race + default auditor
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

## Known limits per CLI (soft mode, headless)

| Lane | Limit | Consequence for specs |
|---|---|---|
| Grok headless | `--permission-mode acceptEdits` is silently ignored by the CLI; without `--allow "Write" --allow "Edit"` every write is prompt-cancelled while the model narrates success | Always pass the two allow rules; treat zero-change evidence digests as a cancelled-writes signal |
| Grok headless | Shell tool prompt-cancelled (no headless approver); cannot delete/rename/chmod or run commands | Wrapper runs verification; deletions go to `ARCHITECT_ACTIONS`; never spec a deletion to Grok |
| Grok headless | May narrate success without writing; may attempt git commits | Evidence contract (head/status digests) is mandatory; git-write ban is standing |
| Codex exec | `workspace-write` sandbox: no writes outside workspace, no network installs | Keep file set inside the worktree; pre-install deps via bootstrap |
| Both | No conversation context | Five-part spec must be self-contained; include Standing constraints verbatim |
