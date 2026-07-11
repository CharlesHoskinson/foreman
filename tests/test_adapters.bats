#!/usr/bin/env bats

ADIR="$BATS_TEST_DIRNAME/../skills/foreman/scripts/adapters"

@test "each adapter defines the contract functions" {
  for v in claude codex grok; do
    ( source "$ADIR/$v.sh"
      [ "$(adapter_vendor)" = "$v" ]
      adapter_cli_bin >/dev/null
      adapter_env_key >/dev/null
      adapter_worker_cmd | grep -q "/task/prompt.md" )
  done
}

@test "claude worker cmd uses stream-json; grok uses streaming-json" {
  ( source "$ADIR/claude.sh"; adapter_worker_cmd | grep -q "stream-json" )
  ( source "$ADIR/grok.sh";   adapter_worker_cmd | grep -q "streaming-json" )
}

@test "codex audit uses exec with read-only sandbox and output schema" {
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/codex" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$BATS_TEST_TMPDIR/codex-argv.txt"
# emulate --output-last-message target write
while [[ "\$1" != "--output-last-message" && \$# -gt 0 ]]; do shift; done
echo '{"verdict":"APPROVED","findings":[]}' > "\$2"
EOF
  chmod +x "$BATS_TEST_TMPDIR/bin/codex"
  PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  echo "audit this" > "$BATS_TEST_TMPDIR/p.md"
  ( source "$ADIR/codex.sh"
    adapter_run_audit "$BATS_TEST_TMPDIR/p.md" "$BATS_TEST_TMPDIR/out.json" )
  grep -qx -- 'read-only' "$BATS_TEST_TMPDIR/codex-argv.txt"
  grep -qx -- '--output-schema' "$BATS_TEST_TMPDIR/codex-argv.txt"
  jq -e '.verdict=="APPROVED"' "$BATS_TEST_TMPDIR/out.json"
}

@test "claude audit extracts structured output from result json" {
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/claude" <<'EOF'
#!/usr/bin/env bash
echo '{"result":"ok","structured_output":{"verdict":"WARNING","findings":[]}}'
EOF
  chmod +x "$BATS_TEST_TMPDIR/bin/claude"
  PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  echo "audit this" > "$BATS_TEST_TMPDIR/p.md"
  ( source "$ADIR/claude.sh"
    adapter_run_audit "$BATS_TEST_TMPDIR/p.md" "$BATS_TEST_TMPDIR/out.json" )
  jq -e '.verdict=="WARNING"' "$BATS_TEST_TMPDIR/out.json"
}
