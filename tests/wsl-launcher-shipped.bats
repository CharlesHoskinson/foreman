#!/usr/bin/env bats
# @description Regression coverage for the wsl-launcher-shipped package:
#   Setup builds the POSIX launcher idempotently, tool-check distinguishes a
#   buildable absence from a bun-blocked degradation, the frozen lane alert
#   payload stays byte-identical, and operator docs name the fallback command.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/.."
  SHIM="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$SHIM"
}

make_setup_fixture() {
  FIXTURE="$BATS_TEST_TMPDIR/fixture"
  mkdir -p "$FIXTURE/skills/foreman/scripts/lib" "$FIXTURE/env" \
    "$FIXTURE/.foreman" "$FIXTURE/launcher"
  cp "$REPO_ROOT/skills/foreman/scripts/foreman-setup.sh" \
    "$FIXTURE/skills/foreman/scripts/"
  cp "$REPO_ROOT/skills/foreman/scripts/lib/common.sh" \
    "$REPO_ROOT/skills/foreman/scripts/lib/config.sh" \
    "$FIXTURE/skills/foreman/scripts/lib/"
  printf '%s\n' '[durable]' 'enabled = true' > "$FIXTURE/.foreman/config.toml"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "fixture tool check"' \
    > "$FIXTURE/env/tool-check.sh"
  chmod +x "$FIXTURE/env/tool-check.sh"
}

make_bun_builder() {
  cat > "$SHIM/bun" <<'SHIM'
#!/usr/bin/env bash
if [[ "${1:-}" == "run" && "${2:-}" == "build:posix" ]]; then
  printf 'build:posix cwd=%s\n' "$PWD" >> "${BUN_BUILD_LOG:?}"
  mkdir -p dist
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > dist/foreman-launch
  chmod +x dist/foreman-launch
  exit 0
fi
exit 64
SHIM
  chmod +x "$SHIM/bun"
}

make_git_noop() {
  printf '%s\n' '#!/usr/bin/env bash' 'exit 1' > "$SHIM/git"
  chmod +x "$SHIM/git"
}

@test "fresh WSL Setup builds foreman-launch once and the second run is a no-op" {
  make_setup_fixture
  make_bun_builder
  export BUN_BUILD_LOG="$BATS_TEST_TMPDIR/bun-build.log"
  printf 'MUTATED INPUT: wsl=1 launcher=absent bun=present\n'

  run env FOREMAN_WSL_FORCE=1 BUN_BUILD_LOG="$BUN_BUILD_LOG" \
    PATH="$SHIM:/usr/bin:/bin" \
    bash "$FIXTURE/skills/foreman/scripts/foreman-setup.sh" --profile soft
  [ "$status" -eq 0 ]
  [ -x "$FIXTURE/launcher/dist/foreman-launch" ]
  [ "$(wc -l < "$BUN_BUILD_LOG")" -eq 1 ]
  [[ "$output" == *"built launcher"* ]]
  printf 'OBSERVED: %s\n' "$(grep 'built launcher' <<<"$output")"

  printf 'MUTATED INPUT: wsl=1 launcher=executable bun=present\n'
  run env FOREMAN_WSL_FORCE=1 BUN_BUILD_LOG="$BUN_BUILD_LOG" \
    PATH="$SHIM:/usr/bin:/bin" \
    bash "$FIXTURE/skills/foreman/scripts/foreman-setup.sh" --profile soft
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$BUN_BUILD_LOG")" -eq 1 ]
  [[ "$output" == *"launcher already built"* ]]
  printf 'OBSERVED: %s\n' "$(grep 'launcher already built' <<<"$output")"
}

@test "fresh WSL Setup warns and succeeds when bun is absent" {
  make_setup_fixture
  printf 'MUTATED INPUT: wsl=1 launcher=absent bun=absent\n'

  run env FOREMAN_WSL_FORCE=1 PATH="/usr/bin:/bin" \
    bash "$FIXTURE/skills/foreman/scripts/foreman-setup.sh" --profile soft
  [ "$status" -eq 0 ]
  [ ! -e "$FIXTURE/launcher/dist/foreman-launch" ]
  [[ "$output" == *"WARN"*"bun"*"bun run build:posix"* ]]
  printf 'OBSERVED: %s\n' "$(grep 'WARN: bun' <<<"$output")"
}

@test "WSL hard tool-check is NOT-READY when launcher is absent and bun is present" {
  make_bun_builder
  make_git_noop
  missing="$BATS_TEST_TMPDIR/missing-foreman-launch"
  printf 'MUTATED INPUT: wsl=1 profile=hard launcher=%s(absent) bun=present\n' "$missing"

  run env FOREMAN_WSL_FORCE=1 FOREMAN_LAUNCH="$missing" \
    BUN_BUILD_LOG="$BATS_TEST_TMPDIR/unused.log" PATH="$SHIM:/usr/bin:/bin" \
    bash "$REPO_ROOT/env/tool-check.sh" --profile hard
  [ "$status" -ne 0 ]
  [[ "$output" == *"foreman-launch"*"missing"*"bun run build:posix"* ]]
  [[ "$output" == *"MUST_FAIL:"*"foreman-launch:missing"* ]]
  printf 'OBSERVED:\n%s\n' \
    "$(grep -E '^(foreman-launch|READY:|MUST_FAIL:)' <<<"$output")"
}

@test "WSL hard tool-check is DEGRADED, not launcher-blocked, when bun is absent" {
  make_git_noop
  missing="$BATS_TEST_TMPDIR/missing-foreman-launch"
  printf 'MUTATED INPUT: wsl=1 profile=hard launcher=%s(absent) bun=absent\n' "$missing"

  run env FOREMAN_WSL_FORCE=1 FOREMAN_LAUNCH="$missing" \
    PATH="$SHIM:/usr/bin:/bin" \
    bash "$REPO_ROOT/env/tool-check.sh" --profile hard
  [[ "$output" == *"foreman-launch"*"degraded"*"bun"* ]]
  [[ "$output" == *"DEGRADED:"*"foreman-launch"* ]]
  must_fail_line="$(grep '^MUST_FAIL:' <<<"$output" || true)"
  [[ "$must_fail_line" != *"foreman-launch"* ]]
  printf 'OBSERVED:\n%s\n' \
    "$(grep -E '^(foreman-launch|READY:|MUST_FAIL:|DEGRADED:)' <<<"$output")"
}

@test "reference manifest inventories the WSL launcher for hard and full profiles" {
  run awk '
    /^\[\[tools\]\]$/ { in_tool=1; id=""; profile=""; where=""; next }
    in_tool && /^id = "foreman-launch"$/ { id=$0 }
    in_tool && /^profile = / { profile=$0 }
    in_tool && /^where = / { where=$0 }
    in_tool && id && /^$/ {
      print id "\n" profile "\n" where
      exit
    }
  ' "$REPO_ROOT/env/reference-manifest.toml"
  [ "$status" -eq 0 ]
  [[ "$output" == *'id = "foreman-launch"'* ]]
  [[ "$output" == *'profile = ["hard", "full"]'* ]]
  [[ "$output" == *'where = ["wsl"]'* ]]
}

@test "lane-run keeps the frozen alert payload and adds only a human build hint" {
  source_file="$REPO_ROOT/skills/foreman/scripts/lane-run.sh"
  payload_count="$(grep -Fc \
    "el_emit \"\$RUN\" alert \"\$LANE\" '{\"kind\":\"degraded\",\"reason\":\"launcher_absent\"}'" \
    "$source_file")"
  [ "$payload_count" -eq 1 ]
  grep -Fq 'launcher absent; build it during Setup with: (cd launcher && bun run build:posix)' \
    "$source_file"
}

@test "install, usage, and launcher docs describe automatic Setup build and fallback" {
  for file in docs/INSTALL.md docs/USAGE.md launcher/README.md; do
    grep -Eqi 'Setup.*build|build.*Setup' "$REPO_ROOT/$file"
    grep -Fq 'cd launcher && bun run build:posix' "$REPO_ROOT/$file"
  done
}
