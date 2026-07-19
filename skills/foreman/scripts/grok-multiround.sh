#!/usr/bin/env bash
# @description Bounded re-prompt loop for grok's single-burst `--prompt-file`
#   invocation (agents/grok-implementer.md "Single-burst: write-first
#   specs"). A single grok burst reads the spec, may narrate orientation,
#   and exits -- there is no follow-up turn. For genuinely exploratory specs
#   (grok must read/introspect before it can write), this helper re-issues
#   the spec across a bounded number of rounds, feeding forward a preamble
#   that tells grok the prior round produced no file changes and it must
#   write now instead of reading again. "Did grok write anything" is
#   detected via a git-status digest of the target working dir (untracked
#   AND modified files both flip the digest), never by parsing grok's own
#   narration.
# Usage: grok-multiround.sh SPEC [--max-rounds N] -- GROK_CMD [ARGS...]
#   SPEC          path to the five-part spec file (round 1 prompt, verbatim)
#   --max-rounds  bounded round budget (default 3)
#   GROK_CMD ...  the grok binary and its fixed args (e.g. --cwd WORKDIR);
#                 this helper appends `--prompt-file ROUND_SPEC` itself --
#                 do NOT pass --prompt-file in GROK_CMD's own args.
# @exitcode 0 a file change was observed within the round budget (prints
#   "grok-multiround: files changed (rounds=N)" on stdout)
# @exitcode 1 (EXIT_FAIL) no file change after the full round budget -- an
#   EMPTY-BURST FAILED: grok narrated orientation every round but never wrote
# @exitcode 2 (EXIT_CONFIG) bad usage (missing SPEC/GROK_CMD, unknown flag)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

[[ $# -ge 1 ]] || die "$EXIT_CONFIG" "usage: grok-multiround.sh SPEC [--max-rounds N] -- GROK_CMD [ARGS...]"
SPEC="$1"; shift
[[ -f "$SPEC" ]] || die "$EXIT_CONFIG" "spec file not found: $SPEC"

MAX_ROUNDS=3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-rounds)
      MAX_ROUNDS="${2:?--max-rounds needs a value}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      die "$EXIT_CONFIG" "unknown arg: $1 (expected --max-rounds N or --)"
      ;;
  esac
done
[[ $# -ge 1 ]] || die "$EXIT_CONFIG" "no GROK_CMD given after --"
GROK_ARGV=("$@")

# Work dir: a --cwd DIR inside GROK_ARGV, else the caller's own cwd.
WD="$(pwd)"
i=0
while [[ $i -lt ${#GROK_ARGV[@]} ]]; do
  if [[ "${GROK_ARGV[$i]}" == "--cwd" ]]; then
    WD="${GROK_ARGV[$((i+1))]}"
  fi
  i=$((i+1))
done

# @description Digest the working dir's git status (untracked + modified),
#   so "did grok write anything" is evidence, not grok's own narration.
# @stdout a sha256 hex digest
snap() { git -C "$WD" status --porcelain 2>/dev/null | sha256sum | cut -d' ' -f1; }

before="$(snap)"
LAST_OUT="$(mktemp -t grok-multiround-out.XXXXXX 2>/dev/null || mktemp -t grok-multiround-out)"
GENERATED_SPECS=()
# @description Remove this run's temp files (last-output capture + any
#   generated round>1 spec files) on exit, success or failure alike. Never
#   removes SPEC itself -- round 1 reuses the caller's own SPEC path
#   directly and it is never added to GENERATED_SPECS.
cleanup() { rm -f "$LAST_OUT" "${GENERATED_SPECS[@]:-}"; }
trap cleanup EXIT

round=0
while [[ $round -lt $MAX_ROUNDS ]]; do
  round=$((round+1))
  if [[ $round -eq 1 ]]; then
    ROUND_SPEC="$SPEC"
  else
    ROUND_SPEC="$(mktemp -t grok-multiround-spec.XXXXXX 2>/dev/null || mktemp -t grok-multiround-spec)"
    GENERATED_SPECS+=("$ROUND_SPEC")
    {
      printf 'PRIOR ROUND PRODUCED no file changes and only orientation narration; do NOT read first — Write the deliverable now. Prior output:\n'
      cat "$LAST_OUT" 2>/dev/null || true
      printf '\n---\n'
      cat "$SPEC"
    } > "$ROUND_SPEC"
  fi

  "${GROK_ARGV[@]}" --prompt-file "$ROUND_SPEC" >"$LAST_OUT" 2>&1 || true

  after="$(snap)"
  if [[ "$after" != "$before" ]]; then
    echo "grok-multiround: files changed (rounds=$round)"
    exit "$EXIT_OK"
  fi
done

echo "grok-multiround: EMPTY-BURST FAILED after $round rounds — grok narrated orientation but wrote nothing; re-issue a write-first spec or raise --max-rounds" >&2
exit "$EXIT_FAIL"
