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
  run bash "$SCRIPTS/grok-multiround.sh" "$SPEC" --max-rounds 3 -- "$SHIM/grok" --cwd "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"rounds=2"* ]]
  [ -f "$REPO/out.txt" ]
  grep -q 'no file changes' "$PROMPTLOG"   # round-2 fed-forward preamble
}
@test "never writes -> empty-burst FAILED, non-zero" {
  make_grok_shim 0
  run bash "$SCRIPTS/grok-multiround.sh" "$SPEC" --max-rounds 2 -- "$SHIM/grok" --cwd "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"empty-burst"* || "$output" == *"EMPTY-BURST"* ]]
}
@test "writes immediately -> rounds=1, no re-prompt" {
  make_grok_shim 1
  run bash "$SCRIPTS/grok-multiround.sh" "$SPEC" --max-rounds 3 -- "$SHIM/grok" --cwd "$REPO"
  [ "$status" -eq 0 ]; [[ "$output" == *"rounds=1"* ]]
  ! grep -q 'no file changes' "$PROMPTLOG"
}
