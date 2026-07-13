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
