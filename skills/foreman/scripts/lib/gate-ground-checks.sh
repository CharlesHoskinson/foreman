#!/usr/bin/env bash
# lib/gate-ground-checks.sh — content-driven groundedness canary predicates.
# shellcheck shell=bash
# shellcheck disable=SC2034  # Public unevaluated state is consumed by callers.
# Source-safe: declarations only; no fixture is evaluated while sourcing.

declare -Ag GG_CHECK_LAST_UNEVALUATED=()

# @description Record that a check lacked one of its declared inputs.
# @arg $1 registered check id
# @arg $2 missing input name
# @exitcode 1 always (not a violation)
gg_check_unevaluated() {
  local id="$1" input="$2"
  GG_CHECK_LAST_UNEVALUATED["$id"]="$input"
  return 1
}

# @description Test whether a JSON predicate can be evaluated on a fixture.
# @arg $1 fixture JSON path
# @arg $2 registered check id
# @arg $3 declared input name
# @arg $4 jq predicate proving that input is complete
# @exitcode 0 when present; 1 after recording the missing input otherwise
gg_check_require() {
  local fixture="$1" id="$2" input="$3" predicate="$4"
  if jq -e "$predicate" "$fixture" >/dev/null 2>&1; then
    return 0
  fi
  gg_check_unevaluated "$id" "$input"
}

# @description Detect G1 citations outside the complete diff path set.
# Repository-only paths are advisory G1 facts; paths in neither complete set are
# blocking-form G1 facts. The canary interface aggregates both under G1.
# @arg $1 fixture JSON path
# @exitcode 0 when G1 is violated; 1 when clean or unevaluated
gg_check_G1() {
  local fixture="$1"
  gg_check_require "$fixture" G1 findings \
    '.findings | type == "array" and all(.[]; .file | type == "string")' || return 1
  gg_check_require "$fixture" G1 diff \
    '.changed_paths | type == "array" and all(.[]; type == "string")' || return 1
  gg_check_require "$fixture" G1 repository_head \
    '.repository_head.paths | type == "array" and all(.[]; type == "string")' || return 1

  jq -e '
    . as $artifact
    | any($artifact.findings[];
      .file as $path
      | ($artifact.changed_paths | index($path)) == null)
  ' "$fixture" >/dev/null
}

# @description Detect G2 impossible or out-of-hunk positive line citations.
# @arg $1 fixture JSON path
# @exitcode 0 when G2 is violated; 1 when clean or unevaluated
gg_check_G2() {
  local fixture="$1" missing_path
  gg_check_require "$fixture" G2 findings \
    '.findings | type == "array" and all(.[]; (.file | type == "string") and (.line | type == "number"))' || return 1
  gg_check_require "$fixture" G2 citation_revision \
    '.citation_revision.files | type == "object"' || return 1

  missing_path="$(jq -r '
    . as $artifact
    | first($artifact.findings[]
      | select(.line > 0)
      | .file as $path
      | select($artifact.citation_revision.files[$path] == null)
      | $path) // empty
  ' "$fixture")"
  if [[ -n "$missing_path" ]]; then
    gg_check_unevaluated G2 "citation_revision:$missing_path"
    return 1
  fi

  jq -e '
    . as $artifact
    | any($artifact.findings[];
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
        ))
  ' "$fixture" >/dev/null
}

# @description Detect G3 declared criterion identifiers without a discharge.
# @arg $1 fixture JSON path
# @exitcode 0 when G3 is violated; 1 when clean or unevaluated
gg_check_G3() {
  local fixture="$1"
  gg_check_require "$fixture" G3 criterion_ids \
    '.criteria | type == "array" and all(.[]; type == "string")' || return 1
  gg_check_require "$fixture" G3 discharges \
    '.discharged_criteria | type == "array" and all(.[]; type == "string")' || return 1
  jq -e '. as $artifact | any($artifact.criteria[]; . as $id | ($artifact.discharged_criteria | index($id)) == null)' \
    "$fixture" >/dev/null
}

# @description Detect G4 equality where the recorded policy requires separation.
# @arg $1 fixture JSON path
# @exitcode 0 when G4 is violated; 1 when clean or unevaluated
gg_check_G4() {
  local fixture="$1"
  gg_check_require "$fixture" G4 recorded_worker_vendor \
    '.provenance.worker_vendor | type == "string" and length > 0' || return 1
  gg_check_require "$fixture" G4 recorded_audit_vendor \
    '.provenance.audit_vendor | type == "string" and length > 0' || return 1
  gg_check_require "$fixture" G4 separation_policy \
    '.separation_policy | type == "string"' || return 1
  jq -e '
    .separation_policy == "cross_vendor"
    and .provenance.worker_vendor == .provenance.audit_vendor
  ' "$fixture" >/dev/null
}

# @description Detect G5 a missing or unresolved rubric version at a recorded base.
# The fixture's rubric_versions object is the complete base-tree resolution set.
# @arg $1 fixture JSON path
# @exitcode 0 when G5 is violated; 1 when clean or unevaluated
gg_check_G5() {
  local fixture="$1"
  gg_check_require "$fixture" G5 base_sha \
    '.base_sha | type == "string" and length > 0' || return 1
  gg_check_require "$fixture" G5 rubric \
    '.provenance.rubric | type == "string" and length > 0' || return 1
  gg_check_require "$fixture" G5 rubric_versions \
    '.rubric_versions | type == "object"' || return 1
  jq -e '
    . as $artifact
    | $artifact.provenance.rubric as $rubric
    | ($artifact.provenance.rubric_version | type != "string")
      or ($artifact.provenance.rubric_version | length == 0)
      or (($artifact.rubric_versions[$rubric] // [])
        | index($artifact.provenance.rubric_version) | not)
  ' "$fixture" >/dev/null
}

# @description Detect G6 changed paths outside every declared scope glob.
# @arg $1 fixture JSON path
# @exitcode 0 when G6 is violated; 1 when clean or unevaluated
gg_check_G6() {
  local fixture="$1" changed_path scope_glob matched
  local -a changed_paths=() scope_globs=()
  gg_check_require "$fixture" G6 changed_paths \
    '.changed_paths | type == "array" and all(.[]; type == "string")' || return 1
  gg_check_require "$fixture" G6 scope_globs \
    '.scope | type == "array" and all(.[]; type == "string")' || return 1
  mapfile -t changed_paths < <(jq -r '.changed_paths[]' "$fixture")
  mapfile -t scope_globs < <(jq -r '.scope[]' "$fixture")

  for changed_path in "${changed_paths[@]}"; do
    matched=0
    for scope_glob in "${scope_globs[@]}"; do
      # shellcheck disable=SC2053  # The registry input is intentionally a glob.
      if [[ "$changed_path" == $scope_glob ]]; then
        matched=1
        break
      fi
    done
    (( matched == 0 )) && return 0
  done
  return 1
}

# @description Detect G9a APPROVED with a critical or high finding.
# @arg $1 fixture JSON path
# @exitcode 0 when G9a is violated; 1 when clean or unevaluated
gg_check_G9a() {
  local fixture="$1"
  gg_check_require "$fixture" G9a verdict '.verdict | type == "string"' || return 1
  gg_check_require "$fixture" G9a findings '.findings | type == "array"' || return 1
  jq -e '
    .verdict == "APPROVED"
    and any(.findings[]; .severity == "critical" or .severity == "high")
  ' "$fixture" >/dev/null
}

# @description Detect G9b BLOCKED without a severe finding or criterion miss.
# @arg $1 fixture JSON path
# @exitcode 0 when G9b is violated; 1 when clean or unevaluated
gg_check_G9b() {
  local fixture="$1"
  gg_check_require "$fixture" G9b verdict '.verdict | type == "string"' || return 1
  gg_check_require "$fixture" G9b findings '.findings | type == "array"' || return 1
  gg_check_require "$fixture" G9b criterion_misses \
    '.criterion_misses | type == "array"' || return 1
  jq -e '
    .verdict == "BLOCKED"
    and (any(.findings[]; .severity == "critical" or .severity == "high") | not)
    and (.criterion_misses | length == 0)
  ' "$fixture" >/dev/null
}

# @description Detect G9c WARNING with a complete empty findings set.
# @arg $1 fixture JSON path
# @exitcode 0 when G9c is violated; 1 when clean or unevaluated
gg_check_G9c() {
  local fixture="$1"
  gg_check_require "$fixture" G9c verdict '.verdict | type == "string"' || return 1
  gg_check_require "$fixture" G9c findings '.findings | type == "array"' || return 1
  jq -e '.verdict == "WARNING" and (.findings | length == 0)' \
    "$fixture" >/dev/null
}

# @description Evaluate every registered predicate against fixture content.
# @arg $1 fixture JSON path
# @stdout one check<TAB>focus row per observed registered violation
# @exitcode 0 on a complete dispatch; nonzero on unreadable JSON or a missing check
gg_canary_evaluate_fixture() {
  local fixture="$1" id function status
  if ! jq -e 'type == "object"' "$fixture" >/dev/null 2>&1; then
    printf 'GG_CHECK_FIXTURE_INVALID path=%s\n' "$fixture" >&2
    return 1
  fi
  if (( ${#GG_REGISTRY_IDS[@]} == 0 )); then
    gg_registry_load "$GG_DEFAULT_REGISTRY" || return 1
  fi

  GG_CHECK_LAST_UNEVALUATED=()
  for id in "${GG_REGISTRY_IDS[@]}"; do
    function="gg_check_$id"
    if ! declare -F "$function" >/dev/null 2>&1; then
      printf 'GG_CHECK_UNIMPLEMENTED check=%s\n' "$id" >&2
      return 1
    fi
    if "$function" "$fixture"; then
      printf '%s\tartifact:%s\n' "$id" "$id"
    else
      status=$?
      if (( status != 1 )); then
        printf 'GG_CHECK_ERROR check=%s status=%s\n' "$id" "$status" >&2
        return 1
      fi
    fi
  done
  return 0
}
