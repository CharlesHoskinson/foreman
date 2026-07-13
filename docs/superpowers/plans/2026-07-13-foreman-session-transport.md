# Foreman Session Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `mcp` session transport per the approved spec (`docs/superpowers/specs/2026-07-13-foreman-session-transport-design.md`): opencode orchestrates, worker/auditor run as subscription-authenticated Claude Code / Codex / Grok sessions on the WSL2 host (zero API keys), visible live in a terminal cockpit, with the deterministic gate machinery untouched.

**Architecture:** A `transport.mode = "container" | "mcp"` config switch. In mcp mode, `worker-run.sh`/`audit-run.sh` spawn vendor sessions as harness-controlled child processes — Codex over real MCP (`codex mcp-server` via a new stdlib-only Python client with `threadId` rework continuity), Claude Code via its native `-p`/`--resume` session API, Grok via its headless mode. Decorrelation is model-family-based. A cockpit launcher opens live read-only viewer panes per vendor.

**Tech Stack:** bash (`set -euo pipefail`), Python 3.11+ stdlib only (MCP client), jq, Windows Terminal `wt.exe` / tmux, existing bats suite as regression guard only.

## Global Constraints

- **All commands run inside WSL2 Ubuntu.** Repo path from WSL: `/mnt/c/Users/charl/foreman`.
- Exit-code contract everywhere: `0` pass, `1` failure, `2` config error, `3` missing CLI. No other codes (cockpit viewer scripts are cosmetic and exempt, but still shellcheck-clean).
- **Container transport must be byte-for-byte unaffected:** after every task, `bats tests/` (60 tests) and `shellcheck -x` on all touched scripts stay green. Run from repo root in WSL2.
- **No new committed test files** (spec D6). Verification = inline commands + the Task 11 live demo. Transient fixtures go under `/tmp` and are deleted.
- **Zero API keys in the mcp path**: no env files, no `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`XAI_API_KEY` reads or writes.
- Every new executable file needs `git update-index --chmod=+x <file>` before commit (DrvFS lies about the exec bit; pristine checkouts break without this — learned in the v1 dogfood).
- Prompts are passed as files, never string-interpolated into shell.
- Every script starts `#!/usr/bin/env bash` + `set -euo pipefail` (Python: `#!/usr/bin/env python3`) and passes `shellcheck -x`.
- No AI attribution or Co-Authored-By trailers in any commit message.
- Adapter session contract (fixed here, used by Tasks 3–6): each adapter defines
  `adapter_session_run PROMPT_FILE WORKTREE RUN_DIR ROUND`,
  `adapter_session_can_resume RUN_DIR`,
  `adapter_session_resume PROMPT_FILE WORKTREE RUN_DIR ROUND`.
  Run/resume write the event stream to `RUN_DIR/worker-events-round-ROUND.jsonl`, honor
  `$FOREMAN_SESSION_TIMEOUT_SEC` (default 1800), persist vendor resume state in RUN_DIR,
  and return nonzero on failure. Callers redirect stderr.

## File Structure

```
foreman/
├── skills/foreman/scripts/
│   ├── lib/common.sh                  # Task 1: transport_mode, vendor_family, enforce_mcp_decorrelation
│   ├── mcp/mcp-session.py             # Task 2: deterministic MCP stdio client (new)
│   ├── adapters/codex.sh              # Task 3: session functions (real MCP)
│   ├── adapters/claude.sh             # Task 4: session functions (native -p/--resume)
│   ├── adapters/grok.sh               # Task 5: session functions (headless)
│   ├── worker-run.sh                  # Task 6: transport branch
│   ├── audit-run.sh                   # Task 7: mcp decorrelation + audit-meta.json
│   ├── session-watch.sh               # Task 8: live viewer pane (new)
│   └── foreman-up.sh                  # Task 8: cockpit launcher (new)
├── config/foreman.toml.example        # Task 1: [transport], [orchestrator]
├── install.sh                         # Task 9: docker optional, opencode detection
├── skills/foreman/SKILL.md            # Task 10
├── skills/foreman/references/security-model.md   # Task 10
├── skills/foreman/references/cli-adapters.md     # Task 10
├── README.md                          # Task 10
└── docs/demo-log.md                   # Task 11 (acceptance record, new)
```

---

### Task 1: Transport + decorrelation helpers in `common.sh`; config example keys

**Files:**
- Modify: `skills/foreman/scripts/lib/common.sh` (append after `repo_lock_path`, line 90)
- Modify: `config/foreman.toml.example` (append at end)

**Interfaces:**
- Consumes: existing `toml_get`, `die`, exit-code constants.
- Produces (used by Tasks 6, 7):
  - `transport_mode CONFIG_FILE` → echoes `container` (default) or `mcp`; exit 2 on any other value.
  - `vendor_family VENDOR` → `claude→anthropic`, `codex→openai`, `grok→xai`; exit 2 on unknown.
  - `enforce_mcp_decorrelation CONFIG ROLE VENDOR [WORKER_VENDOR]` — `ROLE=worker`: family(VENDOR) ≠ `orchestrator.model_family` (which must be set); `ROLE=audit`: family(VENDOR) ≠ family(WORKER_VENDOR). Exit 2 on violation; returns 0 otherwise.

- [ ] **Step 1: Append helpers to `skills/foreman/scripts/lib/common.sh`**

```bash

# --- session transport (spec 2026-07-13) -----------------------------------

# transport_mode CONFIG_FILE — "container" (default) or "mcp"; exit 2 otherwise.
transport_mode() {
  local mode
  mode="$(toml_get "$1" transport.mode container)"
  case "$mode" in
    container|mcp) echo "$mode" ;;
    *) die "$EXIT_CONFIG" "transport.mode must be \"container\" or \"mcp\", got: $mode" ;;
  esac
}

# vendor_family VENDOR — the model family behind a vendor CLI (spec §4).
vendor_family() {
  case "$1" in
    claude) echo anthropic ;;
    codex)  echo openai ;;
    grok)   echo xai ;;
    *) die "$EXIT_CONFIG" "unknown vendor: $1" ;;
  esac
}

# enforce_mcp_decorrelation CONFIG ROLE VENDOR [WORKER_VENDOR]
# mcp-mode ≠ rules compare model families, not harness names (spec §4):
#   worker: family(VENDOR) != orchestrator.model_family (key is required)
#   audit:  family(VENDOR) != family(WORKER_VENDOR)
enforce_mcp_decorrelation() {
  local config="$1" role="$2" vendor="$3" worker="${4:-}"
  local fam ofam wfam
  fam="$(vendor_family "$vendor")"
  case "$role" in
    worker)
      ofam="$(toml_get "$config" orchestrator.model_family '')"
      [[ -n "$ofam" ]] || die "$EXIT_CONFIG" \
        "orchestrator.model_family is required when transport.mode = \"mcp\""
      [[ "$fam" != "$ofam" ]] || die "$EXIT_CONFIG" \
        "worker family ($fam) must differ from orchestrator model family ($ofam)"
      ;;
    audit)
      [[ -n "$worker" ]] || die "$EXIT_CONFIG" "enforce_mcp_decorrelation audit: missing worker vendor"
      wfam="$(vendor_family "$worker")"
      [[ "$fam" != "$wfam" ]] || die "$EXIT_CONFIG" \
        "audit family ($fam) must differ from worker family ($wfam)"
      ;;
    *) die "$EXIT_CONFIG" "enforce_mcp_decorrelation: unknown role $role" ;;
  esac
}
```

- [ ] **Step 2: Append to `config/foreman.toml.example`**

```toml

[transport]
mode = "container"   # "container": v1 hardened Docker worker (API keys in env file).
                     # "mcp": worker/auditor run as subscription-authenticated CLI
                     # sessions on the WSL2 host — zero API keys; billed to your
                     # monthly CLI logins. Reduced isolation: see
                     # references/security-model.md before using on untrusted input.

[orchestrator]
model_family = ""    # REQUIRED when transport.mode = "mcp".
                     # The model family your orchestrator terminal is running:
                     # anthropic | openai | xai. With opencode, this is whatever
                     # model you selected in opencode — declare it honestly; the
                     # worker must be a DIFFERENT family (e.g. opencode-on-Claude
                     # cannot use a Claude Code worker).
```

- [ ] **Step 3: Verify**

Run (WSL2, repo root):
```bash
bash -c 'source skills/foreman/scripts/lib/common.sh
  t=$(mktemp); printf "[transport]\nmode = \"mcp\"\n[orchestrator]\nmodel_family = \"anthropic\"\n" > "$t"
  [ "$(transport_mode "$t")" = mcp ] || exit 1
  [ "$(transport_mode /nonexistent)" = container ] || exit 1
  [ "$(vendor_family codex)" = openai ] || exit 1
  enforce_mcp_decorrelation "$t" worker codex || exit 1
  ( enforce_mcp_decorrelation "$t" worker claude ); [ $? -eq 2 ] || exit 1
  ( enforce_mcp_decorrelation "$t" audit claude codex ) || exit 1
  ( enforce_mcp_decorrelation "$t" audit codex codex ); [ $? -eq 2 ] || exit 1
  rm -f "$t"; echo HELPERS-OK'
shellcheck -x skills/foreman/scripts/lib/common.sh
bats tests/
```
Expected: `HELPERS-OK`, shellcheck clean, 60/60 pass.

- [ ] **Step 4: Commit**

```bash
git add skills/foreman/scripts/lib/common.sh config/foreman.toml.example
git commit -m "feat: transport mode + model-family decorrelation helpers"
```

---

### Task 2: `mcp/mcp-session.py` — deterministic MCP stdio client

**Files:**
- Create: `skills/foreman/scripts/mcp/mcp-session.py`

**Interfaces:**
- Consumes: nothing from other tasks. Python 3.11+ stdlib only (POSIX; WSL2 is the reference env).
- Produces (used by Task 3):
  - CLI: `mcp-session.py --server-cmd CMD --tool NAME --args-json JSON --events-out FILE --result-out FILE [--timeout-sec N]`
  - Spawns CMD, performs MCP initialize handshake (newline-delimited JSON-RPC 2.0 over stdio), calls one tool, appends every server notification/request line to `--events-out` (JSONL), writes the `tools/call` result object to `--result-out`, kills the server process group on exit.
  - Server→client requests (approval elicitation etc.) are refused deterministically with a JSON-RPC error — foreman sessions are non-interactive.
  - Exit: 0 tool ok; 1 timeout/server crash/tool `isError`; 2 bad usage.

- [ ] **Step 1: Write `skills/foreman/scripts/mcp/mcp-session.py`**

```python
#!/usr/bin/env python3
"""Deterministic MCP stdio client for the foreman session transport.

Spawns an MCP server (e.g. `codex mcp-server`), performs the initialize
handshake, calls exactly one tool, streams every server notification to an
events file (JSONL), writes the tool result to a result file, then kills the
server. Non-interactive by design: any server->client request (approval
elicitation etc.) is refused with a JSON-RPC error.

Exit codes (foreman contract): 0 ok, 1 session/tool failure, 2 usage error.
Python 3.11+ stdlib only.
"""
import argparse
import json
import os
import select
import shlex
import signal
import subprocess
import sys
import time

PROTOCOL_VERSION = "2025-06-18"


def eprint(*args):
    print("[mcp-session]", *args, file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server-cmd", required=True)
    ap.add_argument("--tool", required=True)
    ap.add_argument("--args-json", required=True)
    ap.add_argument("--events-out", required=True)
    ap.add_argument("--result-out", required=True)
    ap.add_argument("--timeout-sec", type=int, default=1800)
    opts = ap.parse_args()

    try:
        tool_args = json.loads(opts.args_json)
    except json.JSONDecodeError as exc:
        eprint(f"invalid --args-json: {exc}")
        return 2

    try:
        proc = subprocess.Popen(
            shlex.split(opts.server_cmd),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr,
            text=True, bufsize=1, start_new_session=True,
        )
    except OSError as exc:
        eprint(f"cannot spawn server: {exc}")
        return 1

    def send(msg):
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    deadline = time.monotonic() + opts.timeout_sec
    result, rc = {}, 1
    events = open(opts.events_out, "a", buffering=1)
    try:
        send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
            "clientInfo": {"name": "foreman-mcp-session", "version": "1.0"}}})
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                eprint(f"timeout after {opts.timeout_sec}s")
                break
            ready, _, _ = select.select([proc.stdout], [], [], min(remaining, 5))
            if not ready:
                if proc.poll() is not None:
                    eprint(f"server exited early (code {proc.returncode})")
                    break
                continue
            line = proc.stdout.readline()
            if not line:
                eprint("server closed stdout")
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                events.write(json.dumps({"raw": line}) + "\n")
                continue
            if "method" in msg and "id" in msg:
                # Server->client request: refuse — foreman is non-interactive.
                events.write(line + "\n")
                send({"jsonrpc": "2.0", "id": msg["id"], "error": {
                    "code": -32601,
                    "message": "foreman session is non-interactive; request denied"}})
            elif "method" in msg:
                events.write(line + "\n")  # notification: the live stream
            elif msg.get("id") == 1:
                if "error" in msg:
                    eprint(f"initialize failed: {msg['error']}")
                    break
                send({"jsonrpc": "2.0", "method": "notifications/initialized"})
                send({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                      "params": {"name": opts.tool, "arguments": tool_args}})
            elif msg.get("id") == 2:
                if "error" in msg:
                    eprint(f"tool call failed: {msg['error']}")
                else:
                    result = msg.get("result", {})
                    rc = 1 if result.get("isError") else 0
                break
    except BrokenPipeError:
        eprint("server pipe broke")
    finally:
        events.close()
        with open(opts.result_out, "w") as fh:
            json.dump(result, fh)
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    return rc


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verify against a transient fake MCP server (not committed)**

```bash
cat > /tmp/fake-mcp.py <<'EOF'
#!/usr/bin/env python3
import json, sys
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc":"2.0","id":msg["id"],"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"fake","version":"0"}}}), flush=True)
    elif msg.get("method") == "tools/call":
        print(json.dumps({"jsonrpc":"2.0","method":"codex/event","params":{"msg":"working"}}), flush=True)
        print(json.dumps({"jsonrpc":"2.0","method":"codex/event","params":{"msg":"done"}}), flush=True)
        print(json.dumps({"jsonrpc":"2.0","id":msg["id"],"result":{"threadId":"t-123","content":[{"type":"text","text":"ok"}]}}), flush=True)
EOF
python3 skills/foreman/scripts/mcp/mcp-session.py \
  --server-cmd "python3 /tmp/fake-mcp.py" --tool codex \
  --args-json '{"prompt":"hi","cwd":"/tmp"}' \
  --events-out /tmp/ev.jsonl --result-out /tmp/res.json --timeout-sec 20
echo "exit=$?"
grep -c codex/event /tmp/ev.jsonl          # expected: 2
jq -er .threadId /tmp/res.json             # expected: t-123
timeout 15 python3 skills/foreman/scripts/mcp/mcp-session.py \
  --server-cmd "sleep 60" --tool codex --args-json '{}' \
  --events-out /tmp/ev2.jsonl --result-out /tmp/res2.json --timeout-sec 3
echo "timeout-exit=$?"                     # expected: 1
rm -f /tmp/fake-mcp.py /tmp/ev*.jsonl /tmp/res*.json
```
Expected: `exit=0`, `2`, `t-123`, `timeout-exit=1`.

- [ ] **Step 3: Set exec bit and commit**

```bash
git add skills/foreman/scripts/mcp/mcp-session.py
git update-index --chmod=+x skills/foreman/scripts/mcp/mcp-session.py
git commit -m "feat: deterministic MCP stdio client for session transport"
```

---

### Task 3: Codex adapter session functions (real MCP)

**Files:**
- Modify: `skills/foreman/scripts/adapters/codex.sh` (append at end)

**Interfaces:**
- Consumes: `mcp-session.py` (Task 2) at `../mcp/mcp-session.py` relative to the adapter; `$FOREMAN_SESSION_TIMEOUT_SEC`.
- Produces: the adapter session contract (Global Constraints). Resume state: `RUN_DIR/thread-id`. Also writes `RUN_DIR/session-result-round-ROUND.json`.

- [ ] **Step 1: Probe the installed server's tool schema (adjust names if needed)**

```bash
printf '%s\n%s\n%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | timeout 30 codex mcp-server 2>/dev/null \
 | jq -c 'select(.id==2) | .result.tools[] | {name, props: (.inputSchema.properties | keys)}'
```
Expected: tools named `codex` and `codex-reply` with properties including `prompt`, a working-directory key (`cwd`), a sandbox key, and (for codex-reply) a thread/session id key. **If the listed property names differ from those used in Step 2, use the listed names** — the schema is the source of truth.

- [ ] **Step 2: Append to `skills/foreman/scripts/adapters/codex.sh`**

```bash

# --- session transport (spec 2026-07-13 §5): real MCP against `codex mcp-server` ---
# Subscription (ChatGPT-login) auth; no API key. threadId gives the worker
# session memory across rework rounds — container mode cannot do that.

_codex_mcp_client() { echo "$(dirname "${BASH_SOURCE[0]}")/../mcp/mcp-session.py"; }

adapter_session_run() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0 args
  args="$(jq -n --rawfile p "$prompt" --arg cwd "$wt" \
    '{prompt: $p, cwd: $cwd, sandbox: "workspace-write", "approval-policy": "never"}')"
  python3 "$(_codex_mcp_client)" --server-cmd "codex mcp-server" --tool codex \
    --args-json "$args" \
    --events-out "$rd/worker-events-round-$round.jsonl" \
    --result-out "$rd/session-result-round-$round.json" \
    --timeout-sec "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" || rc=$?
  jq -r '[.. | .threadId? // empty] | first // empty' \
    "$rd/session-result-round-$round.json" 2>/dev/null > "$rd/thread-id" || true
  [[ -s "$rd/thread-id" ]] || rm -f "$rd/thread-id"
  return "$rc"
}

adapter_session_can_resume() { [[ -s "$1/thread-id" ]]; }  # RUN_DIR

adapter_session_resume() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0 args
  args="$(jq -n --rawfile p "$prompt" --rawfile tid "$rd/thread-id" \
    '{threadId: ($tid | rtrimstr("\n")), prompt: $p}')"
  python3 "$(_codex_mcp_client)" --server-cmd "codex mcp-server" --tool codex-reply \
    --args-json "$args" \
    --events-out "$rd/worker-events-round-$round.jsonl" \
    --result-out "$rd/session-result-round-$round.json" \
    --timeout-sec "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" || rc=$?
  return "$rc"
}
```
(Substitute the property names confirmed in Step 1 if they differ.)

- [ ] **Step 3: Verify**

```bash
bash -n skills/foreman/scripts/adapters/codex.sh
shellcheck -x skills/foreman/scripts/adapters/codex.sh
bash -c 'source skills/foreman/scripts/adapters/codex.sh
  declare -f adapter_session_run adapter_session_can_resume adapter_session_resume >/dev/null && echo CONTRACT-OK'
bats tests/
```
Expected: shellcheck clean, `CONTRACT-OK`, 60/60 pass. (Live MCP behavior against the real
`codex mcp-server` is exercised end-to-end in Task 11; the client itself was verified
against a fake server in Task 2.)

- [ ] **Step 4: Commit**

```bash
git add skills/foreman/scripts/adapters/codex.sh
git commit -m "feat: codex session transport via codex mcp-server (threadId rework continuity)"
```

---

### Task 4: Claude Code adapter session functions (native session API)

**Files:**
- Modify: `skills/foreman/scripts/adapters/claude.sh` (append at end)

**Interfaces:**
- Consumes: `claude` CLI ≥2.x flags verified on 2.1.207: `-p`, `--output-format stream-json`, `--verbose`, `--permission-mode`, `--allowedTools`, `--resume`; `$FOREMAN_SESSION_TIMEOUT_SEC`.
- Produces: the adapter session contract. Resume state: `RUN_DIR/claude-session-id` (extracted from the stream's `system/init` event).

- [ ] **Step 1: Confirm `--resume` exists on the installed CLI**

Run: `claude --help | grep -E '\-\-resume'`
Expected: a `--resume` (or `-r, --resume`) line taking a session id. If absent, stop and report — the resume path below needs it.

- [ ] **Step 2: Append to `skills/foreman/scripts/adapters/claude.sh`**

```bash

# --- session transport (spec 2026-07-13 §5): native headless session ---
# Subscription (claude.ai login) auth; no API key. Runs on the HOST with
# Bash allowed: mcp mode defends the merge, not the host — see
# references/security-model.md. NOT --dangerously-skip-permissions.

_claude_session_flags() {
  echo "--output-format stream-json --verbose --permission-mode acceptEdits --allowedTools Bash,Edit,Write,Read,Glob,Grep,TodoWrite"
}

adapter_session_run() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0
  local ev="$rd/worker-events-round-$round.jsonl"
  # shellcheck disable=SC2046 # _claude_session_flags is a fixed, space-safe flag list
  ( cd "$wt" && timeout --signal=KILL "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" \
      claude -p "$(cat "$prompt")" $(_claude_session_flags) > "$ev" ) || rc=$?
  jq -r 'select(.type=="system" and .subtype=="init") | .session_id // empty' "$ev" 2>/dev/null \
    | head -1 > "$rd/claude-session-id" || true
  [[ -s "$rd/claude-session-id" ]] || rm -f "$rd/claude-session-id"
  return "$rc"
}

adapter_session_can_resume() { [[ -s "$1/claude-session-id" ]]; }  # RUN_DIR

adapter_session_resume() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0
  local ev="$rd/worker-events-round-$round.jsonl"
  # shellcheck disable=SC2046
  ( cd "$wt" && timeout --signal=KILL "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" \
      claude -p "$(cat "$prompt")" --resume "$(cat "$rd/claude-session-id")" \
      $(_claude_session_flags) > "$ev" ) || rc=$?
  return "$rc"
}
```

- [ ] **Step 3: Verify with a transient claude stub (not committed)**

```bash
mkdir -p /tmp/fbin
cat > /tmp/fbin/claude <<'EOF'
#!/usr/bin/env bash
echo '{"type":"system","subtype":"init","session_id":"sid-42"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}'
EOF
chmod +x /tmp/fbin/claude
bash -c '
  export PATH=/tmp/fbin:$PATH FOREMAN_SESSION_TIMEOUT_SEC=30
  source skills/foreman/scripts/adapters/claude.sh
  rd=$(mktemp -d); mkdir -p "$rd"; p=$(mktemp); echo task > "$p"
  adapter_session_run "$p" /tmp "$rd" 1 || exit 1
  [ "$(cat "$rd/claude-session-id")" = sid-42 ] || exit 1
  adapter_session_can_resume "$rd" || exit 1
  grep -q sid-42 "$rd/worker-events-round-1.jsonl" || exit 1
  echo CLAUDE-SESSION-OK'
shellcheck -x skills/foreman/scripts/adapters/claude.sh
bats tests/
rm -rf /tmp/fbin
```
Expected: `CLAUDE-SESSION-OK`, shellcheck clean, 60/60 pass.

- [ ] **Step 4: Commit**

```bash
git add skills/foreman/scripts/adapters/claude.sh
git commit -m "feat: claude session transport via native -p/--resume (subscription auth)"
```

---

### Task 5: Grok adapter session functions (headless)

**Files:**
- Modify: `skills/foreman/scripts/adapters/grok.sh` (append at end)

**Interfaces:**
- Consumes: `grok` CLI headless flags (v1-verified: `-p`, `--output-format streaming-json`, `--always-approve`, `--no-auto-update`; plus `--cwd` confirmed on the installed build); `$FOREMAN_SESSION_TIMEOUT_SEC`.
- Produces: the adapter session contract. No resume in v1 (`adapter_session_can_resume` always false — grok's `--continue` is cwd-keyed, too ambiguous to trust deterministically).

- [ ] **Step 1: Record the keyless-auth check (spec §10 item 1)**

Run: `grok --help | grep -iE 'login|auth'` and, if a login/auth subcommand exists, its status command.
Record the finding as a comment in the code below (keyless login supported / requires XAI_API_KEY). This does not block the task: the session function inherits whatever auth the CLI has; an unauthenticated CLI fails the round with its own error (exit 1, visible in the events/stderr logs).

- [ ] **Step 2: Append to `skills/foreman/scripts/adapters/grok.sh`**

```bash

# --- session transport (spec 2026-07-13 §5): headless session ---
# Inherits the grok CLI's own login (subscription) auth; no key injection.
# <replace with Step 1 finding: keyless login supported | XAI_API_KEY required>
# No resume in v1: grok --continue is cwd-keyed, not id-keyed; every round is fresh.

adapter_session_run() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0
  timeout --signal=KILL "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" \
    grok --no-auto-update --cwd "$wt" -p "$(cat "$prompt")" \
      --output-format streaming-json --always-approve \
    > "$rd/worker-events-round-$round.jsonl" || rc=$?
  return "$rc"
}

adapter_session_can_resume() { return 1; }  # RUN_DIR (unused)

adapter_session_resume() { adapter_session_run "$@"; }
```

- [ ] **Step 3: Verify**

```bash
mkdir -p /tmp/fbin
printf '#!/usr/bin/env bash\necho "{\\"event\\":\\"done\\"}"\n' > /tmp/fbin/grok
chmod +x /tmp/fbin/grok
bash -c '
  export PATH=/tmp/fbin:$PATH FOREMAN_SESSION_TIMEOUT_SEC=30
  source skills/foreman/scripts/adapters/grok.sh
  rd=$(mktemp -d); p=$(mktemp); echo task > "$p"
  adapter_session_run "$p" /tmp "$rd" 1 || exit 1
  grep -q done "$rd/worker-events-round-1.jsonl" || exit 1
  adapter_session_can_resume "$rd" && exit 1
  echo GROK-SESSION-OK'
shellcheck -x skills/foreman/scripts/adapters/grok.sh
bats tests/
rm -rf /tmp/fbin
```
Expected: `GROK-SESSION-OK`, shellcheck clean, 60/60 pass.

- [ ] **Step 4: Commit**

```bash
git add skills/foreman/scripts/adapters/grok.sh
git commit -m "feat: grok session transport (headless, login auth, no v1 resume)"
```

---

### Task 6: `worker-run.sh` transport branch

**Files:**
- Modify: `skills/foreman/scripts/worker-run.sh`

**Interfaces:**
- Consumes: `transport_mode`, `enforce_mcp_decorrelation` (Task 1); adapter session contract (Tasks 3–5).
- Produces: unchanged artifacts (`worker-round-N.json` same schema, `worker-events-round-N.jsonl`, `worker-stderr-round-N.log`, `prompt-round-N.md`) plus, in mcp mode, `RUN_DIR/session-vendor-round-N` (vendor name, written BEFORE the session starts — the cockpit watcher keys on it). Container path behavior is untouched.

- [ ] **Step 1: Add transport detection and mcp decorrelation.** After line 16 (`CONFIG=...`), insert:

```bash
TRANSPORT="$(transport_mode "$CONFIG")"
```

Replace lines 27–28 (the orchestrator ≠ worker check):

```bash
if [[ "$TRANSPORT" == "mcp" ]]; then
  enforce_mcp_decorrelation "$CONFIG" worker "$VENDOR"
else
  [[ "$VENDOR" == "${FOREMAN_ORCHESTRATOR:-__unset__}" ]] \
    && die "$EXIT_CONFIG" "worker vendor ($VENDOR) must differ from orchestrator"
fi
```

- [ ] **Step 2: Branch the execution block.** Replace lines 46–70 (from the `# --- single-vendor API key env file` comment through the 137-cleanup `fi`) with:

```bash
TIMEOUT_MIN="$(toml_get "$CONFIG" limits.round_timeout_min 30)"
export FOREMAN_SESSION_TIMEOUT_SEC=$((TIMEOUT_MIN * 60))

HEAD_BEFORE="$(git_nohooks -C "$WT" rev-parse HEAD)"

if [[ "$TRANSPORT" == "mcp" ]]; then
  # Session transport: subscription-authenticated host session, zero API keys
  # (spec 2026-07-13 §5). The adapter owns event capture and timeout.
  require_cmd python3
  require_cmd "$(adapter_cli_bin)" "install + log in the $VENDOR CLI (subscription session)"
  echo "$VENDOR" > "$RD/session-vendor-round-$ROUND"
  set +e
  if [[ $ROUND -gt 1 ]] && adapter_session_can_resume "$RD"; then
    adapter_session_resume "$PROMPT" "$WT" "$RD" "$ROUND" \
      2> "$RD/worker-stderr-round-$ROUND.log"
  else
    adapter_session_run "$PROMPT" "$WT" "$RD" "$ROUND" \
      2> "$RD/worker-stderr-round-$ROUND.log"
  fi
  EXIT_CODE=$?
  set -e
else
  # Container transport (v1): single-vendor API key env file (spec §7 S6).
  KEY_NAME="$(adapter_env_key)"
  ENV_FILE="$RD/env"
  ( umask 177; echo "$KEY_NAME=${!KEY_NAME:-}" > "$ENV_FILE" )
  cleanup() { rm -f "$ENV_FILE"; }
  trap cleanup EXIT

  IMAGE="${FOREMAN_WORKER_IMAGE:-foreman-worker:latest}"
  CNAME="foreman-$TASK_ID-r$ROUND"

  set +e
  timeout --signal=KILL "$((TIMEOUT_MIN * 60))" \
    "$(docker_run_wrapper)" \
      --env-file "$ENV_FILE" --prompt "$PROMPT" --name "$CNAME" \
      "$WT" "$IMAGE" -- bash -lc "$(adapter_worker_cmd)" \
    > "$RD/worker-events-round-$ROUND.jsonl" 2> "$RD/worker-stderr-round-$ROUND.log"
  EXIT_CODE=$?
  set -e
  if [[ $EXIT_CODE -eq 137 ]] && [[ "${FOREMAN_NO_SANDBOX:-0}" != "1" ]]; then
    "${DOCKER_BIN:-docker}" rm -f "$CNAME" >/dev/null 2>&1 || true
    log "round timed out after ${TIMEOUT_MIN}m"
  fi
fi
```

Note: `HEAD_BEFORE` moves above the branch (it was line 57); delete the now-duplicated original lines. Everything after (HEAD_AFTER/CLEAN/COMMITTED/round-json/exit) is shared and stays exactly as-is.

- [ ] **Step 3: Verify container path unchanged + mcp path smoke**

```bash
shellcheck -x skills/foreman/scripts/worker-run.sh
bats tests/                       # container-path regression: all 60 must pass
# mcp-path smoke with stubbed vendor CLI (transient):
mkdir -p /tmp/fbin
cat > /tmp/fbin/grok <<'EOF'
#!/usr/bin/env bash
echo '{"event":"done"}'
git -c core.hooksPath= -c user.name=w -c user.email=w@w commit -qam "worker change" 2>/dev/null || true
EOF
chmod +x /tmp/fbin/grok
export PATH=/tmp/fbin:$PATH FOREMAN_HOME=$(mktemp -d) FOREMAN_ORCHESTRATOR=claude
R=$(mktemp -d)/repo; git init -qb main "$R"; cd "$R"
git -c user.name=t -c user.email=t@t commit -qm init --allow-empty
mkdir -p .foreman src; echo x > src/a; git add -A
git -c user.name=t -c user.email=t@t commit -qm fixture
printf '[transport]\nmode = "mcp"\n[orchestrator]\nmodel_family = "anthropic"\n[worker]\nvendor = "grok"\n' > .foreman/config.toml
/mnt/c/Users/charl/foreman/skills/foreman/scripts/task-new.sh SMOKE main
cd "$(dirname "$R")/repo-SMOKE" && echo change >> src/a   # give grok stub something to commit
/mnt/c/Users/charl/foreman/skills/foreman/scripts/worker-run.sh SMOKE
echo "exit=$?"
jq -r .status "$FOREMAN_HOME/runs/SMOKE/worker-round-1.json"   # expected: ok
cat "$FOREMAN_HOME/runs/SMOKE/session-vendor-round-1"          # expected: grok
ls "$FOREMAN_HOME/runs/SMOKE/env" 2>&1                         # expected: No such file (zero keys)
rm -rf /tmp/fbin
```
Expected: 60/60 bats pass; smoke prints `exit=0`, `ok`, `grok`, and no env file exists.

- [ ] **Step 4: Commit**

```bash
git add skills/foreman/scripts/worker-run.sh
git commit -m "feat: worker-run session transport branch (subscription sessions, zero keys)"
```

---

### Task 7: `audit-run.sh` — mcp decorrelation + audit-meta marker

**Files:**
- Modify: `skills/foreman/scripts/audit-run.sh`

**Interfaces:**
- Consumes: `transport_mode`, `enforce_mcp_decorrelation` (Task 1); existing `adapter_run_audit` (already host-side and subscription-capable — no adapter change needed).
- Produces: unchanged `audit-verdict.json`; new `RUN_DIR/audit-meta.json` = `{"vendor": "<auditor>"}` written before the audit runs (cockpit watcher keys on it).

- [ ] **Step 1: Insert after line 41 (the `audit vendor must differ from worker vendor` check), before the adapter `source`:**

```bash
TRANSPORT="$(transport_mode "$CONFIG")"
if [[ "$TRANSPORT" == "mcp" ]]; then
  enforce_mcp_decorrelation "$CONFIG" audit "$AUDITOR" "$WORKER_VENDOR"
fi
jq -n --arg v "$AUDITOR" '{vendor: $v}' > "$RD/audit-meta.json"
```

- [ ] **Step 2: Verify**

```bash
shellcheck -x skills/foreman/scripts/audit-run.sh
bats tests/
```
Expected: shellcheck clean, 60/60 pass (existing audit tests exercise the container-mode path; the inserted lines are a no-op there beyond the new meta file).

- [ ] **Step 3: Commit**

```bash
git add skills/foreman/scripts/audit-run.sh
git commit -m "feat: audit-run model-family decorrelation in mcp mode + audit-meta marker"
```

---

### Task 8: Cockpit — `session-watch.sh` + `foreman-up.sh`

**Files:**
- Create: `skills/foreman/scripts/session-watch.sh`
- Create: `skills/foreman/scripts/foreman-up.sh`

**Interfaces:**
- Consumes: `RUN_DIR/session-vendor-round-N` (Task 6), `RUN_DIR/audit-meta.json` + `audit-verdict.json` (Task 7), event stream files.
- Produces: `session-watch.sh VENDOR [TASK_ID]` — read-only live viewer; `foreman-up.sh [TASK_ID]` — opens Windows Terminal panes (opencode + claude + codex + grok viewers), `FOREMAN_COCKPIT=tmux` for tmux. Cosmetic scripts: never gate anything; exempt from the exit-code contract but shellcheck-clean.

- [ ] **Step 1: Write `skills/foreman/scripts/session-watch.sh`**

```bash
#!/usr/bin/env bash
# Read-only live viewer for one vendor's foreman session activity (cockpit pane).
# Cosmetic: watching is optional; determinism and evidence live in the harness.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

VENDOR="${1:?usage: session-watch.sh VENDOR [TASK_ID]}"
TASK_ID="${2:-}"
require_cmd jq

# Pretty-print one event-stream line (claude stream-json / codex MCP
# notifications / grok streaming-json / raw fallback).
render() {
  jq -rR --unbuffered '
    (fromjson? // {raw: .}) as $e |
    if $e.raw then "· " + ($e.raw | tostring)
    elif $e.type == "system" then "⚙ session " + ($e.subtype // "event")
    elif $e.type == "assistant" then
      ([$e.message.content[]? |
         if .type == "text" then .text
         elif .type == "tool_use" then "→ " + .name + " " + ((.input | tostring)[0:160])
         else empty end] | join("\n"))
    elif $e.method then "→ " + $e.method + " " + (($e.params | tostring)[0:200])
    else ($e | tostring)[0:200] end
  ' 2>/dev/null || cat
}

latest_task() { ls -t "$FOREMAN_HOME/runs" 2>/dev/null | head -1 || true; }

printf '╔ foreman viewer: %s — waiting for a round…\n' "$VENDOR"
SEEN_EVENTS="" SEEN_AUDIT="" TAIL_PID=""
cleanup() { [[ -n "$TAIL_PID" ]] && kill "$TAIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

while :; do
  TID="${TASK_ID:-$(latest_task)}"
  if [[ -n "$TID" ]]; then
    RD="$FOREMAN_HOME/runs/$TID"
    MARKER="$(ls -t "$RD"/session-vendor-round-* 2>/dev/null | head -1 || true)"
    if [[ -n "$MARKER" && "$(cat "$MARKER")" == "$VENDOR" ]]; then
      N="${MARKER##*-}"
      EV="$RD/worker-events-round-$N.jsonl"
      if [[ -e "$EV" && "$EV" != "$SEEN_EVENTS" ]]; then
        SEEN_EVENTS="$EV"
        [[ -n "$TAIL_PID" ]] && kill "$TAIL_PID" 2>/dev/null || true
        printf '\n╔ %s — worker round %s (%s)\n' "$TID" "$N" "$VENDOR"
        ( tail -F -n +1 "$EV" 2>/dev/null | render ) &
        TAIL_PID=$!
      fi
    fi
    if [[ -f "$RD/audit-meta.json" && -f "$RD/audit-verdict.json" \
          && "$RD/audit-verdict.json" != "$SEEN_AUDIT" \
          && "$(jq -r .vendor "$RD/audit-meta.json" 2>/dev/null)" == "$VENDOR" ]]; then
      SEEN_AUDIT="$RD/audit-verdict.json"
      printf '\n╔ %s — audit verdict (%s auditor)\n' "$TID" "$VENDOR"
      jq . "$RD/audit-verdict.json" 2>/dev/null || cat "$RD/audit-verdict.json"
    fi
  fi
  sleep 2
done
```

- [ ] **Step 2: Write `skills/foreman/scripts/foreman-up.sh`**

```bash
#!/usr/bin/env bash
# Foreman cockpit: opencode orchestrator pane + one live viewer pane per vendor.
# Default: Windows Terminal (wt.exe) split panes running WSL2.
# FOREMAN_COCKPIT=tmux uses tmux instead (pure-Linux environments).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SW="$SCRIPT_DIR/session-watch.sh"
TASK_ID="${1:-}"

if [[ "${FOREMAN_COCKPIT:-wt}" == "tmux" ]]; then
  command -v tmux >/dev/null 2>&1 || { echo "tmux not found" >&2; exit 3; }
  tmux kill-session -t foreman 2>/dev/null || true
  tmux new-session -d -s foreman -c "$PWD" opencode
  tmux split-window -h -t foreman "bash '$SW' claude $TASK_ID"
  tmux split-window -v -t foreman "bash '$SW' codex $TASK_ID"
  tmux select-pane -t foreman:0.0
  tmux split-window -v -t foreman "bash '$SW' grok $TASK_ID"
  tmux select-pane -t foreman:0.0
  exec tmux attach -t foreman
fi

command -v wt.exe >/dev/null 2>&1 \
  || { echo "wt.exe not on PATH; retry with FOREMAN_COCKPIT=tmux" >&2; exit 3; }
D="$PWD"
wt.exe new-tab --title opencode wsl.exe -e bash -lc "cd '$D' && exec opencode" \; \
  split-pane -H --size 0.5 --title claude wsl.exe -e bash -lc "exec bash '$SW' claude $TASK_ID" \; \
  split-pane -V --size 0.5 --title codex wsl.exe -e bash -lc "exec bash '$SW' codex $TASK_ID" \; \
  move-focus left \; \
  split-pane -V --size 0.3 --title grok wsl.exe -e bash -lc "exec bash '$SW' grok $TASK_ID"
```

- [ ] **Step 3: Verify**

```bash
shellcheck -x skills/foreman/scripts/session-watch.sh skills/foreman/scripts/foreman-up.sh
# watcher smoke against a synthetic run dir (transient):
export FOREMAN_HOME=$(mktemp -d)
mkdir -p "$FOREMAN_HOME/runs/T9"
echo codex > "$FOREMAN_HOME/runs/T9/session-vendor-round-1"
echo '{"method":"codex/event","params":{"msg":"hello"}}' > "$FOREMAN_HOME/runs/T9/worker-events-round-1.jsonl"
timeout 6 bash skills/foreman/scripts/session-watch.sh codex T9 | head -5
```
Expected: shellcheck clean; watcher prints the round banner and a `→ codex/event …hello…` line before the timeout kills it.

- [ ] **Step 4: Set exec bits and commit**

```bash
git add skills/foreman/scripts/session-watch.sh skills/foreman/scripts/foreman-up.sh
git update-index --chmod=+x skills/foreman/scripts/session-watch.sh skills/foreman/scripts/foreman-up.sh
git commit -m "feat: cockpit — per-vendor live session viewers and wt/tmux launcher"
```

---

### Task 9: `install.sh` — docker optional, opencode detection

**Files:**
- Modify: `install.sh`

**Interfaces:**
- Consumes: nothing new.
- Produces: docker missing = warning (container transport unavailable) instead of hard exit 3; opencode presence reported with the note that it auto-discovers the skill from `~/.claude/skills` / `~/.agents/skills` (both already installed by this script).

- [ ] **Step 1: Make docker a warning.** Replace line 13 (`for c in git jq python3 flock docker; do require_cmd "$c"; done`) with:

```bash
  for c in git jq python3 flock; do require_cmd "$c"; done
  # shellcheck disable=SC2015 # log() always succeeds; no if-then-else ambiguity
  command -v docker >/dev/null 2>&1 \
    && log "docker present (container transport available)" \
    || log "WARNING: docker missing — container transport unavailable; mcp (session) transport still works"
```

- [ ] **Step 2: Report opencode.** After the `for v in claude codex grok` loop (line 40), add:

```bash
  # shellcheck disable=SC2015 # log() always succeeds; no if-then-else ambiguity
  command -v opencode >/dev/null 2>&1 \
    && log "orchestrator CLI present: opencode (auto-discovers this skill from ~/.claude/skills and ~/.agents/skills)" \
    || log "orchestrator CLI missing: opencode (install: curl -fsSL https://opencode.ai/install | bash)"
```

- [ ] **Step 3: Verify**

```bash
shellcheck -x install.sh
bats tests/test_install.bats
bats tests/
```
Expected: shellcheck clean; install tests and full suite pass (install tests use `--skip-tools`, unaffected by the tool-check edits).

- [ ] **Step 4: Commit**

```bash
git add install.sh
git commit -m "feat: install — docker optional for session transport, opencode detection"
```

---

### Task 10: Docs — SKILL.md, security-model, cli-adapters, README

**Files:**
- Modify: `skills/foreman/SKILL.md` (insert before `## Hard rules`)
- Modify: `skills/foreman/references/security-model.md` (append)
- Modify: `skills/foreman/references/cli-adapters.md` (append)
- Modify: `README.md` (insert after the Security model section)

**Interfaces:** documentation of Tasks 1–9; must match their exact names/keys.

- [ ] **Step 1: Insert into `skills/foreman/SKILL.md`, before `## Hard rules`:**

```markdown
## Transports

`transport.mode` in `.foreman/config.toml` selects how worker/audit sessions run:

- **container** (default) — v1 behavior: worker in a hardened network-off Docker
  container, API keys injected per round.
- **mcp** — worker and auditor run as subscription-authenticated CLI sessions on the
  WSL2 host (zero API keys; billed to the CLI logins). Requires
  `orchestrator.model_family` (anthropic | openai | xai) — declare the family YOUR
  terminal is running; the ≠ rules compare model families in this mode. Codex is
  driven over MCP (`codex mcp-server`, rework rounds continue the same thread);
  Claude Code via `claude -p --resume`. Reduced isolation — read
  references/security-model.md.

The stage flow is identical in both modes. To watch sessions live, run
`$FS/foreman-up.sh` (cockpit: your orchestrator pane + one viewer pane per vendor),
or `tail -f ~/.foreman/runs/TASK_ID/worker-events-round-N.jsonl`.
```

- [ ] **Step 2: Append to `skills/foreman/references/security-model.md`:**

```markdown

## Session (mcp) transport posture

The mcp transport trades container isolation for subscription economics and live
visibility. The worker session runs ON THE HOST with vendor-native guardrails only
(Codex `workspace-write` sandbox; Claude Code permission modes with Bash allowed).
No `--network none`, no cap-drop, no read-only root: a hostile worker could reach
the network or the wider filesystem to whatever extent the vendor's own sandbox
permits.

Compensating controls that remain fully authoritative: forbidden-path diff check,
hash-drift snapshot over protected files, independent checks from a pristine
checkout, cross-model audit (model-family decorrelation), deterministic gate,
bounded rework, CI as final merge authority.

**Posture:** mcp mode assumes a non-malicious-but-fallible worker and defends the
merge, not the host. For untrusted or injection-risky inputs, use container mode.
```

- [ ] **Step 3: Append to `skills/foreman/references/cli-adapters.md`:**

```markdown

## Session-transport functions (mcp mode)

Each adapter additionally defines:

| Function | Contract |
|---|---|
| `adapter_session_run PROMPT_FILE WORKTREE RUN_DIR ROUND` | run one round as a host session; write `RUN_DIR/worker-events-round-ROUND.jsonl`; honor `$FOREMAN_SESSION_TIMEOUT_SEC`; persist resume state; nonzero on failure |
| `adapter_session_can_resume RUN_DIR` | 0 iff resume state exists |
| `adapter_session_resume PROMPT_FILE WORKTREE RUN_DIR ROUND` | continue the previous session with the rework prompt |

Mechanisms: codex → MCP `codex()`/`codex-reply()` against `codex mcp-server`
(state: `RUN_DIR/thread-id`); claude → `claude -p` / `--resume` (state:
`RUN_DIR/claude-session-id`); grok → headless `grok -p` per round, no resume in v1.
All inherit the CLI's login (subscription) auth — no API keys.
```

- [ ] **Step 4: Insert into `README.md` after the Security model section:**

```markdown
## Session transport (opencode cockpit, no API keys)

`transport.mode = "mcp"` runs worker and auditor as your normal
subscription-authenticated CLI sessions on the WSL2 host — nothing is billed to
API keys. opencode (or any vendor CLI) is the orchestrator; decorrelation is
enforced by model family (`orchestrator.model_family` vs worker vs auditor).

```bash
# one-time, inside WSL2: install + log in (subscription OAuth, no keys)
curl -fsSL https://opencode.ai/install | bash
npm install -g @openai/codex && codex login
curl -fsSL https://claude.ai/install.sh | bash   # then: claude → /login

# per repo
#   .foreman/config.toml: transport.mode = "mcp", orchestrator.model_family = "...",
#   worker/audit vendors from different families

# watch it work
skills/foreman/scripts/foreman-up.sh    # opencode pane + live claude/codex/grok viewers
```

Codex rework rounds continue the same session thread over MCP; Claude Code resumes
via its session id. Isolation is reduced versus container mode — see
`skills/foreman/references/security-model.md` ("Session (mcp) transport posture").
```

- [ ] **Step 5: Verify**

Run: `bats tests/ && shellcheck -x install.sh skills/foreman/scripts/*.sh skills/foreman/scripts/lib/*.sh skills/foreman/scripts/adapters/*.sh`
Expected: 60/60 pass, shellcheck clean. Manually confirm SKILL.md stays under 500 lines: `wc -l skills/foreman/SKILL.md`.

- [ ] **Step 6: Commit**

```bash
git add skills/foreman/SKILL.md skills/foreman/references/security-model.md \
        skills/foreman/references/cli-adapters.md README.md
git commit -m "docs: session transport — protocol, posture, adapter contract, quickstart"
```

---

### Task 11: WSL2 environment setup + live acceptance demo (manual)

**Files:**
- Create: `docs/demo-log.md` (record of the run)

**Interfaces:** consumes everything. This is spec §9 — acceptance is the visible demo, not test scaffolding. Steps needing interactive OAuth logins are done by the human (Charles); everything else is scriptable.

- [ ] **Step 1: Install the CLIs natively in WSL2**

```bash
curl -fsSL https://opencode.ai/install | bash
npm install -g @openai/codex
curl -fsSL https://claude.ai/install.sh | bash
curl -fsSL https://x.ai/cli/install.sh | bash   # optional: grok pane stays idle without it
```
Expected: `opencode --version`, `codex --version`, `claude --version` all print inside WSL2. (If an install URL has moved, check the vendor's docs — names are moving targets.)

- [ ] **Step 2: One-time logins (HUMAN — interactive OAuth, no keys)**

- `opencode auth login` → pick the provider/plan to orchestrate with
- `claude` → `/login` → subscription account
- `codex login` → ChatGPT plan account
- `grok` → sign in if installed
Then confirm zero keys: `env | grep -cE 'ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY'` prints `0`.

- [ ] **Step 3: Configure foreman on the target repo (foreman itself)**

```bash
cd /mnt/c/Users/charl/foreman && ./install.sh
# .foreman/config.toml — set:
#   [transport] mode = "mcp"
#   [orchestrator] model_family = "<family opencode is running>"
#   [worker] vendor = "codex"     # if opencode runs anthropic
#   [audit]  vendor = "claude"
#   [checks] command = "bats tests/"
```

- [ ] **Step 4: Run the cockpit demo (HUMAN drives opencode)**

```bash
skills/foreman/scripts/foreman-up.sh
```
In the opencode pane, invoke the foreman skill with a real small task (e.g. *"add a `--version` flag to session-watch.sh printing the repo git describe"*). Follow the stage flow: `task-new` → plan → `worker-run` (watch the codex pane light up) → `checks-run` → `evidence-collect` → `audit-run` (watch the claude pane show the verdict) → `gate-eval` → `pr-open` or rework (watch the SAME codex thread continue).

- [ ] **Step 5: Record results in `docs/demo-log.md`**

Record: date, opencode model + declared family, worker/audit vendors, rounds, gate decision, whether thread-resume fired, the zero-key check output, wall-clock, and every rough edge (v1.1 backlog). Honest failures included.

- [ ] **Step 6: Commit**

```bash
git add docs/demo-log.md
git commit -m "docs: session-transport acceptance demo record"
```

---

## Self-Review Notes

- **Spec coverage:** §4 config/decorrelation → Tasks 1, 6, 7; §5 session mechanics → Tasks 2–5 (codex MCP + threadId, claude -p/--resume, grok headless no-resume); §6 cockpit → Task 8 (+ marker files from Tasks 6–7); §7 component table → Tasks 1–10 one-to-one; §8 posture → Task 10 Step 2; §9 acceptance → Task 11 (incl. zero-key check); §10 verification items → Task 3 Step 1 (codex schema probe), Task 4 Step 1 (--resume check), Task 5 Step 1 (grok keyless), Task 9 (opencode discovery — resolved: auto-discovers `~/.claude/skills`/`~/.agents/skills`, both already installed), §10.5 model introspection deliberately config-declared (spec says config is source of truth); §11 out-of-scope respected (no gate/evidence changes, container path untouched).
- **Type consistency:** `adapter_session_run/can_resume/resume` signatures identical in Tasks 3, 4, 5 and consumed identically in Task 6; state files `thread-id`/`claude-session-id` defined and consumed within their own adapters; `session-vendor-round-N` written in Task 6, read in Task 8; `audit-meta.json {vendor}` written in Task 7, read in Task 8; `transport_mode`/`enforce_mcp_decorrelation` defined in Task 1, consumed in Tasks 6–7 with matching arity.
- **Placeholder scan:** one deliberate fill-in — Task 5 Step 2's auth-finding comment, which Step 1 instructs how to resolve; Task 3 Step 1 explicitly makes the probed schema authoritative over the sample keys. No TBDs otherwise; every step has full code or exact commands with expected output.
- **D6 compliance:** no new committed test files; all verification is transient (`/tmp`, deleted) or the existing suite; acceptance is the Task 11 live demo.
