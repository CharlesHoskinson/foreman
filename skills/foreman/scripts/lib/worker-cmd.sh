#!/usr/bin/env bash
# @description Per-vendor hard-mode worker command builder. THE PROMPT MUST
#   NEVER ARRIVE ON STDIN — foreman-launch nulls CMD's stdin unconditionally
#   (launcher/README.md:32-33: "CMD's stdin is the null device"), so every
#   vendor invocation here delivers the task prompt as a file argument or a
#   positional argument instead. v1 covers the two live worker vendors
#   (grok, codex); claude is out of scope (REQUIRES-SEPARATE-HOME).
#
#   Self-contained like lib/launch.sh: does not source lib/common.sh (which
#   declares readonly EXIT_* constants) so it can be sourced standalone (as
#   the bats tests for this file do) without a double-source readonly
#   collision when a caller (e.g. worker-run.sh) has already sourced
#   lib/common.sh itself. Falls back to a local error path when `die`/
#   `EXIT_CONFIG` are not present in the calling shell.
#
#   wc_build_argv VENDOR PROMPT_FILE WORKDIR — fills the global array
#   WC_ARGV with the full argv (argv[0] is the vendor binary name). Callers
#   spawn WC_ARGV directly (no shell re-interpretation), e.g. under
#   foreman-launch: `"$LAUNCHER" ... -- "${WC_ARGV[@]}"`.
#
#   - grok: real prompt interface is `--prompt-file` (ground truth:
#     references/lanes.md:7,39; agents/grok-implementer.md:97), plus the
#     same one-shot/non-interactive flags the grok lane uses elsewhere:
#     `-m grok-4.5` (overridable via WC_GROK_MODEL), `--allow "Write"
#     --allow "Edit"` (auto-approve writes/edits only — shell stays gated),
#     `--output-format plain`, `--cwd WORKDIR`.
#   - codex: `codex exec` takes PROMPT as a positional argument (verified
#     2026-07-18 against the installed `codex exec --help`: "Arguments:
#     [PROMPT] Initial instructions for the agent. If not provided ... or
#     if `-` is used, instructions are read from stdin" — so a real
#     positional argument, never `-`, keeps stdin out of play), plus
#     `--sandbox workspace-write --skip-git-repo-check --output-last-message
#     WORKDIR/.foreman-last.txt --model gpt-5.6-sol (WC_CODEX_MODEL)
#     -c model_reasoning_effort=medium (WC_CODEX_REASONING_EFFORT)`.
# @arg $1 vendor worker vendor: grok | codex
# @arg $2 prompt_file path to the prompt file (contents become codex's
#   positional argument; grok reads the file itself via --prompt-file)
# @arg $3 workdir worker's working directory
# @set WC_ARGV the full command argv as a bash array (argv[0] = binary)
# @exitcode 0 known vendor; nonzero for an unknown vendor
# shellcheck disable=SC2034  # WC_ARGV is the documented output contract; callers use it after sourcing
wc_build_argv() {
  local vendor="$1" prompt_file="$2" workdir="$3"
  WC_ARGV=()
  case "$vendor" in
    grok)
      # NOTE: `grok --prompt-file` is a SINGLE agentic burst — a spec that must
      # read/introspect before writing can exhaust the burst on orientation and
      # write nothing (an "empty-burst" round). Keep hard-mode worker specs
      # write-first; for genuinely exploratory work route through
      # skills/foreman/scripts/grok-multiround.sh (bounded re-prompt loop).
      WC_ARGV=(grok --prompt-file "$prompt_file" \
        -m "${WC_GROK_MODEL:-grok-4.5}" \
        --allow "Write" --allow "Edit" \
        --output-format plain \
        --cwd "$workdir")
      ;;
    codex)
      WC_ARGV=(codex exec \
        --sandbox workspace-write \
        --skip-git-repo-check \
        --output-last-message "$workdir/.foreman-last.txt" \
        --model "${WC_CODEX_MODEL:-gpt-5.6-sol}" \
        -c "model_reasoning_effort=${WC_CODEX_REASONING_EFFORT:-medium}" \
        "$(cat "$prompt_file")")
      ;;
    # claude is advertised as a lane vendor by wt-new.sh, lane-run.sh, and
    # lane-queue.sh, but is deliberately out of scope as a *worker* vendor
    # (REQUIRES-SEPARATE-HOME). Explicit branch so the failure is diagnosable
    # rather than looking like an unknown-vendor typo.
    claude)
      if declare -F die >/dev/null 2>&1 && [[ -n "${EXIT_CONFIG:-}" ]]; then
        die "$EXIT_CONFIG" "claude is deliberately unsupported as a worker vendor (REQUIRES-SEPARATE-HOME); supported worker vendors: grok, codex"
      else
        printf '[foreman] ERROR: claude is deliberately unsupported as a worker vendor (REQUIRES-SEPARATE-HOME); supported worker vendors: grok, codex\n' >&2
        return 2
      fi
      ;;
    *)
      if declare -F die >/dev/null 2>&1 && [[ -n "${EXIT_CONFIG:-}" ]]; then
        die "$EXIT_CONFIG" "unknown worker vendor: $vendor"
      else
        printf '[foreman] ERROR: unknown worker vendor: %s\n' "$vendor" >&2
        return 2
      fi
      ;;
  esac
}
