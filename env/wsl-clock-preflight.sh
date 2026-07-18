#!/usr/bin/env bash
# @description Lane-start clock-drift preflight (v0.2.7.5 package 3,
#   wsl-reliability-env-refresh Task 4): protects the event log's ordering
#   invariants against WSL VM clock drift after a Windows host sleep/resume
#   cycle. WSL2's guest clock can lag the host's real clock until an
#   explicit `hwclock -s` resync -- a documented WSL2 behavior (the guest VM
#   is paused during host sleep and does not automatically catch up on its
#   own), not a bug in this repo. This script compares a WSL-side clock
#   reading against a host-side clock reading and, when the drift exceeds
#   --threshold seconds, either resyncs (--resync) or refuses + alerts
#   (default) -- so a timestamped event is never written to the event log
#   while the two clocks disagree beyond a safe margin. See also
#   env/wsl-clock-resync-task.xml for the complementary resume-triggered
#   `hwclock -s` Windows Scheduled Task (belt-and-braces: that hook fixes
#   drift proactively on resume; this preflight is the last-line guard at
#   lane start in case the hook did not run, was not installed, or the
#   resume happened too recently for the hook to have completed yet).
#
# Fully injectable clock seam for deterministic testing (see
# tests/wsl-clock-preflight.bats, which mocks a skewed clock without ever
# touching the real system clock) -- same family as watch.sh's own
# WATCH_CLOCK_CMD/WATCH_SLEEP_CMD seam (tests/helpers.bash's vtick_init):
#   WSL_CLOCK_CMD    - command whose stdout is the WSL/guest epoch-seconds
#                       reading (default: "date +%s")
#   HOST_CLOCK_CMD   - command whose stdout is the host epoch-seconds
#                       reading (default: default_host_clock below)
#   CLOCK_RESYNC_CMD - command run when drift exceeds threshold and
#                       --resync is given (default: "hwclock -s", needs root)
#
# Usage: env/wsl-clock-preflight.sh [--threshold SECONDS] [--resync]
# @exitcode 0 clocks agree within threshold (before or after a resync)
# @exitcode 1 drift exceeds threshold and was not (or could not be) resynced
# @exitcode 2 usage error
set -euo pipefail

THRESHOLD=5
RESYNC=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --resync) RESYNC=1; shift ;;
    -h|--help)
      echo "usage: wsl-clock-preflight.sh [--threshold SECONDS] [--resync]"
      exit 0
      ;;
    *) echo "wsl-clock-preflight: unknown arg: $1" >&2; exit 2 ;;
  esac
done

# @description Default HOST_CLOCK_CMD: query the Windows host's current UTC
#   epoch-seconds via its own PowerShell, reached through the WSL-mounted
#   /mnt/c filesystem by FULL PATH (never a PATH search) -- the one
#   legitimate, deliberate cross-boundary call Task 2's own
#   appendWindowsPath=false fix documents a carve-out for (see
#   reference-environment.md's "WSL interop" section): an intentional,
#   explicit invocation, never a PATH-leak accident. Falls back to
#   `date +%s` (assume clocks agree) when there is no /mnt/c Windows mount
#   at all, so this degrades to a trivially-passing preflight on a non-WSL
#   Linux host instead of crashing.
# @stdout the host's current UTC epoch-seconds
# shellcheck disable=SC2329 # invoked indirectly via $HOST_CLOCK_CMD's default value
default_host_clock() {
  local ps="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
  if [[ -x "$ps" ]]; then
    "$ps" -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()" 2>/dev/null
  else
    date +%s
  fi
}

WSL_CLOCK_CMD="${WSL_CLOCK_CMD:-date +%s}"
HOST_CLOCK_CMD="${HOST_CLOCK_CMD:-default_host_clock}"
CLOCK_RESYNC_CMD="${CLOCK_RESYNC_CMD:-hwclock -s}"

# @description Read one clock source's epoch-seconds value, stripped of any
#   CRLF a Windows-side command (e.g. powershell.exe) may emit, and of any
#   other stray non-digit noise. Invokes its argument unquoted (word-split)
#   -- same convention as watch.sh's own `$WATCH_CLOCK_CMD` -- so a
#   multi-word override like "bash /path/to/script.sh" resolves correctly.
# @arg $1 the clock-source command string (e.g. "date +%s", "hwclock -r",
#   or a bare function name such as default_host_clock)
# @stdout the epoch-seconds integer, or an empty string if unreadable
read_clock() {
  local cmd="$1" out
  out="$($cmd 2>/dev/null)" || out=""
  out="${out//$'\r'/}"
  printf '%s' "$out" | tr -dc '0-9'
}

wsl_now="$(read_clock "$WSL_CLOCK_CMD")"
host_now="$(read_clock "$HOST_CLOCK_CMD")"

if [[ -z "$wsl_now" || -z "$host_now" ]]; then
  echo "wsl-clock-preflight: ALERT -- could not read one or both clocks (wsl='$wsl_now' host='$host_now'); refusing" >&2
  exit 1
fi

drift=$(( wsl_now > host_now ? wsl_now - host_now : host_now - wsl_now ))

if (( drift <= THRESHOLD )); then
  echo "wsl-clock-preflight: OK -- drift ${drift}s <= threshold ${THRESHOLD}s"
  exit 0
fi

echo "wsl-clock-preflight: drift ${drift}s exceeds threshold ${THRESHOLD}s (wsl=$wsl_now host=$host_now)" >&2

if [[ "$RESYNC" -eq 1 ]]; then
  echo "wsl-clock-preflight: drift exceeds threshold -- attempting resync: $CLOCK_RESYNC_CMD" >&2
  $CLOCK_RESYNC_CMD >/dev/null 2>&1 || true
  wsl_now2="$(read_clock "$WSL_CLOCK_CMD")"
  if [[ -z "$wsl_now2" ]]; then
    echo "wsl-clock-preflight: ALERT -- resync attempted but WSL clock unreadable afterward; refusing" >&2
    exit 1
  fi
  drift2=$(( wsl_now2 > host_now ? wsl_now2 - host_now : host_now - wsl_now2 ))
  if (( drift2 <= THRESHOLD )); then
    echo "wsl-clock-preflight: OK -- resynced, drift now ${drift2}s <= threshold ${THRESHOLD}s"
    exit 0
  fi
  echo "wsl-clock-preflight: ALERT -- resync attempted but drift still ${drift2}s > threshold ${THRESHOLD}s; refusing" >&2
  exit 1
fi

echo "wsl-clock-preflight: ALERT -- refusing to allow a timestamped event write while clocks disagree (re-run with --resync, or fix host/WSL time manually)" >&2
exit 1
