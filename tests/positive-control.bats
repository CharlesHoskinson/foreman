#!/usr/bin/env bats
# @description Tests for the positive-control machinery: the check inventory,
#   the discrimination helper, and the registry comparator.
#
#   The load-bearing property is that a check which classifies its known-bad
#   and known-good arms identically is REJECTED. A predicate that cannot fail
#   is not coverage, and every defect this repository measured on 2026-07-28
#   lived in that blind spot.

setup() {
  LIB="$BATS_TEST_DIRNAME/lib"
  load "$BATS_TEST_DIRNAME/lib/positive-control.bash"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
}

# --- the helper discriminates -------------------------------------------------

@test "helper rejects a predicate that answers both arms identically" {
  printf '[ok] No violation found\n' >"$WORK/good.txt"
  printf 'ERROR: violation at line 3\n' >"$WORK/bad.txt"
  # The measured 2026-07-28 defect: an unanchored substring predicate matches
  # "No violation found" as readily as a real violation.
  defective() { grep -q 'violation' "$1" && return 1; return 0; }

  run assert_positive_control 'test::defective' "$WORK/bad.txt" "$WORK/good.txt" -- defective
  [ "$status" -ne 0 ]
  [[ "$output" == *"DOES NOT DISCRIMINATE"* ]]
}

@test "helper accepts an anchored predicate that discriminates" {
  printf '[ok] No violation found\n' >"$WORK/good.txt"
  printf 'ERROR: violation at line 3\n' >"$WORK/bad.txt"
  anchored() { grep -qE '^ERROR.*violation' "$1" && return 1; return 0; }

  run assert_positive_control 'test::anchored' "$WORK/bad.txt" "$WORK/good.txt" -- anchored
  [ "$status" -eq 0 ]
}

@test "helper refuses a nonexistent known-bad input instead of passing" {
  printf 'ok\n' >"$WORK/good.txt"
  trivial() { return 0; }

  run assert_positive_control 'test::missing' "$WORK/absent.txt" "$WORK/good.txt" -- trivial
  [ "$status" -ne 0 ]
  [[ "$output" == *"known_bad_input does not exist"* ]]
}

@test "helper rejects a check that accepts the known-bad input" {
  printf 'bad\n' >"$WORK/bad.txt"
  printf 'good\n' >"$WORK/good.txt"
  # Discriminates, but the wrong way round.
  inverted() { grep -q 'good' "$1" && return 1; return 0; }

  run assert_positive_control 'test::inverted' "$WORK/bad.txt" "$WORK/good.txt" -- inverted
  [ "$status" -ne 0 ]
  [[ "$output" == *"accepted the known-bad input"* ]]
}

# --- the inventory ------------------------------------------------------------

@test "check-inventory fails closed on an empty tree rather than reporting zero unregistered" {
  mkdir -p "$WORK/empty"
  run env CHECK_INVENTORY_ROOT="$WORK/empty" \
    CHECK_INVENTORY_OUT="$WORK/empty-inv.tsv" \
    bash "$LIB/check-inventory.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"inventory-empty"* ]]
}

@test "check-inventory finds a bats assertion in a minimal tree" {
  mkdir -p "$WORK/min/tests"
  # Built with printf, deliberately. A heredoc would put a literal `@test`
  # at column 0 inside this file, and bats parses .bats line-wise -- it reads
  # that as a NEW test declaration and silently breaks the enclosing test.
  printf '@test "a sample check" {\n  [ 1 -eq 1 ]\n}\n' >"$WORK/min/tests/x.bats"
  run env CHECK_INVENTORY_ROOT="$WORK/min" \
    CHECK_INVENTORY_OUT="$WORK/min-inv.tsv" \
    bash "$LIB/check-inventory.sh"
  [ "$status" -eq 0 ]
  grep -q 'tests/x.bats::a sample check' "$WORK/min-inv.tsv"
}

@test "check-inventory derives check_id as path::name and nothing else" {
  mkdir -p "$WORK/key/tests"
  printf '@test "named check" {\n  [ 1 -eq 1 ]\n}\n' >"$WORK/key/tests/k.bats"
  run env CHECK_INVENTORY_ROOT="$WORK/key" \
    CHECK_INVENTORY_OUT="$WORK/key-inv.tsv" \
    bash "$LIB/check-inventory.sh"
  [ "$status" -eq 0 ]
  run cut -f1 "$WORK/key-inv.tsv"
  [[ "$output" == *"tests/k.bats::named check"* ]]
}

# --- the spec's four acceptance-fixture checks --------------------------------

@test "acceptance fixture: the scanner independently finds the four named checks" {
  run env CHECK_INVENTORY_OUT="$WORK/repo-inv.tsv" \
    bash "$LIB/check-inventory.sh"
  [ "$status" -eq 0 ]
  # This list is a test OF the scanner. It is not the inventory, and nothing
  # may be registered on the strength of appearing here.
  # Either identity of the mkdir atomicity probe: fm_tc_probe_mkdir_once while
  # it lives in shell, probeMkdirOnce once it is ported. The fixture asks
  # whether the scanner finds the PROBE, not how it is currently spelled.
  grep -qE 'fm_tc_probe_mkdir_once|probeMkdirOnce' "$WORK/repo-inv.tsv"
  grep -q 'validate_skip_budget_file' "$WORK/repo-inv.tsv"
  grep -q 'lookup_baseline' "$WORK/repo-inv.tsv"
  grep -q 'docs-check' "$WORK/repo-inv.tsv"
}

@test "the repository inventory is not exhaustive and says so" {
  # A grammar gap is a stated limitation, never a silent one. tests/run.sh was
  # named by the spec as a gate source and was missing from the first
  # implementation; the skip-budget check was invisible until it was added.
  grep -q 'never described as exhaustive' "$LIB/check-inventory.sh"
}

# --- the comparator -----------------------------------------------------------

@test "comparator fails on an unregistered enforced check" {
  printf 'check_id\tkind\treason\n' >"$WORK/todo.tsv"
  printf 'check_id\tkind\tknown_bad_input\tknown_good_input\tcontrol_record\tdemonstrated_at\n' >"$WORK/reg.tsv"
  run env POSITIVE_CONTROL_REGISTRY="$WORK/reg.tsv" \
    POSITIVE_CONTROL_TODO="$WORK/todo.tsv" \
    bash "$LIB/check-registry-compare.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unregistered check"* ]]
}

@test "comparator fails on a stale registry row" {
  printf 'check_id\tkind\treason\n' >"$WORK/todo.tsv"
  {
    printf 'check_id\tkind\tknown_bad_input\tknown_good_input\tcontrol_record\tdemonstrated_at\n'
    printf 'tests/gone.bats::vanished\tassertion\tREADME.md\tREADME.md\tREADME.md\tdeadbeef\n'
  } >"$WORK/reg.tsv"
  run env POSITIVE_CONTROL_REGISTRY="$WORK/reg.tsv" \
    POSITIVE_CONTROL_TODO="$WORK/todo.tsv" \
    bash "$LIB/check-registry-compare.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"stale registry row"* ]]
}

@test "comparator rejects a registry row with the wrong field count" {
  printf 'check_id\tkind\treason\n' >"$WORK/todo.tsv"
  {
    printf 'check_id\tkind\tknown_bad_input\tknown_good_input\tcontrol_record\tdemonstrated_at\n'
    printf 'a::b\tgate\tREADME.md\n'
  } >"$WORK/reg.tsv"
  run env POSITIVE_CONTROL_REGISTRY="$WORK/reg.tsv" \
    POSITIVE_CONTROL_TODO="$WORK/todo.tsv" \
    bash "$LIB/check-registry-compare.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"expected exactly 6"* ]]
}

@test "comparator rejects a registry row naming a path that does not exist" {
  printf 'check_id\tkind\treason\n' >"$WORK/todo.tsv"
  {
    printf 'check_id\tkind\tknown_bad_input\tknown_good_input\tcontrol_record\tdemonstrated_at\n'
    printf 'a::b\tgate\tno/such/file.txt\tREADME.md\tREADME.md\tdeadbeef\n'
  } >"$WORK/reg.tsv"
  run env POSITIVE_CONTROL_REGISTRY="$WORK/reg.tsv" \
    POSITIVE_CONTROL_TODO="$WORK/todo.tsv" \
    bash "$LIB/check-registry-compare.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"does not exist"* ]]
}

@test "comparator rejects an unrecognised kind" {
  printf 'check_id\tkind\treason\n' >"$WORK/todo.tsv"
  {
    printf 'check_id\tkind\tknown_bad_input\tknown_good_input\tcontrol_record\tdemonstrated_at\n'
    printf 'a::b\tsomething-else\tREADME.md\tREADME.md\tREADME.md\tdeadbeef\n'
  } >"$WORK/reg.tsv"
  run env POSITIVE_CONTROL_REGISTRY="$WORK/reg.tsv" \
    POSITIVE_CONTROL_TODO="$WORK/todo.tsv" \
    bash "$LIB/check-registry-compare.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unrecognised kind"* ]]
}

@test "the committed registry and todo satisfy the comparator" {
  # The shipped state must itself be green, or the ratchet is decorative.
  run bash "$LIB/check-registry-compare.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"positive-control: OK"* ]]
}
