#!/usr/bin/env bash
# Foreman install — symlink skill into Claude / agents / grok homes
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$ROOT/skills/foreman"

# @description Link the repository's Foreman skill into a tool-specific skill directory unless that destination exists.
# @arg $1 dest destination path for the Foreman skill symlink
# @stdout whether the destination already existed or the link was created
link_skill() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  if [[ -e "$dest" || -L "$dest" ]]; then
    echo "[foreman] already exists: $dest"
  else
    ln -s "$SKILL_SRC" "$dest"
    echo "[foreman] linked $dest -> $SKILL_SRC"
  fi
}

[[ -f "$SKILL_SRC/SKILL.md" ]] || { echo "SKILL.md missing"; exit 1; }

link_skill "${HOME}/.claude/skills/foreman"
link_skill "${HOME}/.agents/skills/foreman"
link_skill "${HOME}/.grok/skills/foreman"

mkdir -p "${HOME}/.claude/agents"
cp -f "$ROOT/agents/"*.md "${HOME}/.claude/agents/"
echo "[foreman] agents copied to ${HOME}/.claude/agents"

# WSL: also ensure scripts executable
chmod +x "$SKILL_SRC/scripts/"*.sh 2>/dev/null || true
chmod +x "$SKILL_SRC/scripts/lib/"*.sh 2>/dev/null || true

mkdir -p "${HOME}/.foreman/runs"
echo "[foreman] install complete. Soft mode ready."
echo "[foreman] Boot: cd $ROOT && claude   then  /model fable  and  /foreman"
