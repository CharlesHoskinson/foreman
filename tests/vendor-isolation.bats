#!/usr/bin/env bats
# @description T5a (v0.2.5 vendor config isolation plumbing) coverage:
#   wt-new.sh's unconditional per-lane vendor-home provisioning, and
#   lane-run.sh's LANE_VENDOR/LANE_CONFIG_DIR env contract (default dir
#   resolution, explicit-override precedence, the ownership event's
#   config_dir key, and the Bun #12970 / msys->native boundary hazard).
#   Shim-based per spec constraint 4: a fake foreman-launch shim (mirrors
#   tests/lane-run.bats's own write_fake_launcher) plus one skip-guarded
#   real-binary case. No destructive real-vendor concurrency test here --
#   that is T5b (deferred; see docs/research/vendor-concurrency-results.md).
#
# Rework Round 1 (2026-07-18, architect full-suite gate on main): the
# original three "LANE_VENDOR set" tests asserted an MSYS-form expected
# path, but on a host where launcher/dist/foreman-launch.exe already
# exists, `unset FOREMAN_LAUNCH` + a PATH-shim does NOT reliably select the
# shim -- lane_resolve_launcher's precedence checks launcher/dist relative
# to the repo root BEFORE the PATH lookup, so the REAL native launcher
# silently wins. Bash's own msys->native exec-boundary conversion then
# rewrites the exported MSYS-form path into native Windows form for that
# one exec call -- uncontrolled, and dependent on disk state, not a stable
# contract -- so CMD observed a different string than the test's MSYS-form
# `expected`. TWO fixes landed together: (1) lane-run.sh now normalizes the
# effective LANE_CONFIG_DIR deterministically via `cygpath -m` before ever
# exporting it (see lane_normalize_config_dir), so the value reaching CMD
# no longer depends on which launcher happened to resolve; (2) every test
# in this file that wants the fake shim now sets FOREMAN_LAUNCH directly to
# the shim path (explicit-launcher-control pattern) instead of relying on
# PATH-lookup precedence, so test outcome never again depends on
# launcher/dist's presence on disk. All "expected" values are now computed
# via `cygpath -m` in the test bodies themselves for platform-independence.
load helpers

# Mirrors tests/lane-run.bats's own setup(): a throwaway single-commit git
# worktree, durable-lanes intervals off (deterministic, no background
# heartbeat/checkpoint loop), and FOREMAN_LAUNCH neutralized to a
# guaranteed-nonexistent path so every test starts on the frozen
# launcher-absent branch unless it explicitly re-points FOREMAN_LAUNCH at
# the fake shim (Rework Round 1: NEVER via `unset` + PATH -- see file
# header). Also unsets the vendor-isolation env vars this whole file
# exercises, so no test's outcome depends on whatever happened to be set in
# the ambient environment that invoked bats.
setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export DURABLE_ENABLED=false
  export DURABLE_CHECKPOINT_INTERVAL=0 DURABLE_HEARTBEAT_INTERVAL=0
  export FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/no-such-foreman-launch-binary"
  export FAKE_TOOL_CHECK="$BATS_TEST_TMPDIR/fake-tool-check"
  write_fake_tool_check "$FAKE_TOOL_CHECK"
  export FOREMAN_TOOL_CHECK="$FAKE_TOOL_CHECK"
  unset FAKE_TOOL_CHECK_READY
  unset LANE_VENDOR LANE_CONFIG_DIR GROK_HOME CODEX_HOME CLAUDE_CONFIG_DIR 2>/dev/null || true
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  setup_lock_trust_fixture
  WT="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo x > "$WT/f"
  git -C "$WT" add -A
  git -C "$WT" commit -qm base
}

# @description Deterministic readiness probe. Reports the requested lane ready
#   unless FAKE_TOOL_CHECK_READY=no is exported by the negative-control run.
# @arg $1 path to write the probe to
write_fake_tool_check() {
  local path="$1"
  cat > "$path" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
lane=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lane) lane="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ "${FAKE_TOOL_CHECK_READY:-yes}" == "yes" ]]; then
  printf 'LANE_READY: %s=yes\n' "$lane"
  exit 0
fi
printf 'LANE_READY: %s=no\n' "$lane"
exit 1
SHIM
  chmod +x "$path"
}

# @description Mirrors lane-run.sh's own lane_normalize_config_dir exactly
#   (Rework Round 1): `cygpath -m` when available (mixed form, e.g.
#   `C:/Users/x`), else the input unchanged. Used to compute every
#   "expected" value in this file so assertions are platform-independent
#   and never hardcode either path form.
# @arg $1 path
# @stdout normalized (or unchanged) path
norm() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s\n' "$1"
  fi
}

# @description Deterministic fake foreman-launch shim (same shape as
#   tests/lane-run.bats's own write_fake_launcher, trimmed to what this
#   file needs): parses --heartbeat-file/--heartbeat-interval/`-- CMD`,
#   emits one synthetic heartbeat line before running CMD (mirroring the
#   real launcher's "first heartbeat fires immediately at spawn" contract),
#   then runs CMD with whatever environment IT was invoked with -- bash's
#   normal child-inherits-parent-env behavior, nothing special. Since this
#   shim never crosses an msys->native exec boundary (it is bash spawning
#   bash), it cannot by itself reproduce either the Bun #12970 stripping
#   bug OR the msys->native conversion hazard Rework Round 1 diagnosed --
#   what it DOES prove is that lane-run.sh's own normalize+export mechanism
#   produces the right value BEFORE any such boundary is even reached. The
#   skip-guarded real-binary test further down is what actually exercises
#   the real boundary crossing.
# @arg $1 dir directory to write the shim into (Rework Round 1: callers
#   point FOREMAN_LAUNCH directly at DIR/foreman-launch -- never via PATH +
#   unset FOREMAN_LAUNCH, which is disk-state-dependent once
#   launcher/dist/foreman-launch.exe exists; see file header)
write_fake_launcher() {
  local dir="$1"
  cat > "$dir/foreman-launch" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
hb=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --heartbeat-file) hb="$2"; shift 2 ;;
    --heartbeat-interval) shift 2 ;;
    --) shift; break ;;
    *) shift ;;
  esac
done
launcher_pid=$$
child_pid=$((launcher_pid + 1000))
job_id="job-$child_pid"
write_hb() {
  [[ -z "$hb" ]] && return 0
  local alive="$1" ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"ts":"%s","launcher_pid":%d,"pid":%d,"job_id":"%s","alive":%s,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.0}\n' \
    "$ts" "$launcher_pid" "$child_pid" "$job_id" "$alive" >> "$hb"
}
write_hb true
"$@" < /dev/null &
cmd_pid=$!
wait "$cmd_pid"
rc=$?
write_hb false
exit "$rc"
SHIM
  chmod +x "$dir/foreman-launch"
}

# ---------------------------------------------------------------------
# wt-new.sh: unconditional per-lane vendor-home provisioning
# ---------------------------------------------------------------------

@test "wt-new provisions empty vendor-home dirs for grok/codex/claude and prints their paths" {
  setup_tmp_repo
  cd "$REPO"
  run bash "$SCRIPTS/wt-new.sh" run1 implement slug1
  [ "$status" -eq 0 ]
  wt="${lines[-1]}"
  [ -d "$wt/.harness/vendor-home/grok" ]
  [ -d "$wt/.harness/vendor-home/codex" ]
  [ -d "$wt/.harness/vendor-home/claude" ]
  # Empty on purpose (T5b, deferred, is what seeds real vendor config content).
  [ -z "$(ls -A "$wt/.harness/vendor-home/grok")" ]
  [ -z "$(ls -A "$wt/.harness/vendor-home/codex")" ]
  [ -z "$(ls -A "$wt/.harness/vendor-home/claude")" ]
  # Paths printed via log() (stderr; bats' `run` captures it into $output).
  [[ "$output" == *"vendor-home (grok): $wt/.harness/vendor-home/grok"* ]]
  [[ "$output" == *"vendor-home (codex): $wt/.harness/vendor-home/codex"* ]]
  [[ "$output" == *"vendor-home (claude): $wt/.harness/vendor-home/claude"* ]]
}

# ---------------------------------------------------------------------
# lane-run.sh: LANE_VENDOR unset -> frozen path, byte-identical
# ---------------------------------------------------------------------

@test "lane-run (LANE_VENDOR unset, launcher absent -- frozen default): no vendor env reaches CMD" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'env | grep -E "^(GROK_HOME|CODEX_HOME|CLAUDE_CONFIG_DIR)=" > "'"$WT"'/env-dump" || true'
  [ "$status" -eq 0 ]
  [ ! -s "$WT/env-dump" ]
}

@test "lane-run (LANE_VENDOR unset, launcher present): ownership.config_dir stays null, no vendor env reaches CMD" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export FOREMAN_LAUNCH="$stub_dir/foreman-launch"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'env | grep -E "^(GROK_HOME|CODEX_HOME|CLAUDE_CONFIG_DIR)=" > "'"$WT"'/env-dump" || true'
  [ "$status" -eq 0 ]
  [ ! -s "$WT/env-dump" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "null" ]
}

@test "lane-run rejects an unknown LANE_VENDOR before spawning CMD or touching the lock" {
  export LANE_VENDOR=bogus-vendor
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'echo should-not-run > "'"$WT"'/should-not-exist"'
  [ "$status" -eq 2 ]
  [ ! -f "$WT/should-not-exist" ]
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir run1)/events.jsonl" ]
}

# ---------------------------------------------------------------------
# lane-run.sh: LANE_VENDOR set -- default dir resolution, explicit
# override, one env var per vendor, ownership.config_dir. Every
# expected value is the NORMALIZED form (Rework Round 1) -- lane-run.sh
# normalizes unconditionally, regardless of which spawn branch runs.
# ---------------------------------------------------------------------

@test "lane-run (LANE_VENDOR=grok, LANE_CONFIG_DIR unset, fake launcher shim): GROK_HOME defaults to the normalized wt-new-provisioned dir; ownership.config_dir matches" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export FOREMAN_LAUNCH="$stub_dir/foreman-launch"
  export FOREMAN_TOOL_CHECK="$FAKE_TOOL_CHECK"
  mkdir -p "$WT/.harness/vendor-home/grok"   # mirrors wt-new.sh's own provisioning
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  expected="$(norm "$WT/.harness/vendor-home/grok")"
  [ "$(cat "$WT/env-dump")" = "$expected" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "$expected" ]
}

@test "lane-run (LANE_VENDOR=codex, explicit LANE_CONFIG_DIR, fake launcher shim): CODEX_HOME + ownership.config_dir use the normalized override, not the default" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export FOREMAN_LAUNCH="$stub_dir/foreman-launch"
  export FOREMAN_TOOL_CHECK="$FAKE_TOOL_CHECK"
  export LANE_VENDOR=codex
  export LANE_CONFIG_DIR="$BATS_TEST_TMPDIR/custom-codex-home"
  mkdir -p "$LANE_CONFIG_DIR"
  # The test's OWN LANE_CONFIG_DIR (pre-normalization) is still, by
  # construction, a different path than the default dir -- this holds
  # regardless of normalization form.
  [ "$LANE_CONFIG_DIR" != "$WT/.harness/vendor-home/codex" ]
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$CODEX_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  expected="$(norm "$LANE_CONFIG_DIR")"
  [ "$(cat "$WT/env-dump")" = "$expected" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "$expected" ]
}

@test "lane-run rejects LANE_VENDOR=claude (T7: advertising removed; isolated HOME unverified) before CMD" {
  # T7 retired the claude lane: CLAUDE_CONFIG_DIR was insufficient isolation
  # and a distinct $HOME was never implemented. A LANE_VENDOR=claude dispatch
  # must be refused (not mapped to CLAUDE_CONFIG_DIR). Pin the refusal so the
  # half-wiring cannot quietly return. Same shape as the unknown-vendor test
  # above: prove refusal before CMD by using a CMD that would create a file.
  export LANE_VENDOR=claude
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'echo should-not-run > "'"$WT"'/should-not-exist"'
  [ "$status" -ne 0 ]
  [[ "$output" == *"claude"* ]]
  [[ "$output" == *"T7 decision"* ]]
  [[ "$output" == *"LANE_VENDOR 'claude' rejected by T7 decision: claude lane advertising removed because isolated HOME is unverified"* ]]
  [ ! -f "$WT/should-not-exist" ]
  # Refused dispatch leaves no lane lock and no events (mirrors unknown-vendor
  # rejection; verified here rather than assumed from the code path alone).
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir run1)/events.jsonl" ]
}

@test "lane-run (LANE_VENDOR=grok, launcher-absent direct-spawn branch): normalized GROK_HOME still reaches CMD without a launcher" {
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  expected="$(norm "$WT/.harness/vendor-home/grok")"
  [ "$(cat "$WT/env-dump")" = "$expected" ]
}

# ---------------------------------------------------------------------
# Rework Round 1 hazard class: Bun #12970 (compiled Bun exes have
# stripped `\` from env var values on Windows in the past) AND bash's own
# msys->native exec-boundary conversion (uncontrolled, disk-state-
# dependent -- see file header). LANE_CONFIG_DIR is frequently a
# backslashed Windows path; lane-run.sh now deterministically normalizes
# it to forward-slash mixed form (cygpath -m) BEFORE either hazard can
# touch it, so CMD/the ownership event see the SAME normalized value
# regardless of which launcher resolves.
# ---------------------------------------------------------------------

@test "lane-run (fake launcher shim): backslashed LANE_CONFIG_DIR (C:\\x\\y) normalizes to forward-slash form and reaches CMD verbatim" {
  # norm() is identity without cygpath (vendor-isolation.bats:66-72), so
  # `expected` keeps its backslashes and this test's own sanity assertion
  # correctly fires rather than letting it pass vacuously. Backslash path
  # normalization is a Windows-host concern; there is nothing to normalize here.
  command -v cygpath >/dev/null 2>&1 \
    || skip "cygpath unavailable: backslash path normalization is a Windows-host concern"
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export FOREMAN_LAUNCH="$stub_dir/foreman-launch"
  export LANE_VENDOR=grok
  export LANE_CONFIG_DIR='C:\x\y'
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  expected="$(norm 'C:\x\y')"
  [[ "$expected" != *'\'* ]]   # sanity: normalization actually removed the backslashes
  [ "$(cat "$WT/env-dump")" = "$expected" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "$expected" ]
}

# @description Skip-guarded real-binary counterpart (Rework Round 1):
#   exercises the ACTUAL compiled foreman-launch.exe end to end through
#   lane-run.sh's own LANE_VENDOR plumbing -- the real msys->native exec
#   boundary + a real Bun binary, not just the bash fake shim above. This
#   is the test that actually proves the fix: a backslashed
#   LANE_CONFIG_DIR normalizes to forward-slash form BEFORE lane-run.sh
#   ever execs the real launcher, so the value CMD observes matches the
#   normalized `expected` regardless of bash's own implicit boundary
#   conversion. The critical boundary crossing for THIS value is lane-run.sh
#   (msys bash) directly exec'ing the compiled foreman-launch.exe -- that
#   happens identically no matter what CMD itself is, so CMD is `bash -c`
#   here (mirroring tests/lane-run.bats's own real-binary tests), NOT
#   `cmd /c`: a bare `/c` cmd.exe flag needs MSYS_NO_PATHCONV to survive
#   MSYS's own argv conversion (see tests/launcher.bats's setup() comment),
#   but MSYS_NO_PATHCONV would ALSO suppress the auto-conversion lane-run.sh
#   itself relies on for its OWN --heartbeat-file argument (an MSYS-form
#   path) to the same launcher invocation -- confirmed empirically in this
#   worktree: with MSYS_NO_PATHCONV set, the launcher's heartbeat file
#   silently went to the wrong (untranslated) location, ownership pid/job_id
#   came back null on a 20s timeout, and a later native `jq.exe` call on the
#   SAME still-exported variable then also failed to resolve the (also now
#   unconverted) events.jsonl path. Avoiding `cmd /c` sidesteps that whole
#   MSYS_NO_PATHCONV conflict rather than trying to scope it narrowly.
#   Checks file existence FIRST via a plain (non-canonicalized) path before
#   any `cd` -- unlike tests/launcher.bats's own setup(), which `cd`s into
#   launcher/dist unconditionally and hard-fails (rather than skipping) in a
#   fresh worktree where that directory does not exist at all yet (confirmed
#   empirically; out of scope to fix here, not a T5a file). Expected to SKIP
#   only on a host where launcher/build.ps1 has not been run in THIS
#   worktree.
@test "lane-run (real compiled launcher): backslashed LANE_CONFIG_DIR normalizes and survives the real msys->native boundary" {
  exe_rel="$BATS_TEST_DIRNAME/../launcher/dist/foreman-launch.exe"
  [ -f "$exe_rel" ] || skip "compiled exe not found at $exe_rel -- run: pwsh -File launcher/build.ps1"
  EXE="$(cd "$(dirname "$exe_rel")" && pwd)/foreman-launch.exe"
  export FOREMAN_LAUNCH="$EXE"
  export LANE_VENDOR=grok
  export LANE_CONFIG_DIR='C:\vendor-iso-real\sub'
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  expected="$(norm 'C:\vendor-iso-real\sub')"
  [ "$(cat "$WT/env-dump")" = "$expected" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "$expected" ]
}
