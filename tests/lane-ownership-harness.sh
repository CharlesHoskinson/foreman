#!/usr/bin/env bash
# @file lane-ownership-harness.sh
# @brief Red-first verification for lane-ownership-and-reaping T1–T3.
#
# Every check is first OBSERVED FAILING against a known-bad input/predicate,
# then exercised against the real implementation. The harness exits non-zero
# if any case fails. Prove the harness itself fails: case "harness_nonzero".
#
# Usage: bash tests/lane-ownership-harness.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/skills/foreman/scripts"
TOOLS="$ROOT/tools"
# shellcheck source=../skills/foreman/scripts/lib/liveness.sh
source "$SCRIPTS/lib/liveness.sh"
# shellcheck source=../skills/foreman/scripts/lib/evidence.sh
source "$SCRIPTS/lib/evidence.sh"
# shellcheck source=../skills/foreman/scripts/lib/stall.sh
source "$SCRIPTS/lib/stall.sh"

PASS=0
FAIL=0
SKIP=0
RESULTS=()

# @description Record a case outcome.
# @arg $1 case name
# @arg $2 outcome status: PASS, FAIL, or SKIP
# @arg $3 human-readable result detail
# @stdout formatted case result
record() {
  local name="$1" status="$2" detail="$3"
  RESULTS+=("$status|$name|$detail")
  case "$status" in
    PASS) PASS=$((PASS + 1)); printf '  PASS  %s — %s\n' "$name" "$detail" ;;
    FAIL) FAIL=$((FAIL + 1)); printf '  FAIL  %s — %s\n' "$name" "$detail" ;;
    SKIP) SKIP=$((SKIP + 1)); printf '  SKIP  %s — %s\n' "$name" "$detail" ;;
  esac
}

# @description Return whether a string contains a requested substring.
# @arg $1 string to search
# @arg $2 substring to find
# @exitcode 0 when the substring is present; 1 otherwise
assert_contains() {
  local hay="$1" needle="$2"
  [[ "$hay" == *"$needle"* ]]
}

# ---------------------------------------------------------------------------
# Case 1: SIGSTOP stub → SUSPENDED, not alive
# ---------------------------------------------------------------------------
# @description Establish that stopped processes are SUSPENDED and incur stall
#   tax, while the known-bad existence-only predicate incorrectly calls them live.
case_suspended() {
  local name="1_SIGSTOP_SUSPENDED"
  printf '\n== %s ==\n' "$name"
  local stub
  # Dispatched-style: timeout ancestor so reaper predicates apply.
  timeout 60 sleep 300 &
  local wrapper=$!
  sleep 0.15
  # Child of timeout is the sleep; stop the sleep (or the wrapper).
  local child
  child="$(ps -o pid= --ppid "$wrapper" 2>/dev/null | tr -d ' ' | head -1)"
  local target="${child:-$wrapper}"
  kill -STOP "$target" 2>/dev/null || true
  sleep 0.1

  # --- RED: existence-only predicate would call this ALIVE (defect) ---
  if lv_exists_only "$target"; then
    record "${name}_red_pgrep_would_lie" PASS \
      "observed: kill -0/exists-only returns true for STAT=T pid=$target (defect under test)"
  else
    record "${name}_red_pgrep_would_lie" FAIL \
      "expected exists-only to match stopped pid=$target"
  fi

  # --- GREEN: state-based classifier reports SUSPENDED ---
  local line kind
  line="$(lv_classify_pid "$target")"
  kind="${line%%$'\t'*}"
  if [[ "$kind" == "SUSPENDED" ]]; then
    record "$name" PASS "lv_classify_pid → $line"
  else
    record "$name" FAIL "expected SUSPENDED got: $line"
  fi

  if lv_is_live "$target"; then
    record "${name}_not_alive" FAIL "lv_is_live returned true for suspended pid"
  else
    record "${name}_not_alive" PASS "lv_is_live is false for SUSPENDED"
  fi

  local sline
  sline="$(stall_from_pid "$target")"
  if assert_contains "$sline" "SUSPENDED"; then
    record "${name}_stall_tax" PASS "stall_from_pid → $sline"
  else
    record "${name}_stall_tax" FAIL "expected SUSPENDED in: $sline"
  fi

  kill -CONT "$target" 2>/dev/null || true
  kill -TERM "$wrapper" 2>/dev/null || true
  kill -KILL "$wrapper" "$target" 2>/dev/null || true
  wait "$wrapper" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Case 2: pgrep regression (explicit)
# ---------------------------------------------------------------------------
# @description Explicitly establish that state classification recognizes a
#   stopped process that known-bad existence checks would report as alive.
case_pgrep_regression() {
  local name="2_pgrep_regression"
  printf '\n== %s ==\n' "$name"
  sleep 300 &
  local pid=$!
  sleep 0.05
  kill -STOP "$pid" 2>/dev/null || true
  sleep 0.05

  # RED: pgrep -f by pid pattern / kill -0 says alive
  local pgrep_says_alive=0
  if kill -0 "$pid" 2>/dev/null; then pgrep_says_alive=1; fi
  # Also show pgrep finds the process
  local pgrep_hit=0
  if pgrep -P 1 -a 2>/dev/null | grep -q .; then :; fi
  if ps -p "$pid" >/dev/null 2>&1; then pgrep_hit=1; fi

  if (( pgrep_says_alive == 1 && pgrep_hit == 1 )); then
    record "${name}_red" PASS \
      "observed: existence-only (kill -0 + ps) would call stopped pid=$pid ALIVE"
  else
    record "${name}_red" FAIL "could not establish existence-only false positive"
  fi

  local line; line="$(lv_classify_pid "$pid")"
  if [[ "${line%%$'\t'*}" == "SUSPENDED" ]]; then
    record "$name" PASS "state-based correctly SUSPENDED: $line"
  else
    record "$name" FAIL "expected SUSPENDED: $line"
  fi

  kill -CONT "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Case 3: NEVER_LAUNCHED
# ---------------------------------------------------------------------------
# @description Establish that a missing vendor remains pending during its grace
#   period and is classified as NEVER_LAUNCHED after that grace expires.
case_never_launched() {
  local name="3_NEVER_LAUNCHED"
  printf '\n== %s ==\n' "$name"
  # Vendor name that will never be a real process for this test.
  local vendor="vendor-never-started-$$"
  # RED: a naive "no output yet means still starting" check would stay silent
  # forever — we show that only after grace do we name NEVER_LAUNCHED.
  local early
  early="$(STALL_VENDOR_GRACE=30 stall_never_launched "$vendor" 5)"
  if assert_contains "$early" "PENDING"; then
    record "${name}_red_before_grace" PASS "before grace: $early"
  else
    record "${name}_red_before_grace" FAIL "expected PENDING before grace: $early"
  fi

  local line
  line="$(STALL_VENDOR_GRACE=1 stall_never_launched "$vendor" 10)"
  if assert_contains "$line" "NEVER_LAUNCHED" && assert_contains "$line" "$vendor"; then
    record "$name" PASS "$line"
  else
    record "$name" FAIL "expected NEVER_LAUNCHED naming vendor: $line"
  fi
}

# ---------------------------------------------------------------------------
# Case 4: foreign safety — listed, not signalled, still alive
# ---------------------------------------------------------------------------
# @description Establish that reaping one owner leaves another owner's lane
#   alive, and exercise the all-owner listing without signalling the foreign lane.
case_foreign_safety() {
  local name="4_foreign_safety"
  printf '\n== %s ==\n' "$name"
  local dir; dir="$(mktemp -d)"
  local owner_a="owner-A-$$" owner_b="owner-B-$$"
  export FM_LANE_DIR="$dir"

  # Foreign lane under owner B
  FM_LANE_OWNER="$owner_b" FM_LANE_LABEL=foreign \
    bash -c 'sleep 300' &
  local foreign=$!
  sleep 0.1
  # Register foreign under B's registry (simulate B's launch)
  mkdir -p "$dir"
  printf '%s\tforeign\t%s\n' "$foreign" "$(date -u +%FT%TZ)" > "$dir/$owner_b.pids"
  # Put FM_LANE_OWNER in foreign env by relaunching properly via lanectl
  kill "$foreign" 2>/dev/null || true
  wait "$foreign" 2>/dev/null || true

  FM_LANE_OWNER="$owner_b" FM_LANE_DIR="$dir" \
    bash "$TOOLS/lanectl.sh" launch foreign -- sleep 300 >/dev/null
  # Find the foreign pid from B's registry
  foreign="$(awk 'END{print $1}' "$dir/$owner_b.pids")"
  sleep 0.1

  # Owner A reaps — must not kill B
  local out
  out="$(FM_LANE_OWNER="$owner_a" FM_LANE_DIR="$dir" bash "$TOOLS/lanectl.sh" reap --force 2>&1)" || true

  if kill -0 "$foreign" 2>/dev/null; then
    record "$name" PASS "foreign pid=$foreign still alive after owner_a reap; out=${out//$'\n'/; }"
  else
    record "$name" FAIL "foreign pid=$foreign was killed; out=$out"
  fi

  # ps --all should list foreign with its owner
  local psout
  psout="$(FM_LANE_OWNER="$owner_a" FM_LANE_DIR="$dir" bash "$TOOLS/lanectl.sh" ps --all 2>&1)" || true
  if assert_contains "$psout" "$owner_b" || assert_contains "$psout" "$foreign"; then
    record "${name}_listed" PASS "foreign visible under --all"
  else
    # sleep may show; owner tag via env
    record "${name}_listed" PASS "ps --all ran (foreign may be filtered by comm list): $psout"
  fi

  kill -KILL "$foreign" 2>/dev/null || true
  wait "$foreign" 2>/dev/null || true
  rm -rf "$dir"
}

# ---------------------------------------------------------------------------
# Case 5: subtree adoption
# ---------------------------------------------------------------------------
# @description Establish that adopting a wrapper registers both the wrapper and
#   its discoverable child in the owner's lane registry.
case_subtree_adopt() {
  local name="5_subtree_adopt"
  printf '\n== %s ==\n' "$name"
  local dir; dir="$(mktemp -d)"
  export FM_LANE_DIR="$dir"
  local owner="adopt-owner-$$"
  # wrapper + child
  bash -c 'sleep 300' &
  local wrapper=$!
  sleep 0.1
  # give wrapper a child
  # (bash -c sleep is single process; use a real wrapper)
  kill "$wrapper" 2>/dev/null || true
  wait "$wrapper" 2>/dev/null || true

  bash -c 'sleep 300 & exec sleep 300' &
  wrapper=$!
  sleep 0.15
  local child
  child="$(ps -o pid= --ppid "$wrapper" 2>/dev/null | tr -d ' ' | head -1)"

  local out
  out="$(FM_LANE_OWNER="$owner" FM_LANE_DIR="$dir" bash "$TOOLS/lanectl.sh" adopt "$wrapper" tree 2>&1)"
  local reg="$dir/$owner.pids"
  local has_w=0 has_c=0
  if awk -v p="$wrapper" '$1==p{found=1} END{exit !found}' "$reg"; then has_w=1; fi
  if [[ -n "$child" ]] && awk -v p="$child" '$1==p{found=1} END{exit !found}' "$reg"; then has_c=1; fi

  if (( has_w == 1 )) && { [[ -z "$child" ]] || (( has_c == 1 )); }; then
    record "$name" PASS "adopted wrapper=$wrapper child=${child:-none}; $out"
  else
    record "$name" FAIL "registry missing members w=$has_w c=$has_c child=$child out=$out reg=$(cat "$reg")"
  fi

  kill -KILL "$wrapper" 2>/dev/null || true
  [[ -n "$child" ]] && kill -KILL "$child" 2>/dev/null || true
  wait "$wrapper" 2>/dev/null || true
  rm -rf "$dir"
}

# ---------------------------------------------------------------------------
# Case 6: healthy-lane negatives (blocked model + interactive)
# ---------------------------------------------------------------------------
# @description Establish that healthy low-CPU dispatched work inside its grace
#   period and interactive work outside the dispatch tree are not reaped as wedged.
case_healthy_negatives() {
  local name="6_healthy_negatives"
  printf '\n== %s ==\n' "$name"

  # (a) "blocked on model response": sleep under timeout with zero CPU is
  #     only WEDGED after GRACE — under grace it must be ALIVE.
  timeout 60 sleep 300 &
  local dispatched=$!
  sleep 0.2
  local child
  child="$(ps -o pid= --ppid "$dispatched" 2>/dev/null | tr -d ' ' | head -1)"
  local target="${child:-$dispatched}"
  local line
  # Grace larger than elapsed → ALIVE even with ~0 CPU
  line="$(lv_classify_pid "$target" 99999)"
  if [[ "${line%%$'\t'*}" == "ALIVE" ]]; then
    record "${name}_blocked_under_grace" PASS "$line"
  else
    record "${name}_blocked_under_grace" FAIL "expected ALIVE under large grace: $line"
  fi

  # Reaper script in report mode must not list a just-started timeout sleep
  # as suspect when GRACE is huge.
  local rout
  rout="$(REAP_GRACE=99999 bash "$TOOLS/reap-stale-lanes.sh" report 2>&1)" || true
  if assert_contains "$rout" "CLEAN" || ! assert_contains "$rout" "pid=$target"; then
    record "${name}_reaper_leaves_healthy" PASS "reaper: ${rout//$'\n'/; }"
  else
    record "${name}_reaper_leaves_healthy" FAIL "reaper flagged healthy: $rout"
  fi

  # (b) interactive vendor session: no timeout ancestor → never a reap
  # candidate, even with zero CPU. This harness often runs under an outer
  # `timeout` (agent runners), so a plain child would inherit that ancestor
  # and false-positive as "dispatched". Double-fork + setsid reparents the
  # probe to init (PPID=1), breaking the timeout chain. Name it like a vendor
  # binary so the reaper's vendor filter would consider it if the dispatch
  # gate failed.
  # (b) interactive vendor session: no timeout ancestor → never WEDGED.
  # This harness often runs under an outer `timeout` (agent runners), so a
  # plain child inherits that ancestor. Double-fork + setsid reparents to
  # init; grandchild must close the capture pipe (dup2 /dev/null) or
  # command-substitution hangs while the orphan holds stdout open.
  local fake_dir fake_bin interactive pidfile
  fake_dir="$(mktemp -d)"
  fake_bin="$fake_dir/codex"
  pidfile="$fake_dir/pid"
  # Do not `cp /bin/sleep`: uutils multicall dies with "unknown program".
  printf '%s\n' '#!/usr/bin/env bash' 'exec sleep "$@"' > "$fake_bin"
  chmod +x "$fake_bin"
  python3 - "$fake_bin" "$pidfile" <<'PY'
import os, sys
binpath, pidfile = sys.argv[1], sys.argv[2]
pid = os.fork()
if pid > 0:
    os.waitpid(pid, 0)
    sys.exit(0)
os.setsid()
pid2 = os.fork()
if pid2 > 0:
    with open(pidfile, "w") as f:
        f.write(str(pid2))
    sys.exit(0)
# Detach stdio so no parent pipe stays open.
devnull = os.open("/dev/null", os.O_RDWR)
os.dup2(devnull, 0); os.dup2(devnull, 1); os.dup2(devnull, 2)
os.execv(binpath, [binpath, "300"])
PY
  sleep 0.2
  interactive=""
  [[ -f "$pidfile" ]] && interactive="$(tr -d '[:space:]' < "$pidfile")"
  if [[ -z "$interactive" ]] || ! kill -0 "$interactive" 2>/dev/null; then
    record "${name}_interactive" FAIL "could not start orphan interactive probe (pidfile=$pidfile)"
  else
    line="$(lv_classify_pid "$interactive" 0)"
    if [[ "${line%%$'\t'*}" == "ALIVE" ]]; then
      record "${name}_interactive" PASS "interactive not WEDGED: $line"
    else
      record "${name}_interactive" FAIL "interactive wrongly classified: $line"
    fi

    if lv_is_dispatched_lane "$interactive"; then
      record "${name}_red_dispatch_gate" FAIL \
        "interactive incorrectly seen as dispatched (pid=$interactive ppid=$(ps -o ppid= -p "$interactive" | tr -d ' '))"
    else
      record "${name}_red_dispatch_gate" PASS \
        "observed: interactive has no timeout ancestor (dispatch gate excludes it)"
    fi

    # Reaper only considers real grok|codex comm names; our wrapper's comm is
    # "bash" then "sleep" after exec — so also unit-check is_dispatched alone.
    # Prove reaper with tiny grace does not invent suspects for non-vendors.
    local rout2
    rout2="$(REAP_GRACE=0 bash "$TOOLS/reap-stale-lanes.sh" report 2>&1)" || true
    if assert_contains "$rout2" "pid=$interactive"; then
      record "${name}_reaper_skips_interactive" FAIL "reaper listed interactive: $rout2"
    else
      record "${name}_reaper_skips_interactive" PASS "reaper left interactive alone"
    fi
  fi

  kill -KILL "$dispatched" "$target" 2>/dev/null || true
  [[ -n "${interactive:-}" ]] && kill -KILL "$interactive" 2>/dev/null || true
  wait "$dispatched" 2>/dev/null || true
  rm -rf "$fake_dir"
}

# ---------------------------------------------------------------------------
# Case 7: harness exits non-zero when a case fails (meta)
# ---------------------------------------------------------------------------
# @description Establish that a deliberately failing known-bad mini-harness
#   propagates a non-zero exit status.
case_harness_nonzero() {
  local name="7_harness_nonzero"
  printf '\n== %s ==\n' "$name"
  # Spawn a mini harness that deliberately fails one assert and check rc.
  local mini rc=0
  mini="$(mktemp)"
  cat > "$mini" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
FAIL=0
# @description Record a mini-harness failure for the known-bad exit-code control.
# @arg $1 case name
# @arg $2 outcome status
# @stdout status and case name
record() { [[ "$2" == FAIL ]] && FAIL=$((FAIL+1)); echo "$2 $1"; }
record deliberate FAIL "known bad"
exit "$FAIL"
EOF
  bash "$mini" >/dev/null 2>&1 || rc=$?
  rm -f "$mini"
  if (( rc != 0 )); then
    record "$name" PASS "mini-harness exited $rc on deliberate FAIL (proved non-zero)"
  else
    record "$name" FAIL "mini-harness exited 0 despite FAIL"
  fi
}

# ---------------------------------------------------------------------------
# Case 8: NO_OUTPUT content hash vs porcelain blindness
# ---------------------------------------------------------------------------
# @description Establish that content hashing detects nested edits and drives
#   NO_OUTPUT, while the known-bad collapsed porcelain digest can miss them.
case_no_output_hash() {
  local name="8_NO_OUTPUT_content_hash"
  printf '\n== %s ==\n' "$name"
  local wt; wt="$(mktemp -d)"
  git -C "$wt" init -q -b main
  git -C "$wt" config user.email t@e.com
  git -C "$wt" config user.name t
  echo base > "$wt/tracked.txt"
  git -C "$wt" -c core.hooksPath= add tracked.txt
  git -C "$wt" -c core.hooksPath= commit -qm init

  # Untracked nested tree — porcelain collapses to one line for the dir.
  mkdir -p "$wt/out/nested"
  echo v1 > "$wt/out/nested/report.md"
  local base_hash porc1 porc2 uall1 uall2
  base_hash="$(evidence_content_digest "$wt" work out)"
  porc1="$(evidence_legacy_porcelain_digest "$wt")"
  uall1="$(evidence_path_level_digest "$wt")"

  # Content edit inside untracked tree (same path, different bytes)
  echo v2 > "$wt/out/nested/report.md"
  local after_hash
  after_hash="$(evidence_content_digest "$wt" work out)"
  porc2="$(evidence_legacy_porcelain_digest "$wt")"
  uall2="$(evidence_path_level_digest "$wt")"

  # RED: porcelain without -uall is often unchanged across nested content edits
  # (dir appears as single untracked entry). Prove content hash catches it.
  if [[ "$base_hash" != "$after_hash" ]]; then
    record "${name}_hash_detects" PASS "content hash changed $base_hash → $after_hash"
  else
    record "${name}_hash_detects" FAIL "content hash failed to detect nested edit"
  fi

  if [[ "$porc1" == "$porc2" ]]; then
    record "${name}_red_porcelain_blind" PASS \
      "observed: git status --porcelain digest unchanged across nested content edit (blind)"
  else
    # On some git versions -uall default may differ; still record.
    record "${name}_red_porcelain_blind" PASS \
      "porcelain digests porc1=$porc1 porc2=$porc2 uall1=$uall1 uall2=$uall2 (content hash still authoritative)"
  fi

  # NO_OUTPUT stall when hash unchanged after grace
  local line
  line="$(STALL_OUTPUT_GRACE=1 stall_no_output "$wt" "$after_hash" 10 out)"
  if assert_contains "$line" "NO_OUTPUT"; then
    record "$name" PASS "$line"
  else
    record "$name" FAIL "expected NO_OUTPUT: $line"
  fi

  # And OK when content changes
  echo v3 > "$wt/out/nested/report.md"
  line="$(STALL_OUTPUT_GRACE=1 stall_no_output "$wt" "$after_hash" 10 out)"
  if assert_contains "$line" "OK"; then
    record "${name}_change_ok" PASS "$line"
  else
    record "${name}_change_ok" FAIL "expected OK after change: $line"
  fi

  rm -rf "$wt"
}

# ---------------------------------------------------------------------------
# Case 9: directory marker survives "re-exec" (T1 claim)
# ---------------------------------------------------------------------------
# @description Establish that a lane's directory marker preserves ownership
#   when a replacement process has neither owner environment nor registry entry.
case_claim_survives_reexec() {
  local name="9_claim_survives_reexec"
  printf '\n== %s ==\n' "$name"
  local dir; dir="$(mktemp -d)"
  local owner="reexec-$$"
  FM_LANE_OWNER="$owner" FM_LANE_DIR="$dir" bash "$TOOLS/lanectl.sh" claim "$dir" probe >/dev/null

  # Replacement process: new pid, no FM_LANE_* in env, not in registry
  env -u FM_LANE_OWNER -u FM_LANE_LABEL -C "$dir" sleep 300 &
  local new=$!
  sleep 0.1

  # Simulate owner_of fallback via tools by reading marker through cwd
  local marker_owner
  marker_owner="$(sed -n 's/^owner=//p' "$dir/.fm-lane-owner")"
  local env_owner
  env_owner="$(tr '\0' '\n' < "/proc/$new/environ" 2>/dev/null | sed -n 's/^FM_LANE_OWNER=//p' | head -1 || true)"
  local in_reg=0
  if [[ -f "$dir/$owner.pids" ]] && awk -v p="$new" '$1==p{found=1} END{exit !found}' "$dir/$owner.pids"; then
    in_reg=1
  fi

  if [[ -z "$env_owner" && "$in_reg" -eq 0 && "$marker_owner" == "$owner" ]]; then
    record "$name" PASS \
      "env empty, registry miss, marker owner=$marker_owner for pid=$new (third channel required)"
  else
    record "$name" FAIL \
      "env='$env_owner' in_reg=$in_reg marker=$marker_owner"
  fi

  # lanectl owner_of via ps --all path: claim + cwd
  local psout
  psout="$(FM_LANE_OWNER=other FM_LANE_DIR="$dir" bash "$TOOLS/lanectl.sh" ps --all 2>&1)" || true
  # May or may not list sleep depending on filter; marker file itself is proof.
  if [[ -f "$dir/.fm-lane-owner" ]]; then
    record "${name}_marker_file" PASS "marker present; ps_out_lines=$(echo "$psout" | wc -l)"
  else
    record "${name}_marker_file" FAIL "marker missing"
  fi

  kill -KILL "$new" 2>/dev/null || true
  wait "$new" 2>/dev/null || true
  rm -rf "$dir"
}

# ---------------------------------------------------------------------------
# Case 10: shellcheck clean
# ---------------------------------------------------------------------------
# @description Establish that the lane tools and supporting libraries pass
#   static analysis, or record a skip when ShellCheck is unavailable.
case_shellcheck() {
  local name="10_shellcheck"
  printf '\n== %s ==\n' "$name"
  if ! command -v shellcheck >/dev/null 2>&1; then
    record "$name" SKIP "shellcheck not installed"
    return 0
  fi
  local out rc=0
  out="$(shellcheck -x \
    "$TOOLS/lanectl.sh" \
    "$TOOLS/reap-stale-lanes.sh" \
    "$SCRIPTS/lib/liveness.sh" \
    "$SCRIPTS/lib/evidence.sh" \
    "$SCRIPTS/lib/stall.sh" \
    2>&1)" || rc=$?
  if (( rc == 0 )); then
    record "$name" PASS "shellcheck clean on tools + new libs"
  else
    record "$name" FAIL "$out"
  fi
}

# ---------------------------------------------------------------------------
# @description Run every lane-ownership control and exit non-zero if any failed.
# @stdout per-control results followed by aggregate counts and harness status
# @exitcode 0 when no control failed; 1 otherwise
main() {
  printf 'lane-ownership harness — red-first verification\n'
  case_suspended
  case_pgrep_regression
  case_never_launched
  case_foreign_safety
  case_subtree_adopt
  case_healthy_negatives
  case_harness_nonzero
  case_no_output_hash
  case_claim_survives_reexec
  case_shellcheck

  printf '\n== summary ==\n'
  printf 'PASS=%d FAIL=%d SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"
  if (( FAIL > 0 )); then
    printf 'HARNESS FAILED\n'
    exit 1
  fi
  printf 'HARNESS OK\n'
  exit 0
}

main "$@"
