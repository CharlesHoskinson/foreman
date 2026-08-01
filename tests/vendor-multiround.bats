#!/usr/bin/env bats
setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  REPO="$BATS_TEST_TMPDIR/repo"; mkdir -p "$REPO"
  git -C "$REPO" init -q -b main; git -C "$REPO" config user.email t@e.com; git -C "$REPO" config user.name t
  echo base > "$REPO/f"; git -C "$REPO" add -A; git -C "$REPO" commit -qm base
  SPEC="$BATS_TEST_TMPDIR/spec.txt"; echo "Write out.txt now." > "$SPEC"
  SHIM="$BATS_TEST_TMPDIR/shim"; mkdir -p "$SHIM"
  PROMPTLOG="$BATS_TEST_TMPDIR/prompts.txt"; : > "$PROMPTLOG"
}
# a grok shim that writes a file only from the Nth round onward; records each round's prompt-file
make_grok_shim() {   # $1 = round at which it starts writing (0 = never)
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cnt="$SHIM/.count"; n=\$(( \$(cat "\$cnt" 2>/dev/null || echo 0) + 1 )); echo "\$n" > "\$cnt"
pf=""; args=("\$@"); i=0
while [[ \$i -lt \${#args[@]} ]]; do [[ "\${args[\$i]}" == "--prompt-file" ]] && pf="\${args[\$((i+1))]}"; i=\$((i+1)); done
cat "\$pf" >> "$PROMPTLOG"; printf '\n===ROUND %s===\n' "\$n" >> "$PROMPTLOG"
echo "I will orient first, reading the run context..."
if [[ "$1" -ne 0 && "\$n" -ge "$1" ]]; then echo written > "$REPO/out.txt"; fi
exit 0
EOF
  chmod +x "$SHIM/grok"
}

@test "writes on round 2 -> success, rounds=2, fed-forward preamble present" {
  make_grok_shim 2
  run bash "$SCRIPTS/vendor-multiround.sh" "$SPEC" --max-rounds 3 -- "$SHIM/grok" --cwd "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"rounds=2"* ]]
  [ -f "$REPO/out.txt" ]
  grep -q 'no file changes' "$PROMPTLOG"   # round-2 fed-forward preamble
}
@test "never writes -> empty-burst FAILED, non-zero" {
  make_grok_shim 0
  run bash "$SCRIPTS/vendor-multiround.sh" "$SPEC" --max-rounds 2 -- "$SHIM/grok" --cwd "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"empty-burst"* || "$output" == *"EMPTY-BURST"* ]]
}
@test "writes immediately -> rounds=1, no re-prompt" {
  make_grok_shim 1
  run bash "$SCRIPTS/vendor-multiround.sh" "$SPEC" --max-rounds 3 -- "$SHIM/grok" --cwd "$REPO"
  [ "$status" -eq 0 ]; [[ "$output" == *"rounds=1"* ]]
  ! grep -q 'no file changes' "$PROMPTLOG"
}

# @description Bug ledger 2026-07-30 Event 1. The change detector digested every
#   path git reported, including artifacts the HARNESS or the CALLER created
#   rather than the worker. A spec opening with "write SPEC-NOTES.md first" -- an
#   anti-empty-burst guard -- satisfied the digest by itself; three lanes
#   recorded round_done exit_code=0 having implemented nothing, and the false
#   green was caught only by diffing the worktrees by hand.
@test "manufactured artifacts (.harness/, SPEC-*.md) do not count as worker progress" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$REPO/.harness"
echo hb >> "$REPO/.harness/heartbeat.ndjson"
echo notes > "$REPO/SPEC-NOTES.md"
echo "I will orient first, reading the run context..."
exit 0
EOF
  chmod +x "$SHIM/grok"
  run bash "$SCRIPTS/vendor-multiround.sh" "$SPEC" --max-rounds 2 -- "$SHIM/grok" --cwd "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"EMPTY-BURST FAILED"* ]]
  # Non-vacuous: the artifacts really were written. Without these assertions the
  # test would also pass against a shim that did nothing at all.
  [ -f "$REPO/.harness/heartbeat.ndjson" ]
  [ -f "$REPO/SPEC-NOTES.md" ]
}

# @description Positive control for the exclusion above: it must not be so broad
#   that genuine work stops counting. Same shim shape, plus one real source file.
@test "a real source file still counts as worker progress alongside harness noise" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$REPO/.harness"
echo hb >> "$REPO/.harness/heartbeat.ndjson"
echo notes > "$REPO/SPEC-NOTES.md"
echo real > "$REPO/src.sh"
exit 0
EOF
  chmod +x "$SHIM/grok"
  run bash "$SCRIPTS/vendor-multiround.sh" "$SPEC" --max-rounds 2 -- "$SHIM/grok" --cwd "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"files changed"* ]]
  [ -f "$REPO/src.sh" ]
}
