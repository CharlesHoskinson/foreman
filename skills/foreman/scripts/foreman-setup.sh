#!/usr/bin/env bash
# @description Setup & Environment stage wrapper (v0.2.7.5 lifecycle-three-stage,
#   Task 3): an idempotent Setup wrapper around env/tool-check.sh's readiness
#   verdict. On WSL, Setup also builds the POSIX launcher when it is absent;
#   that build is its only repository mutation.
#   Setup owns vendor authentication per spec R2 ("Setup owns all model
#   authentication"), but this script NEVER authenticates anything itself --
#   device/interactive auth (`grok login --device-code`, `codex login`,
#   `claude auth login`) is an OPERATOR action this script only INSTRUCTS, per
#   the spec's "emit a clear, actionable ... instruction and mark that vendor
#   NOT-READY" clause. auth-probes.md documents why: none of the three CLIs
#   offers a safe, non-interactive, headless auto-login this script could
#   drive blindly. Composes env/tool-check.sh rather than re-implementing its
#   checks (plan architecture: "two thin wrapper scripts COMPOSE existing
#   scripts ... not a rewrite"). The launcher build is idempotent: a second
#   run sees a runnable, self-identifying executable and skips without
#   invoking bun again.
#
#   --lane SCOPING: without --lane, readiness is the WHOLE profile's
#   tool-check verdict (every must-tool, including non-vendor ones, must be
#   ok) -- this is the holistic "run Setup before any Use" check. With
#   --lane <vendor>, readiness is scoped SOLELY to that vendor's own
#   LANE_READY signal (env/tool-check.sh --lane, Task 2) -- an unrelated
#   must-tool failure elsewhere (e.g. a different vendor not yet signed in,
#   or a docs tool missing) never blocks a lane whose OWN vendor is already
#   authenticated. This scoped mode is what lets a caller ask "is JUST the
#   grok lane ready" without being coupled to the rest of the host's
#   provisioning state -- matching spec R1's "the readiness verdict SHALL be
#   NOT-READY for THAT LANE" (lane-scoped, not whole-host).
# Usage: foreman-setup.sh [--profile soft|hard|full] [--lane grok|codex|agy|claude]
# @exitcode 0 READY (see --lane SCOPING above for what "ready" means here)
# @exitcode 1 NOT-READY -- see the printed NOT-READY line(s) for which
#   vendor(s)/tools are blocking, and the instruction to fix each
set -euo pipefail
SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"

# Three levels up from skills/foreman/scripts (mirrors lane-run.sh's own
# lane_resolve_launcher repo-root resolution) -- independent of the caller's
# cwd, so this script works the same regardless of where it is invoked from.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TOOL_CHECK="$REPO_ROOT/env/tool-check.sh"

# @description Return whether Setup is running under WSL.
#   FOREMAN_TEST_WSL_FORCE is an explicit test-only seam: 1 forces WSL and 0
#   forces non-WSL. Every override is logged so it cannot silently contradict
#   the host's /proc/version.
# @exitcode 0 on WSL; 1 otherwise
fs_is_wsl() {
  case "${FOREMAN_TEST_WSL_FORCE:-}" in
    1)
      log "TEST OVERRIDE: FOREMAN_TEST_WSL_FORCE=1 forced WSL detection to wsl=1"
      return 0
      ;;
    0)
      log "TEST OVERRIDE: FOREMAN_TEST_WSL_FORCE=0 forced WSL detection to wsl=0"
      return 1
      ;;
  esac
  grep -qi microsoft /proc/version 2>/dev/null
}

# @description Verify that a launcher executable identifies itself cheaply.
# @arg $1 launcher path
# @exitcode 0 when PATH executes and reports a foreman-launch version
fs_launcher_runnable() {
  local launcher="$1" version=""
  [[ -x "$launcher" ]] || return 1
  version="$("$launcher" --version 2>/dev/null)" || return 1
  [[ "$version" == foreman-launch\ * ]]
}

# @description Build launcher/dist/foreman-launch atomically during WSL Setup.
#   An absent bun is a loud degradation, not a Setup failure; a failed build or
#   build that produces no runnable executable is a real failure. Bun writes to
#   a same-filesystem temporary path, which is renamed into place only after it
#   passes the version probe.
# @exitcode 0 already present, built successfully, off WSL, or bun unavailable
# @exitcode 1 launcher cleanup, build, validation, or publication failed
fs_ensure_posix_launcher() {
  fs_is_wsl || return 0

  local launcher="$REPO_ROOT/launcher/dist/foreman-launch"
  local launcher_dir="$REPO_ROOT/launcher/dist"
  local build_dir="" build_launcher=""
  if fs_launcher_runnable "$launcher"; then
    log "launcher already built: $launcher"
    return 0
  fi
  if [[ -e "$launcher" || -L "$launcher" ]]; then
    log "WARN: removing non-runnable launcher before rebuild: $launcher"
    if ! rm -f -- "$launcher"; then
      log "ERROR: could not remove non-runnable launcher: $launcher"
      return 1
    fi
  fi
  if ! command -v bun >/dev/null 2>&1; then
    log "WARN: bun is unavailable; POSIX launcher remains absent. Install bun, then run: (cd launcher && bun run build:posix)"
    return 0
  fi

  if ! mkdir -p -- "$launcher_dir"; then
    log "ERROR: could not create launcher output directory: $launcher_dir"
    return 1
  fi
  if ! build_dir="$(mktemp -d "$launcher_dir/.foreman-launch.build.XXXXXX")"; then
    log "ERROR: could not create temporary launcher build directory under: $launcher_dir"
    return 1
  fi
  build_launcher="$build_dir/foreman-launch"

  log "building POSIX launcher: (cd launcher && bun run build:posix)"
  if ! (cd "$REPO_ROOT/launcher" && bun run build:posix --outfile "$build_launcher"); then
    rm -f -- "$build_launcher"
    fs_launcher_runnable "$launcher" || rm -f -- "$launcher"
    rmdir -- "$build_dir" 2>/dev/null || true
    log "ERROR: POSIX launcher build failed"
    return 1
  fi
  if ! fs_launcher_runnable "$build_launcher"; then
    rm -f -- "$build_launcher"
    fs_launcher_runnable "$launcher" || rm -f -- "$launcher"
    rmdir -- "$build_dir" 2>/dev/null || true
    log "ERROR: POSIX launcher build completed without runnable executable output: $launcher"
    return 1
  fi
  if ! mv -f -- "$build_launcher" "$launcher"; then
    rm -f -- "$build_launcher"
    fs_launcher_runnable "$launcher" || rm -f -- "$launcher"
    rmdir -- "$build_dir" 2>/dev/null || true
    log "ERROR: could not publish POSIX launcher atomically: $launcher"
    return 1
  fi
  rmdir -- "$build_dir" 2>/dev/null || true
  log "built launcher: $launcher"
}

PROFILE="soft"
LANE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --lane) LANE="$2"; shift 2 ;;
    -h|--help)
      echo "usage: foreman-setup.sh [--profile soft|hard|full] [--lane grok|codex|agy|claude]"
      exit 0
      ;;
    *) die "$EXIT_CONFIG" "unknown arg: $1" ;;
  esac
done

if ! fs_ensure_posix_launcher; then
  echo "SETUP: NOT-READY"
  exit 1
fi

# Setup reports the repository's committed TOML value, independent of an
# environment override in the operator's shell.
FOREMAN_CONFIG="$REPO_ROOT/.foreman/config.toml" cfg_load
# Read the parser result directly because cfg_get would apply env overrides,
# while migration reporting is specifically about the repository's TOML.
durable_toml="${_CFG_VALUES[durable.enabled]:-}"
launcher_status="absent"
if [[ -x "$REPO_ROOT/launcher/dist/foreman-launch" ||
  -x "$REPO_ROOT/launcher/dist/foreman-launch.exe" ]]; then
  launcher_status="present"
fi
if [[ "$durable_toml" == "false" ]]; then
  echo "SETUP CONFIG: durable.enabled=false differs from the shipped true default that prevents a subagent backgrounding a long command and ending its turn; launcher=$launcher_status"
fi

# @description Map a vendor id to its operator-facing, non-billing auth
#   instruction (auth-probes.md: the real login subcommand for each CLI --
#   never a headless/automated login attempt run BY this script).
# @arg $1 vendor id (grok|codex|agy|claude)
# @stdout the instruction text; a generic fallback for an unrecognized id
fs_auth_instruction() {
  case "$1" in
    grok) echo "grok login --device-code" ;;
    codex) echo 'codex login  (interactive/localhost — run in a persistent shell via: ! codex login) OR headless: printenv OPENAI_API_KEY | codex login --with-api-key' ;;
    agy) echo "agy interactively and complete sign-in" ;;
    claude) echo "claude auth login" ;;
    *) echo "(no known auth instruction for $1)" ;;
  esac
}

tc_args=(--profile "$PROFILE")
[[ -n "$LANE" ]] && tc_args+=(--lane "$LANE")

# Split assignment (portability checklist): a bare `report="$(cmd)"` would
# abort this script under `set -e` the instant tool-check.sh exits nonzero
# (its normal NOT-READY exit code) -- the `|| tc_rc=$?` alternative path
# keeps the compound command's own status 0 while still capturing the real
# rc for later use.
tc_rc=0
report="$(bash "$TOOL_CHECK" "${tc_args[@]}" 2>&1)" || tc_rc=$?
echo "$report"

rc=0

# Per-vendor NOT-READY instructions: always derived from tool-check's own
# NOT_AUTHENTICATED line (Task 1), regardless of --lane, so an operator
# running a whole-host Setup check sees every vendor that needs attention,
# not just one.
not_auth_line="$(grep -m1 '^NOT_AUTHENTICATED: ' <<<"$report" || true)"
if [[ -n "$not_auth_line" ]]; then
  ids="${not_auth_line#NOT_AUTHENTICATED: }"
  for v in $ids; do
    echo "$v: NOT-READY -- run $(fs_auth_instruction "$v")"
  done
fi

if [[ -n "$LANE" ]]; then
  # Lane-scoped gate (see header SCOPING note): authoritative on the SCOPED
  # lane's own LANE_READY signal only -- deliberately NOT folded together
  # with tc_rc, so an unrelated must-tool failure elsewhere never blocks a
  # lane whose own vendor is already ready.
  lane_line="$(grep -m1 "^LANE_READY: ${LANE}=" <<<"$report" || true)"
  if [[ "$lane_line" == *"=yes" ]]; then
    rc=0
  else
    rc=1
  fi
else
  # Whole-profile gate: mirrors tool-check's own overall verdict exactly.
  if (( tc_rc != 0 )); then
    rc=1
  fi
fi

if (( rc == 0 )); then
  echo "SETUP: READY"
else
  echo "SETUP: NOT-READY"
fi
exit "$rc"
