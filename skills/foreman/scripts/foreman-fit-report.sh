#!/usr/bin/env bash
# @description Read the architect-kept fit ledger ($RD/fit.jsonl) and print a
#   discovery-vs-offload split with a poor-fit verdict. Does NOT read the
#   event log: agent-dispatched discovery lanes emit zero el_emit entries, so
#   an event-log reader would mis-report a discovery-heavy run as good fit.
# Usage: foreman-fit-report.sh RUN_ID
# @stdout one line:
#   foreman-fit report RUN_ID=<id> discovery=<d> offload=<o> offload_fraction=<p>% fit_verdict=<good|poor>
# @stderr on missing ledger: foreman-fit-report: no fit ledger for <RUN_ID>
# @stderr on missing jq:
#   foreman-fit-report: jq is required to read the fit ledger (see dependencies/README.md)
# @stderr on malformed record:
#   foreman-fit-report: malformed ledger record at line <n>: <reason>
# @exitcode 0 report printed
# @exitcode non-zero missing ledger, missing jq, malformed record, or usage error
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

RUN_ID="${1:?usage: foreman-fit-report.sh RUN_ID}"

if ! command -v jq >/dev/null 2>&1; then
  printf 'foreman-fit-report: jq is required to read the fit ledger (see dependencies/README.md)\n' >&2
  exit 1
fi

RD="$(run_dir "$RUN_ID")"
LEDGER="$RD/fit.jsonl"

if [[ ! -f "$LEDGER" ]]; then
  printf 'foreman-fit-report: no fit ledger for %s\n' "$RUN_ID" >&2
  exit 1
fi

# @description Refuse the whole report, naming the offending ledger line.
#   Refusal rather than a silent skip is deliberate: dropping an unreadable
#   record inflates the verdict, and a ledger that was five-sixths discovery
#   once reported fit_verdict=good because bad records were silently dropped.
# @arg $1 line_no 1-based line number of the offending record
# @arg $2 reason short cause, e.g. "unrecognised phase" or "invalid weight"
# @stderr the refusal message naming the line and reason
# @exitcode 1 always — the caller must not continue with a partial tally
malformed() {
  local line_no="$1" reason="$2"
  printf 'foreman-fit-report: malformed ledger record at line %s: %s\n' \
    "$line_no" "$reason" >&2
  exit 1
}

# Tally weight (default 1) by phase: discover → discovery, implement → offload.
# estimate records are ignored for the totals but remain valid. jq is required
# (nested objects cannot be parsed correctly by regex).
discovery=0
offload=0
line_no=0

while IFS= read -r line || [[ -n "$line" ]]; do
  line_no=$((line_no + 1))
  # Strip a trailing CR (Windows-edited ledgers).
  line="${line//$'\r'/}"
  [[ -z "$line" ]] && continue

  # Parse one object; suppress raw jq diagnostics and emit our own.
  # Phase enum is classified in bash (case + default) so an unrecognised
  # phase can never fall through silently if the filter drifts.
  parsed="$(printf '%s\n' "$line" | jq -c \
    'if type != "object" then
       ["err","invalid JSON"]
     elif (has("phase") | not) or .phase == null then
       ["err","missing phase"]
     elif (.phase | type) != "string" then
       ["err","unrecognised phase"]
     elif (has("weight") | not) then
       ["ok", .phase, 1]
     elif (.weight | type) != "number" then
       ["err","invalid weight"]
     elif (.weight < 0) or (.weight != (.weight | floor)) then
       ["err","invalid weight"]
     else
       ["ok", .phase, (.weight | floor)]
     end' 2>/dev/null)" || malformed "$line_no" "invalid JSON"

  # jq streams one result per top-level value. Multiple values on one NDJSON
  # line must be refused — otherwise $phase is multi-line, matches no case
  # arm, and both records are silently uncounted (discovery=0).
  result_count="$(printf '%s\n' "$parsed" | jq -s 'length')"
  if (( result_count > 1 )); then
    malformed "$line_no" "multiple JSON values on one line"
  fi
  if (( result_count < 1 )); then
    malformed "$line_no" "invalid JSON"
  fi

  kind="$(printf '%s\n' "$parsed" | jq -r '.[0]')"
  if [[ "$kind" == "err" ]]; then
    reason="$(printf '%s\n' "$parsed" | jq -r '.[1]')"
    malformed "$line_no" "$reason"
  fi
  phase="$(printf '%s\n' "$parsed" | jq -r '.[1]')"
  weight="$(printf '%s\n' "$parsed" | jq -r '.[2]')"

  case "$phase" in
    discover)  discovery=$((discovery + weight)) ;;
    implement) offload=$((offload + weight)) ;;
    estimate)  ;; # counted as neither side
    *) malformed "$line_no" "unrecognised phase" ;;
  esac
done < "$LEDGER"

# Integer totals (jq may print without decimal; force base-10).
discovery=$((10#${discovery:-0}))
offload=$((10#${offload:-0}))

total=$((discovery + offload))
if (( total == 0 )); then
  frac=0
else
  # round(100 * offload / total) via integer half-up.
  frac=$(( (100 * offload + total / 2) / total ))
fi

if (( frac < 50 )); then
  verdict=poor
else
  verdict=good
fi

printf 'foreman-fit report RUN_ID=%s discovery=%s offload=%s offload_fraction=%s%% fit_verdict=%s\n' \
  "$RUN_ID" "$discovery" "$offload" "$frac" "$verdict"
