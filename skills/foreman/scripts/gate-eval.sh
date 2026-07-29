#!/usr/bin/env bash
# Deterministic merge gate
# Decision-lineage emission (S4a): emits gate_decision into the run event log.
# Telemetry is observational only — emit failure never changes pass/fail (D7).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/eventlog.sh
source "$SCRIPT_DIR/lib/eventlog.sh"
# shellcheck source=lib/telemetry.sh
source "$SCRIPT_DIR/lib/telemetry.sh"

TASK_ID="${1:?usage: gate-eval.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
require_cmd jq; require_cmd git

for f in meta.json hashes.txt checks-result.json audit-verdict.json; do
  [[ -f "$RD/$f" ]] || die "$EXIT_CONFIG" "missing gate input: $RD/$f"
done

WT="$(jq -r .worktree "$RD/meta.json")"
ROOT="$(jq -r .repo_root "$RD/meta.json")"
BASE_SHA="$(jq -r .base_sha "$RD/meta.json")"
HEAD_SHA="$(git_nohooks -C "$WT" rev-parse HEAD 2>/dev/null || echo "")"
CONFIG="$ROOT/.foreman/config.toml"
LANE="$(jq -r '.lane // "gate"' "$RD/meta.json" 2>/dev/null || echo gate)"
[[ -n "$LANE" && "$LANE" != "null" ]] || LANE="gate"

REASONS=()
INPUTS_EVALUATED=()

mapfile -t FORBIDDEN < <(toml_get "$CONFIG" gate.forbidden_paths $'tests/**\n.github/**\n.foreman/**\n*.lock\npackage-lock.json' 2>/dev/null || true)
if [[ ${#FORBIDDEN[@]} -eq 0 ]]; then
  FORBIDDEN=("tests/**" ".github/**" ".foreman/**" "*.lock" "package-lock.json")
fi

for g in "${FORBIDDEN[@]}"; do
  hits="$(git_nohooks -C "$WT" diff --name-only "$BASE_SHA...HEAD" -- ":(glob)$g" 2>/dev/null || true)"
  [[ -n "$hits" ]] && REASONS+=("forbidden path modified ($g): $(echo "$hits" | tr '\n' ' ')")
done
INPUTS_EVALUATED+=("forbidden_paths")

mapfile -t HASH_GLOBS < <(toml_get "$CONFIG" gate.hash_paths $'tests/**\n.github/**' 2>/dev/null || printf 'tests/**\n.github/**')
if [[ -s "$RD/hashes.txt" ]]; then
  if ! diff -q <(hash_snapshot "$WT" "${HASH_GLOBS[@]}") "$RD/hashes.txt" >/dev/null 2>&1; then
    REASONS+=("hash drift in protected files (tests/check/CI config changed since task start)")
  fi
fi
INPUTS_EVALUATED+=("hash_paths")

[[ "$(jq -r .status "$RD/checks-result.json")" == "pass" ]] \
  || REASONS+=("independent checks failed (exit $(jq -r .exit_code "$RD/checks-result.json"))")
INPUTS_EVALUATED+=("checks_result")

if ! jq -e '.verdict | IN("APPROVED","WARNING","BLOCKED")' "$RD/audit-verdict.json" >/dev/null 2>&1; then
  REASONS+=("audit verdict missing or schema-invalid")
elif [[ "$(jq -r .verdict "$RD/audit-verdict.json")" == "BLOCKED" ]]; then
  REASONS+=("audit verdict BLOCKED")
fi
INPUTS_EVALUATED+=("audit_verdict")

if [[ ! -f "$RD/docs-check.json" ]]; then
  REASONS+=("docs-check missing (fail closed)")
elif [[ "$(jq -r .status "$RD/docs-check.json" 2>/dev/null)" != "pass" ]]; then
  REASONS+=("docs-check failed: $(jq -r .status "$RD/docs-check.json" 2>/dev/null)")
fi
INPUTS_EVALUATED+=("docs_check")

PASS=true
if [[ ${#REASONS[@]} -ne 0 ]]; then
  PASS=false
fi

# --- decision emission (observational; never gates) -----------------------
emission_failed=false
gate_payload="$(
  if [[ ${#REASONS[@]} -eq 0 ]]; then
    jq -cn \
      --argjson pass true \
      --arg base "$BASE_SHA" \
      --arg head "$HEAD_SHA" \
      --args \
      '{
         pass: $pass,
         reasons: [],
         base: $base,
         head: $head,
         inputs_evaluated: $ARGS.positional
       }' "${INPUTS_EVALUATED[@]}"
  else
    # reasons as JSON array via --args for the reasons, then inject inputs
    reasons_json="$(jq -cn --args '$ARGS.positional' "${REASONS[@]}")"
    inputs_json="$(jq -cn --args '$ARGS.positional' "${INPUTS_EVALUATED[@]}")"
    jq -cn \
      --argjson pass false \
      --argjson reasons "$reasons_json" \
      --argjson inputs "$inputs_json" \
      --arg base "$BASE_SHA" \
      --arg head "$HEAD_SHA" \
      '{
         pass: $pass,
         reasons: $reasons,
         base: $base,
         head: $head,
         inputs_evaluated: $inputs
       }'
  fi | tr -d '\r'
)"

if ! el_emit "$TASK_ID" gate_decision "$LANE" "$gate_payload" >/dev/null; then
  emission_failed=true
  echo "gate-eval: el_emit gate_decision failed" >&2
fi

# Write gate-decision.json; record emission incompleteness in the record itself.
if [[ "$PASS" == "true" ]]; then
  if [[ "$emission_failed" == "true" ]]; then
    jq -n '{pass:true, reasons:[], emission_failed:true}' > "$RD/gate-decision.json"
  else
    jq -n '{pass:true, reasons:[]}' > "$RD/gate-decision.json"
  fi
  log "GATE PASS ($TASK_ID)"
  exit "$EXIT_OK"
fi

if [[ "$emission_failed" == "true" ]]; then
  jq -n --args '{pass:false, reasons:$ARGS.positional, emission_failed:true}' "${REASONS[@]}" > "$RD/gate-decision.json"
else
  jq -n --args '{pass:false, reasons:$ARGS.positional}' "${REASONS[@]}" > "$RD/gate-decision.json"
fi
log "GATE FAIL ($TASK_ID):"; printf ' - %s\n' "${REASONS[@]}" >&2
exit "$EXIT_FAIL"
