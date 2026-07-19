#!/usr/bin/env bash
# @description Idempotent concurrency-safe git config bootstrap for a repo
#   (v0.2.7.5 worktree-hardening T1). Applies five repo-local settings that
#   the operator's reported stalls/lock failures map to (design.md,
#   2026-07-18 research table): `maintenance.auto=false` (stop the reactive
#   `gc.autoDetach` background fork that competes for the object-DB lock
#   mid-commit), `core.fsmonitor=true` + `core.untrackedCache=true` (avoid
#   slow status/checkout without a filesystem watcher on Windows),
#   `core.longpaths=true` (Windows MAX_PATH), and
#   `safe.bareRepository=explicit` (defensive default). Every setting is
#   applied via `git config` directly on the target REPO's own local config
#   -- never `--global` -- so running this against a throwaway test repo
#   never touches the caller's real git config.
#
#   Maintenance path (spec: "disabling reactive gc SHALL NOT leave the repo
#   un-maintained"): deliberately does NOT call `git maintenance register` or
#   `git maintenance start`. Empirically probed during this task (throwaway
#   repo + isolated HOME): `git maintenance start` installs REAL, persistent,
#   HOST-WIDE Windows Scheduled Tasks ("Git Maintenance (hourly|daily|
#   weekly)") that do NOT respect HOME redirection at the point they later
#   RUN (they resolve the real user's default HOME then, not whatever HOME
#   was active when `start` was called) -- so there is no way to exercise
#   that path in a test, or even invoke it from an idempotent bootstrap
#   script, without leaving host-wide state behind that this script cannot
#   itself clean up later. `git maintenance register` alone (without
#   `start`) is comparatively low-risk (a single `[maintenance] repo = ...`
#   line in the global gitconfig) but also INERT on its own -- nothing ever
#   triggers a scheduled run without `start`, so registering alone would not
#   actually satisfy "pack/ref hygiene still occurs". Instead, this script
#   itself IS the foreman-owned maintenance tick: `gg_maintenance_tick`
#   below runs `git maintenance run --auto` directly against the REPO (a
#   local, bounded, git-throttled operation -- `--auto` runs git's own
#   heuristic gate, so a redundant call is cheap) whenever it has been at
#   least `GG_TICK_MIN_INTERVAL` seconds (default 3600) since the last tick,
#   tracked via a marker file under the repo's own git-common-dir. Re-running
#   this script periodically (operator cron, a Setup step, or simply before
#   each lane) is therefore the maintenance path -- see
#   references/orchestration-hardening.md for the full write-up and operator
#   guidance on registering a REAL scheduled task by hand if desired.
# Usage: git-guards.sh REPO
# @exitcode 0 settings applied (or already correct) and the maintenance path
#   is active
# @exitcode 2 usage error (missing/invalid REPO)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

REPO="${1:?usage: git-guards.sh REPO}"
require_cmd git
[[ -d "$REPO" ]] || die "$EXIT_CONFIG" "git-guards: not a directory: $REPO"
git_nohooks -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 \
  || die "$EXIT_CONFIG" "git-guards: not a git repository: $REPO"

# @description Apply one git config key/value pair to REPO's own local
#   config (idempotent: a no-op write when the value already matches) and
#   report it, satisfying the spec's "report which settings it applied".
# @arg $1 repo repository path
# @arg $2 key config key (e.g. "core.longpaths")
# @arg $3 value desired config value
gg_apply_config() {
  local repo="$1" key="$2" value="$3" current
  current="$(git_nohooks -C "$repo" config --get "$key" 2>/dev/null || true)"
  if [[ "$current" != "$value" ]]; then
    git_nohooks -C "$repo" config "$key" "$value"
  fi
  log "git-guards: applied $key=$value"
}

# @description Ensure a maintenance path exists for REPO without ever
#   calling `git maintenance register`/`start` (see the file header for the
#   empirical reason those are avoided). Runs a bounded, throttled
#   `git maintenance run --auto` directly against REPO, tracked via a marker
#   file under the repo's own git-common-dir so back-to-back invocations
#   (e.g. this script's own idempotence re-run) do not redundantly re-tick
#   within `GG_TICK_MIN_INTERVAL` seconds (default 3600). Never fatal: a
#   failed or unsupported `maintenance run` degrades to a logged warning,
#   never aborts the bootstrap.
# @arg $1 repo repository path
gg_maintenance_tick() {
  local repo="$1" common marker now last=0 elapsed min_interval
  common="$(git_nohooks -C "$repo" rev-parse --git-common-dir 2>/dev/null || echo ".git")"
  [[ "$common" = /* ]] || common="$repo/$common"
  marker="$common/foreman-maintenance.tick"
  now="$(date -u +%s)"
  [[ -f "$marker" ]] && last="$(cat "$marker" 2>/dev/null || echo 0)"
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  elapsed=$(( now - last ))
  min_interval="${GG_TICK_MIN_INTERVAL:-3600}"
  if (( elapsed >= min_interval )); then
    if git_nohooks -C "$repo" maintenance run --auto >/dev/null 2>&1; then
      log "git-guards: maintenance tick ran (foreman-owned fallback, --auto)"
    else
      log "git-guards: maintenance tick attempt failed (non-fatal; git maintenance may be unavailable on this git version)"
    fi
    printf '%s\n' "$now" > "$marker"
  else
    log "git-guards: maintenance tick skipped (last ran ${elapsed}s ago, < ${min_interval}s threshold)"
  fi
  log "git-guards: maintenance path active (foreman-owned tick; marker=$marker)"
}

gg_apply_config "$REPO" maintenance.auto false
gg_apply_config "$REPO" core.fsmonitor true
gg_apply_config "$REPO" core.untrackedCache true
gg_apply_config "$REPO" core.longpaths true
gg_apply_config "$REPO" safe.bareRepository explicit

gg_maintenance_tick "$REPO"

log "git-guards: bootstrap complete for $REPO"
