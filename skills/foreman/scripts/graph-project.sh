#!/usr/bin/env bash
# @description Deterministic work-DAG projection of a run's events.jsonl.
#
# The work-DAG is a pure function of the event log. No LLM authors it, it never
# passes through graphify, and it takes no event-log lock (read-only). Node and
# edge identities are derived from event content (JK-1..5), never from
# iteration order. Unknown future event types are ignored (additivity).
#
# Round-1 scope (BRIEF): project the log itself and prove determinism /
# additivity. Store integration, checkpoint→symbol bridge, rename maps and
# query ergonomics are deferred.
#
# Usage:
#   graph-project.sh --run RUN [--events PATH] [--out PATH] [--check]
#
#   --run RUN       Run id (required). Used in canonical work ids.
#   --events PATH   events.jsonl to read (default: $FOREMAN_HOME/runs/RUN/events.jsonl)
#   --out PATH      Write projection here via temp+rename (default: stdout)
#   --check         Re-project and cmp against --out; report diff, never rewrite
#
# Exit codes:
#   0  projection ok, or --check identical
#   1  malformed/truncated log, missing inputs, check mismatch, or write failure
#   2  usage error
#
# Fail-loud contract (BRIEF verification):
#   - a truncated (torn-tail) log fails naming the line; no partial DAG
#   - a malformed line fails naming the line; no partial DAG
#   - an unknown event type does not break the projection
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

export LC_ALL=C

# --- argument parsing -------------------------------------------------------

# @description Print graph-project command usage to standard error.
gp_usage() {
  cat >&2 <<'EOF'
usage: graph-project.sh --run RUN [--events PATH] [--out PATH] [--check]
EOF
}

RUN=""
EVENTS=""
OUT=""
CHECK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)    RUN="${2:-}"; shift 2 ;;
    --events) EVENTS="${2:-}"; shift 2 ;;
    --out)    OUT="${2:-}"; shift 2 ;;
    --check)  CHECK=1; shift ;;
    -h|--help) gp_usage; exit 0 ;;
    *)
      echo "graph-project: unknown argument: $1" >&2
      gp_usage
      exit 2
      ;;
  esac
done

if [[ -z "$RUN" ]]; then
  echo "graph-project: --run is required" >&2
  gp_usage
  exit 2
fi

if [[ -z "$EVENTS" ]]; then
  EVENTS="$(run_dir "$RUN")/events.jsonl"
fi

if (( CHECK == 1 )) && [[ -z "$OUT" ]]; then
  echo "graph-project: --check requires --out" >&2
  exit 2
fi

require_cmd jq
require_cmd sha256sum

# --- pure readers -----------------------------------------------------------

# @description Validate every line of events.jsonl. Fail loud on malformed or
#   torn lines (no silent partial projection). Unknown event *types* are fine
#   — only JSON parseability is required (additivity of the log vocabulary).
# @arg $1 path to events.jsonl
# @stdout validated JSON lines (CR stripped), one per line
# @exitcode 0 clean; 1 malformed or truncated
gp_validate_events() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "graph-project: events file not found: $file" >&2
    return 1
  fi
  local n=0 line
  while true; do
    if IFS= read -r line; then
      n=$((n + 1))
      line=${line%$'\r'}
      if [[ -z "$line" ]]; then
        echo "graph-project: empty line $n in $file" >&2
        return 1
      fi
      if ! jq -e . >/dev/null 2>&1 <<<"$line"; then
        echo "graph-project: malformed line $n in $file" >&2
        return 1
      fi
      printf '%s\n' "$line"
    else
      if [[ -n "${line:-}" ]]; then
        n=$((n + 1))
        echo "graph-project: truncated log at line $n in $file (no trailing newline)" >&2
        return 1
      fi
      return 0
    fi
  done < "$file"
}

# @description Content-hash for a finding (JK-4).
# @arg $1 file  @arg $2 line  @arg $3 summary
# @stdout lowercase hex sha256
gp_finding_hash() {
  local file="$1" line="$2" summary="$3"
  printf '%s\0%s\0%s' "$file" "$line" "$summary" | sha256sum | awk '{print $1}'
}

# jq filter: pure projection. Input = JSON array of events.
# $run = run id string; $findings = {seq_string: finding_id}
# shellcheck disable=SC2016
GP_JQ_FILTER='
def work_id(lane; attempt):
  "foreman:run/\($run)/lane/\(lane)/attempt/\(attempt|tostring)";
def verdict_id(lane; attempt):
  "foreman:verdict/\($run)/lane/\(lane)/attempt/\(attempt|tostring)";
def gate_id(lane; attempt):
  "foreman:gate/\($run)/lane/\(lane)/attempt/\(attempt|tostring)";
def edge_key(rel; src; tgt; seq):
  "foreman:edge/\(rel)/\(src)->\(tgt)/seq/\(seq|tostring)";
def sort_key(rec):
  (rec.kind // "") + "\t" + (rec.type // rec.relation // "") + "\t" + (rec.id // "");

def touch_attempt(state; lane; attempt; seq; ts; commit; vendor; model; usage):
  (lane + "\t" + (attempt|tostring)) as $ak
  | work_id(lane; attempt) as $wid
  | state
  | .attempts[$ak] = (
      (.attempts[$ak] // {
        kind: "node",
        type: "attempt",
        id: $wid,
        run: $run,
        lane: lane,
        attempt: attempt,
        ts: ts,
        seq: seq,
        outcome: null,
        commit: null,
        vendor: null,
        model: null,
        usage: null,
        incomplete: true,
        missing: ["round_done"],
        consumed_seq: seq
      })
      | .ts = (if .ts == null then ts
               elif ts != null and ts < .ts then ts
               else .ts end)
      | .seq = (if .seq == null then seq else ([.seq, seq] | min) end)
      | .consumed_seq = ([.consumed_seq, seq] | max)
      | .commit = (if commit != null then commit else .commit end)
      # First non-null wins: do not let a later audit/gate event overwrite the
      # worker vendor/model recorded on the attempt (JK-5 is recorded, not
      # "last writer").
      | .vendor = (if .vendor != null then .vendor else vendor end)
      | .model = (if .model != null then .model else model end)
      | .usage = (if .usage != null then .usage else usage end)
    );

def mark_incomplete(state; typ; lane; seq; ts; missing):
  state
  | .incomplete += [{
      kind: "incomplete",
      type: typ,
      id: ("foreman:incomplete/\($run)/seq/" + (seq|tostring)),
      run: $run,
      lane: lane,
      seq: seq,
      ts: ts,
      missing: missing,
      consumed_seq: seq
    }];

reduce .[] as $e (
  {
    attempts: {},
    verdicts: {},
    gates: {},
    findings: {},
    edges: {},
    incomplete: [],
    max_seq: 0,
    event_count: 0
  };
  .event_count += 1
  | .max_seq = ([.max_seq, ($e.seq // 0)] | max)
  | . as $st0
  | ($e.lane // "") as $lane
  | ($e.payload.attempt // null) as $attempt
  | ($e.seq // 0) as $seq
  | ($e.ts // null) as $ts
  | ($e.commit // $e.payload.sha // null) as $commit
  | ($e.payload.vendor // $e.payload.usage.vendor // null) as $vendor
  | ($e.payload.model // $e.payload.usage.model // null) as $model
  | ($e.payload.usage // null) as $usage
  | ($e.type // "") as $type

  # Ignore unknown types entirely (additivity). Still counted in event_count.
  | if (
      $type != "prompt" and $type != "ownership" and $type != "state"
      and $type != "checkpoint" and $type != "round_done" and $type != "waiting_child"
      and $type != "alert" and $type != "merge_base" and $type != "audit_verdict"
      and $type != "finding" and $type != "gate_decision"
      and $type != "heartbeat" and $type != "heartbeat_rollup"
    ) then
      $st0
    else
      # Heartbeats are known but produce no nodes/edges.
      if ($type == "heartbeat" or $type == "heartbeat_rollup") then
        $st0
      else
        # Touch attempt node when attempt is present. Decision events create
        # the attempt shell but do not supply worker vendor/model (JK-5).
        (if $attempt != null and $lane != "" then
           if ($type == "audit_verdict" or $type == "finding" or $type == "gate_decision") then
             touch_attempt($st0; $lane; $attempt; $seq; $ts; $commit; null; null; null)
           else
             touch_attempt($st0; $lane; $attempt; $seq; $ts; $commit; $vendor; $model; $usage)
           end
         else $st0 end) as $st1

        | if $type == "round_done" then
            if $attempt == null or $lane == "" then
              mark_incomplete($st1; $type; $lane; $seq; $ts;
                if $attempt == null then ["payload.attempt"] else ["lane"] end)
            else
              ($lane + "\t" + ($attempt|tostring)) as $ak
              | $st1
              | .attempts[$ak] = (
                  .attempts[$ak]
                  | .outcome = {
                      exit_code: ($e.payload.exit_code // null),
                      exit_source: ($e.payload.exit_source // null),
                      gate_rc: ($e.payload.gate_rc // null),
                      report_fresh: ($e.payload.report_fresh // null),
                      checkpoint_failed: ($e.payload.checkpoint_failed // null)
                    }
                  | .incomplete = false
                  | .missing = []
                  | .consumed_seq = ([.consumed_seq, $seq] | max)
                  | .commit = (if $commit != null then $commit else .commit end)
                )
            end

          elif $type == "audit_verdict" then
            if $attempt == null or $lane == "" then
              mark_incomplete($st1; $type; $lane; $seq; $ts;
                if $attempt == null then ["payload.attempt"] else ["lane"] end)
            else
              (verdict_id($lane; $attempt)) as $vid
              | (work_id($lane; $attempt)) as $wid
              | (edge_key("produced"; $wid; $vid; $seq)) as $eid1
              | (edge_key("evaluated_by"; $wid; $vid; $seq)) as $eid2
              | $st1
              | .verdicts[$vid] = {
                  kind: "node",
                  type: "verdict",
                  id: $vid,
                  run: $run,
                  lane: $lane,
                  attempt: $attempt,
                  ts: $ts,
                  seq: $seq,
                  verdict: ($e.payload.verdict // null),
                  reason: ($e.payload.reason // null),
                  vendor: $vendor,
                  model: $model,
                  evidence: ($e.payload.evidence // $e.payload.diff_hash // null),
                  duration_s: ($e.payload.duration_s // $e.payload.duration // null),
                  consumed_seq: $seq
                }
              | .edges[$eid1] = {
                  kind: "edge", relation: "produced", id: $eid1,
                  source: $wid, target: $vid, seq: $seq, ts: $ts,
                  run: $run, consumed_seq: $seq
                }
              | .edges[$eid2] = {
                  kind: "edge", relation: "evaluated_by", id: $eid2,
                  source: $wid, target: $vid, seq: $seq, ts: $ts,
                  run: $run, consumed_seq: $seq
                }
            end

          elif $type == "gate_decision" then
            if $attempt == null or $lane == "" then
              mark_incomplete($st1; $type; $lane; $seq; $ts;
                if $attempt == null then ["payload.attempt"] else ["lane"] end)
            else
              (gate_id($lane; $attempt)) as $gid
              | (work_id($lane; $attempt)) as $wid
              | (edge_key("gated_by"; $wid; $gid; $seq)) as $eid
              | $st1
              | .gates[$gid] = {
                  kind: "node",
                  type: "gate_decision",
                  id: $gid,
                  run: $run,
                  lane: $lane,
                  attempt: $attempt,
                  ts: $ts,
                  seq: $seq,
                  outcome: ($e.payload.outcome // $e.payload.pass // null),
                  reasons: ($e.payload.reasons // []),
                  base_sha: ($e.payload.base_sha // null),
                  head_sha: ($e.payload.head_sha // null),
                  consumed_seq: $seq
                }
              | .edges[$eid] = {
                  kind: "edge", relation: "gated_by", id: $eid,
                  source: $wid, target: $gid, seq: $seq, ts: $ts,
                  run: $run, consumed_seq: $seq
                }
            end

          elif $type == "finding" then
            if $attempt == null or $lane == "" then
              mark_incomplete($st1; $type; $lane; $seq; $ts;
                if $attempt == null then ["payload.attempt"] else ["lane"] end)
            else
              (($findings[($seq|tostring)]) // ("foreman:finding/missing-" + ($seq|tostring))) as $fid
              | (work_id($lane; $attempt)) as $wid
              | (edge_key("produced"; $wid; $fid; $seq)) as $eid
              | $st1
              | .findings[$fid] = {
                  kind: "node",
                  type: "finding",
                  id: $fid,
                  run: $run,
                  lane: $lane,
                  attempt: $attempt,
                  ts: $ts,
                  seq: $seq,
                  file: ($e.payload.file // null),
                  line: ($e.payload.line // null),
                  severity: ($e.payload.severity // null),
                  summary: ($e.payload.summary // null),
                  source: ($e.payload.source // null),
                  upheld: ($e.payload.upheld // null),
                  raw_id: ($e.payload.id // null),
                  consumed_seq: $seq
                }
              | .edges[$eid] = {
                  kind: "edge", relation: "produced", id: $eid,
                  source: $wid, target: $fid, seq: $seq, ts: $ts,
                  run: $run, consumed_seq: $seq
                }
            end

          elif $type == "merge_base" then
            if $attempt != null and $lane != "" and ($e.payload.merge_base // null) != null then
              (work_id($lane; $attempt)) as $wid
              | ($e.payload.merge_base) as $mb
              | (edge_key("descends_from"; $wid; ("git:commit/" + $mb); $seq)) as $eid
              | $st1
              | .edges[$eid] = {
                  kind: "edge", relation: "descends_from", id: $eid,
                  source: $wid, target: ("git:commit/" + $mb),
                  seq: $seq, ts: $ts, run: $run, consumed_seq: $seq
                }
            else
              $st1
            end

          else
            # prompt / ownership / state / checkpoint / waiting_child / alert:
            # attempt node already touched above when attempt present.
            $st1
          end
      end
    end
)

| . as $final
| (
    [
      $final.attempts | to_entries | map(.value)
      | group_by(.lane)[]
      | sort_by(.attempt)
      | select(length >= 2)
      | . as $xs
      | range(1; $xs|length) as $i
      | {
          kind: "edge",
          relation: "supersedes",
          id: edge_key("supersedes"; $xs[$i].id; $xs[$i-1].id; $xs[$i].attempt),
          source: $xs[$i].id,
          target: $xs[$i-1].id,
          seq: $xs[$i].attempt,
          ts: null,
          run: $run,
          # Content of the two attempts only — not the log-wide max_seq — so an
          # additive unknown event does not rewrite known edges.
          consumed_seq: $xs[$i].consumed_seq
        }
    ]
  ) as $supersedes
| (
    [ $final.attempts[] ]
    + [ $final.verdicts[] ]
    + [ $final.gates[] ]
    + [ $final.findings[] ]
    + [ $final.edges[] ]
    + $supersedes
    + $final.incomplete
    + [{
        kind: "coverage",
        type: "coverage",
        id: ("foreman:coverage/" + $run),
        run: $run,
        max_seq: $final.max_seq,
        event_count: $final.event_count,
        attempts_projected: ($final.attempts | length),
        incomplete_records: ($final.incomplete | length),
        durable_events: ($final.event_count > 0),
        reason: (if $final.event_count == 0 then
                   "empty event log; no durable-lane events to project"
                 else null end),
        consumed_seq: $final.max_seq
      }]
  )
| map(select(. != null))
| sort_by(sort_key(.))
| .[]
'

# @description Project a validated events stream to worklog JSONL on stdout.
# @arg $1 run id
# @stdin validated events.jsonl lines
# @stdout worklog.jsonl
gp_project_stream() {
  local run="$1"
  local events_json
  if ! events_json="$(jq -cs '.')"; then
    echo "graph-project: failed to assemble events array" >&2
    return 1
  fi

  # Precompute finding ids (sha256) keyed by event seq.
  local finding_map="{}"
  local row seq ffile fline fsum fid
  while IFS= read -r row; do
    [[ -z "$row" ]] && continue
    seq="$(jq -r '.seq' <<<"$row")"
    ffile="$(jq -r '.payload.file // ""' <<<"$row")"
    fline="$(jq -r '.payload.line // ""' <<<"$row")"
    fsum="$(jq -r '.payload.summary // .payload.id // ""' <<<"$row")"
    if jq -e '(.payload.id | type == "string") and (.payload.id | length > 0)' \
         >/dev/null 2>&1 <<<"$row"; then
      fid="foreman:finding/$(jq -r '.payload.id' <<<"$row")"
    else
      fid="foreman:finding/$(gp_finding_hash "$ffile" "$fline" "$fsum")"
    fi
    finding_map="$(jq -c --arg s "$seq" --arg id "$fid" '. + {($s): $id}' <<<"$finding_map")"
  done < <(jq -c '.[] | select(.type == "finding")' <<<"$events_json")

  if ! jq -c --arg run "$run" --argjson findings "$finding_map" \
        "$GP_JQ_FILTER" <<<"$events_json"; then
    echo "graph-project: projection transform failed" >&2
    return 1
  fi
}

# @description Validate then project an events file for RUN to stdout.
# @arg $1 run id  @arg $2 events path
# @exitcode 0 ok; 1 validate or project failure
gp_project_file() {
  local run="$1" events="$2"
  local validated rc=0
  validated="$(mktemp "${TMPDIR:-/tmp}/gp-events.XXXXXX")"
  if ! gp_validate_events "$events" > "$validated"; then
    rm -f -- "$validated"
    return 1
  fi
  if ! gp_project_stream "$run" < "$validated"; then
    rc=1
  fi
  rm -f -- "$validated"
  return "$rc"
}

# --- main -------------------------------------------------------------------

if (( CHECK == 1 )); then
  if [[ ! -f "$OUT" ]]; then
    echo "graph-project: --check: output file missing: $OUT" >&2
    exit 1
  fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/gp-check.XXXXXX")"
  if ! gp_project_file "$RUN" "$EVENTS" > "$tmp"; then
    rm -f -- "$tmp"
    echo "graph-project: --check: re-projection failed" >&2
    exit 1
  fi
  if cmp -s "$tmp" "$OUT"; then
    rm -f -- "$tmp"
    echo "graph-project: check ok (byte-identical)"
    exit 0
  fi
  echo "graph-project: check FAILED — projection differs from $OUT" >&2
  diff -u "$OUT" "$tmp" >&2 || true
  rm -f -- "$tmp"
  exit 1
fi

if [[ -n "$OUT" ]]; then
  out_dir="$(dirname -- "$OUT")"
  mkdir -p -- "$out_dir"
  tmp="$(mktemp "${out_dir}/.worklog.XXXXXX")"
  if ! gp_project_file "$RUN" "$EVENTS" > "$tmp"; then
    rm -f -- "$tmp"
    exit 1
  fi
  if ! mv -- "$tmp" "$OUT"; then
    rm -f -- "$tmp"
    echo "graph-project: failed to publish $OUT" >&2
    exit 1
  fi
else
  gp_project_file "$RUN" "$EVENTS"
fi
