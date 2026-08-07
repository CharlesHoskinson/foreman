#!/usr/bin/env bash
# @description Compare the derived full-repository check inventory against the
#   committed positive-control registry, and fail the build on a discrepancy.
#
#   Three failures, all of them fail-closed:
#     - an inventory member with no registry row      -> unregistered check
#     - a registry row absent from the full inventory -> stale row
#     - an empty inventory                            -> inventory-empty
#
#   An empty inventory is NOT reported as "no unregistered checks". A green
#   build over an empty inventory carries no coverage information and is not
#   citable as coverage.
#
#   SCOPE, stated because the spec requires the limitation to be stated
#   wherever coverage is claimed: enforcement covers the kinds in
#   ENFORCED_KINDS (default: gate, probe). The repository holds 727 bats
#   assertions; demanding a control fixture for each on day one would replace
#   the release with a fixture-authoring program, which is the outcome the
#   owner ruled against when choosing a registry scoped to the gates over
#   repo-wide mutation testing. Assertions and verdict-predicates ARE
#   inventoried, and are reported, but do not fail the build yet.
#
#   RATCHET: tests/positive-control-todo.tsv lists enforced-kind checks that
#   are known to lack a control. A check in that file is reported, not fatal.
#   A check in NEITHER the registry NOR the todo file is fatal -- so a NEW gate
#   added without a control fails the build, which is the property this exists
#   for. The todo file only ever shrinks.
# @exitcode 0 all enforced checks are registered or explicitly deferred
# @exitcode 1 a discrepancy was found
# @exitcode 2 the inventory could not be derived
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$TESTS_DIR/.." && pwd)"
REGISTRY="${POSITIVE_CONTROL_REGISTRY:-$TESTS_DIR/positive-control-registry.tsv}"
TODO="${POSITIVE_CONTROL_TODO:-$TESTS_DIR/positive-control-todo.tsv}"
INVENTORY="${CHECK_INVENTORY_OUT:-$TESTS_DIR/.check-inventory.tsv}"
ENFORCED_KINDS="${ENFORCED_KINDS:-gate probe}"

VALID_KINDS="gate probe assertion verdict-predicate"
failures=0

# @description Report a failure and count it.
fail() {
  printf 'FAIL %s\n' "$1" >&2
  failures=$((failures + 1))
}

# @description Derive the inventory at the tree under test.
derive_inventory() {
  if ! bash "$TESTS_DIR/lib/check-inventory.sh"; then
    printf 'FAIL inventory-empty\n' >&2
    exit 2
  fi
}

# @description Reject a malformed registry before comparing anything: a row
#   with a missing field, an unrecognised kind, or a path that does not exist
#   fails the build.
validate_registry() {
  local lineno=0 line check_id kind bad good record demo nf
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    [[ "$lineno" -eq 1 ]] && continue
    [[ -z "$line" ]] && continue

    nf="$(awk -F'\t' '{print NF}' <<<"$line")"
    if [[ "$nf" -ne 6 ]]; then
      fail "registry row $lineno has $nf fields, expected exactly 6"
      continue
    fi
    IFS=$'\t' read -r check_id kind bad good record demo <<<"$line"

    if [[ " $VALID_KINDS " != *" $kind "* ]]; then
      fail "registry row $lineno ($check_id) has unrecognised kind: $kind"
    fi
    local p
    for p in "$bad" "$good" "$record"; do
      if [[ ! -e "$REPO_ROOT/$p" ]]; then
        fail "registry row $lineno ($check_id) names a path that does not exist: $p"
      fi
    done
    if [[ -z "$demo" ]]; then
      fail "registry row $lineno ($check_id) has an empty demonstrated_at"
    fi
  done <"$REGISTRY"
}

# @description Compare inventory against registry over the enforced kinds.
compare() {
  local rows
  rows="$(($(wc -l <"$INVENTORY") - 1))"
  if [[ "$rows" -le 0 ]]; then
    printf 'FAIL inventory-empty\n' >&2
    exit 2
  fi

  local registered todo_ids enforced_inventory
  registered="$(mktemp)"
  todo_ids="$(mktemp)"
  enforced_inventory="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$registered' '$todo_ids' '$enforced_inventory'" RETURN

  tail -n +2 "$REGISTRY" | cut -f1 | LC_ALL=C sort -u >"$registered"
  if [[ -f "$TODO" ]]; then
    tail -n +2 "$TODO" | cut -f1 | LC_ALL=C sort -u >"$todo_ids"
  else
    : >"$todo_ids"
  fi

  local kind kind_rows
  for kind in $ENFORCED_KINDS; do
    kind_rows="$(awk -F'\t' -v k="$kind" 'NR > 1 && $2 == k' "$INVENTORY" | wc -l)"
    # An enforced kind with zero members carries no coverage, and reporting it
    # as clean is how a whole class of checks disappears unnoticed. Measured:
    # the probe recognizer reads shell only, so when env/tool-check.sh became a
    # thin Node adapter its 9 probes went to 0 and nothing objected.
    if [[ "$kind_rows" -eq 0 ]]; then
      fail "enforced kind '$kind' inventories zero checks -- extend the recognizer grammar to wherever those checks moved, or retire the kind from ENFORCED_KINDS deliberately"
    fi
    awk -F'\t' -v k="$kind" 'NR > 1 && $2 == k {print $1}' "$INVENTORY"
  done | LC_ALL=C sort -u >"$enforced_inventory"

  # Unregistered: in the enforced inventory, in neither registry nor todo.
  local id
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    fail "unregistered check has no positive control and no todo entry: $id"
  done < <(LC_ALL=C comm -23 "$enforced_inventory" \
    <(LC_ALL=C sort -u "$registered" "$todo_ids"))

  # Stale: a registry row whose check_id the FULL inventory does not contain.
  # Compared against the full inventory, not the enforced subset, so a row for
  # an assertion is not called stale merely because assertions are unenforced.
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    fail "stale registry row names a check the repository does not contain: $id"
  done < <(LC_ALL=C comm -23 "$registered" \
    <(tail -n +2 "$INVENTORY" | cut -f1 | LC_ALL=C sort -u))

  # Stale todo entries are equally misleading: they imply work that no longer exists.
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    fail "stale todo row names a check the repository does not contain: $id"
  done < <(LC_ALL=C comm -23 "$todo_ids" \
    <(tail -n +2 "$INVENTORY" | cut -f1 | LC_ALL=C sort -u))

  local n_reg n_todo n_enf
  n_reg="$(wc -l <"$registered")"
  n_todo="$(wc -l <"$todo_ids")"
  n_enf="$(wc -l <"$enforced_inventory")"
  printf 'positive-control: inventory=%d enforced(%s)=%d registered=%d deferred=%d\n' \
    "$rows" "${ENFORCED_KINDS// /,}" "$n_enf" "$n_reg" "$n_todo" >&2
  printf 'positive-control: assertion and verdict-predicate kinds are inventoried but NOT enforced -- coverage claims must say so\n' >&2
}

# @description Derive the inventory, validate the registry's shape, then
#   compare the two. Every discrepancy is reported before the exit status is
#   decided, so one run names all of them rather than only the first.
# @exitcode 0 registry and inventory agree over the enforced kinds
# @exitcode 1 a discrepancy was found
# @exitcode 2 the inventory could not be derived
main() {
  if [[ ! -f "$REGISTRY" ]]; then
    printf 'FAIL registry missing: %s\n' "$REGISTRY" >&2
    exit 1
  fi
  derive_inventory
  validate_registry
  compare
  if [[ "$failures" -gt 0 ]]; then
    printf 'positive-control: %d failure(s)\n' "$failures" >&2
    return 1
  fi
  printf 'positive-control: OK\n' >&2
  return 0
}

main "$@"
