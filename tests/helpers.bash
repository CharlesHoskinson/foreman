#!/usr/bin/env bash
# @description Shared bats helpers: throwaway git repo + isolated FOREMAN_HOME.
set -euo pipefail

# This host's Windows jq.exe emits CRLF, so bats keeps a trailing CR on each
# element of ${lines[@]} when a test parses multi-line jq output, breaking
# string equality. Wrap jq for the TEST environment only (not the shipped
# library) to strip CR. Stripping CR from jq text output is always safe.
if command -v jq >/dev/null 2>&1; then
  _f="${BATS_RUN_TMPDIR:-${BATS_TMPDIR:-/tmp}}/.foreman_jq_crlf"
  if [[ ! -f "$_f" ]]; then
    # Sentinel byte after jq's output: command substitution on this host strips
    # a trailing CRLF as a unit (not just the trailing \n), so a bare
    # "$(printf '{}' | jq -c .)" always loses the very CR it's testing for.
    # Appending a non-newline byte keeps jq's CRLF from being the trailing
    # bytes, so it survives capture intact.
    _probe="$(printf '{}' | jq -c .; printf x)"
    if [[ "$_probe" == *$'\r'* ]]; then _v=1; else _v=0; fi
    # Trailing newline required: under `set -e`, `read` on a file with no
    # final newline returns 1 (EOF-terminated read), which would trip errexit.
    printf '%s\n' "$_v" > "$_f.$$" && mv -f "$_f.$$" "$_f"   # atomic publish
  fi
  read -r _crlf < "$_f"
  if [[ "$_crlf" == 1 ]]; then
    export _REAL_JQ="$(type -P jq)"
    jq() { "$_REAL_JQ" "$@" | tr -d '\r'; }
    export -f jq
  fi
fi

# @description Create a disposable git repo and point FOREMAN_HOME at test tmp.
# @set REPO absolute path of the throwaway repo
# @set SCRIPTS absolute path of skills/foreman/scripts in the real checkout
# @set FOREMAN_HOME isolated run-state dir under bats tmp
setup_tmp_repo() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  mkdir -p "$FOREMAN_HOME"
  REPO="$BATS_TEST_TMPDIR/repo"
  local tpl="$BATS_FILE_TMPDIR/repo-tpl"
  if [[ ! -d "$tpl" ]]; then                 # built once per file
    mkdir -p "$tpl"
    git -C "$tpl" init -q -b main
    git -C "$tpl" config user.email test@example.com
    git -C "$tpl" config user.name "Foreman Test"
    echo "# fixture" > "$tpl/README.md"
    git -C "$tpl" -c core.hooksPath= add README.md
    git -C "$tpl" -c core.hooksPath= commit -qm init
    cp "$BATS_TEST_DIRNAME/../.markdownlint-cli2.jsonc" "$tpl/"
    cp "$BATS_TEST_DIRNAME/../.codespellrc" "$tpl/"
  fi
  cp -r "$tpl" "$REPO"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"   # B#3: no cd&&pwd
  export REPO SCRIPTS
}

# @description el_init the given run and print its run-dir path. Hoisted
#   because several tests (watch.bats, nats-bridge.bats) repeat this exact
#   two-line prefix before seeding a run-specific fixture (a hand-crafted
#   events.jsonl, a pre-created lock dir, ...) directly under the run dir
#   instead of going through the normal emit/lock API. Precondition: the
#   caller's own setup() must already have sourced lib/common.sh (run_dir)
#   and lib/eventlog.sh (el_init) -- this helper does not source them itself.
# @arg $1 run id
# @stdout the run's directory path ($FOREMAN_HOME/runs/$1)
seed_run() {
  el_init "$1"
  run_dir "$1"
}

# @description Create a fresh, single-commit git worktree at
#   $BATS_TEST_TMPDIR/wt with one tracked file ("f"). Repeated identically
#   (modulo the tracked file's content) across checkpoint.bats's and
#   resume.bats's own setup() hooks.
# @arg $1 tracked-file content (default: base)
# @set WT absolute path of the fresh worktree
setup_git_worktree() {
  WT="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo "${1:-base}" > "$WT/f"
  git -C "$WT" add -A
  git -C "$WT" commit -qm base
}

# @description VTICK fake clock for watch.sh (T4a, 2026-07-18 v0.2.5 hardening
#   plan): a file-backed epoch-ms counter plus two tiny standalone bash
#   scripts wired as watch.sh's WATCH_CLOCK_CMD/WATCH_SLEEP_CMD clock seam, so
#   a wall-clock STALLED->DEAD walk that would otherwise take real minutes
#   completes in the time watch.sh's own poll loop takes to run. Standalone
#   script files (not exported bash functions) so invocation is reliable
#   across the `bash "$SCRIPTS/watch.sh"` subprocess boundary these tests
#   spawn, with no dependence on bash's function-export env-var encoding. The
#   counter is seeded at the REAL current epoch-ms (`date +%s%N`) so it
#   starts in the same era as the real `ts` fields a real el_emit call writes
#   for the fixture events -- age computations stay meaningful -- and only
#   ever advances afterward via the WATCH_SLEEP_CMD script's own tmp+rename
#   atomic write (never a real sleep, never touches the real clock again).
# @arg $1 optional counter file path (default: $BATS_TEST_TMPDIR/vtick_ms)
# @set VTICK_FILE the counter file path
# @set WATCH_CLOCK_CMD exported: "bash <script>" that prints $VTICK_FILE's
#   current value
# @set WATCH_SLEEP_CMD exported: "bash <script>" that advances $VTICK_FILE by
#   its own $1 argument (milliseconds)
vtick_init() {
  VTICK_FILE="${1:-$BATS_TEST_TMPDIR/vtick_ms}"
  local now_ms
  now_ms=$(( $(date +%s%N) / 1000000 ))
  printf '%s\n' "$now_ms" > "$VTICK_FILE"

  local clock_script="$BATS_TEST_TMPDIR/vtick_clock.sh"
  cat > "$clock_script" <<EOF
#!/usr/bin/env bash
cat "$VTICK_FILE"
EOF

  local sleep_script="$BATS_TEST_TMPDIR/vtick_sleep.sh"
  cat > "$sleep_script" <<EOF
#!/usr/bin/env bash
# VTICK: no-op with respect to wall time -- never calls sleep. Advances the
# fake clock file by \$1 milliseconds via an atomic tmp+rename write so a
# concurrent reader (watch.sh's own next wd_now_ms call) never sees a torn
# counter file.
delta="\${1:-0}"
cur="\$(cat "$VTICK_FILE")"
new=\$(( cur + delta ))
printf '%s\n' "\$new" > "$VTICK_FILE.tmp.\$\$" && mv -f "$VTICK_FILE.tmp.\$\$" "$VTICK_FILE"
EOF

  export VTICK_FILE
  export WATCH_CLOCK_CMD="bash $clock_script"
  export WATCH_SLEEP_CMD="bash $sleep_script"
}

# ---------------------------------------------------------------------------
# Lock trust fixtures (lock-primitive-hardening integration F4)
# Positive-path tests must not depend on ambient ptrace/strace. Negative-path
# tests must not accidentally earn trust via a local probe. Both fixtures are
# hermetic: they write FOREMAN_TOOL_CHECK_JSON and set
# FOREMAN_LOCK_DISABLE_LOCAL_PROBE=1.
# ---------------------------------------------------------------------------

# @description Install a trusted flock inventory row for the current host.
#   Writes a currency-valid inventory so fm_lock_acquire selects flock without
#   running a local probe. Call from setup() of positive-path lock consumers.
# @set FOREMAN_TOOL_CHECK_JSON inventory path under BATS_TEST_TMPDIR
# @set FOREMAN_LOCK_DISABLE_LOCAL_PROBE 1
# @set FOREMAN_LOCK_MANIFEST empty temp manifest (no pins required)
setup_lock_trust_fixture() {
  local inv_dir inv path ver sha ts
  inv_dir="${BATS_TEST_TMPDIR:-${TMPDIR:-/tmp}}/lock-trust"
  mkdir -p "$inv_dir"
  inv="$inv_dir/last-tool-check.json"
  # Resolve identity without sourcing lock.sh (may already be sourced).
  path="$(command -v flock 2>/dev/null || true)"
  if [[ -n "$path" ]]; then
    path="$(readlink -f -- "$path" 2>/dev/null || printf '%s' "$path")"
  fi
  if [[ -z "$path" || ! -x "$path" ]]; then
    echo "setup_lock_trust_fixture: flock binary not found" >&2
    return 1
  fi
  ver="$(flock --version 2>/dev/null | head -n 1 | tr -d '\r' || true)"
  if [[ -n "$ver" ]]; then
    ver="flock ${ver}"
  else
    ver="flock:$(command -v flock)"
  fi
  sha="$(sha256sum -- "$path" 2>/dev/null | awk '{print $1}')"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 -c '
import json,sys
path,ver,sha,ts=sys.argv[1:5]
doc={
  "lock_atomicity":[{
    "mechanism":"flock",
    "path":path,
    "version":ver,
    "sha256":sha,
    "verdict":"atomic",
    "evidence_class":"syscall",
    "filesystem_classes":["local"],
    "timestamp":ts,
    "notes":"bats trust fixture; not a live probe"
  }]
}
print(json.dumps(doc,indent=2))
' "$path" "$ver" "$sha" "$ts" >"$inv"
  # Empty manifest so pin path is inert.
  : >"$inv_dir/empty-manifest.toml"
  export FOREMAN_TOOL_CHECK_JSON="$inv"
  export FOREMAN_LOCK_MANIFEST="$inv_dir/empty-manifest.toml"
  export FOREMAN_LOCK_DISABLE_LOCAL_PROBE=1
  # Clear any process-local probe cache if lock.sh already sourced.
  _FM_LOCK_VINIT=""
  _FM_LOCK_VINIT_PID=""
  _FM_LOCK_VROWS=""
  _FM_LOCK_LOCAL_PROBED=""
  _FM_LOCK_LOCAL_PROBED_MECHS=""
  _FM_LOCK_LAST_VERDICT=""
  _FM_LOCK_SELECTED=""
}

# @description Install an untrusted lock environment: empty inventory, no
#   local probe, empty pin register. Positive acquisition must refuse with
#   FM_LOCK_PROBE_UNTRUSTED. Use for negative-path lock tests.
setup_lock_untrusted_fixture() {
  local inv_dir
  inv_dir="${BATS_TEST_TMPDIR:-${TMPDIR:-/tmp}}/lock-untrusted"
  mkdir -p "$inv_dir"
  printf '%s\n' '{}' >"$inv_dir/last-tool-check.json"
  : >"$inv_dir/empty-manifest.toml"
  export FOREMAN_TOOL_CHECK_JSON="$inv_dir/last-tool-check.json"
  export FOREMAN_LOCK_MANIFEST="$inv_dir/empty-manifest.toml"
  export FOREMAN_LOCK_DISABLE_LOCAL_PROBE=1
  _FM_LOCK_VINIT=""
  _FM_LOCK_VINIT_PID=""
  _FM_LOCK_VROWS=""
  _FM_LOCK_LOCAL_PROBED=""
  _FM_LOCK_LOCAL_PROBED_MECHS=""
  _FM_LOCK_LAST_VERDICT=""
  _FM_LOCK_SELECTED=""
}

# @description Trusted mkdir-only fixture via temporary pin + inventory.
#   Forces mkdir selection (flock suppressed) for reclaim/owner-token tests.
# @arg $1 optional probe_target fragment (default: x)
setup_lock_mkdir_trust_fixture() {
  local probe_target="${1:-x}"
  local inv_dir path ver sha ts host trace man
  inv_dir="${BATS_TEST_TMPDIR:-${TMPDIR:-/tmp}}/lock-mkdir-trust"
  mkdir -p "$inv_dir"
  path="$(command -v mkdir 2>/dev/null || true)"
  path="$(readlink -f -- "$path" 2>/dev/null || printf '%s' "$path")"
  ver="$(mkdir --version 2>/dev/null | head -n 1 | tr -d '\r' || true)"
  sha="$(sha256sum -- "$path" 2>/dev/null | awk '{print $1}')"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Host class: match lock.sh auto-detect when possible.
  if [[ -n "${FOREMAN_LOCK_HOST_CLASS:-}" ]]; then
    host="$FOREMAN_LOCK_HOST_CLASS"
  elif [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]] || \
       grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    host="wsl-linux"
  else
    host="linux-native"
  fi
  export FOREMAN_LOCK_HOST_CLASS="$host"
  trace="$inv_dir/mkdir-pin.trace"
  # Bound EEXIST line — fragment must match probe_target.
  printf 'mkdir("/tmp/fm-probe/%s", 0777) = -1 EEXIST (File exists)\n' \
    "$probe_target" >"$trace"
  man="$inv_dir/man.toml"
  cat >"$man" <<EOF
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "$sha"
host_class = "$host"
trace_artifact = "$trace"
probe_target = "$probe_target"
filesystem_classes = ["local"]
verdict = "atomic"
date = "2026-07-29"
notes = "bats mkdir trust fixture; NOT a production pin"
EOF
  # Inventory with mkdir atomic; no flock row so selection is mkdir.
  python3 -c '
import json,sys
path,ver,sha,ts=sys.argv[1:5]
doc={
  "lock_atomicity":[{
    "mechanism":"mkdir",
    "path":path,
    "version":ver,
    "sha256":sha,
    "verdict":"atomic",
    "evidence_class":"pinned-mechanism",
    "filesystem_classes":["local"],
    "timestamp":ts,
    "notes":"bats mkdir trust fixture"
  }]
}
print(json.dumps(doc,indent=2))
' "$path" "$ver" "$sha" "$ts" >"$inv_dir/last-tool-check.json"
  export FOREMAN_TOOL_CHECK_JSON="$inv_dir/last-tool-check.json"
  export FOREMAN_LOCK_MANIFEST="$man"
  export FOREMAN_LOCK_DISABLE_LOCAL_PROBE=1
  _FM_LOCK_VINIT=""
  _FM_LOCK_VINIT_PID=""
  _FM_LOCK_VROWS=""
  _FM_LOCK_LOCAL_PROBED=""
  _FM_LOCK_LOCAL_PROBED_MECHS=""
  _FM_LOCK_LAST_VERDICT=""
  _FM_LOCK_SELECTED=""
}
