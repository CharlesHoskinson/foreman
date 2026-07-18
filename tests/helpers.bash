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
