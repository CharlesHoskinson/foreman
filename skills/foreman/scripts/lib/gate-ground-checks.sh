#!/usr/bin/env bash
# lib/gate-ground-checks.sh — content-driven groundedness canary predicates.
# shellcheck shell=bash
# shellcheck disable=SC2034  # Public unevaluated state is consumed by callers.
# Source-safe: declarations only; no fixture is evaluated while sourcing.

declare -Ag GG_CHECK_LAST_UNEVALUATED=()
GG_CHECK_PROGRAM=""

# Shared by the public shape probe and the single-parse evaluator. Keeping the
# shape predicate here lets gg_canary_run distinguish shape failures without a
# second jq parse of every fixture.
GG_CANARY_SHAPE_JQ='
  type == "object"
  and (.verdict == "APPROVED" or .verdict == "WARNING" or .verdict == "BLOCKED")
  and (.summary | type == "string")
  and (.findings | type == "array")
  and all(.findings[];
    type == "object"
    and (.severity == "critical" or .severity == "high"
      or .severity == "medium" or .severity == "low")
    and (.file | type == "string")
    and (.line | type == "number" and . == floor)
    and (.summary | type == "string")
    and (.evidence | type == "string"))
'

# Each registered function installs one legible jq fragment in
# GG_CHECK_PROGRAM. gg_canary_evaluate_fixture composes only the registered
# fragments, then parses the fixture once. A result carries the check identity,
# its first missing declared input (if any), and its violation verdict.

# @description Install the G1 citation-path predicate.
gg_check_G1() {
  GG_CHECK_PROGRAM='
    if ((try ((.findings | type) == "array"
      and all(.findings[]; .file | type == "string")) catch false) | not) then
      {id:"G1", missing:"findings", violated:false}
    elif ((try ((.changed_paths | type) == "array"
      and all(.changed_paths[]; type == "string")) catch false) | not) then
      {id:"G1", missing:"diff", violated:false}
    elif ((try ((.repository_head.paths | type) == "array"
      and all(.repository_head.paths[]; type == "string")) catch false) | not) then
      {id:"G1", missing:"repository_head", violated:false}
    else
      . as $artifact
      | any($artifact.findings[];
          .file as $path
          | ($artifact.changed_paths | index($path)) == null) as $violated
      | {id:"G1", missing:null, violated:$violated}
    end
  '
}

# @description Install the G2 citation-line predicate.
gg_check_G2() {
  GG_CHECK_PROGRAM='
    if ((try ((.findings | type) == "array"
      and all(.findings[];
        (.file | type == "string") and (.line | type == "number")))
      catch false) | not) then
      {id:"G2", missing:"findings", violated:false}
    elif ((try (.citation_revision.files | type == "object") catch false) | not) then
      {id:"G2", missing:"citation_revision", violated:false}
    else
      . as $artifact
      | (first($artifact.findings[]
          | select(.line > 0)
          | .file as $path
          | select($artifact.citation_revision.files[$path] == null)
          | $path) // "") as $missing_path
      | if ($missing_path | length) > 0 then
          {id:"G2", missing:("citation_revision:" + $missing_path), violated:false}
        else
          (any($artifact.findings[];
            select(.line > 0)
            | .file as $path
            | .line as $line
            | $artifact.citation_revision.files[$path] as $revision
            | ($revision.line_count | type == "number")
              and ($revision.changed_ranges | type == "array")
              and (
                $line > $revision.line_count
                or (all($revision.changed_ranges[];
                  (type != "array") or (length != 2)
                  or ($line < .[0]) or ($line > .[1])))
              ))) as $violated
          | {id:"G2", missing:null, violated:$violated}
        end
    end
  '
}

# @description Install the G3 criterion-discharge predicate.
gg_check_G3() {
  GG_CHECK_PROGRAM='
    if ((try ((.criteria | type) == "array"
      and all(.criteria[]; type == "string")) catch false) | not) then
      {id:"G3", missing:"criterion_ids", violated:false}
    elif ((try ((.discharged_criteria | type) == "array"
      and all(.discharged_criteria[]; type == "string")) catch false) | not) then
      {id:"G3", missing:"discharges", violated:false}
    else
      . as $artifact
      | any($artifact.criteria[];
          . as $id
          | ($artifact.discharged_criteria | index($id)) == null) as $violated
      | {id:"G3", missing:null, violated:$violated}
    end
  '
}

# @description Install the G4 vendor-separation predicate.
gg_check_G4() {
  GG_CHECK_PROGRAM='
    if ((try (.provenance.worker_vendor | type == "string" and length > 0)
      catch false) | not) then
      {id:"G4", missing:"recorded_worker_vendor", violated:false}
    elif ((try (.provenance.audit_vendor | type == "string" and length > 0)
      catch false) | not) then
      {id:"G4", missing:"recorded_audit_vendor", violated:false}
    elif ((try (.separation_policy | type == "string") catch false) | not) then
      {id:"G4", missing:"separation_policy", violated:false}
    else
      (.separation_policy == "cross_vendor"
        and .provenance.worker_vendor == .provenance.audit_vendor) as $violated
      | {id:"G4", missing:null, violated:$violated}
    end
  '
}

# @description Install the G5 rubric-version predicate.
gg_check_G5() {
  GG_CHECK_PROGRAM='
    if ((try (.base_sha | type == "string" and length > 0) catch false) | not) then
      {id:"G5", missing:"base_sha", violated:false}
    elif ((try (.provenance.rubric | type == "string" and length > 0)
      catch false) | not) then
      {id:"G5", missing:"rubric", violated:false}
    elif ((try (.rubric_versions | type == "object") catch false) | not) then
      {id:"G5", missing:"rubric_versions", violated:false}
    else
      . as $artifact
      | $artifact.provenance.rubric as $rubric
      | (($artifact.provenance.rubric_version | type != "string")
        or ($artifact.provenance.rubric_version | length == 0)
        or (($artifact.rubric_versions[$rubric] // [])
          | index($artifact.provenance.rubric_version) | not)) as $violated
      | {id:"G5", missing:null, violated:$violated}
    end
  '
}

# @description Install the G6 scope predicate and expose its arrays for Bash's
# exact [[ value == glob ]] matching semantics after the one JSON parse.
gg_check_G6() {
  GG_CHECK_PROGRAM='
    if ((try ((.changed_paths | type) == "array"
      and all(.changed_paths[]; type == "string")) catch false) | not) then
      {id:"G6", missing:"changed_paths", violated:false}
    elif ((try ((.scope | type) == "array"
      and all(.scope[]; type == "string")) catch false) | not) then
      {id:"G6", missing:"scope_globs", violated:false}
    else
      {id:"G6", missing:null, violated:false,
        changed_paths:.changed_paths, scope_globs:.scope}
    end
  '
}

# @description Install the G9a verdict-consistency predicate.
gg_check_G9a() {
  GG_CHECK_PROGRAM='
    if ((try (.verdict | type == "string") catch false) | not) then
      {id:"G9a", missing:"verdict", violated:false}
    elif ((try (.findings | type == "array") catch false) | not) then
      {id:"G9a", missing:"findings", violated:false}
    else
      (.verdict == "APPROVED"
        and any(.findings[];
          .severity == "critical" or .severity == "high")) as $violated
      | {id:"G9a", missing:null, violated:$violated}
    end
  '
}

# @description Install the G9b verdict-consistency predicate.
gg_check_G9b() {
  GG_CHECK_PROGRAM='
    if ((try (.verdict | type == "string") catch false) | not) then
      {id:"G9b", missing:"verdict", violated:false}
    elif ((try (.findings | type == "array") catch false) | not) then
      {id:"G9b", missing:"findings", violated:false}
    elif ((try (.criterion_misses | type == "array") catch false) | not) then
      {id:"G9b", missing:"criterion_misses", violated:false}
    else
      (.verdict == "BLOCKED"
        and (any(.findings[];
          .severity == "critical" or .severity == "high") | not)
        and (.criterion_misses | length == 0)) as $violated
      | {id:"G9b", missing:null, violated:$violated}
    end
  '
}

# @description Install the G9c verdict-consistency predicate.
gg_check_G9c() {
  GG_CHECK_PROGRAM='
    if ((try (.verdict | type == "string") catch false) | not) then
      {id:"G9c", missing:"verdict", violated:false}
    elif ((try (.findings | type == "array") catch false) | not) then
      {id:"G9c", missing:"findings", violated:false}
    else
      (.verdict == "WARNING" and (.findings | length == 0)) as $violated
      | {id:"G9c", missing:null, violated:$violated}
    end
  '
}

# @description Evaluate every registered predicate from one parse of fixture.
# @arg $1 fixture JSON path
# @stdout one check<TAB>focus row per observed registered violation
# @exitcode 0 complete dispatch; 2 shape mismatch; 1 unreadable JSON/missing check
gg_canary_evaluate_fixture() {
  local fixture="$1" id function separator jq_output jq_program
  local kind encoded status extra decoded changed_path scope_glob matched
  local -a g6_changed_paths=() g6_scope_globs=()
  local -A expected=() observed=() violated=()

  if (( ${#GG_REGISTRY_IDS[@]} == 0 )); then
    gg_registry_load "$GG_DEFAULT_REGISTRY" || return 1
  fi

  jq_program="if ((try ($GG_CANARY_SHAPE_JQ) catch false) | not) then
    \"SHAPE\"
  else
    ["
  separator=""
  for id in "${GG_REGISTRY_IDS[@]}"; do
    expected["$id"]=1
    function="gg_check_$id"
    if ! declare -F "$function" >/dev/null 2>&1; then
      printf 'GG_CHECK_UNIMPLEMENTED check=%s\n' "$id" >&2
      return 1
    fi
    "$function"
    jq_program+="$separator try ($GG_CHECK_PROGRAM) catch {id:\"$id\", error:true}"
    separator=","
  done
  jq_program+=']
    | .[]
    | if .error then
        ["CHECK", .id, "x", "ERROR"] | @tsv
      elif .id == "G6" and .missing == null then
        (["CHECK", .id, "x", "GLOB"] | @tsv),
        (.changed_paths[] | ["G6_CHANGED", ("x" + .)] | @tsv),
        (.scope_globs[] | ["G6_SCOPE", ("x" + .)] | @tsv)
      else
        ["CHECK", .id, ("x" + (.missing // "")),
          (if .violated then "1" else "0" end)] | @tsv
      end
  end'

  if ! jq_output="$(jq -r "$jq_program" "$fixture" 2>/dev/null)"; then
    printf 'GG_CHECK_FIXTURE_INVALID path=%s\n' "$fixture" >&2
    return 1
  fi
  if [[ "$jq_output" == "SHAPE" ]]; then
    printf 'GG_CHECK_FIXTURE_SHAPE_INVALID path=%s\n' "$fixture" >&2
    return 2
  fi

  GG_CHECK_LAST_UNEVALUATED=()
  while IFS=$'\t' read -r kind id encoded status extra; do
    case "$kind" in
      CHECK)
        if [[ -z "${expected[$id]+present}" || -n "${observed[$id]+present}" ||
          -z "$encoded" || -z "$status" || -n "$extra" ]]; then
          printf 'GG_CHECK_RESULT_INVALID check=%s\n' "$id" >&2
          return 1
        fi
        observed["$id"]=1
        printf -v decoded '%b' "$encoded"
        decoded="${decoded#x}"
        if [[ -n "$decoded" ]]; then
          GG_CHECK_LAST_UNEVALUATED["$id"]="$decoded"
          violated["$id"]=0
        elif [[ "$status" == "0" || "$status" == "1" ]]; then
          violated["$id"]="$status"
        elif [[ "$id" == "G6" && "$status" == "GLOB" ]]; then
          violated["$id"]=0
        elif [[ "$status" == "ERROR" ]]; then
          printf 'GG_CHECK_ERROR check=%s status=jq\n' "$id" >&2
          return 1
        else
          printf 'GG_CHECK_RESULT_INVALID check=%s\n' "$id" >&2
          return 1
        fi
        ;;
      G6_CHANGED|G6_SCOPE)
        if [[ -z "${expected[G6]+present}" || -z "$id" ||
          -n "$encoded" || -n "$status" || -n "$extra" ]]; then
          printf 'GG_CHECK_RESULT_INVALID check=G6\n' >&2
          return 1
        fi
        printf -v decoded '%b' "$id"
        decoded="${decoded#x}"
        if [[ "$kind" == "G6_CHANGED" ]]; then
          g6_changed_paths+=("$decoded")
        else
          g6_scope_globs+=("$decoded")
        fi
        ;;
      *)
        printf 'GG_CHECK_RESULT_INVALID check=unknown\n' >&2
        return 1
        ;;
    esac
  done <<<"$jq_output"

  for id in "${GG_REGISTRY_IDS[@]}"; do
    if [[ -z "${observed[$id]+present}" ]]; then
      printf 'GG_CHECK_RESULT_INVALID check=%s\n' "$id" >&2
      return 1
    fi
  done

  if [[ -n "${expected[G6]+present}" &&
    -z "${GG_CHECK_LAST_UNEVALUATED[G6]+present}" ]]; then
    for changed_path in "${g6_changed_paths[@]}"; do
      matched=0
      for scope_glob in "${g6_scope_globs[@]}"; do
        # shellcheck disable=SC2053  # Registry input is intentionally a glob.
        if [[ "$changed_path" == $scope_glob ]]; then
          matched=1
          break
        fi
      done
      if (( matched == 0 )); then
        violated[G6]=1
        break
      fi
    done
  fi

  for id in "${GG_REGISTRY_IDS[@]}"; do
    if [[ "${violated[$id]}" == "1" ]]; then
      printf '%s\tartifact:%s\n' "$id" "$id"
    fi
  done
  return 0
}
