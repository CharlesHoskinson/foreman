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
# shellcheck disable=SC2016
# Single quotes intentional: this is a jq program, not a bash expansion.
RENDER_FILTER='
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
  '

# shellcheck disable=SC2012
latest_task() { ls -t "$FOREMAN_HOME/runs" 2>/dev/null | head -1 || true; }

# start_tail EVENTS_FILE — tail the round's event stream through the render
# filter, all inside a dedicated process group (setsid) so kill_tail can
# reap tail *and* jq together instead of leaking the pipeline's children.
start_tail() {
  # shellcheck disable=SC2016
  # Single quotes intentional: $1/$2 expand inside the child bash -c, not here.
  setsid bash -c '
    tail -F -n +1 "$1" 2>/dev/null | { jq -rR --unbuffered "$2" 2>/dev/null || cat; }
  ' _ "$1" "$RENDER_FILTER" &
  TAIL_PID=$!
}

kill_tail() {
  if [[ -n "${TAIL_PID:-}" ]]; then
    kill -KILL -- "-$TAIL_PID" 2>/dev/null || true
    TAIL_PID=""
  fi
}

printf '╔ foreman viewer: %s — waiting for a round…\n' "$VENDOR"
SEEN_EVENTS="" SEEN_AUDIT="" TAIL_PID=""
cleanup() { kill_tail; }
trap cleanup EXIT

while :; do
  TID="${TASK_ID:-$(latest_task)}"
  if [[ -n "$TID" ]]; then
    RD="$FOREMAN_HOME/runs/$TID"
    # shellcheck disable=SC2012
    MARKER="$(ls -t "$RD"/session-vendor-round-* 2>/dev/null | head -1 || true)"
    if [[ -n "$MARKER" && "$(cat "$MARKER")" == "$VENDOR" ]]; then
      N="${MARKER##*-}"
      EV="$RD/worker-events-round-$N.jsonl"
      if [[ -e "$EV" && "$EV" != "$SEEN_EVENTS" ]]; then
        SEEN_EVENTS="$EV"
        kill_tail
        printf '\n╔ %s — worker round %s (%s)\n' "$TID" "$N" "$VENDOR"
        start_tail "$EV"
      fi
    fi
    if [[ -f "$RD/audit-meta.json" && -f "$RD/audit-verdict.json" \
          && "$RD/audit-verdict.json" != "$SEEN_AUDIT" \
          && "$(jq -r .vendor "$RD/audit-meta.json" 2>/dev/null)" == "$VENDOR" ]]; then
      SEEN_AUDIT="$RD/audit-verdict.json"
      printf '\n╔ %s — audit verdict (%s auditor)\n' "$TID" "$VENDOR"
      jq . "$RD/audit-verdict.json" 2>/dev/null || cat "$RD/audit-verdict.json" 2>/dev/null || true
    fi
  fi
  sleep 2
done
