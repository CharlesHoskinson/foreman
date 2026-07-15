#!/usr/bin/env bash
# Foreman reference-env inventory (Linux / WSL).
# Usage: tool-check.sh [--profile soft|hard|full] [--json] [--out FILE]
set -euo pipefail

PROFILE="soft"
JSON=0
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help)
      echo "usage: tool-check.sh [--profile soft|hard|full] [--json] [--out FILE]"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOST="$(hostname 2>/dev/null || echo unknown)"
OS="$(uname -s 2>/dev/null || echo unknown)"
IS_WSL=0
grep -qi microsoft /proc/version 2>/dev/null && IS_WSL=1

have() { command -v "$1" >/dev/null 2>&1; }

check_one() {
  local id="$1" cmd="$2"
  local status="missing" detail=""
  case "$id" in
    git)
      if have git; then status=ok; detail="$(git --version 2>&1)"; else status=missing; fi
      ;;
    python3)
      if have python3; then
        detail="$(python3 --version 2>&1)"
        # require 3.11+ for tomllib
        if python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null; then
          status=ok
        else
          status=outdated
          detail="$detail (need >= 3.11)"
        fi
        python3 -c 'import tomllib' 2>/dev/null || { status=outdated; detail="$detail (tomllib missing)"; }
      elif have python; then
        detail="$(python --version 2>&1)"
        status=outdated
      else
        status=missing
      fi
      ;;
    jq)
      if have jq; then status=ok; detail="$(jq --version 2>&1)"; else status=missing; fi
      ;;
    grok)
      if have grok; then status=ok; detail="$(grok --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    codex)
      if have codex; then status=ok; detail="$(codex --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    claude)
      if have claude; then status=ok; detail="$(claude --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    node)
      if have node; then status=ok; detail="$(node --version 2>&1)"; else status=missing; fi
      ;;
    npm)
      if have npm; then status=ok; detail="$(npm --version 2>&1)"; else status=missing; fi
      ;;
    docker)
      if have docker; then
        if docker info >/dev/null 2>&1; then
          status=ok
          detail="$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker --version)"
        else
          status=degraded
          detail="docker binary present but daemon not reachable"
        fi
      else
        status=missing
      fi
      ;;
    shellcheck)
      if have shellcheck; then status=ok; detail="$(shellcheck --version 2>&1 | head -2 | tr '\n' ' ')"; else status=missing; fi
      ;;
    bats)
      if have bats; then status=ok; detail="$(bats --version 2>&1)"; else status=missing; fi
      ;;
    flock)
      if have flock; then status=ok; detail="$(command -v flock)"; else status=missing; fi
      ;;
    gh)
      if have gh; then status=ok; detail="$(gh --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    timeout)
      if have timeout || have gtimeout; then status=ok; detail="$(command -v timeout || command -v gtimeout)"; else status=missing; fi
      ;;
    foreman_skill)
      if [[ -f "${HOME}/.claude/skills/foreman/SKILL.md" ]] || [[ -f "${HOME}/.agents/skills/foreman/SKILL.md" ]] || [[ -f "${HOME}/.grok/skills/foreman/SKILL.md" ]]; then
        status=ok
        detail="skill linked under ~/.claude|agents|grok/skills/foreman"
      elif [[ -f "$ROOT/skills/foreman/SKILL.md" ]]; then
        status=degraded
        detail="repo has skill but not installed to home (run install.sh)"
      else
        status=missing
      fi
      ;;
    *)
      status=unknown
      detail="no checker for $id"
      ;;
  esac
  printf '%s\t%s\t%s\n' "$id" "$status" "$detail"
}

# profile membership
must_soft=(git python3 grok codex foreman_skill)
must_hard=(git python3 jq docker flock foreman_skill)
must_full=(git python3 jq grok codex docker flock foreman_skill)
should_soft=(claude node npm jq)
should_hard=(shellcheck bats gh timeout grok codex)
should_full=(claude node npm shellcheck bats gh timeout)

case "$PROFILE" in
  soft) must=("${must_soft[@]}"); should=("${should_soft[@]}") ;;
  hard) must=("${must_hard[@]}"); should=("${should_hard[@]}") ;;
  full) must=("${must_full[@]}"); should=("${should_full[@]}") ;;
  *) echo "bad profile: $PROFILE" >&2; exit 2 ;;
esac

declare -A SEEN=()
ROWS=()
for id in "${must[@]}" "${should[@]}"; do
  [[ -n "${SEEN[$id]:-}" ]] && continue
  SEEN[$id]=1
  ROWS+=("$(check_one "$id" "")")
done

missing=()
outdated=()
degraded=()
ok_n=0
for row in "${ROWS[@]}"; do
  id="${row%%$'\t'*}"
  rest="${row#*$'\t'}"
  st="${rest%%$'\t'*}"
  case "$st" in
    ok) ok_n=$((ok_n+1)) ;;
    missing) missing+=("$id") ;;
    outdated) outdated+=("$id") ;;
    degraded) degraded+=("$id") ;;
  esac
done

# must failures
must_fail=()
for id in "${must[@]}"; do
  for row in "${ROWS[@]}"; do
    rid="${row%%$'\t'*}"
    [[ "$rid" == "$id" ]] || continue
    rest="${row#*$'\t'}"
    st="${rest%%$'\t'*}"
    if [[ "$st" != "ok" ]]; then must_fail+=("$id:$st"); fi
  done
done

READY=0
[[ ${#must_fail[@]} -eq 0 ]] && READY=1

report_text() {
  echo "FOREMAN TOOL CHECK"
  echo "profile: $PROFILE"
  echo "host: $HOST  os: $OS  wsl: $IS_WSL"
  echo "time: $NOW"
  echo "repo: $ROOT"
  echo "---"
  printf '%-16s %-10s %s\n' "TOOL" "STATUS" "DETAIL"
  for row in "${ROWS[@]}"; do
    id="${row%%$'\t'*}"
    rest="${row#*$'\t'}"
    st="${rest%%$'\t'*}"
    det="${rest#*$'\t'}"
    printf '%-16s %-10s %s\n' "$id" "$st" "$det"
  done
  echo "---"
  if [[ $READY -eq 1 ]]; then
    echo "READY: yes — profile '$PROFILE' must-tools are OK"
  else
    echo "READY: no — fix must-tools before implementation work"
    echo "MUST_FAIL: ${must_fail[*]}"
  fi
  [[ ${#missing[@]} -gt 0 ]] && echo "MISSING: ${missing[*]}"
  [[ ${#outdated[@]} -gt 0 ]] && echo "OUTDATED: ${outdated[*]}"
  [[ ${#degraded[@]} -gt 0 ]] && echo "DEGRADED: ${degraded[*]}"
  echo "---"
  echo "NEXT:"
  if [[ $READY -eq 0 ]]; then
    echo "  bash env/bootstrap-wsl.sh --profile $PROFILE"
    echo "  # then re-run: bash env/tool-check.sh --profile $PROFILE"
  else
    echo "  proceed with /foreman soft or hard implementation"
  fi
}

report_json() {
  python3 - "$PROFILE" "$HOST" "$OS" "$IS_WSL" "$NOW" "$ROOT" "$READY" "${ROWS[@]}" <<'PY'
import json, sys
profile, host, os_, is_wsl, now, root, ready = sys.argv[1:8]
rows = sys.argv[8:]
tools = []
for row in rows:
    parts = row.split("\t", 2)
    tid = parts[0]
    st = parts[1] if len(parts) > 1 else "unknown"
    det = parts[2] if len(parts) > 2 else ""
    tools.append({"id": tid, "status": st, "detail": det})
out = {
    "schema": "foreman.tool-check.v1",
    "profile": profile,
    "ready": ready == "1",
    "host": host,
    "os": os_,
    "wsl": is_wsl == "1",
    "time": now,
    "repo": root,
    "tools": tools,
    "missing": [t["id"] for t in tools if t["status"] == "missing"],
    "outdated": [t["id"] for t in tools if t["status"] == "outdated"],
    "degraded": [t["id"] for t in tools if t["status"] == "degraded"],
}
print(json.dumps(out, indent=2))
PY
}

if [[ $JSON -eq 1 ]]; then
  BODY="$(report_json)"
else
  BODY="$(report_text)"
fi

echo "$BODY"
if [[ -n "$OUT" ]]; then
  mkdir -p "$(dirname "$OUT")"
  printf '%s\n' "$BODY" > "$OUT"
  echo "[tool-check] wrote $OUT" >&2
fi

exit $((1 - READY))
