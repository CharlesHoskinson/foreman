#!/usr/bin/env bats
# @description Unit tests for lib/worker-cmd.sh's wc_build_argv — builds the
#   per-vendor worker command as a bash array (WC_ARGV). The prompt is
#   always delivered via a file/positional argument, NEVER stdin, because
#   foreman-launch nulls CMD's stdin (launcher/README.md:32-33).

setup() {
  source "$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/worker-cmd.sh"
}

@test "grok: prompt delivered via --prompt-file" {
  local p="$BATS_TEST_TMPDIR/p"; echo hi >"$p"
  wc_build_argv grok "$p" /work
  [ "${WC_ARGV[0]}" = "grok" ]
  [[ " ${WC_ARGV[*]} " == *"--prompt-file $p"* ]]
}

@test "codex: exec with prompt arg + sandbox flags, no stdin redirect" {
  local p="$BATS_TEST_TMPDIR/p"; echo "do it" >"$p"
  wc_build_argv codex "$p" /work
  [ "${WC_ARGV[0]}" = "codex" ]
  [[ " ${WC_ARGV[*]} " == *" exec "* ]]
  [[ " ${WC_ARGV[*]} " != *"<"* ]]
}

@test "unknown vendor errors" {
  run wc_build_argv nope /dev/null /work
  [ "$status" -ne 0 ]
}
