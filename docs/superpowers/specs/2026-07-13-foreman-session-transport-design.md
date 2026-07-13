# Foreman Session Transport — opencode-Orchestrated Subscription Sessions

**Date:** 2026-07-13
**Status:** Approved for planning
**Extends:** `2026-07-10-foreman-orchestrator-worker-skill-design.md` (v1 container design — unchanged and still shipped)

## 1. Problem

Foreman v1's worker/audit invocations inject vendor **API keys** into a network-off
container. The user's API keys are billed per token; their vendor CLI *logins* (Claude
Code, Codex, Grok) are billed by monthly subscription. The v1 dogfood's cross-vendor
round has been blocked on exactly this: no one wants to fund token-metered keys when
subscription sessions already exist on the machine.

Separately, v1's containerized rounds are invisible while they run. The user wants to
**watch the orchestration live**: an opencode terminal driving the loop, with the Claude
Code, Codex, and Grok sessions each visible in their own terminal as they work.

## 2. Goal

Add a second transport to foreman in which:

- **opencode** is the orchestrator terminal (running the foreman skill's stage flow,
  exactly as Claude Code does in v1 — the skill is orchestrator-agnostic).
- Worker and auditor run as **subscription-authenticated sessions** of the vendor CLIs
  on the WSL2 host. **Zero API keys anywhere in this mode.**
- Every session is **visible live** in its own terminal pane while the harness drives it.
- The deterministic harness (worktree, evidence, hash drift, independent checks, gate,
  bounded rework, PR) stays byte-for-byte authoritative, and the v1 container transport
  keeps working unchanged.

### Key enabling fact

`claude -p`, `codex exec`, and `codex mcp-server` all reuse the CLI's **login
credentials** (Claude Pro/Max OAuth, ChatGPT sign-in) — headless invocation is billed to
the subscription, not to an API key. Headless ≠ API-key-billed. This removes any need to
puppet the interactive TUIs. Grok's CLI keyless-login support is a verification item
(§10); until verified, grok remains container-transport-only.

## 3. Decisions (settled during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | **Both transports as a config mode**: `transport.mode = "container" \| "mcp"`. Container path untouched. |
| D2 | Decorrelation | **Model-family rule** in mcp mode: config declares what model family opencode is running; ≠ checks compare families, not harness names. |
| D3 | Session control | **Harness-driven**: `worker-run.sh` / `audit-run.sh` spawn and control every session deterministically. opencode's model never freelances an MCP call. |
| D4 | Visibility | **Live cockpit**: a launcher opens one terminal pane per vendor rendering that session's real event stream human-readably as it happens. Panes are viewers of harness-spawned sessions, not TUI remote-controls. |
| D5 | Runtime | **All-in WSL2**: opencode + claude + codex (+ grok if keyless) installed natively in WSL2 Ubuntu, each logged in once. Windows-side installs untouched. |
| D6 | Acceptance | **No new test scaffolding.** Acceptance is a live visible demo (§9). Existing 60-test bats suite + shellcheck must stay green (container path regression guard). |

## 4. Configuration

```toml
[transport]
mode = "mcp"                  # "container" (default) preserves v1 behavior exactly

[orchestrator]
model_family = "anthropic"    # REQUIRED in mcp mode: the family opencode is running

[worker]
vendor = "codex"              # → family "openai"

[audit]
vendor = "claude"             # → family "anthropic"
```

Vendor → family map (in `lib/common.sh`): `claude → anthropic`, `codex → openai`,
`grok → xai`.

The mode value is `"mcp"` after its dominant control surface (Codex is driven over real
MCP; it is also the name the user knows the feature by), even though the Claude adapter
uses Claude Code's native session API rather than an MCP wrapper — see §5.

**Decorrelation rules (mcp mode, enforced with exit 2):**
- `family(worker.vendor) ≠ orchestrator.model_family`
- `family(audit.vendor) ≠ family(worker.vendor)`

Container mode keeps v1's harness-name rules unchanged. Example: opencode running Claude
+ Codex worker + Claude Code auditor → legal. opencode running Claude + Claude Code
worker → refused.

## 5. Session mechanics (one honest asymmetry)

All sessions run in the task worktree on the WSL2 host, spawned as child processes of
the harness with wall-clock timeout, streamed event capture, and fail-closed error
handling — same artifacts and exit-code contract ({0,1,2,3}) as v1.

### Codex — real MCP

A new stdlib-only Python client, `skills/foreman/scripts/mcp/mcp-session.py`, speaks
JSON-RPC 2.0 over stdio to `codex mcp-server`:

- `run`: spawn the server, `initialize`, call the `codex()` tool with the prompt-file
  contents, `cwd` = worktree, sandbox `workspace-write`; stream every notification to
  `worker-events-round-N.jsonl`; persist the returned `threadId` to `$(run_dir)/thread-id`.
- `resume`: rework rounds call `codex-reply()` with the saved `threadId` — the worker
  keeps its session memory across rework rounds, which container mode cannot do.
- Timeout, server crash, or malformed JSON → kill the server, mark the round
  `status:"fail"`, exit 1. No pip dependencies; Python 3.11+ stdlib only.

### Claude Code — native session API

Claude Code exposes tools via `claude mcp serve` but no "run a task" MCP tool; community
wrappers just shell out to `claude -p`. So the adapter drives it directly:

- Round 1: `claude -p "$(cat prompt)" --output-format stream-json --verbose` in the
  worktree, with permissions scoped by flags/settings to the worktree (no
  `--dangerously-skip-permissions` outside a container; exact flag set is a
  verification item, §10). Session id is captured from the event stream.
- Rework: `claude -p --resume <session-id>` — same session-continuity benefit as Codex.
- Identical control surface to MCP; one less third-party dependency. If pure MCP
  symmetry is ever wanted, a small bundled wrapper server can be added without
  architectural change.

### Grok — pending verification

If the grok CLI supports keyless login-based headless runs (§10), it gets the same
adapter treatment (it already streams `streaming-json`). Otherwise `worker-run.sh` /
`audit-run.sh` exit 3 for `vendor = "grok"` in mcp mode with a message naming the
container transport as the alternative.

### Auditor

`audit-run.sh` in mcp mode runs the audit vendor read-only on the cold diff: Codex via
MCP with sandbox `read-only`; Claude with mutation tools disallowed (v1's
`adapter_run_audit` already does this — it inherits subscription auth for free). Same
schema-forced `audit-verdict.json`, same fail-closed handling.

## 6. Live cockpit

New launcher `foreman-up.sh`:

- Opens a **Windows Terminal** layout of WSL2 panes (tmux fallback via
  `FOREMAN_COCKPIT=tmux`): one pane running **opencode** (the user drives `/foreman`
  there), plus one pane per configured vendor.
- Each vendor pane runs `session-watch.sh VENDOR`, which follows the run dir and
  pretty-prints that vendor's live event stream — tool calls, file edits, commands,
  audit verdicts — as they happen. Panes idle with a "waiting for round…" banner until
  the harness starts a session for that vendor, then light up in real time.
- The panes are **read-only viewers** of the actual session event streams the harness is
  already capturing. Determinism, timeouts, and evidence collection are unaffected by
  whether anyone is watching.

Net effect: it looks and reads like four manually opened sessions working together;
control is entirely opencode → harness scripts → child sessions.

## 7. Component changes (all in this repo)

| Component | Change |
|---|---|
| `lib/common.sh` | `transport_mode()`, `vendor_family()`, mcp-mode decorrelation check helper |
| `scripts/mcp/mcp-session.py` | **new** — deterministic MCP stdio client (run/resume), stdlib-only |
| `adapters/{claude,codex}.sh` | **add** `adapter_session_run PROMPT WT RD ROUND` and `adapter_session_resume ...`; existing v1 functions untouched |
| `adapters/grok.sh` | session functions only if §10 verification passes; else exit-3 stub |
| `worker-run.sh` | branch on transport: container path unchanged; mcp path = no env-file/key logic, same round artifacts, same commit+clean enforcement, timeout via `timeout` |
| `audit-run.sh` | mcp path: session-auth read-only audit; artifacts/schema unchanged |
| `foreman-up.sh` | **new** cockpit launcher (Windows Terminal panes; tmux fallback) |
| `scripts/session-watch.sh` | **new** event-stream pretty-printer per vendor |
| `install.sh` | detect opencode; register the skill with it (path per §10); mcp-mode checks: WSL2-native claude/codex present + logged in; Docker no longer required when `mode = "mcp"` |
| `SKILL.md` + `references/` | transport-aware protocol notes, opencode invocation, cockpit usage; `security-model.md` gains the §8 posture section |
| `config/foreman.toml.example` | new `[transport]`/`[orchestrator]` keys, commented |

Untouched: `task-new.sh`, `checks-run.sh` (pristine checkout; network-off container when
Docker is present, host fallback as today), `evidence-collect.sh`, `gate-eval.sh`,
`pr-open.sh`, `sandbox/`. The gate does not care how the commit was produced.

## 8. Security posture (stated honestly)

MCP mode trades container isolation for subscription economics and visibility:

- The worker session runs **on the host** with vendor-native guardrails only (Codex
  `workspace-write` sandbox; Claude Code permission scoping). No `--network none`, no
  cap-drop, no read-only root. A hostile worker could touch the network or the wider
  filesystem to the extent the vendor's own sandbox permits.
- **Compensating controls that remain fully authoritative:** forbidden-path diff check,
  hash-drift snapshot over protected files, independent checks from a pristine checkout,
  cross-model audit, deterministic gate, bounded rework, CI as final merge authority.
- Posture statement for `security-model.md`: *mcp mode assumes a non-malicious-but-
  fallible worker and defends the merge, not the host. For untrusted or
  injection-risky inputs, use container mode.*

## 9. Acceptance (no new test scaffolding)

Acceptance is the live demo, on a real repo:

1. `foreman-up.sh` opens the cockpit: opencode + claude + codex (+ grok) panes.
2. In the opencode pane, invoke the foreman skill with a real small task.
3. Watch: `task-new` worktree appears → Codex pane lights up and implements → checks
   re-run from a pristine checkout → Claude pane lights up and audits the cold diff →
   gate rules → PR opens (or rework round visibly continues the same Codex thread).
4. Confirm zero API-key environment variables were set anywhere in the run
   (`env | grep -E 'ANTHROPIC|OPENAI|XAI'` clean; no `$(run_dir)/env` file created).

Regression guard: the existing 60-test bats suite and `shellcheck -x` stay green —
the container transport must be byte-for-byte unaffected.

## 10. Verification items (resolve at implementation start, not assumed)

1. **Grok keyless auth:** does the grok CLI support login-session (SuperGrok
   subscription) headless runs without `XAI_API_KEY`? Gate grok's mcp-mode support on
   the answer.
2. **opencode skill registration:** the current mechanism/path by which opencode
   discovers Agent Skills (native skills dir, command file, or plugin) — wire
   `install.sh` accordingly.
3. **Claude Code non-interactive permission flags:** current flag set to scope a
   host-side `-p` session to the worktree without `--dangerously-skip-permissions`
   (allowedTools / permission-mode / settings file), and the exact `--resume` semantics
   in `-p` mode.
4. **`codex mcp-server` tool schema:** current parameter names for `codex()` /
   `codex-reply()` (prompt, cwd, sandbox, threadId) on the installed version.
5. **opencode model-family introspection:** whether the harness can read opencode's
   active model to cross-check `orchestrator.model_family` (nice-to-have; config
   declaration is the source of truth either way).

## 11. Out of scope

- Windows-native or macOS harness execution (unchanged from v1).
- Puppeting interactive vendor TUIs.
- gVisor/microVM isolation upgrades.
- Multi-worker parallel rounds; opencode driving multiple tasks concurrently.
- Any change to gate semantics, evidence formats, or the v1 container flow.
