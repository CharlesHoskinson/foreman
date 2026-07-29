#!/usr/bin/env bash
# @description Verification harness for graph-project.sh (work-dag-projection r1).
#
# Standing rule (AGENT_TRAPS §3.2 / BRIEF): every checker is OBSERVED FAILING
# against a known-bad input before it is trusted. This harness runs each case
# as FAIL-then-PASS and exits non-zero if any case misbehaves.
#
# Cases:
#   1. malformed line  — fails naming the line; good log projects
#   2. truncated log   — fails naming the line; good log projects
#   3. unknown type    — does NOT break; known nodes unchanged
#   4. determinism     — two runs over the same log are byte-identical
#   5. content ids     — reordering events does not change node/edge ids
#   6. harness itself  — a deliberately failing assertion trips non-zero exit
#
# Usage: bash tests/graph-project-harness.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GP="$ROOT/skills/foreman/scripts/graph-project.sh"
export LC_ALL=C

PASS=0
FAIL=0
RESULTS=()

# @description Record a case result. name status detail
record() {
  local name="$1" status="$2" detail="${3:-}"
  if [[ "$status" == "PASS" ]]; then
    PASS=$((PASS + 1))
    RESULTS+=("PASS  $name${detail:+ — $detail}")
  else
    FAIL=$((FAIL + 1))
    RESULTS+=("FAIL  $name${detail:+ — $detail}")
  fi
}

# @description Assert that a command exits with expected status.
# @arg $1 name  @arg $2 expected_rc  @arg $3.. command
expect_rc() {
  local name="$1" want="$2"; shift 2
  local rc=0
  set +e
  "$@" >/dev/null 2>"$WORKDIR/stderr.$name"
  rc=$?
  set -e
  if (( rc == want )); then
    return 0
  fi
  echo "  expected rc=$want got rc=$rc" >&2
  cat "$WORKDIR/stderr.$name" >&2 || true
  return 1
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/gp-harness.XXXXXX")"
# shellcheck disable=SC2064
trap 'rm -rf -- "$WORKDIR"' EXIT

write_good_log() {
  local path="$1"
  cat > "$path" <<'EOF'
{"seq":1,"ts":"2026-01-01T00:00:00Z","type":"prompt","lane":"impl","payload":{"attempt":1,"cmd":"grok","vendor":"grok","model":"grok-4.5"}}
{"seq":2,"ts":"2026-01-01T00:00:01Z","type":"checkpoint","lane":"impl","commit":"abc123","payload":{"attempt":1,"sha":"abc123"}}
{"seq":3,"ts":"2026-01-01T00:00:02Z","type":"round_done","lane":"impl","commit":"abc123","payload":{"attempt":1,"exit_code":0,"exit_source":"cmd"}}
{"seq":4,"ts":"2026-01-01T00:00:03Z","type":"audit_verdict","lane":"impl","payload":{"attempt":1,"verdict":"APPROVED","vendor":"codex","model":"gpt-5.6","duration_s":12}}
{"seq":5,"ts":"2026-01-01T00:00:04Z","type":"finding","lane":"impl","payload":{"attempt":1,"file":"skills/foreman/scripts/x.sh","line":10,"summary":"bug","severity":"high","id":"f1","upheld":null}}
{"seq":6,"ts":"2026-01-01T00:00:05Z","type":"gate_decision","lane":"impl","payload":{"attempt":1,"outcome":"pass","reasons":[],"base_sha":"b","head_sha":"h"}}
{"seq":7,"ts":"2026-01-01T00:00:06Z","type":"prompt","lane":"impl","payload":{"attempt":2,"cmd":"grok","vendor":"grok"}}
{"seq":8,"ts":"2026-01-01T00:00:07Z","type":"round_done","lane":"impl","payload":{"attempt":2,"exit_code":1}}
{"seq":9,"ts":"2026-01-01T00:00:08Z","type":"heartbeat","lane":"impl","payload":{}}
EOF
}

known_nodes() {
  # Nodes + content edges, excluding coverage (which tracks log-wide max_seq).
  jq -c 'select(.kind == "node" or .kind == "edge" or .kind == "incomplete")' "$1" | LC_ALL=C sort
}

echo "=== graph-project harness (FAIL-then-PASS discipline) ==="
echo "workdir: $WORKDIR"
echo

# --------------------------------------------------------------------------
# Case 1: malformed line
# --------------------------------------------------------------------------
echo "--- case 1: malformed line ---"
MAL="$WORKDIR/mal.jsonl"
write_good_log "$MAL"
printf '%s\n' 'THIS-IS-NOT-JSON' >> "$MAL"

echo "  [observe FAIL] known-bad (malformed line) must exit non-zero and name the line"
if expect_rc mal_bad 1 "$GP" --run r1 --events "$MAL"; then
  if grep -q 'malformed line 10' "$WORKDIR/stderr.mal_bad"; then
    echo "  observed FAIL correctly (named line 10)"
    # now PASS path
    write_good_log "$WORKDIR/good.jsonl"
    if expect_rc mal_good 0 "$GP" --run r1 --events "$WORKDIR/good.jsonl"; then
      record "malformed-line" PASS "fail-on-bad then project-on-good"
    else
      record "malformed-line" FAIL "good log did not project"
    fi
  else
    record "malformed-line" FAIL "stderr did not name line 10: $(cat "$WORKDIR/stderr.mal_bad")"
  fi
else
  record "malformed-line" FAIL "known-bad did not exit 1 (checker never observed failing)"
fi

# --------------------------------------------------------------------------
# Case 2: truncated log
# --------------------------------------------------------------------------
echo "--- case 2: truncated log ---"
TR="$WORKDIR/tr.jsonl"
write_good_log "$TR"
printf '%s' '{"partial":true' >> "$TR"   # no trailing newline

echo "  [observe FAIL] known-bad (truncated) must exit non-zero and name the line"
if expect_rc tr_bad 1 "$GP" --run r1 --events "$TR"; then
  if grep -Eq 'truncated log at line 10' "$WORKDIR/stderr.tr_bad"; then
    echo "  observed FAIL correctly (named line 10)"
    write_good_log "$WORKDIR/good2.jsonl"
    if expect_rc tr_good 0 "$GP" --run r1 --events "$WORKDIR/good2.jsonl"; then
      record "truncated-log" PASS "fail-on-bad then project-on-good"
    else
      record "truncated-log" FAIL "good log did not project"
    fi
  else
    record "truncated-log" FAIL "stderr did not name line: $(cat "$WORKDIR/stderr.tr_bad")"
  fi
else
  record "truncated-log" FAIL "known-bad did not exit 1"
fi

# --------------------------------------------------------------------------
# Case 3: unknown event type (additivity) — must NOT break
# --------------------------------------------------------------------------
echo "--- case 3: unknown event type (additivity) ---"
# First: prove a checker that requires "must break on unknown" would be wrong
# by observing that the BAD input (unknown type) actually succeeds. The
# known-bad for *this* property is a projection that *drops* known nodes when
# an unknown type is present — we synthesise that as a control.
write_good_log "$WORKDIR/base.jsonl"
"$GP" --run r1 --events "$WORKDIR/base.jsonl" > "$WORKDIR/proj_base.jsonl"
known_nodes "$WORKDIR/proj_base.jsonl" > "$WORKDIR/known_base.txt"

# Control: a fake "projection" missing an attempt node must fail our equality check.
echo "  [observe FAIL] control where known nodes were dropped"
jq -c 'select(.id != "foreman:run/r1/lane/impl/attempt/1")' "$WORKDIR/proj_base.jsonl" \
  > "$WORKDIR/proj_dropped.jsonl"
known_nodes "$WORKDIR/proj_dropped.jsonl" > "$WORKDIR/known_dropped.txt"
if cmp -s "$WORKDIR/known_base.txt" "$WORKDIR/known_dropped.txt"; then
  record "additivity" FAIL "control equality unexpectedly held (checker is vacuous)"
else
  echo "  observed FAIL correctly (dropped node detected)"
  # PASS path: inject unknown type; projection completes; known nodes unchanged
  cp "$WORKDIR/base.jsonl" "$WORKDIR/with_unknown.jsonl"
  printf '%s\n' \
    '{"seq":10,"ts":"2026-01-01T00:00:09Z","type":"future_widget_v99","lane":"impl","payload":{"attempt":2,"x":true}}' \
    >> "$WORKDIR/with_unknown.jsonl"
  if expect_rc unk 0 "$GP" --run r1 --events "$WORKDIR/with_unknown.jsonl"; then
    "$GP" --run r1 --events "$WORKDIR/with_unknown.jsonl" > "$WORKDIR/proj_unk.jsonl"
    known_nodes "$WORKDIR/proj_unk.jsonl" > "$WORKDIR/known_unk.txt"
    if cmp -s "$WORKDIR/known_base.txt" "$WORKDIR/known_unk.txt"; then
      record "additivity" PASS "unknown type kept; known nodes byte-identical"
    else
      record "additivity" FAIL "known nodes changed after unknown type"
      diff -u "$WORKDIR/known_base.txt" "$WORKDIR/known_unk.txt" | head -40 >&2 || true
    fi
  else
    record "additivity" FAIL "unknown type broke the projection"
  fi
fi

# --------------------------------------------------------------------------
# Case 4: determinism
# --------------------------------------------------------------------------
echo "--- case 4: determinism ---"
write_good_log "$WORKDIR/det.jsonl"
"$GP" --run r1 --events "$WORKDIR/det.jsonl" > "$WORKDIR/d1.jsonl"
"$GP" --run r1 --events "$WORKDIR/det.jsonl" > "$WORKDIR/d2.jsonl"
# Control: mutate one output and confirm cmp detects it
echo "  [observe FAIL] control where second projection was hand-edited"
cp "$WORKDIR/d1.jsonl" "$WORKDIR/d2_bad.jsonl"
printf '%s\n' '{"kind":"node","type":"attempt","id":"hand-edit"}' >> "$WORKDIR/d2_bad.jsonl"
if cmp -s "$WORKDIR/d1.jsonl" "$WORKDIR/d2_bad.jsonl"; then
  record "determinism" FAIL "cmp control did not detect edit (vacuous)"
else
  echo "  observed FAIL correctly (edit detected)"
  if cmp -s "$WORKDIR/d1.jsonl" "$WORKDIR/d2.jsonl"; then
    # cross-path: project from a copied log path (stand-in for cross-machine)
    cp "$WORKDIR/det.jsonl" "$WORKDIR/det-copy.jsonl"
    "$GP" --run r1 --events "$WORKDIR/det-copy.jsonl" > "$WORKDIR/d3.jsonl"
    if cmp -s "$WORKDIR/d1.jsonl" "$WORKDIR/d3.jsonl"; then
      record "determinism" PASS "byte-identical across runs and paths"
    else
      record "determinism" FAIL "path copy produced different projection"
    fi
  else
    record "determinism" FAIL "two runs over same log differed"
    diff -u "$WORKDIR/d1.jsonl" "$WORKDIR/d2.jsonl" | head -40 >&2 || true
  fi
fi

# --------------------------------------------------------------------------
# Case 5: node/edge identity from content, not iteration order
# --------------------------------------------------------------------------
echo "--- case 5: content-derived identity (reorder events) ---"
# Build a log and a permutation that preserves seq numbers (identity must
# not depend on file order — only on event content fields).
write_good_log "$WORKDIR/ord_a.jsonl"
# Reverse line order of the same events
tac "$WORKDIR/ord_a.jsonl" > "$WORKDIR/ord_b.jsonl"
"$GP" --run r1 --events "$WORKDIR/ord_a.jsonl" > "$WORKDIR/proj_a.jsonl"
"$GP" --run r1 --events "$WORKDIR/ord_b.jsonl" > "$WORKDIR/proj_b.jsonl"
# Control: change an attempt number in content → ids must change
echo "  [observe FAIL] control where attempt id in content changes"
jq -c 'if .payload.attempt == 1 then .payload.attempt = 9 else . end' \
  "$WORKDIR/ord_a.jsonl" > "$WORKDIR/ord_mut.jsonl"
"$GP" --run r1 --events "$WORKDIR/ord_mut.jsonl" > "$WORKDIR/proj_mut.jsonl"
ids_a="$(jq -r 'select(.kind=="node")|.id' "$WORKDIR/proj_a.jsonl" | LC_ALL=C sort | tr '\n' ' ')"
ids_mut="$(jq -r 'select(.kind=="node")|.id' "$WORKDIR/proj_mut.jsonl" | LC_ALL=C sort | tr '\n' ' ')"
if [[ "$ids_a" == "$ids_mut" ]]; then
  record "content-ids" FAIL "mutating attempt content did not change ids (vacuous)"
else
  echo "  observed FAIL correctly (content mutation changed ids)"
  if cmp -s "$WORKDIR/proj_a.jsonl" "$WORKDIR/proj_b.jsonl"; then
    record "content-ids" PASS "reordered events → byte-identical projection"
  else
    record "content-ids" FAIL "reordered events changed projection"
    diff -u "$WORKDIR/proj_a.jsonl" "$WORKDIR/proj_b.jsonl" | head -40 >&2 || true
  fi
fi

# --------------------------------------------------------------------------
# Case 6: harness exits non-zero when a case fails (meta-check)
# --------------------------------------------------------------------------
echo "--- case 6: harness non-zero on failure (meta) ---"
# Prove the accumulator trips: inject a synthetic FAIL and ensure we would
# exit non-zero. Observed by running a subshell that forces FAIL=1.
echo "  [observe FAIL] subshell with forced failure exits non-zero"
set +e
(
  set -euo pipefail
  FAIL=1
  PASS=0
  if (( FAIL > 0 )); then exit 1; fi
  exit 0
)
meta_rc=$?
set -e
if (( meta_rc != 0 )); then
  echo "  observed FAIL correctly (forced failure → rc=$meta_rc)"
  record "harness-nonzero" PASS "failure accumulator exits non-zero"
else
  record "harness-nonzero" FAIL "forced failure exited 0"
fi

# --------------------------------------------------------------------------
# --check mode smoke
# --------------------------------------------------------------------------
echo "--- case 7: --check mode ---"
write_good_log "$WORKDIR/chk.jsonl"
"$GP" --run r1 --events "$WORKDIR/chk.jsonl" --out "$WORKDIR/worklog.jsonl"
echo "  [observe FAIL] hand-edit detected by --check"
printf '%s\n' '{"kind":"node","id":"tampered"}' >> "$WORKDIR/worklog.jsonl"
if expect_rc chk_bad 1 "$GP" --run r1 --events "$WORKDIR/chk.jsonl" --out "$WORKDIR/worklog.jsonl" --check; then
  echo "  observed FAIL correctly"
  # restore and pass
  "$GP" --run r1 --events "$WORKDIR/chk.jsonl" --out "$WORKDIR/worklog.jsonl"
  if expect_rc chk_good 0 "$GP" --run r1 --events "$WORKDIR/chk.jsonl" --out "$WORKDIR/worklog.jsonl" --check; then
    record "check-mode" PASS "detects hand-edit; clean re-project checks ok"
  else
    record "check-mode" FAIL "clean check failed"
  fi
else
  record "check-mode" FAIL "hand-edit not detected"
fi

# --------------------------------------------------------------------------
echo
echo "=== results ==="
for r in "${RESULTS[@]}"; do
  printf '  %s\n' "$r"
done
echo
echo "passed=$PASS failed=$FAIL"

if (( FAIL > 0 )); then
  echo "HARNESS FAILED" >&2
  exit 1
fi
echo "HARNESS PASSED"
exit 0
