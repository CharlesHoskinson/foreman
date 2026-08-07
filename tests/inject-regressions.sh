#!/usr/bin/env bash
# @description Seed known defects into an isolated copy of the tree and assert
#   the owning test slice fails for each. A suite that stays green while a real
#   defect is present is not protecting the property it claims to protect, and
#   nothing else in the harness can tell you that.
#
#   This is the negative control to tests/lib/positive-control.bash's positive
#   one. Positive controls prove a check can distinguish good from bad input;
#   this proves the SUITE can distinguish good from bad IMPLEMENTATION.
#
#   The working tree is never mutated. Each case runs against a fresh
#   `git archive HEAD` extraction in a temp directory, so an interrupted run
#   cannot leave a seeded defect behind in the repository -- which is the one
#   way a tool like this could do real harm.
#
#   Any seeded defect whose owning slice stays GREEN is reported as an
#   UNPROTECTED DEFECT CLASS and fails this script.
# @exitcode 0 every seeded defect was caught by its owning slice
# @exitcode 1 at least one defect class is unprotected
# @exitcode 2 the harness could not run
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BATS="${BATS:-$(command -v bats || true)}"
LOCK="${FOREMAN_HOME:-$HOME/.foreman}/gate.lock"
KEEP="${INJECT_KEEP_TREE:-0}"
failures=0
declare -a UNPROTECTED=()

[[ -n "$BATS" ]] || { printf 'ERROR bats not found\n' >&2; exit 2; }

# @description Extract a pristine copy of HEAD into a temp directory. Tracked
#   files only, no .git -- the copy must not be committable by accident.
# @stdout path to the extracted tree
make_tree() {
  local d
  d="$(mktemp -d "${TMPDIR:-/tmp}/foreman-inject.XXXXXX")" || return 1
  git -C "$REPO_ROOT" archive HEAD | tar -x -C "$d" || return 1
  printf '%s\n' "$d"
}

# @description Run one seeded-defect case.
# @arg $1 case id
# @arg $2 slice: the bats file that OWNS this property
# @arg $3 human description of the defect
# @arg $4 mutator: a function name, called with the tree root
run_case() {
  local id="$1" slice="$2" desc="$3" mutator="$4"
  local tree rc out

  tree="$(make_tree)" || { printf 'ERROR could not extract tree\n' >&2; return 2; }

  # Each mutator asserts its own post-condition and returns non-zero if the
  # pattern it targets was not present. That matters more than it looks: a
  # mutator that silently no-ops would "prove" the suite catches a defect that
  # was never actually introduced, which is the exact false confidence this
  # script exists to destroy.
  if ! "$mutator" "$tree"; then
    printf 'ERROR %s: mutator did not apply -- the pattern it targets has moved\n' "$id" >&2
    rm -rf "$tree"
    failures=$((failures + 1))
    return 1
  fi

  out="$(cd "$tree" && flock "$LOCK" "$BATS" --formatter tap "$slice" 2>&1)"
  rc=$?

  if [[ "$rc" -ne 0 ]]; then
    local caught_by
    caught_by="$(printf '%s\n' "$out" | grep -m3 '^not ok' | sed 's/^/           /')"
    printf 'CAUGHT   %-28s %s\n' "$id" "$desc"
    printf '         owning slice %s failed as it must\n' "$slice"
    [[ -n "$caught_by" ]] && printf '%s\n' "$caught_by"
  else
    printf 'UNCAUGHT %-28s %s\n' "$id" "$desc"
    printf '         owning slice %s stayed GREEN with the defect present\n' "$slice"
    printf '         %s tests ran\n' "$(printf '%s\n' "$out" | grep -c '^ok')"
    UNPROTECTED+=("$id ($slice): $desc")
    failures=$((failures + 1))
  fi

  if [[ "$KEEP" == "1" ]]; then
    printf '         tree kept at %s\n' "$tree"
  else
    rm -rf "$tree"
  fi
  return 0
}

# --- the seeded defects -------------------------------------------------------
#
# The mutators match SOURCE TEXT literally, so every pattern below is
# single-quoted on purpose: `$prev` and `$lock` must reach grep and sed as the
# characters that appear in eventlog.sh, not as this shell's expansions.
# shellcheck disable=SC2016

# @description Duplicate sequence number: stop advancing .seq, so two emits in
#   one run receive the same seq. el_emit's own comment names this the only
#   unacceptable outcome -- a gap is fine, a duplicate is not.
# @arg $1 tree root
mutate_duplicate_seq() {
  local f="$1/skills/foreman/scripts/lib/eventlog.sh"
  [[ -f "$f" ]] || return 1
  grep -q 'seq=$(( ${prev:-0} + 1 ))' "$f" || return 1
  sed -i 's/seq=$(( ${prev:-0} + 1 ))/seq=$(( ${prev:-0} ))/' "$f"
  grep -q 'seq=$(( ${prev:-0} ))' "$f"
}

# @description Swallowed concurrency collision: a refused lock acquisition
#   stops being fatal, so concurrent emitters interleave in the critical
#   section instead of serializing.
# @arg $1 tree root
# shellcheck disable=SC2016
mutate_swallow_lock_failure() {
  local f="$1/skills/foreman/scripts/lib/eventlog.sh"
  [[ -f "$f" ]] || return 1
  grep -q 'if ! fm_lock_acquire "$lock" >/dev/null; then' "$f" || return 1
  # Turn the guard into one that never fires.
  sed -i 's/if ! fm_lock_acquire "\$lock" >\/dev\/null; then/if false \&\& ! fm_lock_acquire "$lock" >\/dev\/null; then/' "$f"
  grep -q 'if false && ! fm_lock_acquire' "$f"
}

# @description Dropped provenance field: the frozen event shape loses `lane`,
#   so an event can no longer be attributed to the lane that produced it.
# @arg $1 tree root
mutate_drop_provenance() {
  local f="$1/skills/foreman/scripts/lib/eventlog.sh"
  [[ -f "$f" ]] || return 1
  grep -q "{seq:\$seq,ts:\$ts,type:\$type,lane:\$lane,commit:\$commit,payload:\$payload}" "$f" || return 1
  sed -i "s/{seq:\$seq,ts:\$ts,type:\$type,lane:\$lane,commit:\$commit,payload:\$payload}/{seq:\$seq,ts:\$ts,type:\$type,commit:\$commit,payload:\$payload}/" "$f"
  grep -q "{seq:\$seq,ts:\$ts,type:\$type,commit:\$commit,payload:\$payload}" "$f"
}

# @description Run every seeded-defect case, then report any whose owning slice
#   stayed green. Reporting is the point: an unprotected defect class is a
#   finding to publish, never something to silence by deleting the case.
# @exitcode 0 every seeded defect was caught
# @exitcode 1 at least one defect class is unprotected
main() {
  printf 'inject-regressions: seeding known defects into isolated copies of HEAD\n\n'

  run_case duplicate-seq        tests/eventlog.bats \
    'two emits receive the same sequence number' mutate_duplicate_seq
  run_case swallowed-collision  tests/eventlog.bats \
    'a refused lock acquisition is no longer fatal' mutate_swallow_lock_failure
  run_case dropped-provenance   tests/eventlog.bats \
    'the frozen event shape loses its lane field' mutate_drop_provenance

  printf '\n'
  if [[ "${#UNPROTECTED[@]}" -gt 0 ]]; then
    printf 'UNPROTECTED DEFECT CLASSES: %d\n' "${#UNPROTECTED[@]}" >&2
    local u
    for u in "${UNPROTECTED[@]}"; do
      printf '  - %s\n' "$u" >&2
    done
    printf 'A seeded defect that leaves its owning slice green is a property the\n' >&2
    printf 'suite does not actually protect. Report it; do not silence it.\n' >&2
    return 1
  fi
  printf 'inject-regressions: all seeded defects were caught by their owning slice\n'
  return 0
}

main "$@"
