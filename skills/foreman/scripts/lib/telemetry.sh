#!/usr/bin/env bash
# @description Decision-lineage emission helpers (S4a / decision-lineage-emission).
#   Shared by audit-run.sh, gate-eval.sh and lane-run.sh. Does NOT touch
#   eventlog.sh's frozen signature — only builds payload JSON for el_emit.
#   Observational only (D7): every caller MUST guard el_emit failures so
#   telemetry never changes a gate/round outcome.
#
#   Vendor usage-reporting status (probed 2026-07-29 on this host; also
#   recorded in references/orchestration-hardening.md):
#     grok  (0.2.114): CLI version via `grok --version`. No per-round usage
#                      object on plain/streaming-json observed in harness —
#                      record source:"unavailable" unless a usage object is
#                      found in stream.ndjson.
#     codex (0.146.0): CLI version via `codex --version`. `codex exec --json`
#                      can emit event lines that sometimes carry usage, but
#                      the default audit/worker invocation does not surface
#                      a reliable per-round cost — source:"unavailable"
#                      unless stream/session JSON yields numbers.
#     claude (2.1.x):  CLI version via `claude --version`. No harness-facing
#                      per-round usage channel today — source:"unavailable".
#   An absent figure is data, never zero.

# @description Stable finding id derived from content (file, line, severity,
#   normalised summary). Does not change the model-facing verdict schema.
# @arg $1 file  @arg $2 line  @arg $3 severity  @arg $4 summary
# @stdout 16-char hex prefix of sha256
tl_finding_id() {
  local file="${1:-}" line="${2:-0}" severity="${3:-}" summary="${4:-}"
  local norm
  # Conservative normalisation: case, whitespace, trailing punctuation.
  norm="$(printf '%s' "$summary" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -s '[:space:]' ' ' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/[[:punct:]]*$//')"
  printf '%s\0%s\0%s\0%s' "$file" "$line" "$severity" "$norm" \
    | sha256sum | awk '{print substr($1,1,16)}'
}

# @description Build a usage payload block. Numeric fields are OMITTED when
#   source is unavailable — never written as zero.
# @arg $1 vendor  @arg $2 model  @arg $3 effort (may be empty)
# @arg $4 source vendor_reported|estimated|unavailable
# @arg $5 input_tokens (empty = omit)  @arg $6 output_tokens
# @arg $7 cached_tokens  @arg $8 cost_usd
# @stdout compact JSON object
tl_usage_block() {
  local vendor="$1" model="$2" effort="${3:-}" source="$4"
  local in_tok="${5:-}" out_tok="${6:-}" cached="${7:-}" cost="${8:-}"
  case "$source" in
    vendor_reported|estimated|unavailable) ;;
    *) source="unavailable" ;;
  esac
  # Absolute rule: unavailable => numeric fields absent, never zero — even if
  # a caller accidentally passes "0" strings.
  if [[ "$source" == "unavailable" ]]; then
    in_tok=""; out_tok=""; cached=""; cost=""
  fi
  jq -cn \
    --arg vendor "$vendor" \
    --arg model "$model" \
    --arg effort "$effort" \
    --arg source "$source" \
    --arg in_tok "$in_tok" \
    --arg out_tok "$out_tok" \
    --arg cached "$cached" \
    --arg cost "$cost" \
    '{
       vendor: $vendor,
       model: $model,
       source: $source
     }
     + (if $effort == "" then {} else {effort: $effort} end)
     + (if $in_tok == "" then {} else {input_tokens: ($in_tok|tonumber)} end)
     + (if $out_tok == "" then {} else {output_tokens: ($out_tok|tonumber)} end)
     + (if $cached == "" then {} else {cached_tokens: ($cached|tonumber)} end)
     + (if $cost == "" then {} else {cost_usd: ($cost|tonumber)} end)' \
  | tr -d '\r'
}

# @description Probe a stream/log file for a usage-like object. Accepts common
#   shapes (OpenAI/Codex usage, nested .usage, top-level token fields).
#   Returns source:unavailable with no numerics when nothing reliable is found.
# @arg $1 path  @arg $2 vendor  @arg $3 model  @arg $4 effort
# @stdout usage JSON block
tl_usage_from_file() {
  local path="$1" vendor="$2" model="$3" effort="${4:-}"
  if [[ ! -f "$path" || ! -s "$path" ]]; then
    tl_usage_block "$vendor" "$model" "$effort" "unavailable"
    return 0
  fi
  local parsed
  parsed="$(jq -cs --arg vendor "$vendor" --arg model "$model" --arg effort "$effort" '
    def pick_num($o; $k):
      if ($o|type) == "object" and ($o[$k] != null) and (($o[$k]|type) == "number")
      then $o[$k] else empty end;
    def from_usage($u):
      {
        vendor: $vendor,
        model: $model,
        source: "vendor_reported",
        input_tokens: (pick_num($u; "input_tokens") // pick_num($u; "prompt_tokens") // pick_num($u; "inputTokens") // empty),
        output_tokens: (pick_num($u; "output_tokens") // pick_num($u; "completion_tokens") // pick_num($u; "outputTokens") // empty),
        cached_tokens: (pick_num($u; "cached_tokens") // pick_num($u; "cache_read_input_tokens") // pick_num($u; "cachedTokens") // empty),
        cost_usd: (pick_num($u; "cost_usd") // pick_num($u; "total_cost_usd") // pick_num($u; "cost") // empty)
      }
      | if $effort != "" then . + {effort: $effort} else . end
      | with_entries(select(.value != null));
    [ .[]
      | objects
      | (if .usage then from_usage(.usage)
         elif .response.usage then from_usage(.response.usage)
         elif .token_usage then from_usage(.token_usage)
         elif ((.input_tokens != null) or (.prompt_tokens != null)) then from_usage(.)
         else empty end)
    ] | if length == 0 then
          {vendor:$vendor, model:$model, source:"unavailable"}
          + (if $effort == "" then {} else {effort:$effort} end)
        else .[-1] end
  ' "$path" 2>/dev/null | tr -d '\r')" || parsed=""
  if [[ -z "$parsed" ]]; then
    tl_usage_block "$vendor" "$model" "$effort" "unavailable"
  else
    printf '%s\n' "$parsed"
  fi
}

# @description CLI-reported version string for a vendor, or empty if unknown.
# @arg $1 vendor
# @stdout version string (single line, trimmed)
tl_cli_version() {
  local vendor="$1" out=""
  case "$vendor" in
    grok)
      out="$(timeout 15 grok --version 2>/dev/null | head -1 | tr -d '\r')" || out=""
      ;;
    codex)
      out="$(timeout 15 codex --version 2>/dev/null | head -1 | tr -d '\r')" || out=""
      ;;
    claude)
      out="$(timeout 15 claude --version 2>/dev/null | head -1 | tr -d '\r')" || out=""
      ;;
    *) out="" ;;
  esac
  printf '%s' "$out"
}

# @description Requested model alias for a vendor from env overrides / defaults.
#   Never scrapes a command string.
# @arg $1 vendor
# @stdout alias string
tl_requested_alias() {
  local vendor="$1"
  case "$vendor" in
    grok)  printf '%s' "${LANE_MODEL:-${WC_GROK_MODEL:-grok-4.5}}" ;;
    codex) printf '%s' "${LANE_MODEL:-${WC_CODEX_MODEL:-gpt-5.6-sol}}" ;;
    claude) printf '%s' "${LANE_MODEL:-${WC_CLAUDE_MODEL:-}}" ;;
    *)     printf '%s' "${LANE_MODEL:-}" ;;
  esac
}

# @description Model-identity object for round-start (requested alias ≠ CLI version).
# @arg $1 vendor
# @stdout compact JSON
tl_model_identity() {
  local vendor="${1:-}"
  local alias ver
  alias="$(tl_requested_alias "$vendor")"
  ver="$(tl_cli_version "$vendor")"
  jq -cn \
    --arg vendor "$vendor" \
    --arg requested_alias "$alias" \
    --arg cli_version "$ver" \
    '{
       vendor: (if $vendor == "" then null else $vendor end),
       requested_alias: (if $requested_alias == "" then null else $requested_alias end),
       cli_version: (if $cli_version == "" then null else $cli_version end)
     }' | tr -d '\r'
}

# @description Emit a finding_outcome event (later fact; never rewrites the
#   original finding event). Callers must guard el_emit.
# @arg $1 run  @arg $2 lane  @arg $3 finding_id  @arg $4 upheld true|false
# @arg $5 reason (optional)
# @stdout seq from el_emit on success
tl_emit_finding_outcome() {
  local run="$1" lane="$2" fid="$3" upheld="$4" reason="${5:-}"
  local payload
  payload="$(jq -cn \
    --arg id "$fid" \
    --argjson upheld "$upheld" \
    --arg reason "$reason" \
    '{finding_id:$id, upheld:$upheld}
     + (if $reason == "" then {} else {reason:$reason} end)' | tr -d '\r')"
  el_emit "$run" finding_outcome "$lane" "$payload"
}

# @description Content hash of a file for evidence reference (no file body).
# @arg $1 path
# @stdout sha256 hex or empty
tl_file_sha256() {
  local path="$1"
  [[ -f "$path" ]] || { printf ''; return 0; }
  sha256sum "$path" 2>/dev/null | awk '{print $1}'
}
