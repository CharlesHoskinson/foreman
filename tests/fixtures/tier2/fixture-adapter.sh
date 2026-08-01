#!/usr/bin/env bash
# @description Return one recorded score/model observation for collector tests.
set -euo pipefail

: "${TIER2_FIXTURE_SOURCE:?TIER2_FIXTURE_SOURCE must name a recorded fixture}"

if [[ -n "${TIER2_FIXTURE_CALL_LOG:-}" ]]; then
  printf 'fixture-adapter-call\n' >> "$TIER2_FIXTURE_CALL_LOG"
fi

condition=""
spec_id=""
run_number=""
while (( $# > 0 )); do
  case "$1" in
    --condition) condition="$2"; shift 2 ;;
    --spec-id) spec_id="$2"; shift 2 ;;
    --run-number) run_number="$2"; shift 2 ;;
    --pinned-model-json) shift 2 ;;
    *) printf 'fixture adapter: unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

jq -c \
  --arg condition "$condition" \
  --arg spec_id "$spec_id" \
  --argjson run_index "$((run_number - 1))" '
    {
      score: .conditions[$condition].runs[$run_index].scores[$spec_id],
      observed_model: .conditions[$condition].runs[$run_index].observed_model,
      cost_usd: 0.1875
    }
  ' "$TIER2_FIXTURE_SOURCE"
