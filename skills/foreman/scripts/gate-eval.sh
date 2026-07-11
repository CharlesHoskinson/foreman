#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: gate-eval.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
require_cmd jq; require_cmd git; require_cmd python3

for f in meta.json hashes.txt checks-result.json audit-verdict.json; do
  [[ -f "$RD/$f" ]] || die "$EXIT_CONFIG" "missing gate input: $RD/$f"
done

WT="$(jq -r .worktree "$RD/meta.json")"
ROOT="$(jq -r .repo_root "$RD/meta.json")"
BASE_SHA="$(jq -r .base_sha "$RD/meta.json")"
CONFIG="$ROOT/.foreman/config.toml"

REASONS=()

# 1. Forbidden paths in the committed diff (spec §6.6, §7 S3).
mapfile -t FORBIDDEN < <(toml_get "$CONFIG" gate.forbidden_paths 'tests/**
.github/**
.foreman/**
**/*.lock
**/package-lock.json
**/package.json
**/pyproject.toml')
for g in "${FORBIDDEN[@]}"; do
  hits="$(git_nohooks -C "$WT" diff --name-only "$BASE_SHA...HEAD" -- ":(glob)$g")"
  [[ -n "$hits" ]] && REASONS+=("forbidden path modified ($g): $(echo "$hits" | tr '\n' ' ')")
done

# 2. Hash drift on protected files, including uncommitted tampering (spec §7 S3).
mapfile -t HASH_GLOBS < <(toml_get "$CONFIG" gate.hash_paths 'tests/**
.github/**
**/package.json
**/pyproject.toml')
if ! diff -q <(hash_snapshot "$WT" "${HASH_GLOBS[@]}") "$RD/hashes.txt" >/dev/null; then
  REASONS+=("hash drift in protected files (tests/check/CI config changed since task start)")
fi

# 3. Independent checks must be green (spec §6.4).
CHECKS_STATUS="$(jq -r .status "$RD/checks-result.json")" \
  || die "$EXIT_CONFIG" "checks-result.json is not valid JSON"
if [[ "$CHECKS_STATUS" != "pass" ]]; then
  CHECKS_EXIT="$(jq -r .exit_code "$RD/checks-result.json")" \
    || die "$EXIT_CONFIG" "checks-result.json is not valid JSON"
  REASONS+=("independent checks failed (exit $CHECKS_EXIT)")
fi

# 4. Audit verdict: schema-valid and not BLOCKED (spec §6.5–6.6).
if ! jq -e '.verdict | IN("APPROVED","WARNING","BLOCKED")' "$RD/audit-verdict.json" >/dev/null 2>&1; then
  REASONS+=("audit verdict missing or schema-invalid")
elif [[ "$(jq -r .verdict "$RD/audit-verdict.json")" == "BLOCKED" ]]; then
  REASONS+=("audit verdict BLOCKED")
fi

if [[ ${#REASONS[@]} -eq 0 ]]; then
  jq -n '{pass:true, reasons:[]}' > "$RD/gate-decision.json"
  log "GATE PASS ($TASK_ID)"
  exit "$EXIT_OK"
fi
jq -n --args '{pass:false, reasons:$ARGS.positional}' "${REASONS[@]}" > "$RD/gate-decision.json"
log "GATE FAIL ($TASK_ID):"; printf ' - %s\n' "${REASONS[@]}" >&2
exit "$EXIT_FAIL"
