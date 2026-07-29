#!/usr/bin/env bash
# @description Declarative Bats preconditions. Every unmet requirement calls
#   skip with an actionable reason; callers must never use a bare skip.

# @description Identify the host dialect used by platform preconditions and
#   skip budgets.
# @stdout one of linux, wsl, or windows
preconditions_platform() {
  local kernel
  kernel="$(uname -s 2>/dev/null || printf 'unknown')"
  case "$kernel" in
    MINGW*|MSYS*|CYGWIN*)
      printf 'windows\n'
      ;;
    Linux)
      if [[ -n "${WSL_DISTRO_NAME:-}" ]] ||
        grep -Eqi '(microsoft|wsl)' /proc/sys/kernel/osrelease 2>/dev/null; then
        printf 'wsl\n'
      else
        printf 'linux\n'
      fi
      ;;
    *)
      printf '%s\n' "${kernel,,}"
      ;;
  esac
}

# @description Skip unless the host satisfies the named platform requirement.
# @arg $1 required platform: windows, wsl, linux, posix, or an exact host id
require_platform() {
  local required="${1:?require_platform requires a platform}"
  local actual
  actual="$(preconditions_platform)"
  case "$required" in
    posix)
      [[ "$actual" == linux || "$actual" == wsl ]] && return 0
      ;;
    linux)
      [[ "$actual" == linux || "$actual" == wsl ]] && return 0
      ;;
    *)
      [[ "$actual" == "$required" ]] && return 0
      ;;
  esac
  skip "requires platform $required; current platform is $actual"
}

# @description Skip unless an executable tool is available on PATH.
# @arg $1 executable name
# @arg $2 optional installation command or instruction
require_tool() {
  local tool="${1:?require_tool requires a tool name}"
  local install="${2:-install $tool and add it to PATH}"
  command -v "$tool" >/dev/null 2>&1 && return 0
  skip "requires tool $tool; install with: $install"
}

# @description Skip when the test needs permission behavior root can bypass.
require_non_root() {
  (( EUID != 0 )) && return 0
  skip "requires a non-root user; rerun the test as an unprivileged user"
}

# @description Skip unless a required build artefact exists.
# @arg $1 artefact path
# @arg $2 optional command that builds the artefact
require_built() {
  local artefact="${1:?require_built requires an artefact path}"
  local build_command="${2:-build the artefact before running this test}"
  [[ -e "$artefact" ]] && return 0
  skip "requires built artefact $artefact; build with: $build_command"
}

# @description Skip if any named vendor process is currently live.
# @arg $1... optional exact process names; defaults to grok, codex, and claude
require_no_live_vendor() {
  local vendors=("$@")
  local vendor
  if ! command -v pgrep >/dev/null 2>&1; then
    skip "requires tool pgrep to confirm no live vendor process; install with: install procps"
  fi
  if (( ${#vendors[@]} == 0 )); then
    vendors=(grok codex claude)
  fi
  for vendor in "${vendors[@]}"; do
    if pgrep -x "$vendor" >/dev/null 2>&1; then
      skip "requires no live $vendor process; stop $vendor before running this test"
    fi
  done
}
