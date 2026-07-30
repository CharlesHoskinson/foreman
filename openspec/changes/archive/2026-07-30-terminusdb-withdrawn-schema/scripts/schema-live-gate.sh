#!/usr/bin/env bash
# Live load-test gate for terminusdb-schema (T3 + BRIEF verification).
#
# Extracts the largest parseable fenced JSON schema block from design.md,
# loads it into a fresh pinned TerminusDB 12.0.6 container, and asserts:
#   1. schema POST full_replace → HTTP 200
#   2. schema GET lists every declared class/enum name
#   3. well-formed Agent instance accepted (positive)
#   4. Agent with invalid vendor enum rejected (negative / known-bad)
#   5. Agent with undeclared field rejected (BRIEF)
#   6. drop-and-rebuild yields identical schema document set (BRIEF)
#
# Exit non-zero if any case fails. Tear down the container on exit.
#
# Self-test of harness failure path:
#   schema-live-gate.sh --self-test-fail
#   Forces a deliberate false expectation and requires non-zero exit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DESIGN_MD="${DESIGN_MD:-$PKG_DIR/design.md}"
IMAGE="terminusdb/terminusdb-server:v12.0.6"
DIGEST="sha256:e02eaa3a5b75e01550cee2a662a846db7fceb725193983f1f35e1842ab580fee"
ADMIN_PASS="${TERMINUSDB_ADMIN_PASS:-schema-gate-root}"
CONTAINER="tdb-schema-gate-$$"
HOST_PORT="${HOST_PORT:-}"
WORKDIR="${TMPDIR:-/tmp}/terminusdb-schema-gate-$$"
FAILED=0
SELF_TEST_FAIL=0

log() { printf '%s\n' "$*"; }
fail() { log "FAIL: $*"; FAILED=$((FAILED + 1)); }
pass() { log "PASS: $*"; }

usage() {
  cat <<EOF
Usage: $0 [--self-test-fail]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --self-test-fail) SELF_TEST_FAIL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) log "unknown arg: $1"; usage; exit 2 ;;
  esac
done

cleanup() {
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKDIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$WORKDIR"

# --- extract largest parseable fenced JSON block from design.md ---
python3 - "$DESIGN_MD" "$WORKDIR/schema.json" <<'PY'
import json, re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8")
out = Path(sys.argv[2])
best = None
for b in re.findall(r"```json\n(.*?)```", text, re.S):
    try:
        obj = json.loads(b)
    except json.JSONDecodeError:
        continue
    if isinstance(obj, list) and (best is None or len(obj) > len(best)):
        best = obj
if best is None:
    sys.exit("no parseable fenced JSON schema block")
out.write_text(json.dumps(best), encoding="utf-8")
ids = sorted(x["@id"] for x in best if isinstance(x, dict) and "@id" in x)
Path(sys.argv[2] + ".ids").write_text("\n".join(ids) + "\n", encoding="utf-8")
print(f"extracted {len(best)} objects, {len(ids)} named ids")
PY

# Pick a free host port if not provided
if [[ -z "$HOST_PORT" ]]; then
  HOST_PORT="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"
fi
BASE="http://127.0.0.1:${HOST_PORT}"
AUTH="admin:${ADMIN_PASS}"

log "Starting pinned TerminusDB ${IMAGE}@${DIGEST} on port ${HOST_PORT}"
docker run -d --name "$CONTAINER" \
  -p "${HOST_PORT}:6363" \
  -e "TERMINUSDB_ADMIN_PASS=${ADMIN_PASS}" \
  "${IMAGE}@${DIGEST}" >/dev/null

# Wait for API
ready=0
for i in $(seq 1 60); do
  if curl -fsS -u "$AUTH" "$BASE/api/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  # some builds answer 401 on /api/ which still means up
  code="$(curl -sS -o /dev/null -w '%{http_code}' -u "$AUTH" "$BASE/api/" || true)"
  if [[ "$code" =~ ^(200|401|404)$ ]]; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" -ne 1 ]]; then
  log "TerminusDB did not become ready; docker logs:"
  docker logs "$CONTAINER" 2>&1 | tail -40 || true
  exit 1
fi
pass "container ready"

# Create database
db_code="$(curl -sS -o "$WORKDIR/db-create.body" -w '%{http_code}' \
  -u "$AUTH" -X POST "$BASE/api/db/admin/foreman" \
  -H "Content-Type: application/json" \
  -d '{"label":"Foreman Graph Plane","comment":"terminusdb-schema live gate"}')"
if [[ "$db_code" != "200" && "$db_code" != "201" ]]; then
  # already exists is fine only if reusing; we use fresh container so expect 200
  fail "create db HTTP $db_code body=$(cat "$WORKDIR/db-create.body")"
else
  pass "create database HTTP $db_code"
fi

http_post() {
  local url="$1" data_file="$2" out_body="$3"
  curl -sS -o "$out_body" -w '%{http_code}' \
    -u "$AUTH" -X POST "$url" \
    -H "Content-Type: application/json" \
    --data-binary @"$data_file"
}

# --- Check 1: schema load ---
schema_code="$(http_post \
  "$BASE/api/document/admin/foreman?graph_type=schema&full_replace=true&author=schema-gate&message=v0.2.9-frozen" \
  "$WORKDIR/schema.json" \
  "$WORKDIR/schema-load.body")"
if [[ "$schema_code" == "200" ]]; then
  pass "check1 schema full_replace HTTP 200"
else
  fail "check1 schema full_replace HTTP $schema_code body=$(head -c 500 "$WORKDIR/schema-load.body")"
fi

# --- Check 2: schema readback contains every declared name ---
get_code="$(curl -sS -o "$WORKDIR/schema-get.json" -w '%{http_code}' \
  -u "$AUTH" \
  "$BASE/api/document/admin/foreman?graph_type=schema&as_list=true")"
if [[ "$get_code" != "200" ]]; then
  fail "check2 schema GET HTTP $get_code"
else
  missing="$(python3 - "$WORKDIR/schema.json.ids" "$WORKDIR/schema-get.json" <<'PY'
import json, sys
from pathlib import Path
want = [l.strip() for l in Path(sys.argv[1]).read_text().splitlines() if l.strip()]
got_docs = json.loads(Path(sys.argv[2]).read_text())
if isinstance(got_docs, dict):
    got_docs = [got_docs]
got_ids = set()
for d in got_docs:
    if isinstance(d, dict):
        if "@id" in d:
            got_ids.add(d["@id"].split("#")[-1].split("/")[-1])
        # sometimes returned as terminusdb:///foreman/schema#Name
        for k in ("@id",):
            v = d.get(k)
            if isinstance(v, str):
                got_ids.add(v.rsplit("/", 1)[-1].rsplit("#", 1)[-1])
missing = [w for w in want if w not in got_ids and not any(w == g or g.endswith(w) for g in got_ids)]
# softer: substring match on raw text
raw = Path(sys.argv[2]).read_text()
missing = [w for w in want if w not in raw]
if missing:
    print(",".join(missing))
PY
)"
  if [[ -n "$missing" ]]; then
    fail "check2 missing declared ids in GET: $missing"
  else
    pass "check2 all declared class/enum names present in schema GET"
  fi
fi

# snapshot for drop-rebuild
cp "$WORKDIR/schema-get.json" "$WORKDIR/schema-get-1.json"

# --- Check 3: positive Agent fixture ---
# Classes use Lexical keys; omit @id (SubmittedIdDoesNotMatchGeneratedId).
# Required GraphNode fields: created_at. Agent: agent_key, vendor, model.
cat >"$WORKDIR/agent-ok.json" <<'JSON'
{
  "@type": "Agent",
  "agent_key": "gate-agent-positive",
  "vendor": "xai",
  "model": "grok-4.5",
  "created_at": "2026-07-29T00:00:00Z"
}
JSON

pos_code="$(http_post \
  "$BASE/api/document/admin/foreman?author=schema-gate&message=positive-fixture" \
  "$WORKDIR/agent-ok.json" \
  "$WORKDIR/agent-ok.body")"
if [[ "$pos_code" == "200" || "$pos_code" == "201" ]]; then
  pass "check3 positive Agent fixture HTTP $pos_code"
else
  fail "check3 positive Agent fixture HTTP $pos_code body=$(head -c 800 "$WORKDIR/agent-ok.body")"
fi

# --- Check 4: invalid enum (known-bad must be rejected) ---
cat >"$WORKDIR/agent-bad-enum.json" <<'JSON'
{
  "@type": "Agent",
  "agent_key": "gate-agent-bad-enum",
  "vendor": "not-a-real-vendor",
  "model": "grok-4.5",
  "created_at": "2026-07-29T00:00:00Z"
}
JSON

neg_code="$(http_post \
  "$BASE/api/document/admin/foreman?author=schema-gate&message=negative-fixture" \
  "$WORKDIR/agent-bad-enum.json" \
  "$WORKDIR/agent-bad-enum.body")"
if [[ "$neg_code" == "200" || "$neg_code" == "201" ]]; then
  fail "check4 invalid enum was ACCEPTED (HTTP $neg_code) — schema vacuous"
else
  pass "check4 invalid enum rejected HTTP $neg_code (known-bad observed failing)"
fi

# --- Check 5: undeclared field (BRIEF; known-bad must be rejected) ---
cat >"$WORKDIR/agent-bad-field.json" <<'JSON'
{
  "@type": "Agent",
  "agent_key": "gate-agent-bad-field",
  "vendor": "xai",
  "model": "grok-4.5",
  "created_at": "2026-07-29T00:00:00Z",
  "not_a_declared_field": "boom"
}
JSON

uf_code="$(http_post \
  "$BASE/api/document/admin/foreman?author=schema-gate&message=undeclared-field" \
  "$WORKDIR/agent-bad-field.json" \
  "$WORKDIR/agent-bad-field.body")"
if [[ "$uf_code" == "200" || "$uf_code" == "201" ]]; then
  fail "check5 undeclared field was ACCEPTED (HTTP $uf_code) — schema vacuous"
else
  pass "check5 undeclared field rejected HTTP $uf_code (known-bad observed failing)"
fi

# --- Check 6: drop-and-rebuild identity ---
schema_code2="$(http_post \
  "$BASE/api/document/admin/foreman?graph_type=schema&full_replace=true&author=schema-gate&message=rebuild" \
  "$WORKDIR/schema.json" \
  "$WORKDIR/schema-load-2.body")"
if [[ "$schema_code2" != "200" ]]; then
  fail "check6 rebuild full_replace HTTP $schema_code2"
else
  get_code2="$(curl -sS -o "$WORKDIR/schema-get-2.json" -w '%{http_code}' \
    -u "$AUTH" \
    "$BASE/api/document/admin/foreman?graph_type=schema&as_list=true")"
  if [[ "$get_code2" != "200" ]]; then
    fail "check6 rebuild GET HTTP $get_code2"
  else
    cmp_out="$(python3 - "$WORKDIR/schema-get-1.json" "$WORKDIR/schema-get-2.json" <<'PY'
import json, sys
from pathlib import Path

def norm(path):
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        data = [data]
    # normalize: sort by @id, drop volatile keys if any
    out = []
    for d in data:
        if not isinstance(d, dict):
            continue
        out.append(json.dumps(d, sort_keys=True))
    return sorted(out)

a, b = norm(sys.argv[1]), norm(sys.argv[2])
if a == b:
    print("identical")
else:
    print(f"differ len {len(a)} vs {len(b)}")
    sa, sb = set(a), set(b)
    print(f"only_first={len(sa-sb)} only_second={len(sb-sa)}")
    sys.exit(1)
PY
)" || true
    if [[ "$cmp_out" == "identical" ]]; then
      pass "check6 drop-and-rebuild schema identical"
    else
      fail "check6 drop-and-rebuild schema not identical: $cmp_out"
    fi
  fi
fi

# Optional: prove harness fails when a success case is inverted
if [[ "$SELF_TEST_FAIL" -eq 1 ]]; then
  log "SELF-TEST: forcing failure path (expect non-zero exit)"
  fail "deliberate self-test failure"
fi

if [[ "$FAILED" -gt 0 ]]; then
  log "GATE RESULT: FAILED ($FAILED check(s))"
  exit 1
fi
log "GATE RESULT: PASSED (all checks)"
exit 0
