#!/usr/bin/env bash
# Deterministic merge gate
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: gate-eval.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
require_cmd jq; require_cmd git

for f in meta.json hashes.txt checks-result.json audit-verdict.json; do
  [[ -f "$RD/$f" ]] || die "$EXIT_CONFIG" "missing gate input: $RD/$f"
done

WT="$(jq -r .worktree "$RD/meta.json")"
ROOT="$(jq -r .repo_root "$RD/meta.json")"
BASE_SHA="$(jq -r .base_sha "$RD/meta.json")"
CONFIG="$ROOT/.foreman/config.toml"

REASONS=()

mapfile -t FORBIDDEN < <(toml_get "$CONFIG" gate.forbidden_paths $'tests/**\n.github/**\n.foreman/**\n*.lock\npackage-lock.json' 2>/dev/null || true)
if [[ ${#FORBIDDEN[@]} -eq 0 ]]; then
  FORBIDDEN=("tests/**" ".github/**" ".foreman/**" "*.lock" "package-lock.json")
fi

for g in "${FORBIDDEN[@]}"; do
  hits="$(git_nohooks -C "$WT" diff --name-only "$BASE_SHA...HEAD" -- ":(glob)$g" 2>/dev/null || true)"
  [[ -n "$hits" ]] && REASONS+=("forbidden path modified ($g): $(echo "$hits" | tr '\n' ' ')")
done

mapfile -t HASH_GLOBS < <(toml_get "$CONFIG" gate.hash_paths $'tests/**\n.github/**' 2>/dev/null || printf 'tests/**\n.github/**')
if [[ -s "$RD/hashes.txt" ]]; then
  if ! diff -q <(hash_snapshot "$WT" "${HASH_GLOBS[@]}") "$RD/hashes.txt" >/dev/null 2>&1; then
    REASONS+=("hash drift in protected files (tests/check/CI config changed since task start)")
  fi
fi

[[ "$(jq -r .status "$RD/checks-result.json")" == "pass" ]] \
  || REASONS+=("independent checks failed (exit $(jq -r .exit_code "$RD/checks-result.json"))")

if ! jq -e '.verdict | IN("APPROVED","WARNING","BLOCKED")' "$RD/audit-verdict.json" >/dev/null 2>&1; then
  REASONS+=("audit verdict missing or schema-invalid")
elif [[ "$(jq -r .verdict "$RD/audit-verdict.json")" == "BLOCKED" ]]; then
  REASONS+=("audit verdict BLOCKED")
fi

if [[ ! -f "$RD/docs-check.json" ]]; then
  REASONS+=("docs-check missing (fail closed)")
elif [[ "$(jq -r .status "$RD/docs-check.json" 2>/dev/null)" != "pass" ]]; then
  REASONS+=("docs-check failed: $(jq -r .status "$RD/docs-check.json" 2>/dev/null)")
fi

if [[ ${#REASONS[@]} -eq 0 ]]; then
  jq -n '{pass:true, reasons:[]}' > "$RD/gate-decision.json"
  log "GATE PASS ($TASK_ID)"
  exit "$EXIT_OK"
fi
jq -n --args '{pass:false, reasons:$ARGS.positional}' "${REASONS[@]}" > "$RD/gate-decision.json"
log "GATE FAIL ($TASK_ID):"; printf ' - %s\n' "${REASONS[@]}" >&2
exit "$EXIT_FAIL"
