#!/usr/bin/env bats
# shellcheck disable=SC1091
bats_require_minimum_version 1.5.0
load helpers

setup() {
  SCRIPTS="${FM_LOCK_TEST_SCRIPTS:-$BATS_TEST_DIRNAME/../skills/foreman/scripts}"
  LOCK_LIB="${FM_LOCK_TEST_LIB:-$SCRIPTS/lib/lock.sh}"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export PATH_ORIGINAL="$PATH"
  OCCUPANCY_PIDS=()
}

teardown() {
  local pid
  for pid in "${OCCUPANCY_PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  export PATH="$PATH_ORIGINAL"
}

reset_lock_verdict_cache() {
  _FM_LOCK_VINIT=""
  _FM_LOCK_VINIT_PID=""
  _FM_LOCK_VROWS=""
  _FM_LOCK_LOCAL_PROBED=""
  _FM_LOCK_LOCAL_PROBED_MECHS=""
  _FM_LOCK_LAST_VERDICT=""
  _FM_LOCK_SELECTED=""
}

assert_stderr_contains() {
  local needle="$1"
  if [[ "$stderr" != *"$needle"* ]]; then
    printf 'stderr did not contain %q; actual stderr: %s\n' "$needle" "$stderr" >&3
    return 1
  fi
}

force_mkdir_only() {
  fm_lock__available_mechanisms() {
    printf '%s\n' mkdir
  }
  reset_lock_verdict_cache
}

configure_trusted_flock() {
  setup_lock_trust_fixture
  # shellcheck source=../skills/foreman/scripts/lib/lock.sh
  source "$LOCK_LIB"
}

configure_pinned_mkdir() {
  export FOREMAN_LOCK_HOST_CLASS="${1:-msys2-git-bash}"
  setup_lock_mkdir_trust_fixture lock-probe-target
  # shellcheck source=../skills/foreman/scripts/lib/lock.sh
  source "$LOCK_LIB"
  force_mkdir_only
}

configure_trusted_non_atomic_mkdir() {
  local fixture="$BATS_TEST_TMPDIR/non-atomic"
  local path version sha timestamp
  mkdir -p "$fixture"
  path="$(command -v mkdir)"
  path="$(readlink -f -- "$path" 2>/dev/null || printf '%s' "$path")"
  version="$(mkdir --version 2>/dev/null | head -n 1 | tr -d '\r' || true)"
  sha="$(sha256sum -- "$path" | awk '{print $1}')"
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 -c '
import json, sys
path, version, sha, timestamp = sys.argv[1:5]
print(json.dumps({"lock_atomicity": [{
    "mechanism": "mkdir",
    "path": path,
    "version": version,
    "sha256": sha,
    "verdict": "non-atomic",
    "evidence_class": "syscall",
    "filesystem_classes": ["local"],
    "timestamp": timestamp
}]}))
' "$path" "$version" "$sha" "$timestamp" >"$fixture/inventory.json"
  : >"$fixture/manifest.toml"
  export FOREMAN_TOOL_CHECK_JSON="$fixture/inventory.json"
  export FOREMAN_LOCK_MANIFEST="$fixture/manifest.toml"
  export FOREMAN_LOCK_DISABLE_LOCAL_PROBE=1
  # shellcheck source=../skills/foreman/scripts/lib/lock.sh
  source "$LOCK_LIB"
  force_mkdir_only
}

make_check_then_act_mkdir() {
  local shim_dir="$BATS_TEST_TMPDIR/non-atomic-bin"
  mkdir -p "$shim_dir"
  export REAL_MKDIR_BIN
  REAL_MKDIR_BIN="$(command -v mkdir)"
  cat >"$shim_dir/mkdir" <<'SHIM'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  printf '%s\n' 'mkdir (check-then-act test shim) 1.0'
  exit 0
fi
for arg in "$@"; do
  if [[ "$arg" == "-p" || "$arg" == "--parents" ]]; then
    exec "$REAL_MKDIR_BIN" "$@"
  fi
done
target="${!#}"
if [[ -e "$target" ]]; then
  printf 'mkdir: cannot create directory %q: File exists\n' "$target" >&2
  exit 1
fi
# Deliberately widen the check/create gap, then falsely report success when
# another racer created the directory. This is the known-bad check-then-act
# primitive the occupancy assertion must reject.
sleep 0.08
"$REAL_MKDIR_BIN" -- "$target" 2>/dev/null || true
exit 0
SHIM
  chmod +x "$shim_dir/mkdir"
  export PATH="$shim_dir:$PATH"
}

assert_strict_occupancy_trace() {
  local trace="$1" racers="$2"
  awk -v expected="$racers" '
    BEGIN { occupied = 0; enters = 0; exits = 0; bad = 0 }
    $1 == "ENTER" {
      if (occupied) {
        printf "occupancy overlap: ENTER %s while %s still holds\n", $2, holder > "/dev/stderr"
        bad = 1
      }
      occupied = 1
      holder = $2
      enters++
      next
    }
    $1 == "EXIT" {
      if (!occupied) {
        printf "occupancy underflow: EXIT %s with no holder\n", $2 > "/dev/stderr"
        bad = 1
      } else if ($2 != holder) {
        printf "occupancy mismatch: EXIT %s while %s holds\n", $2, holder > "/dev/stderr"
        bad = 1
      }
      occupied = 0
      holder = ""
      exits++
      next
    }
    {
      printf "occupancy malformed record: %s\n", $0 > "/dev/stderr"
      bad = 1
    }
    END {
      if (occupied) {
        printf "occupancy leak: %s entered without EXIT\n", holder > "/dev/stderr"
        bad = 1
      }
      if (enters != expected || exits != expected) {
        printf "occupancy count: ENTER=%d EXIT=%d expected=%d\n", enters, exits, expected > "/dev/stderr"
        bad = 1
      }
      exit bad
    }
  ' "$trace"
}

occupancy_worker() {
  local id="$1" adapter="$2" lock="$3" trace="$4" ready="$5" go="$6"
  : >"$ready/$id"
  while [[ ! -e "$go" ]]; do
    sleep 0.002
  done

  if [[ "$adapter" == "helper" ]]; then
    # Each contender is a distinct process and therefore initializes its own
    # helper state before entering the same critical section.
    # shellcheck source=../skills/foreman/scripts/lib/lock.sh
    source "$LOCK_LIB"
    fm_lock_acquire "$lock" 10
  else
    while ! mkdir -- "$lock" 2>/dev/null; do
      sleep 0.002
    done
  fi

  printf 'ENTER %s\n' "$id" >>"$trace"
  sleep 0.025
  printf 'EXIT %s\n' "$id" >>"$trace"

  if [[ "$adapter" == "helper" ]]; then
    fm_lock_release "$lock"
  else
    rmdir -- "$lock" 2>/dev/null || true
  fi
}

run_occupancy_race() {
  local adapter="$1" racers="$2"
  local work="$BATS_TEST_TMPDIR/occupancy"
  local lock="$work/shared.lock"
  local trace="$work/trace"
  local ready="$work/ready"
  local go="$work/go"
  local id pid rc=0 count
  mkdir -p "$ready"
  : >"$trace"

  for id in $(seq 1 "$racers"); do
    occupancy_worker "$id" "$adapter" "$lock" "$trace" "$ready" "$go" &
    OCCUPANCY_PIDS+=("$!")
  done

  for _ in $(seq 1 1000); do
    count="$(find "$ready" -type f | wc -l)"
    [[ "$count" -eq "$racers" ]] && break
    sleep 0.002
  done
  [[ "$count" -eq "$racers" ]]
  : >"$go"

  for pid in "${OCCUPANCY_PIDS[@]}"; do
    wait "$pid" || rc=1
  done
  OCCUPANCY_PIDS=()
  [[ "$rc" -eq 0 ]]
  assert_strict_occupancy_trace "$trace" "$racers"
}

@test "occupancy: eight release-contending acquirers strictly alternate ENTER and EXIT" {
  local adapter="helper"
  case "${FM_LOCK_OCCUPANCY_CONTROL:-trusted-flock}" in
    trusted-flock)
      configure_trusted_flock
      ;;
    check-then-act-mkdir)
      make_check_then_act_mkdir
      adapter="primitive"
      ;;
    *)
      echo "unknown FM_LOCK_OCCUPANCY_CONTROL=$FM_LOCK_OCCUPANCY_CONTROL" >&2
      return 2
      ;;
  esac

  run_occupancy_race "$adapter" 8
}

@test "trusted flock acquisition creates no lock directory and releases the held lock" {
  configure_trusted_flock
  local lock="$BATS_TEST_TMPDIR/flock/shared.lock"

  fm_lock_acquire "$lock" 2
  [ "$FM_LOCK_MECHANISM" = "flock" ]
  [ ! -d "$lock" ]
  fm_lock_release "$lock"
  [ -z "$FM_LOCK_MECHANISM" ]
  [ ! -d "$lock" ]
}

@test "temporary pinned manifest makes mkdir fallback reachable and cleans success and error paths" {
  configure_pinned_mkdir msys2-git-bash
  local success_lock="$BATS_TEST_TMPDIR/fallback/success.lock"
  local error_lock="$BATS_TEST_TMPDIR/fallback/error.lock"

  fm_lock_acquire "$success_lock" 2
  [ "$FM_LOCK_MECHANISM" = "mkdir" ]
  [ -d "$success_lock" ]
  [ "$(find "$BATS_TEST_TMPDIR/fallback" -maxdepth 1 -type d -name '*.lock' | wc -l)" -eq 1 ]
  fm_lock_release "$success_lock"
  [ ! -e "$success_lock" ]

  failing_section() {
    fm_lock_acquire "$error_lock" 2 || return 90
    [ "$FM_LOCK_MECHANISM" = "mkdir" ] || return 91
    [ -d "$error_lock" ] || return 92
    local critical_rc=23
    fm_lock_release "$error_lock" || return 93
    return "$critical_rc"
  }
  run failing_section
  [ "$status" -eq 23 ]
  [ ! -e "$error_lock" ]
  [ "$(find "$BATS_TEST_TMPDIR/fallback" -maxdepth 1 -type d -name '*.lock' | wc -l)" -eq 0 ]
  [ "$FOREMAN_LOCK_MANIFEST" != "$BATS_TEST_DIRNAME/../env/reference-manifest.toml" ]
  [[ "$FOREMAN_LOCK_MANIFEST" == "$BATS_TEST_TMPDIR/"* ]]
}

@test "unpinned Git-Bash host refuses with class consequence and pinning route" {
  export FOREMAN_LOCK_HOST_CLASS=msys2-git-bash
  setup_lock_untrusted_fixture
  # shellcheck source=../skills/foreman/scripts/lib/lock.sh
  source "$LOCK_LIB"
  force_mkdir_only
  local lock="$BATS_TEST_TMPDIR/unpinned/shared.lock"
  local protected="$BATS_TEST_TMPDIR/unpinned/protected"
  mkdir -p "$(dirname "$protected")"
  printf '%s\n' unchanged >"$protected"
  local before
  before="$(sha256sum "$protected")"

  run --separate-stderr fm_lock_acquire "$lock" 0

  [ "$status" -ne 0 ]
  [ "$(grep -oE 'FM_LOCK_(NESTED|FS_UNSUPPORTED|NO_ATOMIC_PRIMITIVE|PROBE_UNTRUSTED|UNAVAILABLE|TIMEOUT)' <<<"$stderr" | wc -l)" -eq 1 ]
  [[ "$stderr" == *"FM_LOCK_PROBE_UNTRUSTED"* ]]
  assert_stderr_contains "host_class=msys2-git-bash"
  assert_stderr_contains "durable_lanes=unavailable"
  assert_stderr_contains "trace-on-Foreman-controlled-host-of-same-class"
  assert_stderr_contains "commit-artifact"
  assert_stderr_contains "add-[[lock_atomicity.pinned]]"
  [ ! -e "$lock" ]
  [ "$(sha256sum "$protected")" = "$before" ]
}

@test "trusted non-atomic mkdir with no flock refuses as no atomic primitive" {
  configure_trusted_non_atomic_mkdir
  local lock="$BATS_TEST_TMPDIR/non-atomic-refusal/shared.lock"

  run --separate-stderr fm_lock_acquire "$lock" 0

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"FM_LOCK_NO_ATOMIC_PRIMITIVE"* ]]
  [[ "$stderr" != *"FM_LOCK_PROBE_UNTRUSTED"* ]]
  assert_stderr_contains "mechanism mkdir"
  assert_stderr_contains "atomic_primitive=absent"
  [ ! -e "$lock" ]
}

@test "uncovered filesystem refuses before acquisition and names its class" {
  configure_trusted_flock
  fm_lock__fs_class() {
    printf '%s\n' network
  }
  reset_lock_verdict_cache
  local lock="$BATS_TEST_TMPDIR/network/shared.lock"
  local protected="$BATS_TEST_TMPDIR/network/protected"
  mkdir -p "$(dirname "$protected")"
  printf '%s\n' unchanged >"$protected"
  local before
  before="$(sha256sum "$protected")"

  run --separate-stderr fm_lock_acquire "$lock" 0

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"FM_LOCK_FS_UNSUPPORTED"* ]]
  assert_stderr_contains "$lock"
  assert_stderr_contains "detected_class=network"
  assert_stderr_contains "covered_classes=local"
  [ ! -e "$lock" ]
  [ "$(sha256sum "$protected")" = "$before" ]
}

@test "trusted but unusable lock path refuses with operation detail" {
  configure_trusted_flock
  local parent="$BATS_TEST_TMPDIR/not-a-directory"
  local lock="$parent/shared.lock"
  printf '%s\n' unchanged >"$parent"
  local before
  before="$(sha256sum "$parent")"

  run --separate-stderr fm_lock_acquire "$lock" 0

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"FM_LOCK_UNAVAILABLE"* ]]
  [[ "$stderr" == *"mkdir -p"* ]]
  [ "$(sha256sum "$parent")" = "$before" ]
}

@test "timeout on an engaged trusted mechanism refuses without touching protected data" {
  configure_pinned_mkdir linux-native
  local lock="$BATS_TEST_TMPDIR/timeout/shared.lock"
  local protected="$BATS_TEST_TMPDIR/timeout/protected"
  mkdir -p "$lock"
  printf '%s\n' unchanged >"$protected"
  local before
  before="$(sha256sum "$protected")"

  run --separate-stderr fm_lock_acquire "$lock" 0

  [ "$status" -ne 0 ]
  [[ "$stderr" == *"FM_LOCK_TIMEOUT"* ]]
  [[ "$stderr" != *"FM_LOCK_PROBE_UNTRUSTED"* ]]
  [ -d "$lock" ]
  [ "$(sha256sum "$protected")" = "$before" ]
}

@test "nested acquisition refuses while outer lock remains held and releasable" {
  configure_trusted_flock
  local outer="$BATS_TEST_TMPDIR/nested/outer.lock"
  local inner="$BATS_TEST_TMPDIR/nested/inner.lock"

  fm_lock_acquire "$outer" 2
  local held_before="$_FM_LOCK_HELD_PATH"
  run --separate-stderr fm_lock_acquire "$inner" 0
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"FM_LOCK_NESTED"* ]]
  [ "$_FM_LOCK_HELD_PATH" = "$held_before" ]
  [ "$FM_LOCK_MECHANISM" = "flock" ]
  fm_lock_release "$outer"
  [ -z "$_FM_LOCK_HELD_PATH" ]
}

@test "sequence and attempt locks are independent across processes" {
  configure_trusted_flock
  local seq="$BATS_TEST_TMPDIR/independent/.seq.lock"
  local attempt="$BATS_TEST_TMPDIR/independent/.attempt.lock"
  local marker="$BATS_TEST_TMPDIR/independent/seq-entered"

  fm_lock_acquire "$attempt" 2
  (
    # shellcheck source=../skills/foreman/scripts/lib/lock.sh
    source "$LOCK_LIB"
    fm_lock_acquire "$seq" 1
    : >"$marker"
    fm_lock_release "$seq"
  ) &
  local child=$!
  wait "$child"
  [ -e "$marker" ]
  [ "$_FM_LOCK_HELD_PATH" = "$attempt" ]
  fm_lock_release "$attempt"
}

@test "owner-aware reclaim removes only the named dead-holder mkdir lock" {
  configure_pinned_mkdir linux-native
  local target="$BATS_TEST_TMPDIR/reclaim/.nats-bridge.lock"
  local seq="$BATS_TEST_TMPDIR/reclaim/.seq.lock"
  local attempt="$BATS_TEST_TMPDIR/reclaim/.attempt.lock"
  local dead_pid=999999
  while kill -0 "$dead_pid" 2>/dev/null; do
    dead_pid=$((dead_pid + 1))
  done
  mkdir -p "$target" "$seq" "$attempt"
  printf 'pid=%s\nstart=1\n' "$dead_pid" >"$target/owner"

  run --separate-stderr fm_lock_reclaim "$target"

  [ "$status" -eq 0 ]
  [[ "$stderr" == *"FM_LOCK_RECLAIMED"* ]]
  [[ "$stderr" == *"$target"* ]]
  [[ "$stderr" == *"$dead_pid"* ]]
  [ ! -e "$target" ]
  [ -d "$seq" ]
  [ -d "$attempt" ]
}

@test "owner-aware reclaim refuses a live holder and leaves its lock intact" {
  configure_pinned_mkdir linux-native
  local lock="$BATS_TEST_TMPDIR/reclaim-live/.nats-bridge.lock"

  fm_lock_acquire "$lock" 2
  run --separate-stderr fm_lock_reclaim "$lock"
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"FM_LOCK_RECLAIM_REFUSED"* ]]
  assert_stderr_contains "reason=held_by_this_process"
  [ -d "$lock" ]
  fm_lock_release "$lock"
  [ ! -e "$lock" ]
}

# @description Report every line of a shell file that invokes a pattern-matching
#   kill. The comment is stripped from each line first, so a comment that names
#   the pattern does not count. A "#" starts a comment only at the start of a
#   word, so "${#array[@]}" survives the strip and is still scanned.
# @arg $@ shell files to scan
# @stdout "path:line: text" for each invocation found
scan_pattern_kill_invocations() {
  awk '
    {
      code = $0
      sub(/(^|[[:space:]])#.*$/, "", code)
      if (code ~ /pkill[[:space:]]+-f([[:space:]]|$)/) {
        printf "%s:%d: %s\n", FILENAME, FNR, $0
      }
    }
  ' "$@"
}

@test "operational scripts never invoke pkill -f pattern matching" {
  local script_files=()
  mapfile -t script_files < <(find "$SCRIPTS" -type f -name '*.sh' -print | sort)
  [ "${#script_files[@]}" -gt 0 ]
  run scan_pattern_kill_invocations "${script_files[@]}"
  [ "$status" -eq 0 ]
  if [ -n "$output" ]; then
    printf 'pattern-matching kill invoked at:\n%s\n' "$output" >&3
  fi
  [ -z "$output" ]
}
