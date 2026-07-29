#!/usr/bin/env bats

load ../../lib/preconditions

@test "require_platform names the unmet platform" {
  require_platform fixture-platform
  false
}

@test "require_tool names the missing tool and install command" {
  require_tool foreman-fixture-tool "install foreman-fixture-tool"
  false
}

@test "require_non_root names the privilege requirement when root" {
  if (( EUID != 0 )); then
    skip "requires root to exercise the known-bad precondition input"
  fi
  require_non_root
  false
}

@test "require_built names the missing artefact and build command" {
  require_built "$BATS_TEST_TMPDIR/missing-dist" "npm run build:fixture"
  false
}

@test "require_no_live_vendor names the live vendor" {
  pgrep() {
    [[ "$1" == "-x" && "$2" == "foreman-fixture-vendor" ]]
  }
  require_no_live_vendor foreman-fixture-vendor
  false
}
