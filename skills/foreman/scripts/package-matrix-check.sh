#!/usr/bin/env bash
# package-matrix-check.sh — fail-closed TSV matrix checker against openspec inventory
# Validates one literal MATRIX.tsv; never executes field contents.
set -u
set -o pipefail

DIAGNOSTICS=()
declare -A SEEN_PACKAGES=()
declare -A MATRIX_PACKAGES=()

# @description Print usage to stderr and exit nonzero.
# @stdout none
# @exitcode 1 always
die_usage() {
  printf '%s\n' "usage: package-matrix-check.sh MATRIX.tsv" >&2
  exit 1
}

# @description Append one diagnostic line to the aggregate list.
# @arg $1 message diagnostic text (no trailing newline required)
# @stdout none
# @exitcode 0
emit_diag() {
  DIAGNOSTICS+=("$1")
}

# --- argument ---
if [[ $# -ne 1 ]]; then
  die_usage
fi

MATRIX="$1"
if [[ ! -f "$MATRIX" || ! -r "$MATRIX" ]]; then
  printf '%s\n' "error: matrix not readable: ${MATRIX}" >&2
  exit 1
fi

# --- tools ---
if ! command -v openspec >/dev/null 2>&1; then
  printf '%s\n' "error: openspec not found" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' "error: jq not found" >&2
  exit 1
fi

# --- inventory: openspec list --json once ---
OPENSPEC_JSON=""
if ! OPENSPEC_JSON="$(openspec list --json 2>/dev/null)"; then
  printf '%s\n' "error: openspec list --json failed" >&2
  exit 1
fi

if ! printf '%s\n' "$OPENSPEC_JSON" | jq -e . >/dev/null 2>&1; then
  printf '%s\n' "error: openspec list --json returned malformed JSON" >&2
  exit 1
fi

if ! printf '%s\n' "$OPENSPEC_JSON" | jq -e '.changes | type == "array"' >/dev/null 2>&1; then
  printf '%s\n' "error: openspec list --json missing or malformed .changes" >&2
  exit 1
fi

# Type failures first: non-object elements, or name present but not a string.
if printf '%s\n' "$OPENSPEC_JSON" | jq -e '
  any(.changes[];
    if type != "object" then true
    else (has("name") and (.name | type != "string"))
    end)
' >/dev/null 2>&1; then
  printf '%s\n' "error: malformed inventory name" >&2
  exit 1
fi

# Missing or empty string names (separate from malformed-type predicate).
EMPTY_COUNT="$(printf '%s\n' "$OPENSPEC_JSON" | jq '[.changes[] | select((.name // "") == "")] | length')" || {
  printf '%s\n' "error: openspec list --json missing or malformed .changes" >&2
  exit 1
}
if [[ "$EMPTY_COUNT" != "0" ]]; then
  printf '%s\n' "error: openspec inventory contains empty name" >&2
  exit 1
fi

# Collect string names; refuse duplicates. Capture jq exit so a failing
# pipeline is not ignored via process substitution.
NAMES_LIST=""
if ! NAMES_LIST="$(printf '%s\n' "$OPENSPEC_JSON" | jq -r '.changes[] | .name')"; then
  printf '%s\n' "error: openspec list --json missing or malformed .changes" >&2
  exit 1
fi

declare -A INVENTORY=()
INVENTORY_ORDER=()
while IFS= read -r name || [[ -n "$name" ]]; do
  [[ -z "$name" ]] && continue
  if [[ -n "${INVENTORY[$name]+x}" ]]; then
    printf '%s\n' "error: duplicate inventory name: ${name}" >&2
    exit 1
  fi
  INVENTORY["$name"]=1
  INVENTORY_ORDER+=("$name")
done <<< "$NAMES_LIST"

# --- header ---
EXPECTED_HEADER=$'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact'
LINE_NO=0
HEADER_READ=0

while IFS= read -r line || [[ -n "$line" ]]; do
  LINE_NO=$((LINE_NO + 1))

  if [[ $HEADER_READ -eq 0 ]]; then
    if [[ "$line" != "$EXPECTED_HEADER" ]]; then
      emit_diag "invalid header"
      # Continue so later row diagnostics remain part of the aggregate report.
    fi
    HEADER_READ=1
    continue
  fi

  # Count TAB bytes exactly. An empty row has one empty column and is invalid.
  tab_count=0
  rest="$line"
  while [[ "$rest" == *$'\t'* ]]; do
    tab_count=$((tab_count + 1))
    rest="${rest#*$'\t'}"
  done

  if [[ $tab_count -ne 5 ]]; then
    col_count=$((tab_count + 1))
    # empty line: 0 tabs → 1 column
    emit_diag "line ${LINE_NO}: expected 6 columns, got ${col_count}"
    continue
  fi

  # Peel first five fields with parameter expansion on $'\t', sixth is remainder
  field_package="${line%%$'\t'*}"
  remainder="${line#*$'\t'}"
  field_disposition="${remainder%%$'\t'*}"
  remainder="${remainder#*$'\t'}"
  field_owner="${remainder%%$'\t'*}"
  remainder="${remainder#*$'\t'}"
  field_consumer="${remainder%%$'\t'*}"
  remainder="${remainder#*$'\t'}"
  field_verification="${remainder%%$'\t'*}"
  field_artifact="${remainder#*$'\t'}"

  package="$field_package"
  disposition="$field_disposition"
  owner_requirement="$field_owner"
  consumer="$field_consumer"
  verification="$field_verification"
  result_artifact="$field_artifact"

  # Empty package must not become an associative-array key.
  if [[ -z "$package" ]]; then
    emit_diag "line ${LINE_NO}: package is empty"
    continue
  fi

  # disposition allow-list
  case "$disposition" in
    v029-implemented|v029-gap|v030-deferred|parked|withdrawn|split) ;;
    *)
      emit_diag "unknown disposition: ${disposition}"
      ;;
  esac

  # duplicates
  if [[ -n "${SEEN_PACKAGES[$package]+x}" ]]; then
    emit_diag "duplicate package: ${package}"
  else
    SEEN_PACKAGES["$package"]=1
  fi
  MATRIX_PACKAGES["$package"]=1

  # inventory outsider
  if [[ -z "${INVENTORY[$package]+x}" ]]; then
    emit_diag "unknown package: ${package}"
  fi

  # disposition-specific field requirements
  case "$disposition" in
    v029-implemented)
      if [[ -z "$owner_requirement" ]]; then
        emit_diag "v029-implemented package ${package} requires owner_requirement"
      fi
      if [[ -z "$consumer" ]]; then
        emit_diag "v029-implemented package ${package} requires consumer"
      fi
      if [[ -z "$verification" ]]; then
        emit_diag "v029-implemented package ${package} requires verification"
      fi
      if [[ -z "$result_artifact" ]]; then
        emit_diag "v029-implemented package ${package} requires result_artifact"
      fi
      ;;
    v030-deferred|parked|withdrawn|split)
      if [[ -z "$result_artifact" ]]; then
        emit_diag "package ${package} (${disposition}) requires result_artifact"
      fi
      ;;
    v029-gap)
      # no extra field requirements
      ;;
  esac
done < "$MATRIX"

if [[ $HEADER_READ -eq 0 ]]; then
  emit_diag "invalid header"
fi

# missing active packages
for name in "${INVENTORY_ORDER[@]}"; do
  if [[ -z "${MATRIX_PACKAGES[$name]+x}" ]]; then
    emit_diag "missing active package: ${name}"
  fi
done

# --- report ---
if [[ ${#DIAGNOSTICS[@]} -gt 0 ]]; then
  for d in "${DIAGNOSTICS[@]}"; do
    printf '%s\n' "$d" >&2
  done
  exit 1
fi

printf 'PASS: package matrix valid (%s)\n' "$MATRIX"
exit 0
