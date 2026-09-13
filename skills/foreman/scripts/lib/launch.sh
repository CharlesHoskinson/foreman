#!/usr/bin/env bash
# @description Self-contained foreman-launch resolver for hard-mode scripts
#   located under skills/foreman/scripts/lib. It does not depend on a caller's
#   SCRIPT_DIR or LANE_PLATFORM globals and therefore remains
#   reusable from a fresh sourcing context. Precedence identical in spirit:
#   FOREMAN_LAUNCH env override (AUTHORITATIVE when set -- non-executable or
#   missing means the launcher is ABSENT, never a fallthrough to the probes
#   below; this is the deliberate neutralization knob tests use) > the
#   committed launcher/dist binary resolved relative to THIS file's own repo
#   root (FOUR levels up from scripts/lib -- the audit's off-by-one trap:
#   lane_resolve_launcher is three levels up from scripts, this file lives
#   one level deeper) > PATH lookup > absent.
# @stdout resolved executable path (nothing if absent)
# @exitcode 0 found; 1 absent
fl_resolve_launcher() {
  if [[ -n "${FOREMAN_LAUNCH:-}" ]]; then
    if [[ -x "$FOREMAN_LAUNCH" ]]; then
      printf '%s\n' "$FOREMAN_LAUNCH"
      return 0
    fi
    return 1
  fi

  local repo_root candidate
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd 2>/dev/null)" || repo_root=""
  if [[ -n "$repo_root" ]]; then
    case "$(uname -s)" in
      *NT*|MINGW*|MSYS*|CYGWIN*) candidate="$repo_root/launcher/dist/foreman-launch.exe" ;;
      *) candidate="$repo_root/launcher/dist/foreman-launch" ;;
    esac
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  if candidate="$(command -v foreman-launch 2>/dev/null)"; then
    [[ -n "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  fi

  return 1
}
