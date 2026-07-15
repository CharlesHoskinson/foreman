#!/usr/bin/env bash
# @description Durable-lanes environment preflight: the single list of durable
#   dependencies and their verification. Exits 3 if any required dep is missing.
# Usage: durable-preflight.sh [--json] [--require EXTRA_ID ...]
set -euo pipefail

# @description Check one dependency; print "OK <id>" or "MISSING <id> -- <hint>".
# @arg $1 id  @arg $2 check command  @arg $3 install hint
# @exitcode 0 present, 1 missing
dp_one() {
  local id="$1" check="$2" hint="$3"
  if bash -c "$check" >/dev/null 2>&1; then printf 'OK %s\n' "$id"; return 0
  else printf 'MISSING %s -- %s\n' "$id" "$hint"; return 1; fi
}

# @description Verify all durable deps. Sets DP_MISSING to the count of missing required.
# @stdout one status line per dependency
dp_verify() {
  local json="${1:-}"; DP_MISSING=0
  # id | check | hint | required(1/0)
  local rows=(
    "git|git --version|install git|1"
    "jq|jq --version|install jq|1"
    "coreutils|stdbuf --version || gstdbuf --version|install coreutils|1"
    "bash|bash --version|install bash|1"
    "nats-server|nats-server --version|scoop install main/nats-server (or binaries.nats.dev)|0"
    "nats-cli|nats --version|scoop install extras/natscli|0"
  )
  for extra in "${DP_EXTRA[@]:-}"; do [[ -n "$extra" ]] && rows+=("$extra|command -v $extra|install $extra|1"); done
  for r in "${rows[@]}"; do
    IFS='|' read -r id check hint req <<<"$r"
    if ! dp_one "$id" "$check" "$hint"; then
      if [[ "$req" == 1 ]]; then
        DP_MISSING=$((DP_MISSING+1))
      fi
    fi
  done
}

# @description CLI entry point: parse args, run dp_verify, print table/JSON, exit 3 if any required dep is missing.
# @arg $@ [--json] [--require EXTRA_ID ...]
main() {
  local json="" ; DP_EXTRA=()
  while [[ $# -gt 0 ]]; do case "$1" in
    --json) json=1; shift;;
    --require)
      if [[ ! "${2:-}" =~ ^[A-Za-z0-9_.-]+$ ]]; then
        printf 'error: invalid --require id: %s\n' "${2:-}" >&2
        exit 2
      fi
      DP_EXTRA+=("$2"); shift 2;;
    *) shift;;
  esac; done
  local tmp out; tmp="$(mktemp)"
  dp_verify >"$tmp" || true
  out="$(<"$tmp")"
  rm -f "$tmp"
  if [[ -n "$json" ]]; then
    printf '%s\n' "$out" | jq -R . | jq -s '{deps: [.[] | {status:(split(" ")[0]), id:(split(" ")[1])}], missing_required: '"${DP_MISSING:-0}"'}'
  else printf '%s\n' "$out"; fi
  [[ "${DP_MISSING:-0}" -eq 0 ]] || exit 3
}
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
