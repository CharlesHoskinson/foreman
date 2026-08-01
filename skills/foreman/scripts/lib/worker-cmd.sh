#!/usr/bin/env bash
# @description Compatibility shim for per-vendor hard-mode worker adapters.
#   THE PROMPT MUST
#   NEVER ARRIVE ON STDIN — foreman-launch nulls CMD's stdin unconditionally
#   (launcher/README.md:32-33: "CMD's stdin is the null device"), so every
#   vendor invocation here delivers the task prompt as a file argument or a
#   positional argument instead.
#
#   Self-contained like lib/launch.sh: does not source lib/common.sh (which
#   declares readonly EXIT_* constants) so it can be sourced standalone (as
#   the bats tests for this file do) without a double-source readonly
#   collision when a caller (e.g. worker-run.sh) has already sourced
#   lib/common.sh itself. Falls back to a local error path when `die`/
#   `EXIT_CONFIG` are not present in the calling shell.
#
#   wc_build_argv VENDOR PROMPT_FILE WORKDIR — fills the global array
#   WC_ARGV with the full argv (argv[0] is the vendor binary name). It sources
#   only the selected standalone adapter, invokes adapter_implement_argv, and
#   copies ADAPTER_ARGV element-for-element into WC_ARGV. Callers spawn
#   WC_ARGV directly (no shell re-interpretation), e.g. under foreman-launch:
#   `"$LAUNCHER" ... -- "${WC_ARGV[@]}"`.
# @arg $1 vendor worker vendor: grok | codex
# @arg $2 prompt_file path to the prompt file (contents become codex's
#   positional argument; grok reads the file itself via --prompt-file)
# @arg $3 workdir worker's working directory
# @arg $4 adapter_option optional vendor adapter flag such as Codex -p/--profile
# @arg $5 adapter_value optional value paired with adapter_option
# @set WC_ARGV the full command argv as a bash array (argv[0] = binary)
# @exitcode 0 known vendor; nonzero for an unknown vendor
# shellcheck disable=SC2034  # WC_ARGV is the documented output contract; callers use it after sourcing
wc_build_argv() {
  local vendor="$1" prompt_file="$2" workdir="$3" adapter_file
  shift 3
  WC_ARGV=()
  case "$vendor" in
    grok|codex|agy|claude) ;;
    *)
      if declare -F die >/dev/null 2>&1 && [[ -n "${EXIT_CONFIG:-}" ]]; then
        die "$EXIT_CONFIG" "unknown worker vendor: $vendor"
      else
        printf '[foreman] ERROR: unknown worker vendor: %s\n' "$vendor" >&2
        return 2
      fi
      ;;
  esac

  adapter_file="${BASH_SOURCE[0]%/*}/../adapters/$vendor.sh"
  # shellcheck source=/dev/null  # Resolved from the validated vendor at runtime.
  source "$adapter_file"
  adapter_implement_argv "$vendor" "$prompt_file" "$workdir" "$@" || return $?
  WC_ARGV=("${ADAPTER_ARGV[@]}")
}
