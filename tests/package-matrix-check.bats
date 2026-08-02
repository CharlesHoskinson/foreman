#!/usr/bin/env bats
# Contract tests for skills/foreman/scripts/package-matrix-check.sh.
# The suite covers literal TSV parsing, aggregate diagnostics, required
# evidence fields, fail-closed inventory handling, and inert field contents.
setup() {
  CHECKER="${BATS_TEST_DIRNAME}/../skills/foreman/scripts/package-matrix-check.sh"
  STUB_DIR="${BATS_TEST_TMPDIR}/bin"
  mkdir -p "${STUB_DIR}"
  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  printf '%s\n' '{"changes":[{"name":"alpha"},{"name":"beta"}]}'
  exit 0
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  export PATH="${STUB_DIR}:${PATH}"
}

# Header: package disposition owner_requirement consumer verification result_artifact
valid_matrix() {
  local path="$1"
  # Literal TAB-separated rows; all active packages exactly once.
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${path}"
}

@test "valid matrix exits zero" {
  local matrix="${BATS_TEST_TMPDIR}/valid.tsv"
  valid_matrix "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -eq 0 ]
}

@test "matrix that omits one active package exits nonzero and names it" {
  local matrix="${BATS_TEST_TMPDIR}/omit.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing active package: beta"* ]]
}

@test "duplicate package rows exit nonzero and name the duplicate" {
  local matrix="${BATS_TEST_TMPDIR}/dup.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    $'alpha\tv029-gap\town-alpha2\tconsumer-a2\tbash -c true\tartifacts/alpha2.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"duplicate package: alpha"* ]]
}

@test "row for package outside active inventory exits nonzero and names it" {
  local matrix="${BATS_TEST_TMPDIR}/extra.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    $'gamma\tv029-gap\town-gamma\tconsumer-g\tbash -c true\tartifacts/gamma.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown package: gamma"* ]]
}

@test "unknown disposition exits nonzero and names it" {
  local matrix="${BATS_TEST_TMPDIR}/bad-disp.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    $'beta\tnot-a-real-disposition\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown disposition: not-a-real-disposition"* ]]
}

@test "v029-implemented with empty consumer exits nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/empty-consumer.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\t\tbash -c true\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"v029-implemented package alpha requires consumer"* ]]
}

@test "v029-implemented with empty verification command exits nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/empty-verification.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\t\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"v029-implemented package alpha requires verification"* ]]
}

@test "v029-implemented with empty owner_requirement exits nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/empty-owner.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\t\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"v029-implemented package alpha requires owner_requirement"* ]]
}

@test "v029-implemented with empty result_artifact exits nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/empty-result-v029.tsv"
  {
    printf '%s\n' \
      $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact'
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
      alpha v029-implemented own-alpha consumer-a 'bash -c true' ''
    printf '%s\n' \
      $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt'
  } > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"v029-implemented package alpha requires result_artifact"* ]]
}

@test "deferred dispositions with empty result_artifact exit nonzero" {
  # Exercise v030-deferred, parked, withdrawn, and split — all require result_artifact.
  # Architect finding: do not build the deferred row with double-quoted \t escapes
  # (those stay literal backslash-t and can fail for the wrong reason). Use printf
  # so separators are real TAB bytes.
  local d
  for d in v030-deferred parked withdrawn split; do
    local matrix="${BATS_TEST_TMPDIR}/empty-artifact-${d}.tsv"
    {
      printf '%s\n' \
        $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact'
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
        alpha "$d" own-alpha consumer-a 'bash -c true' ''
      printf '%s\n' \
        $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt'
    } > "${matrix}"
    run bash "${CHECKER}" "${matrix}"
    [ "$status" -ne 0 ]
    [[ "$output" == *"requires result_artifact"* ]]
  done
}

@test "malformed header and seven-column row each exit nonzero" {
  # Malformed header
  local matrix_hdr="${BATS_TEST_TMPDIR}/bad-header.tsv"
  printf '%s\n' \
    $'wrong\theader\tcolumns\there\tnow\tok' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${matrix_hdr}"
  run bash "${CHECKER}" "${matrix_hdr}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"invalid header"* ]]

  # Seven-column row (data line is line 2)
  local matrix_cols="${BATS_TEST_TMPDIR}/seven-cols.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt\textra' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${matrix_cols}"
  run bash "${CHECKER}" "${matrix_cols}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"line 2: expected 6 columns, got 7"* ]]
}

@test "aggregate run reports every independent diagnostic before exit" {
  # Simultaneously: omit beta, include unknown gamma twice, unknown disposition on gamma.
  # Proves the checker reports every error before exit (fail-closed multi-error).
  local matrix="${BATS_TEST_TMPDIR}/aggregate.tsv"
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    $'gamma\tnot-a-real-disposition\town-gamma\tconsumer-g\tbash -c true\tartifacts/gamma.txt' \
    $'gamma\tnot-a-real-disposition\town-gamma\tconsumer-g\tbash -c true\tartifacts/gamma2.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing active package: beta"* ]]
  [[ "$output" == *"unknown package: gamma"* ]]
  [[ "$output" == *"duplicate package: gamma"* ]]
  [[ "$output" == *"unknown disposition: not-a-real-disposition"* ]]
}

@test "verification shell substitution is parsed literally and not executed" {
  local matrix="${BATS_TEST_TMPDIR}/literal-sub.tsv"
  # Valid matrix: both active packages; verification contains $(touch MARKER)
  # as a literal field value — checker must not execute matrix field contents.
  # $'...' does not expand command substitution, so the field stays literal.
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\t$(touch MARKER)\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${matrix}"
  rm -f "${BATS_TEST_TMPDIR}/MARKER"
  run bash -c "cd \"${BATS_TEST_TMPDIR}\" && bash \"${CHECKER}\" \"${matrix}\""
  [ "$status" -eq 0 ]
  [ ! -e "${BATS_TEST_TMPDIR}/MARKER" ]
}

@test "openspec list --json process failure exits nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/openspec-fail.tsv"
  valid_matrix "${matrix}"
  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  echo "openspec boom" >&2
  exit 1
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"openspec list --json failed"* ]]
}

@test "malformed openspec JSON exits nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/malformed-json.tsv"
  valid_matrix "${matrix}"
  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  printf '%s\n' 'not-json{'
  exit 0
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"malformed JSON"* ]]
}

@test "non-array .changes exits nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/changes-object.tsv"
  valid_matrix "${matrix}"
  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  printf '%s\n' '{"changes":{"name":"alpha"}}'
  exit 0
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing or malformed .changes"* ]]
}

@test "empty and missing inventory .name each exit nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/empty-name.tsv"
  valid_matrix "${matrix}"

  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  printf '%s\n' '{"changes":[{"name":""},{"name":"beta"}]}'
  exit 0
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"inventory contains empty name"* ]]

  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  printf '%s\n' '{"changes":[{},{"name":"beta"}]}'
  exit 0
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"inventory contains empty name"* ]]
}

@test "numeric and non-object inventory names exit nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/malformed-name.tsv"
  valid_matrix "${matrix}"

  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  printf '%s\n' '{"changes":[{"name":123},{"name":"beta"}]}'
  exit 0
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  # Require the inventory-name predicate itself — a later missing-package
  # diagnostic is not proof of this boundary.
  [[ "$output" == *"malformed inventory name"* ]]

  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  printf '%s\n' '{"changes":["not-an-object",{"name":"beta"}]}'
  exit 0
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"malformed inventory name"* ]]
}

@test "duplicate inventory name exits nonzero" {
  local matrix="${BATS_TEST_TMPDIR}/dup-inventory.tsv"
  valid_matrix "${matrix}"
  cat > "${STUB_DIR}/openspec" <<'STUB'
#!/usr/bin/env bash
if [[ $# -eq 2 && "$1" == "list" && "$2" == "--json" ]]; then
  printf '%s\n' '{"changes":[{"name":"alpha"},{"name":"alpha"}]}'
  exit 0
fi
echo "openspec stub: expected exactly 'list --json'" >&2
exit 2
STUB
  chmod +x "${STUB_DIR}/openspec"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"duplicate inventory name: alpha"* ]]
}

@test "empty package field exits nonzero without associative-array crash" {
  local matrix="${BATS_TEST_TMPDIR}/empty-package.tsv"
  # Six columns; package field on data line 2 is empty. Literal TABs only.
  printf '%s\n' \
    $'package\tdisposition\towner_requirement\tconsumer\tverification\tresult_artifact' \
    $'\tv029-implemented\town-empty\tconsumer-e\tbash -c true\tartifacts/empty.txt' \
    $'alpha\tv029-implemented\town-alpha\tconsumer-a\tbash -c true\tartifacts/alpha.txt' \
    $'beta\tv029-implemented\town-beta\tconsumer-b\tbash -c true\tartifacts/beta.txt' \
    > "${matrix}"
  run bash "${CHECKER}" "${matrix}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"line 2: package is empty"* ]]
  # Must not crash via Bash associative-array subscript on empty key.
  [[ "$output" != *"unbound variable"* ]]
  [[ "$output" != *"bad array subscript"* ]]
}
