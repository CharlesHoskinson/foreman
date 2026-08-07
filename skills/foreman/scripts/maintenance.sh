#!/usr/bin/env bash
# @description Report vendored-skill drift, Graphify freshness, and Foreman tool compatibility.
# Usage: maintenance.sh [--stage upstream|graph|compat|all] [--json PATH] [--strict] [--apply]
# Fixture-sensitive stages use the current directory; compatibility files resolve
# from this script's checkout so Bats fixtures can use the real environment checker.
# @exitcode 0 report completed; findings are informational unless --strict is used
# @exitcode 2 invalid arguments or unavailable JSON serialization support
# @exitcode 3 --strict found upstream drift, a stale graph, or compatibility drift
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=skills/foreman/scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

REAL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TARGET_ROOT="$(pwd -P)"
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import json' >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done

STAGE="all"
JSON_OUT=""
STRICT=0
APPLY=0

# @description Print command usage.
# @stdout maintenance command syntax
usage() {
  echo "usage: maintenance.sh [--stage upstream|graph|compat|all] [--json PATH] [--strict] [--apply]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="${2:?--stage needs upstream, graph, compat, or all}"; shift 2 ;;
    --json) JSON_OUT="${2:?--json needs a path}"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit "$EXIT_OK" ;;
    *) die "$EXIT_CONFIG" "maintenance: unknown arg $1" ;;
  esac
done

case "$STAGE" in
  upstream|graph|compat|all) ;;
  *) die "$EXIT_CONFIG" "maintenance: invalid stage $STAGE" ;;
esac

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/foreman-maintenance.XXXXXX")"
UPSTREAM_ITEMS="$TMP_DIR/upstream.tsv"
COMPAT_ITEMS="$TMP_DIR/compat.tsv"
GRAPH_DETAIL_FILE="$TMP_DIR/graph-detail.txt"
: > "$UPSTREAM_ITEMS"
: > "$COMPAT_ITEMS"
: > "$GRAPH_DETAIL_FILE"

# @description Remove temporary maintenance report data created by this process.
cleanup() {
  [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]] && rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT

# @description Append a tab-separated stage item while normalizing embedded control characters.
# @arg $1 file stage item file
# @arg $2 name item name
# @arg $3 status item status
# @arg $4 detail human-readable item detail
append_item() {
  local file="$1" name="$2" status="$3" detail="$4"
  detail="${detail//$'\t'/ }"
  detail="${detail//$'\r'/ }"
  detail="${detail//$'\n'/ }"
  printf '%s\t%s\t%s\n' "$name" "$status" "$detail" >> "$file"
}

# @description Compute a vendored skill directory hash from paths and CR-stripped file content.
# @arg $1 skill vendored skill directory name below skills
# @stdout final SHA-256 digest, or empty-tree when the directory contains no files
directory_hash() {
  local skill="$1"
  (
    cd "$TARGET_ROOT"
    if [[ -z "$(find "skills/$skill" -type f -print -quit)" ]]; then
      printf 'empty-tree\n'
      return 0
    fi
    find "skills/$skill" -type f -print0 | sort -z | while IFS= read -r -d '' f; do
      printf '%s\0' "$f"
      tr -d '\r' < "$f"
    done | sha256sum | cut -d' ' -f1
  )
}

# @description Parse vendored skill names and recorded content hashes from the Markdown table.
# @arg $1 manifest skills/VENDORED.md path
# @stdout tab-separated skill name and recorded hash rows
parse_vendored_rows() {
  local manifest="$1"
  awk -F'|' '
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    /^[[:space:]]*[|]/ && NF >= 4 {
      skill = trim($2)
      hash = trim($(NF - 1))
      if (skill != "" && skill != "Skill" && skill !~ /^:?-+:?$/) {
        print skill "\t" hash
      }
    }
  ' "$manifest"
}

# @description Replace one skill's recorded content hash in the vendored Markdown table.
# @arg $1 manifest skills/VENDORED.md path
# @arg $2 skill vendored skill name
# @arg $3 digest replacement SHA-256 digest
# @exitcode nonzero if Python is unavailable or the table row cannot be updated
update_recorded_hash() {
  local manifest="$1" skill="$2" digest="$3"
  [[ -n "$PY" ]] || return 1
  "$PY" - "$manifest" "$skill" "$digest" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
skill = sys.argv[2]
digest = sys.argv[3]
lines = path.read_text(encoding="utf-8").splitlines()
updated = False
for index, line in enumerate(lines):
    fields = line.split("|")
    if len(fields) >= 4 and fields[1].strip() == skill:
        fields[-2] = f" {digest} "
        lines[index] = "|".join(fields)
        updated = True
if not updated:
    raise SystemExit(1)
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
}

UPSTREAM_STATUS="skipped"
GRAPH_STATUS="skipped"
GRAPH_DETAIL="stage not selected"
COMPAT_STATUS="skipped"

# @description Check and optionally refresh every vendored skill listed in skills/VENDORED.md.
run_upstream() {
  local manifest="$TARGET_ROOT/skills/VENDORED.md"
  local name recorded current source target target_parent expected_target resolved_target
  local found=0 drift=0
  : > "$UPSTREAM_ITEMS"

  if [[ ! -f "$manifest" ]]; then
    UPSTREAM_STATUS="skipped"
    append_item "$UPSTREAM_ITEMS" upstream skipped "skills/VENDORED.md not found"
    return 0
  fi

  while IFS=$'\t' read -r name recorded; do
    [[ -n "$name" ]] || continue
    found=$((found + 1))
    if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ || "$name" == "." || "$name" == ".." || "$name" == *".."* ]]; then
      drift=1
      append_item "$UPSTREAM_ITEMS" "$name" drift "invalid skill name"
      continue
    fi

    target="$TARGET_ROOT/skills/$name"
    if [[ ! -d "$target" ]]; then
      drift=1
      append_item "$UPSTREAM_ITEMS" "$name" drift "listed in VENDORED.md but directory missing"
      continue
    fi

    source="$HOME/.claude/skills/$name"

    if [[ "$APPLY" -eq 1 ]]; then
      if [[ -d "$source" ]]; then
        target_parent="$(cd "$TARGET_ROOT/skills" && pwd -P)"
        expected_target="$TARGET_ROOT/skills/$name"
        target="$target_parent/$name"
        if [[ "$target" != "$expected_target" ]]; then
          drift=1
          append_item "$UPSTREAM_ITEMS" "$name apply" drift "refusing unsafe target path: $target"
          continue
        fi
        if ! resolved_target="$(cd "$target" && pwd -P)"; then
          drift=1
          append_item "$UPSTREAM_ITEMS" "$name apply" drift "refusing unsafe target path: $target"
          continue
        fi
        if [[ "$resolved_target" != "$target_parent/"* ]]; then
          drift=1
          append_item "$UPSTREAM_ITEMS" "$name apply" drift "refusing unsafe target path: $resolved_target"
          continue
        fi
        # Refuse when the source resolves into the target. install.sh symlinks
        # every skills/*/ into ~/.claude/skills, so on any host that ran the
        # installer the re-vendor source IS this tree. Without this check the
        # rm -rf below deletes the skill, the source is left dangling, and the
        # copy restores nothing -- then the emptied tree's hash is recorded as
        # the new truth.
        resolved_source=""
        if ! resolved_source="$(cd "$source" && pwd -P)"; then
          drift=1
          append_item "$UPSTREAM_ITEMS" "$name apply" drift "cannot resolve source: $source"
          continue
        fi
        if [[ "$resolved_source" == "$resolved_target" ]]; then
          drift=1
          append_item "$UPSTREAM_ITEMS" "$name apply" drift \
            "refusing self-referential re-vendor: source resolves to the target ($resolved_source)"
          continue
        fi
        if rm -rf -- "$target" && mkdir -p -- "$target" && cp -R "$source/." "$target/"; then
          find "$target" -depth -type d -name .git -exec rm -rf -- {} +
          find "$target" -type f -name '*.local.md' -delete
          current="$(directory_hash "$name")"
          if update_recorded_hash "$manifest" "$name" "$current"; then
            recorded="$current"
            append_item "$UPSTREAM_ITEMS" "$name apply" ok "re-vendored; content hash updated"
          else
            append_item "$UPSTREAM_ITEMS" "$name apply" skipped "could not update recorded content hash"
          fi
        else
          drift=1
          append_item "$UPSTREAM_ITEMS" "$name apply" drift "could not safely replace from upstream source: $source"
          continue
        fi
      else
        append_item "$UPSTREAM_ITEMS" "$name apply" skipped "upstream source not found: $source"
      fi
    fi

    current="$(directory_hash "$name")"
    if [[ "$current" == "$recorded" ]]; then
      append_item "$UPSTREAM_ITEMS" "$name" ok "content hash matches"
    else
      drift=1
      append_item "$UPSTREAM_ITEMS" "$name" drift "content hash mismatch"
    fi
  done < <(parse_vendored_rows "$manifest")

  if [[ "$found" -eq 0 ]]; then
    UPSTREAM_STATUS="skipped"
    append_item "$UPSTREAM_ITEMS" upstream skipped "no listed vendored skill directories found"
  elif [[ "$drift" -eq 1 ]]; then
    UPSTREAM_STATUS="drift"
  else
    UPSTREAM_STATUS="ok"
  fi
}

# @description Return the last approximately 200 characters of command output on one line.
# @arg $1 output captured command output
# @stdout normalized error excerpt
last_200() {
  printf '%s' "$1" | tail -c 200 | tr '\r\n\t' '   '
}

# @description Run Graphify's documented incremental update when its prerequisites are present.
run_graph() {
  local graph_json="$TARGET_ROOT/graphify-out/graph.json"
  local graph_py="" candidate output

  if [[ ! -f "$graph_json" ]]; then
    GRAPH_STATUS="skipped"
    GRAPH_DETAIL="graphify-out/graph.json not found"
    printf '%s' "$GRAPH_DETAIL" > "$GRAPH_DETAIL_FILE"
    return 0
  fi

  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import graphify' >/dev/null 2>&1; then
      graph_py="$candidate"
      break
    fi
  done
  if [[ -z "$graph_py" ]]; then
    GRAPH_STATUS="skipped"
    GRAPH_DETAIL="graphify not importable"
    printf '%s' "$GRAPH_DETAIL" > "$GRAPH_DETAIL_FILE"
    return 0
  fi

  if command -v graphify >/dev/null 2>&1; then
    if output="$(cd "$TARGET_ROOT" && graphify . --update 2>&1)"; then
      GRAPH_STATUS="ok"
      GRAPH_DETAIL="incremental Graphify update completed"
    else
      GRAPH_STATUS="stale"
      GRAPH_DETAIL="incremental Graphify update failed: $(last_200 "$output")"
    fi
  elif output="$(cd "$TARGET_ROOT" && "$graph_py" -m graphify . --update 2>&1)"; then
    GRAPH_STATUS="ok"
    GRAPH_DETAIL="incremental Graphify module update completed"
  else
    GRAPH_STATUS="stale"
    GRAPH_DETAIL="incremental Graphify module update failed: $(last_200 "$output")"
  fi
  printf '%s' "$GRAPH_DETAIL" > "$GRAPH_DETAIL_FILE"
}

# @description Inventory soft-profile tools and enforce version floors from the reference manifest.
run_compat() {
  local tool_check="$REAL_ROOT/env/tool-check.sh"
  local manifest="$REAL_ROOT/env/reference-manifest.toml"
  local tool_json="$TMP_DIR/tool-check.json"
  local parsed="$TMP_DIR/compat-parsed.tsv"
  local line name status detail
  : > "$COMPAT_ITEMS"

  if [[ ! -f "$tool_check" ]]; then
    COMPAT_STATUS="skipped"
    append_item "$COMPAT_ITEMS" compat skipped "env/tool-check.sh not found: $tool_check"
    return 0
  fi
  if [[ -z "$PY" ]]; then
    COMPAT_STATUS="drift"
    append_item "$COMPAT_ITEMS" tool-check missing "python3 or python unavailable for compatibility JSON"
    return 0
  fi

  if bash "$tool_check" --profile soft --json --out "$tool_json" > "$TMP_DIR/tool-check.stdout" 2> "$TMP_DIR/tool-check.stderr"; then
    :
  else
    # A nonzero tool-check status normally means a must-tool is missing; its JSON
    # remains authoritative and is parsed below instead of aborting this report.
    :
  fi
  if [[ ! -s "$tool_json" ]]; then
    COMPAT_STATUS="drift"
    append_item "$COMPAT_ITEMS" tool-check missing "tool-check did not produce JSON"
    return 0
  fi

  if ! "$PY" - "$tool_json" "$manifest" > "$parsed" <<'PY'
import json
import re
import sys
import tomllib

with open(sys.argv[1], encoding="utf-8") as stream:
    report = json.load(stream)
if report.get("schema") != "foreman.tool-check.v1":
    raise SystemExit("unexpected tool-check schema")
with open(sys.argv[2], "rb") as stream:
    manifest = tomllib.load(stream)

tools = {item["id"]: item for item in report.get("tools", [])}
must = set(manifest.get("profiles", {}).get("soft", {}).get("must", []))
selected = ("grok", "codex", "claude", "node")
items = []
seen = set()
drift = False

def clean(value):
    return str(value).replace("\t", " ").replace("\r", " ").replace("\n", " ")

def version_tuple(value):
    match = re.search(r"\d+(?:\.\d+)+", value)
    return tuple(int(part) for part in match.group(0).split(".")) if match else ()

def version_below(actual, floor):
    width = max(len(actual), len(floor))
    return actual + (0,) * (width - len(actual)) < floor + (0,) * (width - len(floor))

for tool_id in selected:
    if tool_id not in tools:
        continue
    tool = tools[tool_id]
    item_status = "ok" if tool.get("status") == "ok" else "missing"
    items.append((tool_id, item_status, tool.get("detail", "")))
    seen.add(tool_id)

for definition in manifest.get("tools", []):
    floor_text = definition.get("min_version")
    if not floor_text:
        continue
    tool_id = definition.get("id", "")
    tool = tools.get(tool_id)
    detail = tool.get("detail", "") if tool else "not present in tool-check output"
    actual = version_tuple(detail)
    floor = version_tuple(str(floor_text))
    if tool is None or tool.get("status") != "ok":
        item_status = "drift" if actual and floor and version_below(actual, floor) else "missing"
    elif not actual or version_below(actual, floor):
        item_status = "drift"
    else:
        item_status = "ok"
    if item_status == "drift":
        detail = f"{detail} (need >= {floor_text})".strip()
        drift = True
    items.append((tool_id, item_status, detail))
    seen.add(tool_id)

for tool_id in must:
    tool = tools.get(tool_id)
    if tool is None or tool.get("status") != "ok":
        drift = True
        if tool_id not in seen:
            detail = tool.get("detail", "") if tool else "not present in tool-check output"
            items.append((tool_id, "missing", detail))
            seen.add(tool_id)

print("__STATUS__\t" + ("drift" if drift else "ok"))
for item in items:
    print("\t".join(clean(value) for value in item))
PY
  then
    COMPAT_STATUS="drift"
    append_item "$COMPAT_ITEMS" tool-check missing "could not parse compatibility data"
    return 0
  fi

  while IFS=$'\t' read -r name status detail; do
    name="${name%"${name##*[![:space:]]}"}"
    status="${status%"${status##*[![:space:]]}"}"
    detail="${detail%"${detail##*[![:space:]]}"}"
    if [[ "$name" == "__STATUS__" ]]; then
      COMPAT_STATUS="$status"
    elif [[ -n "$name" ]]; then
      append_item "$COMPAT_ITEMS" "$name" "$status" "$detail"
    fi
  done < "$parsed"
}

append_item "$UPSTREAM_ITEMS" upstream skipped "stage not selected"
append_item "$COMPAT_ITEMS" compat skipped "stage not selected"
printf '%s' "$GRAPH_DETAIL" > "$GRAPH_DETAIL_FILE"

case "$STAGE" in
  upstream) run_upstream ;;
  graph) run_graph ;;
  compat) run_compat ;;
  all)
    run_upstream
    run_graph
    run_compat
    ;;
esac

# @description Render all stage statuses and findings as a human-readable report.
# @stdout maintenance stage summary and item details
render_human() {
  local name status detail
  printf 'maintenance upstream: %s\n' "$UPSTREAM_STATUS"
  while IFS=$'\t' read -r name status detail; do
    printf '  %s: %s - %s\n' "$name" "$status" "$detail"
  done < "$UPSTREAM_ITEMS"
  printf 'maintenance graph: %s - %s\n' "$GRAPH_STATUS" "$GRAPH_DETAIL"
  printf 'maintenance compat: %s\n' "$COMPAT_STATUS"
  while IFS=$'\t' read -r name status detail; do
    printf '  %s: %s - %s\n' "$name" "$status" "$detail"
  done < "$COMPAT_ITEMS"
}

# @description Serialize the stable maintenance schema with every stage key present.
# @arg $1 output destination path
write_json() {
  local destination="$1"
  [[ -n "$PY" ]] || die "$EXIT_CONFIG" "maintenance: python3 or python is required for --json"
  "$PY" - "$destination" "$UPSTREAM_STATUS" "$UPSTREAM_ITEMS" "$GRAPH_STATUS" "$GRAPH_DETAIL_FILE" "$COMPAT_STATUS" "$COMPAT_ITEMS" <<'PY'
import json
import pathlib
import sys

destination = pathlib.Path(sys.argv[1])
upstream_status, upstream_file = sys.argv[2:4]
graph_status, graph_file = sys.argv[4:6]
compat_status, compat_file = sys.argv[6:8]

def read_items(path):
    items = []
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        name, status, detail = (line.split("\t", 2) + ["", ""])[:3]
        items.append({"name": name, "status": status, "detail": detail})
    return items

payload = {
    "schema": "foreman.maintenance.v1",
    "stages": {
        "upstream": {"status": upstream_status, "items": read_items(upstream_file)},
        "graph": {"status": graph_status, "detail": pathlib.Path(graph_file).read_text(encoding="utf-8")},
        "compat": {"status": compat_status, "items": read_items(compat_file)},
    },
}
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY
}

render_human
[[ -n "$JSON_OUT" ]] && write_json "$JSON_OUT"

if [[ "$STRICT" -eq 1 ]] && {
  [[ "$UPSTREAM_STATUS" == "drift" ]] ||
  [[ "$GRAPH_STATUS" == "stale" ]] ||
  [[ "$COMPAT_STATUS" == "drift" ]]
}; then
  exit "$EXIT_MISSING_CLI"
fi
exit "$EXIT_OK"
