#!/usr/bin/env bash
# @description Derive the full-repository check inventory used to hold the
#   positive-control registry accountable. The sweep is over the whole
#   repository tree at the commit under test, never over a release diff: a
#   diff-scoped sweep silently omits every check it did not touch, which is
#   what lets an unregistered gate pass as covered.
#
#   Output is DERIVED and uncommitted. It is never a substitute for
#   tests/positive-control-registry.tsv, which is edited deliberately the way
#   tests/baseline.tsv and tests/skip-budget.tsv are.
#
#   Recognizer grammar enumerates exactly four kinds -- gate, probe,
#   assertion, verdict-predicate. A predicate reachable only through a wrapper
#   this grammar does not recognise is NOT covered, and this inventory is
#   never described as exhaustive. Measured grammar gaps, each found by running
#   the scanner against the real tree rather than by reading it, are recorded
#   in docs/evidence/positive-control/2026-08-06-control-record.md.
# @stdout TSV written to $OUT: check_id, kind, path, check_name
set -uo pipefail

# CHECK_INVENTORY_ROOT lets the sweep run against a tree other than the one the
# script was sourced from -- the acceptance fixture needs that, and so does
# running the scan at a landing stage's tip rather than at the release start.
REPO_ROOT="${CHECK_INVENTORY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TESTS_DIR="$REPO_ROOT/tests"
OUT="${CHECK_INVENTORY_OUT:-$TESTS_DIR/.check-inventory.tsv}"

# @description Emit one inventory row. check_id is <repo-relative path>::<check
#   name> so a registry row and an inventory member match by string equality on
#   check_id and by nothing else.
# @arg $1 repository-relative path
# @arg $2 kind: gate, probe, assertion, or verdict-predicate
# @arg $3 check name
emit_row() {
  local path="$1" kind="$2" name="$3"
  [[ -z "$path" || -z "$kind" || -z "$name" ]] && return 0
  printf '%s::%s\t%s\t%s\t%s\n' "$path" "$name" "$kind" "$path" "$name"
}

# @description (a) gate, workflow arm -- every check invoked by a step in
#   .github/workflows/. A step carries the predicate under its explicit id when
#   it has one, otherwise under its step name. Only step-level keys are read:
#   the top-level workflow name and any name: nested under with: (an artifact
#   name, not a predicate) are deliberately excluded.
#
#   A step is a gate only when it RUNS something. A step that merely `uses:` a
#   marketplace action -- actions/setup-node, actions/upload-artifact -- is
#   provisioning, not a predicate, and a positive control over "Set up Node"
#   would assert nothing.
scan_gate_workflows() {
  local f rel
  for f in "$REPO_ROOT"/.github/workflows/*.yml "$REPO_ROOT"/.github/workflows/*.yaml; do
    [[ -f "$f" ]] || continue
    rel="${f#"$REPO_ROOT"/}"
    while IFS= read -r name; do
      emit_row "$rel" gate "$name"
    done < <(awk '
      function flush() {
        if (step_name != "" && has_run) print step_name
        step_name = ""; has_run = 0
      }
      # A new step begins at six spaces then a list dash.
      /^[[:space:]]{6}-[[:space:]]/ { flush() }
      /^[[:space:]]{6}-?[[:space:]]*(name|id):[[:space:]]*/ {
        line = $0
        sub(/^[[:space:]]{6}-?[[:space:]]*(name|id):[[:space:]]*/, "", line)
        gsub(/^["'"'"']|["'"'"']$/, "", line)
        sub(/[[:space:]]+$/, "", line)
        # An explicit id: overrides a name: seen earlier in the same step.
        if (line != "" && (step_name == "" || $0 ~ /id:/)) step_name = line
      }
      /^[[:space:]]{8}run:/ { has_run = 1 }
      END { flush() }
    ' "$f")
  done
}

# @description (a) gate, runner arm -- the checks tests/run.sh itself enforces.
#   The spec names tests/run.sh as a gate source alongside the workflows, and
#   omitting it hid the skip-budget check entirely: the spec's own acceptance
#   fixture demands the scanner find that check, and it did not until this arm
#   existed.
scan_gate_runner() {
  local f rel base found
  for f in "$REPO_ROOT"/tests/run.sh "$REPO_ROOT"/tools/ci-local.sh; do
    [[ -f "$f" ]] || continue
    rel="${f#"$REPO_ROOT"/}"
    while IFS= read -r name; do
      emit_row "$rel" gate "$name"
    done < <(grep -oE '^(validate|lookup|check|assert|enforce)_[a-zA-Z0-9_]*\(\)' "$f" |
      sed 's/()$//')
  done

  # The positive-control machinery is itself a gate, and T8's rule is that a
  # check introduced by this release carries a control before it is trusted.
  # Inventorying it here is what lets its own registry rows match.
  for f in "$REPO_ROOT"/tests/lib/check-inventory.sh \
    "$REPO_ROOT"/tests/lib/check-registry-compare.sh \
    "$REPO_ROOT"/tests/lib/positive-control.bash; do
    [[ -f "$f" ]] || continue
    rel="${f#"$REPO_ROOT"/}"
    base="$(basename "$f")"
    base="${base%.*}"
    found=0
    while IFS= read -r name; do
      emit_row "$rel" gate "$name"
      found=1
    done < <(grep -oE '^assert_[a-zA-Z0-9_]*\(\)' "$f" | sed 's/()$//')
    [[ "$found" -eq 0 ]] && emit_row "$rel" gate "$base"
  done
}

# @description (a) gate, script arm -- every gate-* / *-eval.sh script under
#   skills/foreman/scripts/. These are linear scripts rather than function
#   libraries, so the script itself is the check; deriving from function names
#   would silently inventory nothing for a script that declares none.
scan_gate_scripts() {
  local f rel base found
  for f in "$REPO_ROOT"/skills/foreman/scripts/gate-*.sh \
    "$REPO_ROOT"/skills/foreman/scripts/*-eval.sh; do
    [[ -f "$f" ]] || continue
    rel="${f#"$REPO_ROOT"/}"
    base="$(basename "$f" .sh)"
    found=0
    while IFS= read -r name; do
      emit_row "$rel" gate "$name"
      found=1
    done < <(grep -oE '^[a-zA-Z_][a-zA-Z0-9_]*\(\)' "$f" | sed 's/()$//')
    [[ "$found" -eq 0 ]] && emit_row "$rel" gate "$base"
  done
}

# @description (b) probe -- functions that record a verdict through the
#   tool-check or probe helpers.
scan_probes() {
  local f rel
  for f in "$REPO_ROOT"/env/tool-check.sh "$REPO_ROOT"/skills/foreman/scripts/lib/*.sh; do
    [[ -f "$f" ]] || continue
    rel="${f#"$REPO_ROOT"/}"
    while IFS= read -r name; do
      emit_row "$rel" probe "$name"
    done < <(grep -oE '^(fm_tc_|probe_|check_)[a-zA-Z0-9_]*\(\)' "$f" | sed 's/()$//')
  done
}

# @description (b) probe, TypeScript arm -- exported probe/check functions in the
#   ported tool-check sources. The shell arm above reads env/tool-check.sh; when
#   that file became a thin Node adapter its probes moved here, and a shell-only
#   grammar inventoried zero of them without complaint.
scan_probes_ts() {
  local f rel
  for f in "$REPO_ROOT"/packages/orchestration/src/tool-check*.ts \
    "$REPO_ROOT"/components/council/packages/*/src/tool-check*.ts; do
    [[ -f "$f" ]] || continue
    case "$f" in *.test.ts) continue ;; esac
    rel="${f#"$REPO_ROOT"/}"
    while IFS= read -r name; do
      emit_row "$rel" probe "$name"
    # BW-013 debt — DO NOT EXTEND THIS LIST.
    #
    # The first three alternatives are the rule: a check is a function named
    # probe*, check* or fmTc*. The six literal names after them are not a rule,
    # they are the six TypeScript successors the Node port renamed out of that
    # convention, hardcoded so the regime could see them again.
    #
    # A seventh differently-named check is still invisible. That blind spot is
    # not new — it is the same convention-matching rule that went blind under
    # the port — but adding a name here is how it stays. The fix is principled
    # discovery (an annotation at the definition site, or inventory driven by
    # the enforcement dispatcher's call sites), not a longer list.
    #
    # Ruled mergeable-as-debt by fable council 2026-08-08, on the grounds that
    # the change is monotonic: it only ever enlarges the matched set, so it
    # closes six holes and opens none. See brokenwindows.md BW-013.
    done < <(grep -oE '^export (async )?function (probe|check|fmTc|sha256FileSync|readProcVersion|classifyFsClassFromProbe|classifyHostClass|lookupPinnedVerdict|runAtomicityProbes)[A-Za-z0-9_]*' "$f" |
      sed -E 's/^export (async )?function //')
  done
}

# @description (c) assertion -- every bats @test that asserts.
#
#   The spec phrases this as "calls an assertion helper", but that is
#   under-inclusive against this repository and would silently drop real
#   checks. Bats runs each test under errexit, so a bare command's exit status
#   IS the assertion: `grep -q ...` and `jq -e ... >/dev/null` are the dominant
#   style here, and neither calls a helper. Restricting to helper calls scored
#   15 genuine checks as bodiless, among them
#   telemetry.bats "known-bad: zero-cost unavailable must not be produced by
#   tl_usage_block", which asserts five times through `jq -e`.
#
#   So a @test is inventoried when its body holds at least one executable
#   line. Only a body that is empty or wholly comments is excluded.
scan_assertions() {
  local f rel
  for f in "$REPO_ROOT"/tests/*.bats; do
    [[ -f "$f" ]] || continue
    rel="${f#"$REPO_ROOT"/}"
    while IFS= read -r name; do
      emit_row "$rel" assertion "$name"
    done < <(awk '
      /^@test[[:space:]]+"/ {
        name = $0
        sub(/^@test[[:space:]]+"/, "", name)
        sub(/"[[:space:]]*\{[[:space:]]*$/, "", name)
        inbody = 1; asserted = 0; next
      }
      inbody && /^\}/ { if (asserted) print name; inbody = 0; next }
      inbody && /^[[:space:]]*#/ { next }
      inbody && /^[[:space:]]*$/ { next }
      inbody { asserted = 1 }
    ' "$f")
  done
}

# @description (d) verdict-predicate -- call sites that parse output for an
#   outcome token. Scoped to the function BODY that does the parsing: a
#   file-level match would inventory every unrelated helper that happens to
#   share a file with a verdict string.
scan_verdict_predicates() {
  local f rel base found
  for f in "$REPO_ROOT"/skills/foreman/scripts/*.sh; do
    [[ -f "$f" ]] || continue
    grep -qE '(PASS|FAIL|BLOCKED|APPROVED|CANARY_OK|NOT_MERGEABLE|UNVERIFIED)' "$f" || continue
    rel="${f#"$REPO_ROOT"/}"
    base="$(basename "$f" .sh)"
    found=0
    while IFS= read -r name; do
      emit_row "$rel" verdict-predicate "$name"
      found=1
    done < <(awk '
      /^[a-zA-Z_][a-zA-Z0-9_]*\(\)[[:space:]]*\{/ {
        name = $0
        sub(/\(\).*$/, "", name)
        inbody = 1; hit = 0; next
      }
      inbody && /^\}/ { if (hit) print name; inbody = 0; next }
      inbody && /(PASS|FAIL|BLOCKED|APPROVED|CANARY_OK|NOT_MERGEABLE|UNVERIFIED)/ &&
        /(==|=~|case|grep|\[\[)/ { hit = 1 }
    ' "$f")
    # Linear scripts declare no functions, so a function-scoped sweep
    # inventories nothing for them -- the same gap that hid gate-eval.sh.
    # Thirteen verdict-parsing scripts fell in it, merge-gate.sh among them.
    [[ "$found" -eq 0 ]] && emit_row "$rel" verdict-predicate "$base"
  done
}

# @description Sweep every recognizer, sort the union, and replace the derived
#   inventory file. Fails closed with inventory-empty rather than writing an
#   empty file, so a caller can never mistake "nothing scanned" for "nothing
#   unregistered".
# @exitcode 0 the inventory holds at least one member
# @exitcode 1 the sweep found nothing
main() {
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/check-inventory.XXXXXX")" || return 1
  {
    printf 'check_id\tkind\tpath\tcheck_name\n'
    {
      scan_gate_workflows
      scan_gate_runner
      scan_gate_scripts
      scan_probes
      scan_probes_ts
      scan_assertions
      scan_verdict_predicates
    } | LC_ALL=C sort -u
  } >"$tmp"

  local rows
  rows="$(($(wc -l <"$tmp") - 1))"
  if [[ "$rows" -le 0 ]]; then
    rm -f -- "$tmp"
    printf 'inventory-empty\n' >&2
    return 1
  fi

  # Write-to-temp then replace: a redirect straight onto the target truncates
  # it first, so a mid-write failure leaves no output at all.
  mv -f -- "$tmp" "$OUT" || { rm -f -- "$tmp"; return 1; }
  printf 'check-inventory: %d rows -> %s\n' "$rows" "${OUT#"$REPO_ROOT"/}" >&2
  return 0
}

main "$@"
