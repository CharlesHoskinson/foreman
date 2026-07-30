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
# shellcheck source=lib/evidence.sh
source "$SCRIPT_DIR/lib/evidence.sh"
# shellcheck source=lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"

TASK_ID="${1:?usage: gate-eval.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
require_cmd jq; require_cmd git

for f in meta.json hashes.txt checks-result.json; do
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

FOREMAN_CONFIG="$CONFIG"
cfg_load
WARNING_LOW_POLICY="$(cfg_get audit.policy warning_low_resolved merge)"
WARNING_MEDIUM_POLICY="$(cfg_get audit.policy warning_medium ask)"
BLOCKED_POLICY="$(cfg_get audit.policy blocked never)"
UNVERIFIED_POLICY="$(cfg_get audit.policy unverified retry)"

CURRENT_DIFF_SHA=""
CURRENT_DIFF_VALID=false
if CURRENT_DIFF_SHA="$(tl_diff_sha256 "$WT" "$BASE_SHA")"; then
  CURRENT_DIFF_VALID=true
else
  REASONS+=("gate diff hash computation failed (cannot bind gate inputs)")
fi

CURRENT_TREE_SHA=""
CURRENT_TREE_VALID=false
tree_tmp="$(mktemp)"
if evidence_tree_sha256 "$WT" >"$tree_tmp"; then
  CURRENT_TREE_SHA="$(<"$tree_tmp")"
  CURRENT_TREE_VALID=true
  rm -f "$tree_tmp"
else
  tree_reason="${EVIDENCE_REASON:-tree-identity-uncomputable}"
  rm -f "$tree_tmp"
  REASONS+=("gate evaluated-tree identity computation failed ($tree_reason)")
fi

CURRENT_ATTEMPT=""
CURRENT_ATTEMPT_VALID=false
if [[ -r "$RD/audit-attempt.current" ]]; then
  CURRENT_ATTEMPT="$(<"$RD/audit-attempt.current")"
  if [[ "$CURRENT_ATTEMPT" =~ ^[0-9]+$ ]]; then
    CURRENT_ATTEMPT_VALID=true
  fi
fi
if [[ "$CURRENT_ATTEMPT_VALID" != "true" ]]; then
  REASONS+=("audit current attempt id computation failed (audit-attempt.current missing or malformed)")
fi

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

checks_status="$(jq -r '.status // empty' "$RD/checks-result.json" 2>/dev/null || true)"
checks_exit="$(jq -r '.exit_code // "unknown"' "$RD/checks-result.json" 2>/dev/null || echo unknown)"
checks_diff="$(jq -r '.diff_sha256 // empty' "$RD/checks-result.json" 2>/dev/null || true)"
checks_tree="$(jq -r '.tree_sha256 // empty' "$RD/checks-result.json" 2>/dev/null || true)"
if [[ "$checks_status" != "pass" ]]; then
  REASONS+=("independent checks failed (exit $checks_exit)")
fi
if [[ "$CURRENT_DIFF_VALID" == "true" && "$checks_diff" != "$CURRENT_DIFF_SHA" ]]; then
  REASONS+=("checks-result diff hash mismatch (stale independent-checks artifact)")
fi
if [[ "$CURRENT_TREE_VALID" == "true" && "$checks_tree" != "$CURRENT_TREE_SHA" ]]; then
  REASONS+=("checks-result evaluated-tree mismatch (stale independent-checks artifact)")
fi
INPUTS_EVALUATED+=("checks_result")

AUDIT_VALID=false
if jq -e \
  'type == "object"
   and (.verdict | IN("APPROVED","WARNING","BLOCKED","UNVERIFIED"))' \
  "$RD/audit-verdict.json" >/dev/null 2>&1; then
  AUDIT_VALID=true
fi
if [[ "$AUDIT_VALID" != "true" ]]; then
  REASONS+=("audit verdict missing or schema-invalid")
else
  audit_diff="$(jq -r '.evidence.diff_sha256 // empty' "$RD/audit-verdict.json")"
  audit_tree="$(jq -r '.evidence.tree_sha256 // empty' "$RD/audit-verdict.json")"
  audit_attempt="$(jq -r '.evidence.attempt // empty' "$RD/audit-verdict.json")"
  audit_state="$(jq -r '.state // empty' "$RD/audit-verdict.json")"
  if [[ "$CURRENT_DIFF_VALID" == "true" && "$audit_diff" != "$CURRENT_DIFF_SHA" ]]; then
    REASONS+=("audit verdict diff hash mismatch (stale verdict for a different diff)")
  fi
  if [[ "$CURRENT_TREE_VALID" == "true" && "$audit_tree" != "$CURRENT_TREE_SHA" ]]; then
    REASONS+=("audit verdict evaluated-tree mismatch (worktree changed since the audit ran)")
  fi
  if [[ "$CURRENT_ATTEMPT_VALID" == "true" ]] \
    && { [[ ! "$audit_attempt" =~ ^[0-9]+$ ]] || (( 10#$audit_attempt != 10#$CURRENT_ATTEMPT )); }; then
    REASONS+=("audit verdict attempt superseded or unfinished (a fresher or still-running audit exists)")
  fi
  if [[ "$audit_state" != "complete" ]]; then
    REASONS+=("audit verdict incomplete (state is not complete)")
  fi

  AUDIT_VERDICT="$(jq -r .verdict "$RD/audit-verdict.json")"
  case "$AUDIT_VERDICT" in
    APPROVED)
      :
      ;;
    WARNING)
      warning_has_higher="$(
        jq -r '[.findings[]? | (.severity // "unknown")] | any(. != "low")' \
          "$RD/audit-verdict.json" 2>/dev/null || echo true
      )"
      warning_policy="$WARNING_LOW_POLICY"
      warning_selector='.findings[]?'
      if [[ "$warning_has_higher" == "true" ]]; then
        warning_policy="$WARNING_MEDIUM_POLICY"
        warning_selector='.findings[]? | select((.severity // "unknown") != "low")'
      fi
      if [[ "$warning_policy" != "merge" ]]; then
        mapfile -t warning_findings < <(
          jq -r "$warning_selector |
            \"\\(.severity // \"unknown\") \\(.file // \"<unknown>\"):\\(.line // 0) \\(.summary // \"<no summary>\")\"" \
            "$RD/audit-verdict.json" 2>/dev/null
        )
        if [[ ${#warning_findings[@]} -eq 0 ]]; then
          REASONS+=("audit WARNING unresolved findings (policy: $warning_policy)")
        else
          for finding in "${warning_findings[@]}"; do
            REASONS+=("audit WARNING unresolved finding ($finding; policy: $warning_policy)")
          done
        fi
      fi
      ;;
    BLOCKED)
      if [[ "$BLOCKED_POLICY" != "merge" ]]; then
        REASONS+=("audit verdict BLOCKED (policy: $BLOCKED_POLICY)")
      fi
      ;;
    UNVERIFIED)
      audit_unverified_reason="$(jq -r '.reason // "unspecified"' "$RD/audit-verdict.json")"
      REASONS+=("audit verdict UNVERIFIED (reason: $audit_unverified_reason; policy: $UNVERIFIED_POLICY)")
      ;;
  esac
fi
INPUTS_EVALUATED+=("audit_verdict")

if [[ -f "$RD/task-state.json" ]] \
  && [[ "$(jq -r '.state // empty' "$RD/task-state.json" 2>/dev/null || true)" == "Abandoned" ]]; then
  task_state_reason="$(
    jq -r '.reason // "audit_attempts_exhausted"' "$RD/task-state.json" 2>/dev/null \
      || echo audit_attempts_exhausted
  )"
  REASONS+=("task state Abandoned ($task_state_reason)")
fi
INPUTS_EVALUATED+=("task_state")

if [[ ! -f "$RD/docs-check.json" ]]; then
  REASONS+=("docs-check missing (fail closed)")
else
  docs_status="$(jq -r '.status // empty' "$RD/docs-check.json" 2>/dev/null || true)"
  docs_diff="$(jq -r '.diff_sha256 // empty' "$RD/docs-check.json" 2>/dev/null || true)"
  docs_tree="$(jq -r '.tree_sha256 // empty' "$RD/docs-check.json" 2>/dev/null || true)"
  if [[ "$docs_status" != "pass" ]]; then
    REASONS+=("docs-check failed: ${docs_status:-invalid}")
  fi
  if [[ "$CURRENT_DIFF_VALID" == "true" && "$docs_diff" != "$CURRENT_DIFF_SHA" ]]; then
    REASONS+=("docs-check diff hash mismatch (stale docs-check artifact)")
  fi
  if [[ "$CURRENT_TREE_VALID" == "true" && "$docs_tree" != "$CURRENT_TREE_SHA" ]]; then
    REASONS+=("docs-check evaluated-tree mismatch (stale docs-check artifact)")
  fi
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
