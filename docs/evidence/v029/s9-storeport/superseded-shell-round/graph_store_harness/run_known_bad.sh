#!/usr/bin/env bash
# @description Prove every checker fails against a known-bad input.
#   AGENT_TRAPS §3.2: a check never observed failing is not evidence.
#   Each case is a checker that MUST exit non-zero on a known-bad input.
#   If any checker returns 0 on bad input, this harness exits non-zero.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_PARENT="$ROOT/skills/foreman"
export PYTHONPATH="${PKG_PARENT}${PYTHONPATH:+:$PYTHONPATH}"

failures=0
observed=0

# @description Run a command that MUST exit non-zero on known-bad input.
# @arg $1 label
# @arg $@ command
expect_fail() {
  local label="$1"; shift
  observed=$((observed + 1))
  echo "--- known-bad: $label (must exit non-zero) ---"
  set +e
  local output rc
  output="$("$@" 2>&1)"
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    echo "SOUNDNESS FAIL: checker returned 0 on known-bad input: $label" >&2
    echo "$output" >&2
    failures=$((failures + 1))
  else
    echo "OBSERVED FAIL rc=$rc: $label"
    printf '%s\n' "$output" | head -n 6 | sed 's/^/  | /'
  fi
}

# Checker: schema-validate a Claim. Known-bad: free-float confidence.
expect_fail "schema rejects free-float confidence" python3 - <<'PY'
from graph_store.schema import validate_document
from graph_store.errors import SchemaValidationError
try:
    validate_document({
        "@type": "Claim", "claim_key": "x", "text": "t",
        "status": "proposed", "confidence": 0.42,
    })
    print("ACCEPTED free-float — checker defective")
    raise SystemExit(0)
except SchemaValidationError as e:
    print(f"rejected field={e.field}: {e}")
    raise SystemExit(1)
PY

# Checker: normalise version ref. Known-bad: response-header branch: prefix.
expect_fail "version-ref rejects branch: prefix" \
  python3 -m graph_store version-ref "branch:main"

# Checker: expected-non-empty query. Known-bad: empty store with expect_empty=False.
expect_fail "unexpected-empty raises on empty store" python3 - <<'PY'
from graph_store.files_only import FilesOnlyGraphStore
from graph_store.schema import default_schema_payload
from graph_store.errors import UnexpectedEmptyError
s = FilesOnlyGraphStore()
s.register_schema(default_schema_payload())
try:
    s.query("unevaluated_leaves", expect_empty=False)
    print("returned empty without error — checker defective")
    raise SystemExit(0)
except UnexpectedEmptyError as e:
    print(f"raised {type(e).__name__}: {e}")
    raise SystemExit(1)
PY

# Checker: full contract suite against stub (must fail without --expect-fail).
expect_fail "contract suite fails broken stub" \
  python3 -m graph_store.contract_suite stub

# Checker: Mention documents are forbidden.
expect_fail "schema rejects Mention document" python3 - <<'PY'
from graph_store.schema import validate_document
from graph_store.errors import SchemaValidationError
try:
    validate_document({"@type": "Mention", "x": 1})
    print("ACCEPTED Mention — checker defective")
    raise SystemExit(0)
except SchemaValidationError as e:
    print(f"rejected: {e}")
    raise SystemExit(1)
PY

# Checker: EVALUATES exactly one target.
expect_fail "schema rejects Evaluation with two targets" python3 - <<'PY'
from graph_store.schema import validate_document
from graph_store.errors import SchemaValidationError
try:
    validate_document({
        "@type": "Evaluation",
        "evaluation_id": "E",
        "verdict": "approved",
        "evaluates_attempt": "Attempt/A1",
        "evaluates_artifact": "Artifact/p+h",
    })
    print("ACCEPTED two targets — checker defective")
    raise SystemExit(0)
except SchemaValidationError as e:
    print(f"rejected: {e}")
    raise SystemExit(1)
PY

# Checker: write before schema registration.
expect_fail "upsert without schema raises" python3 - <<'PY'
from graph_store.files_only import FilesOnlyGraphStore
from graph_store.errors import SchemaNotRegisteredError
s = FilesOnlyGraphStore(auto_schema=False)
try:
    s.upsert_document({"@type": "Task", "task_key": "x", "title": "t"})
    print("ACCEPTED write without schema — checker defective")
    raise SystemExit(0)
except SchemaNotRegisteredError as e:
    print(f"raised: {e}")
    raise SystemExit(1)
PY

if [[ "$observed" -lt 3 ]]; then
  echo "HARNESS DEFECT: fewer than 3 known-bad cases ran" >&2
  exit 1
fi

if [[ "$failures" -ne 0 ]]; then
  echo "KNOWN-BAD HARNESS FAILED: $failures checker(s) did not fail" >&2
  exit 1
fi

echo "ALL KNOWN-BAD CHECKERS OBSERVED FAILING ($observed cases)"
exit 0
