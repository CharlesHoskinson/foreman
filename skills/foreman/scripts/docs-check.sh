#!/usr/bin/env bash
# @description Fail-closed documentation and comment-quality gate: markdownlint-cli2,
#   codespell, lychee (offline by default), and bash comment-coverage. Emits a human
#   summary and optional JSON (--json PATH) for gate consumption.
# Usage: docs-check.sh [--online] [--json PATH]
# Env: DOCS_CHECK_FORCE_MISSING=tool1,tool2 forces named tool(s) missing (test hook)
# @exitcode 0 all checks pass
# @exitcode 1 findings
# @exitcode 2 required tool missing (fail closed)
set -euo pipefail

PY="$(command -v python3 || command -v python || true)"

ONLINE=0; JSON_OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --online) ONLINE=1; shift ;;
    --json) JSON_OUT="${2:?--json needs a path}"; shift 2 ;;
    *) echo "docs-check: unknown arg $1" >&2; exit 2 ;;
  esac
done

VENDORED=(skills/scrapling skills/graphify skills/superpowers docs/research sandbox FOREMAN_REPORT.md FOREMAN_REPORT.json node_modules)

# DOCS_CHECK_FORCE_MISSING=tool1,tool2 — test hook: force named tool(s) to
# resolve as missing regardless of PATH (used by tests/docs-check.bats to
# exercise the fail-closed exit-2 path deterministically).
IFS=',' read -ra _FORCE_MISSING <<< "${DOCS_CHECK_FORCE_MISSING:-}"
# @description Return success when a tool key is forced missing by the test hook.
# @arg $1 tool key
forced_missing() {
  local t
  for t in "${_FORCE_MISSING[@]:-}"; do [[ "$t" == "$1" ]] && return 0; done
  return 1
}

declare -A T_STATUS T_FINDINGS
FAIL=0; MISSING=0

# @description Record one tool result.
# @arg $1 tool key
# @arg $2 status pass|fail|missing
# @arg $3 finding count
record() { T_STATUS[$1]="$2"; T_FINDINGS[$1]="${3:-0}"; [[ "$2" == fail ]] && FAIL=1; [[ "$2" == missing ]] && MISSING=1; return 0; }

# markdownlint-cli2 — config supplies ignores
if ! forced_missing markdownlint && command -v markdownlint-cli2 >/dev/null 2>&1; then
  if OUT=$(markdownlint-cli2 "**/*.md" 2>&1); then record markdownlint pass 0
  else record markdownlint fail "$(grep -c ':' <<<"$OUT" || true)"; echo "$OUT" | tail -20; fi
else record markdownlint missing; fi

# codespell — .codespellrc supplies skip list
CODESPELL_CMD=""
if ! forced_missing codespell; then
  if command -v codespell >/dev/null 2>&1; then
    CODESPELL_CMD="codespell"
  elif command -v python3 >/dev/null 2>&1 && python3 -m codespell_lib --version >/dev/null 2>&1; then
    CODESPELL_CMD="python3 -m codespell_lib"
  elif command -v python >/dev/null 2>&1 && python -m codespell_lib --version >/dev/null 2>&1; then
    CODESPELL_CMD="python -m codespell_lib"
  fi
fi
if [[ -n "$CODESPELL_CMD" ]]; then
  if OUT=$($CODESPELL_CMD 2>&1); then record codespell pass 0
  else record codespell fail "$(wc -l <<<"$OUT")"; echo "$OUT" | tail -20; fi
else
  record codespell missing
fi

# lychee — offline unless --online
LYCHEE_CMD=""
if ! forced_missing lychee; then
  LYCHEE_CMD="${LYCHEE:-$(command -v lychee || true)}"
  if [[ -z "$LYCHEE_CMD" && -x "${LOCALAPPDATA:-}/Microsoft/WinGet/Links/lychee.exe" ]]; then
    LYCHEE_CMD="${LOCALAPPDATA:-}/Microsoft/WinGet/Links/lychee.exe"
  fi
  if [[ -z "$LYCHEE_CMD" ]]; then
    # shellcheck disable=SC2012 # globbed package layout is intentionally resolved by ls
    LYCHEE_CMD="$(ls "${LOCALAPPDATA:-}"/Microsoft/WinGet/Packages/lycheeverse.lychee*/*/lychee.exe 2>/dev/null | head -1 || true)"
  fi
fi
if [[ -n "$LYCHEE_CMD" ]]; then
  LARGS=(--no-progress); [[ "$ONLINE" -eq 0 ]] && LARGS+=(--offline)
  MAPFILE=(); while IFS= read -r f; do
    skip=0; for v in "${VENDORED[@]}"; do [[ "$f" == "$v"* ]] && skip=1; done
    [[ $skip -eq 0 ]] && MAPFILE+=("$f")
  done < <(git ls-files '*.md' '*.html' 2>/dev/null || find . -name '*.md' -o -name '*.html')
  if OUT=$("$LYCHEE_CMD" "${LARGS[@]}" "${MAPFILE[@]}" 2>&1); then record lychee pass 0
  else record lychee fail "$(grep -c 'ERROR\|✗' <<<"$OUT" || true)"; echo "$OUT" | tail -20; fi
else record lychee missing; fi

# comment coverage over scripts/**/*.sh (repo-relative; excludes vendored)
COV_FINDINGS=0
while IFS= read -r f; do
  skip=0; for v in "${VENDORED[@]}"; do [[ "$f" == "$v"* ]] && skip=1; done
  [[ $skip -eq 1 ]] && continue
  # top-of-file purpose comment within first 5 non-shebang lines
  if ! awk 'NR<=6 && /^#/ && !/^#!/ {found=1} END{exit !found}' "$f"; then
    echo "missing purpose header: $f"; COV_FINDINGS=$((COV_FINDINGS+1))
  fi
  # every function preceded by a comment block containing @description
  while IFS= read -r line; do
    echo "undocumented function: $f: $line"; COV_FINDINGS=$((COV_FINDINGS+1))
  done < <(awk '
    /^#/ { if ($0 ~ /@description/) doc=1; next }
    /^[[:space:]]*$/ { next }
    /^(function[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(\)/ {
      if (!doc) print FNR": "$0
      doc=0; next
    }
    { doc=0 }
  ' "$f")
done < <(find . -path ./.git -prune -o -path ./.claude -prune -o -path ./openspec/changes/archive -prune -o -name '*.sh' -print | sed 's|^\./||')
if [[ "$COV_FINDINGS" -gt 0 ]]; then record comments fail "$COV_FINDINGS"; else record comments pass 0; fi

# JSON output
if [[ -n "$JSON_OUT" ]]; then
  if [[ -z "$PY" ]]; then
    echo "docs-check: python3 or python is required for --json output" >&2
    exit 2
  fi
  "$PY" - "$JSON_OUT" <<PY
import json, sys
tools = {
  "markdownlint": {"status": "${T_STATUS[markdownlint]:-missing}", "findings": ${T_FINDINGS[markdownlint]:-0}},
  "codespell":    {"status": "${T_STATUS[codespell]:-missing}",    "findings": ${T_FINDINGS[codespell]:-0}},
  "lychee":       {"status": "${T_STATUS[lychee]:-missing}",       "findings": ${T_FINDINGS[lychee]:-0}},
  "comments":     {"status": "${T_STATUS[comments]:-missing}",     "findings": ${T_FINDINGS[comments]:-0}},
}
status = "pass" if all(t["status"] == "pass" for t in tools.values()) else "fail"
json.dump({"schema": "foreman.docs-check.v1", "status": status, "tools": tools}, open(sys.argv[1], "w"), indent=2)
PY
fi

echo "docs-check: markdownlint=${T_STATUS[markdownlint]:-?} codespell=${T_STATUS[codespell]:-?} lychee=${T_STATUS[lychee]:-?} comments=${T_STATUS[comments]:-?}"
[[ "$MISSING" -eq 1 ]] && exit 2
[[ "$FAIL" -eq 1 ]] && exit 1
exit 0
