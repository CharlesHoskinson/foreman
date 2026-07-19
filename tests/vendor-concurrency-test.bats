#!/usr/bin/env bats
# @description T5b (v0.2.7.5, package 6) harness-LOGIC coverage for
#   vendor-concurrency-test.sh -- entirely shim-driven and deterministic, no
#   real vendor CLI, no real quota. A fake vendor CLI written to
#   $BATS_TEST_TMPDIR/bin (prepended on PATH) stands in for grok/codex;
#   because vendor-concurrency-test.sh roots its containment scan at
#   BATS_TEST_TMPDIR when set (see vct_root), a shim that writes to a
#   sibling path of that directory is a genuine, observable containment
#   escape -- exactly what a misbehaving real vendor CLI writing outside its
#   own config dir would look like. The real destructive grok/codex runs
#   (Task 2 of the T5b plan) are a manual, contained protocol against real
#   quota -- never exercised here; see docs/research/vendor-concurrency-results.md.
load helpers

setup() {
  setup_tmp_repo
  SHIM="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$SHIM"
}

@test "runner emits GREEN when N isolated shim-lanes all pass (N=2)" {
  printf '#!/usr/bin/env bash\necho ok > "$GROK_HOME/ran"\n' > "$SHIM/grok"
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT: GREEN"* ]]
  [[ "$output" == *"containment: clean"* ]]
}

@test "runner emits GREEN at N=3 too (well-behaved shim, three lanes)" {
  printf '#!/usr/bin/env bash\necho ok > "$GROK_HOME/ran"\n' > "$SHIM/grok"
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 3
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT: GREEN"* ]]
  [[ "$output" == *"lane 3:"* ]]
}

@test "a deeply-nested (>260 char) but valid JSON file in-config is NOT a false-positive corruption (Windows MAX_PATH regression)" {
  # Reproduces a real finding from the Task 2 destructive run: codex's own
  # bundled-plugin cache nests deep enough under a long containment root to
  # exceed Windows' 260-char MAX_PATH, which made jq.exe's path-argument
  # file-open fail even though the file is valid JSON. vct_json_bad must
  # feed jq over stdin (never a path argument) so this is not misreported
  # as config-JSON corruption.
  cat > "$SHIM/grok" <<'SHIM'
#!/usr/bin/env bash
d="$GROK_HOME"
for i in $(seq 1 12); do d="$d/segment_of_a_certain_length_xx"; done
mkdir -p "$d"
printf '{"a":1}' > "$d/deep.json"
SHIM
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT: GREEN"* ]]
  [[ "$output" == *"config-json: valid"* ]]
}

@test "runner emits RED + abort log when a shim writes outside its config dir" {
  printf '#!/usr/bin/env bash\necho leak > "$BATS_TEST_TMPDIR/outside"\n' > "$SHIM/grok"
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 1 ]
  [[ "$output" == *"VERDICT: RED"* ]]
  [[ "$output" == *"abort"* ]]
  [[ "$output" == *"LEAK DETECTED"* ]]
}

@test "runner emits RED + abort log when a lane freezes and needs kill -9" {
  # A shim that ignores SIGTERM so timeout's -k grace escalates to SIGKILL
  # (rc 137) -- the concrete "process requires kill -9" abort trigger.
  # VCT_AUTH_TIMEOUT=1 keeps the pre/post auth reprobe (which hits this same
  # SIGTERM-ignoring shim) from also taking its own full default bound.
  printf "#!/usr/bin/env bash\ntrap '' TERM\nfor i in \$(seq 1 20); do sleep 1; done\n" > "$SHIM/grok"
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" VCT_TIMEOUT=1 VCT_KILL_GRACE=1 VCT_AUTH_TIMEOUT=1 bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 1 ]
  [[ "$output" == *"VERDICT: RED"* ]]
  [[ "$output" == *"abort"* ]]
  [[ "$output" == *"freeze: TRIPPED"* ]]
}

# --- Rework round 1 (Opus audit): per-lane $HOME + auth-invalidation ------
# Two abort monitors the original cut omitted: (spec.md:9) a real vendor
# writing $HOME-relative state shares the real ambient $HOME across every
# lane, invisible to the containment scan entirely; (spec.md:16-21) nothing
# re-probed auth after the run, so a sibling lane's invalidated session
# would never be observed.

@test "a write inside a lane's own \$HOME stays contained (per-lane HOME override works)" {
  # Positive control for the $HOME fix: proves HOME is actually set to a
  # lane-owned subtree (not the real ambient one) and that subtree is
  # already covered by the existing whole-root containment scan -- a write
  # there must NOT be misreported as an escape.
  printf '#!/usr/bin/env bash\necho ok > "$HOME/lane-home-file"\n' > "$SHIM/grok"
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT: GREEN"* ]]
  [[ "$output" == *"containment: clean"* ]]
}

@test "a shim that escapes via \$HOME (../.. traversal, landing outside every lane dir) -> containment-abort RED" {
  # Simulates a vendor that resolves its "home" writes to a location the
  # per-lane HOME override does not actually contain (e.g. ignores $HOME and
  # falls back to Windows' own USERPROFILE/profile-API resolution, or
  # traverses above it) -- exactly the escape shape Claude's own
  # ~/.claude.json write races are (see the Task 3 ruling in the results
  # doc). Must still be caught as a containment violation.
  printf '#!/usr/bin/env bash\necho leak > "$HOME/../../escaped-via-home"\n' > "$SHIM/grok"
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 1 ]
  [[ "$output" == *"VERDICT: RED"* ]]
  [[ "$output" == *"abort"* ]]
  [[ "$output" == *"LEAK DETECTED"* ]]
  [[ "$output" == *"escaped-via-home"* ]]
}

@test "auth stays valid pre/post -> no false-positive auth_invalidation abort" {
  # Positive control: a shim whose auth probe ("models") always reports
  # signed-in, both before and after the main task runs. Must stay GREEN.
  cat > "$SHIM/grok" <<'SHIM'
#!/usr/bin/env bash
if [[ "$1" == "models" ]]; then
  echo "You are logged in with grok.com."
  exit 0
fi
echo ok > "$GROK_HOME/ran"
SHIM
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT: GREEN"* ]]
  [[ "$output" == *"auth-invalidation: none"* ]]
  [[ "$output" == *"auth(pre/post)=yes/yes"* ]]
}

@test "a sibling lane's auth invalidated mid-run -> auth_invalidation abort RED" {
  # A shared (not per-lane) state file simulates a REMOTE session that
  # local per-lane config-dir isolation cannot isolate: the auth probe
  # ("models") reports signed-in until any lane's main task runs, then
  # reports signed-out for every lane afterward. Pre-created (so it exists
  # in the harness's own BEFORE containment snapshot) and lives outside any
  # lane's own dir on purpose -- it stands in for the vendor's remote
  # account state, not a local file this harness is expected to contain.
  STATE="$BATS_TEST_TMPDIR/auth-state"
  echo ok > "$STATE"
  cat > "$SHIM/grok" <<SHIM
#!/usr/bin/env bash
if [[ "\$1" == "models" ]]; then
  if grep -q invalidated "$STATE" 2>/dev/null; then
    echo "Error: not authenticated. Please sign in." >&2
    exit 1
  fi
  echo "You are logged in with grok.com."
  exit 0
else
  echo invalidated > "$STATE"
  echo ok > "\$GROK_HOME/ran"
fi
SHIM
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 1 ]
  [[ "$output" == *"VERDICT: RED"* ]]
  [[ "$output" == *"abort"* ]]
  [[ "$output" == *"auth-invalidation: TRIPPED"* ]]
  [[ "$output" == *"pre=yes post=no"* ]]
}

@test "vendor id maps to its own config-dir env var (codex -> CODEX_HOME)" {
  printf '#!/usr/bin/env bash\necho ok > "$CODEX_HOME/ran"\n' > "$SHIM/codex"
  chmod +x "$SHIM/codex"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" codex 2
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT: GREEN"* ]]
}

@test "an unknown/absent vendor CLI reports a missing-CLI error, never a fake verdict" {
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" novendorxyz 2
  [ "$status" -eq 3 ]
  [[ "$output" != *"VERDICT:"* ]]
  [[ "$output" == *"not found on PATH"* ]]
}

@test "usage error on missing args" {
  run bash "$SCRIPTS/vendor-concurrency-test.sh"
  [ "$status" -eq 2 ]
}

@test "a session/thread id merely containing the digits 429 is not a false-positive rate-limit signal" {
  # Regression: observed during the Task 2 destructive run -- a real codex
  # thread_id like "...-9429-..." bare-substring-matched "429" even though
  # it is not an HTTP 429. The check must be word-bounded (\b429\b).
  printf '#!/usr/bin/env bash\necho '"'"'{"type":"thread.started","thread_id":"019f7782-2e08-77b1-9429-47434507473a"}'"'"'\necho ok > "$GROK_HOME/ran"\n' > "$SHIM/grok"
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok 2
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT: GREEN"* ]]
  [[ "$output" == *"rate-limit signal: none"* ]]
}

@test "usage error on non-numeric N" {
  printf '#!/usr/bin/env bash\ntrue\n' > "$SHIM/grok"
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/vendor-concurrency-test.sh" grok abc
  [ "$status" -eq 2 ]
}

# --- Task 4: gated cap changes (lane-queue.sh) ----------------------------
# Source-level checks, not a full pueue-shim run (tests/lane-queue.bats
# already covers the live `ensure` topology behaviorally and is out of
# scope for this file to touch/duplicate). These lock the T5b gating
# invariant: every cap is traceable to a results-doc row, in the one place
# (lane-queue.sh) T5b is allowed to modify. The 2026-07-18 LIVE authorized
# run recorded GREEN rows (grok N=2/N=3, codex N=2), so the caps are now
# grok:3 / codex:2 -- raised only to the proven-green N.

@test "lane-queue.sh cites the T5b results doc next to the grok/codex cap topology" {
  run grep -n -B8 'for spec in grok:3 codex:2' "$SCRIPTS/lane-queue.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"vendor-concurrency-results.md"* ]]
}

@test "lane-queue.sh raises grok/codex caps to the T5b proven-green N (grok:3, codex:2)" {
  run grep -F 'for spec in grok:3 codex:2' "$SCRIPTS/lane-queue.sh"
  [ "$status" -eq 0 ]
  # the pre-verdict default (both capped at 1) must be gone
  run grep -F 'for spec in grok:1 codex:1' "$SCRIPTS/lane-queue.sh"
  [ "$status" -ne 0 ]
}
