#!/usr/bin/env bash
# Foreman install — symlink skill into Claude / agents / grok homes
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$ROOT/skills/foreman"
SKIPPED_DESTINATIONS=0
COMMON_SKILLS_ROOT=""
common_dir="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$common_dir" && -d "$(dirname "$common_dir")/skills" ]]; then
  COMMON_SKILLS_ROOT="$(cd "$(dirname "$common_dir")/skills" && pwd -P)"
fi

# @description Link the repository's Foreman skill into a tool-specific skill directory unless that destination exists.
# @arg $1 dest destination path for the Foreman skill symlink
# @stdout whether the destination already existed or the link was created
link_skill() {
  local src="$1" dest="$2"
  local src_resolved link_target
  src_resolved="$(cd "$src" && pwd -P)"
  mkdir -p "$(dirname "$dest")"

  if [[ -L "$dest" ]]; then
    link_target="$(readlink "$dest")"
    if [[ "$link_target" != /* ]]; then
      link_target="$(dirname "$dest")/$link_target"
    fi
    if [[ -d "$link_target" ]]; then
      link_target="$(cd "$link_target" && pwd -P)"
    fi
    if [[ "$link_target" == "$src_resolved" || ( -n "$COMMON_SKILLS_ROOT" && "$link_target" == "$COMMON_SKILLS_ROOT/$(basename "$src_resolved")" ) ]]; then
      echo "[foreman] ok (already linked): $dest -> $src_resolved"
      return
    fi
    rm -- "$dest"
  elif [[ -e "$dest" ]]; then
    echo "[foreman] SKIP $dest: exists and is not a link — back it up or remove it, then re-run (it may contain *.local.md overlays; do not lose them)" >&2
    SKIPPED_DESTINATIONS=$((SKIPPED_DESTINATIONS + 1))
    return
  fi

  ln -s "$src_resolved" "$dest"
  echo "[foreman] linked $dest -> $src_resolved"
}

[[ -f "$ROOT/skills/foreman/SKILL.md" ]] || { echo "SKILL.md missing"; exit 1; }

for skill_dir in "$ROOT"/skills/*/; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  link_skill "$skill_dir" "${HOME}/.claude/skills/$name"
  link_skill "$skill_dir" "${HOME}/.agents/skills/$name"
  link_skill "$skill_dir" "${HOME}/.grok/skills/$name"
done

echo "[foreman] $SKIPPED_DESTINATIONS destinations skipped (unlinked real dirs)"

mkdir -p "${HOME}/.claude/agents"
cp -f "$ROOT/agents/"*.md "${HOME}/.claude/agents/"
echo "[foreman] agents copied to ${HOME}/.claude/agents"

# WSL: also ensure scripts executable
chmod +x "$SKILL_SRC/scripts/"*.sh 2>/dev/null || true
chmod +x "$SKILL_SRC/scripts/lib/"*.sh 2>/dev/null || true

mkdir -p "${HOME}/.foreman/runs"
echo "[foreman] install complete. Soft mode ready."
echo "[foreman] Boot: cd $ROOT && claude   then  /model fable  and  /foreman"
