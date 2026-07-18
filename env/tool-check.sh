#!/usr/bin/env bash
# Foreman reference-env inventory (Linux / WSL).
# Usage: tool-check.sh [--profile soft|hard|full|durable] [--json] [--out FILE]
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
      echo "usage: tool-check.sh [--profile soft|hard|full|durable] [--json] [--out FILE]"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMON_SKILLS_ROOT=""
common_dir="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$common_dir" && -d "$(dirname "$common_dir")/skills" ]]; then
  COMMON_SKILLS_ROOT="$(cd "$(dirname "$common_dir")/skills" && pwd -P)"
fi
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOST="$(hostname 2>/dev/null || echo unknown)"
OS="$(uname -s 2>/dev/null || echo unknown)"
IS_WSL=0
grep -qi microsoft /proc/version 2>/dev/null && IS_WSL=1

# @description Test whether an executable is available on PATH.
# @arg $1 command executable name to resolve
# @exitcode 0 if the executable is available; nonzero otherwise
have() { command -v "$1" >/dev/null 2>&1; }

# @description Inspect one known Foreman dependency and emit its availability status and version detail.
# @arg $1 id tool identifier selecting the dependency-specific check
# @arg $2 cmd reserved command field; currently unused by the checks
# @stdout one tab-separated tool, status, and detail row
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
    coreutils)
      if have stdbuf; then status=ok; detail="$(stdbuf --version 2>&1 | head -1)"
      elif have gstdbuf; then status=ok; detail="$(gstdbuf --version 2>&1 | head -1)"
      else status=missing; fi
      ;;
    bash)
      if have bash; then status=ok; detail="$(bash --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    nats-server)
      if have nats-server; then status=ok; detail="$(nats-server --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    nats-cli)
      if have nats; then status=ok; detail="$(nats --version 2>&1 | head -1)"; else status=missing; fi
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
      if have bats; then
        status=ok; detail="$(bats --version 2>&1)"
      elif [[ -x "$HOME/.foreman/tools/bats-core/bin/bats" ]]; then
        status=ok; detail="$($HOME/.foreman/tools/bats-core/bin/bats --version 2>&1)"
      else
        status=missing
      fi
      ;;
    markdownlint-cli2)
      if have markdownlint-cli2; then status=ok; detail="$(markdownlint-cli2 --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    codespell)
      if have codespell && codespell --version >/dev/null 2>&1; then
        status=ok; detail="$(codespell --version 2>&1 | head -1)"
      elif have python3 && python3 -m codespell_lib --version >/dev/null 2>&1; then
        status=ok; detail="python3 -m codespell_lib $(python3 -m codespell_lib --version 2>&1 | head -1)"
      elif have python && python -m codespell_lib --version >/dev/null 2>&1; then
        status=ok; detail="python -m codespell_lib $(python -m codespell_lib --version 2>&1 | head -1)"
      else
        status=missing
      fi
      ;;
    bun)
      if have bun; then
        detail="$(bun --version 2>&1 | head -1)"
        if [[ "$detail" == "1.3.14" ]]; then
          status=ok
        else
          status=outdated
          detail="$detail (expected 1.3.14 pin; winget does not self-pin)"
        fi
      else
        status=missing
      fi
      ;;
    pueue)
      if have pueue; then
        status=ok; detail="$(pueue --version 2>&1 | head -1)"
      elif [[ -x "$HOME/.foreman/tools/pueue/pueue.exe" ]]; then
        status=ok; detail="$("$HOME/.foreman/tools/pueue/pueue.exe" --version 2>&1 | head -1)"
      else
        status=missing
      fi
      ;;
    lychee)
      local LYCHEE_CMD
      LYCHEE_CMD="${LYCHEE:-$(command -v lychee || true)}"
      if [[ -z "$LYCHEE_CMD" && -x "${LOCALAPPDATA:-}/Microsoft/WinGet/Links/lychee.exe" ]]; then
        LYCHEE_CMD="${LOCALAPPDATA:-}/Microsoft/WinGet/Links/lychee.exe"
      fi
      if [[ -z "$LYCHEE_CMD" ]]; then
        LYCHEE_CMD="$(ls "${LOCALAPPDATA:-}"/Microsoft/WinGet/Packages/lycheeverse.lychee*/*/lychee.exe 2>/dev/null | head -1 || true)"
      fi
      if [[ -n "$LYCHEE_CMD" ]] && "$LYCHEE_CMD" --version >/dev/null 2>&1; then
        status=ok; detail="$("$LYCHEE_CMD" --version 2>&1 | head -1)"
      else
        status=missing
      fi
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
must_durable=(git jq coreutils bash)
should_soft=(claude node npm jq markdownlint-cli2 codespell lychee)
should_hard=(shellcheck bats gh timeout grok codex)
should_full=(claude node npm shellcheck bats gh timeout markdownlint-cli2 codespell lychee bun pueue)
should_durable=(nats-server nats-cli)

case "$PROFILE" in
  soft) must=("${must_soft[@]}"); should=("${should_soft[@]}") ;;
  hard) must=("${must_hard[@]}"); should=("${should_hard[@]}") ;;
  full) must=("${must_full[@]}"); should=("${should_full[@]}") ;;
  durable) must=("${must_durable[@]}"); should=("${should_durable[@]}") ;;
  *) echo "bad profile: $PROFILE" >&2; exit 2 ;;
esac

declare -A SEEN=()
ROWS=()
for id in "${must[@]}" "${should[@]}"; do
  [[ -n "${SEEN[$id]:-}" ]] && continue
  SEEN[$id]=1
  ROWS+=("$(check_one "$id" "")")
done

SKILL_IDS=(foreman scrapling graphify superpowers)
SKILL_ROWS=()
for id in "${SKILL_IDS[@]}"; do
  skill_path="${HOME}/.claude/skills/$id"
  repo_skill_path="$(cd "$ROOT/skills/$id" && pwd -P)"
  if [[ -L "$skill_path" ]]; then
    link_target="$(readlink "$skill_path")"
    if [[ "$link_target" != /* ]]; then
      link_target="$(dirname "$skill_path")/$link_target"
    fi
    if [[ -d "$link_target" ]]; then
      link_target="$(cd "$link_target" && pwd -P)"
    fi
    if [[ "$link_target" == "$repo_skill_path" || ( -n "$COMMON_SKILLS_ROOT" && "$link_target" == "$COMMON_SKILLS_ROOT/$id" ) ]]; then
      SKILL_ROWS+=("$(printf '%s\tok\tlinked at ~/.claude/skills/%s' "$id" "$id")")
    else
      SKILL_ROWS+=("$(printf '%s\twarn\tpresent but not linked to repo' "$id")")
    fi
  elif [[ -e "$skill_path" ]]; then
    SKILL_ROWS+=("$(printf '%s\twarn\tpresent but not linked to repo' "$id")")
  else
    SKILL_ROWS+=("$(printf '%s\tmissing\tnot linked at ~/.claude/skills/%s' "$id" "$id")")
  fi
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

# @description Render the collected tool inventory and profile readiness guidance as a human-readable report.
# @stdout the formatted Foreman tool-check report
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
  docs_group=()
  for did in markdownlint-cli2 codespell lychee; do
    for row in "${ROWS[@]}"; do
      [[ "${row%%$'\t'*}" == "$did" ]] || continue
      drest="${row#*$'\t'}"
      docs_group+=("$did:${drest%%$'\t'*}")
    done
  done
  [[ ${#docs_group[@]} -gt 0 ]] && echo "DOCS_GROUP: ${docs_group[*]}"
  echo "---"
  echo "SKILLS"
  printf '%-16s %-10s %s\n' "SKILL" "STATUS" "DETAIL"
  for row in "${SKILL_ROWS[@]}"; do
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

# @description Serialize the collected tool inventory and readiness state using the Foreman tool-check JSON schema.
# @stdout the formatted JSON tool-check report
report_json() {
  python3 - "$PROFILE" "$HOST" "$OS" "$IS_WSL" "$NOW" "$ROOT" "$READY" "${ROWS[@]}" --skills-- "${SKILL_ROWS[@]}" <<'PY'
import json, sys
profile, host, os_, is_wsl, now, root, ready = sys.argv[1:8]
rows = sys.argv[8:]
skill_marker = rows.index("--skills--")
skill_rows = rows[skill_marker + 1:]
rows = rows[:skill_marker]

def parse_rows(items):
    parsed = []
    for row in items:
        parts = row.split("\t", 2)
        tid = parts[0]
        st = parts[1] if len(parts) > 1 else "unknown"
        det = parts[2] if len(parts) > 2 else ""
        parsed.append({"id": tid, "status": st, "detail": det})
    return parsed

tools = parse_rows(rows)
skills = parse_rows(skill_rows)
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
    "skills": skills,
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
