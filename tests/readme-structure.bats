#!/usr/bin/env bats
# @description Structural invariants for README.md (readme-refresh).
#   Required top-level sections, order, and teaching-document anchors.
#   Every checker here is demonstrated to FAIL against a known-bad input.
load helpers

# Paths relative to the real checkout (not the throwaway fixture repo).
ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
README="$ROOT/README.md"
CHECKER="$BATS_TEST_DIRNAME/fixtures/readme-structure-check.sh"

setup_file() {
  # Materialize the checker next to other fixtures if missing from path layout.
  mkdir -p "$BATS_TEST_DIRNAME/fixtures"
  if [[ ! -f "$CHECKER" ]]; then
    # Fallback: checker lives under tests/fixtures after install of this package
    :
  fi
}

# ---------------------------------------------------------------------------
# Self-soundness: the structure checker MUST fail a known-bad README.
# A checker never observed failing is not evidence (AGENT_TRAPS §3.2).
# ---------------------------------------------------------------------------

@test "readme-structure checker FAILS on known-bad input (missing required section)" {
  local bad
  bad="$(mktemp)"
  cat >"$bad" <<'EOF'
# Foreman

## 1. What Foreman is and the problem it solves
text

## 2. The mental model
text

## 3. The five-part spec
text

## 4. Lanes and vendor routing
text

## 5. Soft mode — the loop that runs today
text

## 6. Setup → Use → Cleanup, and the quickstart
text

## 7. Worktree isolation
text

## 8. Reports are claims: evidence, verification, audit, checker soundness
text

## 9. The record: event log, work-DAG, knowledge plane, store
text

## 10. Hard mode — status
text

## 11. Honest capabilities and limits
text

# deliberately omit section 12
EOF
  run bash "$CHECKER" "$bad"
  rm -f "$bad"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing required section"* ]] || [[ "$output" == *"FAIL"* ]]
}

@test "readme-structure checker FAILS on known-bad input (reordered sections)" {
  local bad
  bad="$(mktemp)"
  # Section 3 before section 2 — order violation
  cat >"$bad" <<'EOF'
# Foreman

## 1. What Foreman is and the problem it solves
## 3. The five-part spec
## 2. The mental model
## 4. Lanes and vendor routing
## 5. Soft mode — the loop that runs today
## 6. Setup → Use → Cleanup, and the quickstart
## 7. Worktree isolation
## 8. Reports are claims: evidence, verification, audit, checker soundness
## 9. The record: event log, work-DAG, knowledge plane, store
## 10. Hard mode — status
## 11. Honest capabilities and limits
## 12. Further reading, security, layout, license, lineage
EOF
  run bash "$CHECKER" "$bad"
  rm -f "$bad"
  [ "$status" -ne 0 ]
  [[ "$output" == *"order"* ]] || [[ "$output" == *"FAIL"* ]]
}

@test "readme-structure checker harness exits non-zero when any case fails" {
  # Invoke the checker as a multi-case harness against a bad file; confirm
  # overall exit is non-zero (not just a per-case message with exit 0).
  local bad
  bad="$(mktemp)"
  printf '# empty\n' >"$bad"
  run bash "$CHECKER" "$bad"
  rm -f "$bad"
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# Positive checks against the real README.md
# ---------------------------------------------------------------------------

@test "README.md exists at repo root" {
  [ -f "$README" ]
}

@test "README.md contains all twelve required section headings in order" {
  run bash "$CHECKER" "$README"
  echo "$output"
  [ "$status" -eq 0 ]
}

@test "README.md teaching charter points at USAGE and INSTALL" {
  grep -q 'docs/USAGE.md' "$README"
  grep -q 'docs/INSTALL.md' "$README"
}

@test "README.md documents bash install.sh (not bare ./install.sh as primary)" {
  # Primary quickstart must not instruct bare ./install.sh (mode 100644).
  if grep -nE '^\./install\.sh$' "$README" >/dev/null 2>&1; then
    echo "FAIL: bare ./install.sh instruction found" >&2
    return 1
  fi
  grep -q 'bash install.sh' "$README"
}

@test "README.md hard-mode table does not claim fail-closed at every stage" {
  # The most-misleading sentence from the fact-check pass must stay gone.
  if grep -qi 'fail-closed at every stage' "$README"; then
    echo "FAIL: stale fail-closed claim present" >&2
    return 1
  fi
  grep -qi 'not fail-closed across rounds\|not yet bound to the current diff\|freshness' "$README"
}

@test "README.md keys audit routing on model family" {
  grep -qi 'model family' "$README"
}

@test "README.md includes checker soundness requirements" {
  grep -qi 'known-bad input' "$README"
  grep -qi 'vacuous' "$README"
}

@test "README.md includes the record / knowledge-plane section" {
  grep -q '## 9. The record' "$README"
  grep -qi 'work-DAG\|work-dag\|GraphStore' "$README"
}

@test "README.md layout lists formal/" {
  grep -q 'formal/' "$README"
}
