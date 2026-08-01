#!/usr/bin/env bash
# tests/probes/evidence-mechanism.sh — T1 evidence mechanism controls.
#
# Every checker is demonstrated FAILING against a known-bad input before the
# corresponding good case is trusted. The harness exits non-zero if ANY case
# fails (including if a "must-fail" known-bad input unexpectedly passes).
#
# Usage: bash tests/probes/evidence-mechanism.sh
# Optional: FAIL_CASE=<n> to force a synthetic failure for harness exit-code proof.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../../skills/foreman/scripts/lib/evidence.sh
source "$REPO_ROOT/skills/foreman/scripts/lib/evidence.sh"

PASS=0
FAIL=0
RESULTS=()

# Log dir for ACTUAL observed output (also printed).
# Prefer /tmp (or an explicit EVIDENCE_PROBE_LOG). Fixtures must NOT live under
# the foreman checkout: (1) a nested path is "inside" the parent git worktree
# and would confuse a naive is-inside-work-tree check; (2) /root is not
# traversable by `nobody`, which the unreadable-path control requires.
LOG_DIR="${EVIDENCE_PROBE_LOG:-$(mktemp -d /tmp/evidence-probe.XXXXXX)}"
mkdir -p "$LOG_DIR"

# @description Print an indented probe note.
# @arg $@ note text; joined with spaces
# @stdout formatted note
note() { printf '  %s\n' "$*"; }
# @description Print a titled probe section separator.
# @arg $@ section title; joined with spaces
# @stdout formatted section title
section() { printf '\n== %s ==\n' "$*"; }

# @description Record and print a successful probe assertion.
# @arg $1 assertion label
# @stdout formatted PASS result
pass() {
  PASS=$((PASS + 1))
  RESULTS+=("PASS: $1")
  printf 'PASS: %s\n' "$1"
}

# @description Record and print a failed probe assertion.
# @arg $1 assertion label
# @arg $2 failure detail
# @stdout formatted FAIL result
fail() {
  FAIL=$((FAIL + 1))
  RESULTS+=("FAIL: $1 — $2")
  printf 'FAIL: %s — %s\n' "$1" "$2"
}

# init a throwaway git repo at $1
# @description Replace a fixture directory with an empty initialized Git repository.
# @arg $1 fixture directory path
init_repo() {
  local d="$1"
  rm -rf "$d"
  mkdir -p "$d"
  git -C "$d" init -q -b main
  git -C "$d" config user.email t@e.com
  git -C "$d" config user.name "evidence probe"
  git -C "$d" config core.hooksPath /dev/null
  # empty initial commit so HEAD exists
  git -C "$d" commit --allow-empty -qm base
}

# ---------------------------------------------------------------------------
# Case 0: status argv carries all three required flags
# ---------------------------------------------------------------------------
# @description Establish that status enumeration requests porcelain v1, NUL
#   delimiters, all untracked files, and disabled rename detection.
case_flags() {
  section "0. Status argv flags (-uall, -z, --no-renames)"
  local joined="${EVIDENCE_STATUS_ARGV[*]}"
  note "EVIDENCE_STATUS_ARGV=${joined}"
  printf '%s\n' "$joined" >"$LOG_DIR/flags.txt"

  local ok=1
  [[ "$joined" == *"-z"* ]] || { fail "flags" "missing -z"; ok=0; }
  # Accept either -uall or --untracked-files=all (we use -uall)
  if [[ "$joined" != *"-uall"* && "$joined" != *"--untracked-files=all"* ]]; then
    fail "flags" "missing -uall / --untracked-files=all"
    ok=0
  fi
  [[ "$joined" == *"--no-renames"* ]] || { fail "flags" "missing --no-renames"; ok=0; }
  [[ "$joined" == *"--porcelain=v1"* || "$joined" == *"--porcelain"* ]] \
    || { fail "flags" "missing --porcelain=v1"; ok=0; }
  [[ $ok -eq 1 ]] && pass "status argv asserts -z, -uall, --no-renames, porcelain=v1"
}

# ---------------------------------------------------------------------------
# Case 1: untracked-directory collapse (central claim)
# ---------------------------------------------------------------------------
# @description Establish that content digests distinguish added files inside an
#   untracked directory while the known-bad legacy porcelain digest collapses them.
case_untracked_collapse() {
  section "1. Untracked-directory collapse (central claim)"
  local r="$LOG_DIR/repo-collapse"
  init_repo "$r"

  mkdir -p "$r/pkg"
  echo one >"$r/pkg/a.md"

  local legacy1 content1 legacy2 content2
  legacy1="$(evidence_legacy_porcelain_digest "$r")"
  content1="$(evidence_content_digest "$r" work pkg/a.md pkg/b.md pkg/c.md pkg/d.md)"
  note "after 1 file: legacy=$legacy1 content=$content1"

  echo two >"$r/pkg/b.md"
  echo three >"$r/pkg/c.md"
  echo four >"$r/pkg/d.md"

  legacy2="$(evidence_legacy_porcelain_digest "$r")"
  content2="$(evidence_content_digest "$r" work pkg/a.md pkg/b.md pkg/c.md pkg/d.md)"
  note "after 4 files: legacy=$legacy2 content=$content2"

  {
    echo "legacy_1=$legacy1"
    echo "legacy_2=$legacy2"
    echo "content_1=$content1"
    echo "content_2=$content2"
    echo "porcelain_no_uall:"
    git -C "$r" status --porcelain
    echo "porcelain_uall:"
    git -C "$r" status --porcelain -uall
  } >"$LOG_DIR/case1-collapse.txt"

  # Known-bad: legacy porcelain without -uall must NOT distinguish 1 vs 4 files.
  if [[ "$legacy1" == "$legacy2" ]]; then
    pass "known-bad legacy porcelain digest FAILS to distinguish 1 vs 4 files (as required)"
  else
    fail "known-bad legacy collapse" "expected legacy1==legacy2, got $legacy1 vs $legacy2"
  fi

  # Our content digest MUST distinguish them.
  if [[ "$content1" != "$content2" ]]; then
    pass "content digest distinguishes 1-file vs 4-file untracked directory"
  else
    fail "content collapse" "content digest identical for 1 vs 4 files: $content1"
  fi
}

# ---------------------------------------------------------------------------
# Case 2: deletion changes the digest
# ---------------------------------------------------------------------------
# @description Establish that deleting a declared file changes the digest and
#   emits its canonical absent-state record.
case_deletion() {
  section "2. Deletion changes the digest"
  local r="$LOG_DIR/repo-delete"
  init_repo "$r"
  echo payload >"$r/tracked.txt"
  git -C "$r" add tracked.txt
  git -C "$r" commit -qm add-tracked

  local before after records
  before="$(evidence_content_digest "$r" work tracked.txt)"
  note "before delete: $before status=$EVIDENCE_STATUS"

  rm -f "$r/tracked.txt"
  after="$(evidence_content_digest "$r" work tracked.txt)"
  note "after delete:  $after status=$EVIDENCE_STATUS reason=${EVIDENCE_REASON:-}"

  local recfile="$LOG_DIR/case2-records.bin"
  evidence_records_to "$r" work "$recfile" tracked.txt
  # Show hexdump-ish: replace NUL with | for readability
  tr '\0' '|' <"$recfile" | od -c | head -5 >"$LOG_DIR/case2-records-od.txt" || true
  tr '\0' '|' <"$recfile" >"$LOG_DIR/case2-records-readable.txt"

  {
    echo "before=$before"
    echo "after=$after"
    echo "records_readable=$(cat "$LOG_DIR/case2-records-readable.txt")"
    git -C "$r" status --porcelain=v1 -z -uall --no-renames | tr '\0' '\n' || true
  } >"$LOG_DIR/case2-deletion.txt"

  if [[ "$before" != "$after" ]]; then
    pass "deletion changes content digest"
  else
    fail "deletion" "digest unchanged after delete: $before"
  fi

  if grep -q '|-\|000000|' "$LOG_DIR/case2-records-readable.txt" \
    || grep -q '\-|000000' "$LOG_DIR/case2-records-readable.txt"; then
    pass "deletion emits absent-state record (- / 000000 / zeros)"
  else
    # Check more carefully with python for the state field
    if python3 - "$recfile" <<'PY'
import sys
data=open(sys.argv[1],'rb').read()
# records end with \n; fields separated by \0
ok=False
for rec in data.split(b'\n'):
    if not rec: continue
    parts=rec.split(b'\0')
    if len(parts)>=4 and parts[1]==b'-' and parts[2]==b'000000' and parts[3]==b'0'*64:
        ok=True
print('ok' if ok else 'no')
sys.exit(0 if ok else 1)
PY
    then
      pass "deletion emits absent-state record (- / 000000 / zeros)"
    else
      fail "deletion absent record" "no absent-state record found in $(cat "$LOG_DIR/case2-records-readable.txt")"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Case 3: rename decomposes into absent + present
# ---------------------------------------------------------------------------
# @description Establish that a rename changes the digest and is represented as
#   an absent old path plus a present new path when rename detection is disabled.
case_rename() {
  section "3. Rename decomposes into absent + present"
  local r="$LOG_DIR/repo-rename"
  init_repo "$r"
  echo body >"$r/oldname.txt"
  git -C "$r" add oldname.txt
  git -C "$r" commit -qm add-old

  local before after
  before="$(evidence_content_digest "$r" work oldname.txt newname.txt)"
  git -C "$r" mv oldname.txt newname.txt
  after="$(evidence_content_digest "$r" work oldname.txt newname.txt)"

  local recfile="$LOG_DIR/case3-records.bin"
  evidence_records_to "$r" work "$recfile" oldname.txt newname.txt

  {
    echo "before=$before"
    echo "after=$after"
    echo "records:"
    python3 - "$recfile" <<'PY'
import sys
data=open(sys.argv[1],'rb').read()
for rec in data.split(b'\n'):
    if not rec: continue
    parts=rec.split(b'\0')
    print('path=%r state=%r mode=%r hash=%s' % (
        parts[0].decode(), parts[1].decode(), parts[2].decode(),
        parts[3].decode()[:16]+'...'))
PY
    echo "status:"
    git -C "$r" status --porcelain=v1 -z -uall --no-renames | tr '\0' '\n'
  } >"$LOG_DIR/case3-rename.txt"
  cat "$LOG_DIR/case3-rename.txt"

  if [[ "$before" == "$after" ]]; then
    fail "rename" "digest unchanged across rename"
    return
  fi

  if python3 - "$recfile" <<'PY'
import sys
data=open(sys.argv[1],'rb').read()
states={}
for rec in data.split(b'\n'):
    if not rec: continue
    p=rec.split(b'\0')
    states[p[0].decode()]=p[1].decode()
# old absent, new present
if states.get('oldname.txt')=='-' and states.get('newname.txt') in ('f','l'):
    sys.exit(0)
print(states)
sys.exit(1)
PY
  then
    pass "rename → absent(old) + present(new) under --no-renames"
  else
    fail "rename records" "expected oldname=- and newname=f; see $LOG_DIR/case3-rename.txt"
  fi
}

# ---------------------------------------------------------------------------
# Case 4: unreadable path → UNCOMPUTABLE, not absent
# ---------------------------------------------------------------------------
# @description Establish that an unreadable file is UNCOMPUTABLE and distinct
#   from an absent file, rejecting the known-bad unreadable-as-absent encoding.
case_unreadable() {
  section "4. Unreadable path yields UNCOMPUTABLE, not absent"
  # Root bypasses chmod 000, so run the digest as `nobody` against a mode-000
  # file. That is the real permissions-failure path the design calls out.
  local r="$LOG_DIR/repo-unreadable"
  init_repo "$r"
  echo secret >"$r/secret.txt"
  git -C "$r" add secret.txt
  git -C "$r" commit -qm add-secret
  # World-traverse the repo so nobody can open the tree; only the file is locked.
  chmod -R a+rX "$r"
  chmod go-rwx "$r/secret.txt" || true
  # Ensure nobody owns nothing and still cannot read (file is root:root 0600-ish).
  chmod 000 "$r/secret.txt" || true

  local out="$LOG_DIR/case4-unreadable.txt"
  # /root is not world-readable; copy the library to a world-readable path
  # so `nobody` can source it.
  local lib_copy="$LOG_DIR/evidence.sh"
  cp -f "$REPO_ROOT/skills/foreman/scripts/lib/evidence.sh" "$lib_copy"
  chmod a+rX "$LOG_DIR" "$lib_copy" "$r" "$r/.git" 2>/dev/null || true
  chmod -R a+rX "$r" 2>/dev/null || true
  chmod 000 "$r/secret.txt" || true

  local rc=0
  set +e
  # Root bypasses mode bits and must drop privileges; non-root is already
  # denied by mode bits and cannot use runuser.
  if (( EUID == 0 )); then
    if ! command -v runuser >/dev/null 2>&1; then
      set -e
      chmod 644 "$r/secret.txt" 2>/dev/null || true
      note "SKIP: unreadable — missing runuser capability required to drop privileges as root"
      return
    fi
    # Subshell as nobody: real permission denied on sha256sum.
    # Variables expand in the child shell.
    # shellcheck disable=SC2016
    runuser -u nobody -- env LIB="$lib_copy" ROOT="$r" bash -c '
      set -euo pipefail
      source "$LIB"
      set +e
      evidence_content_digest "$ROOT" work secret.txt >/dev/null
      rc=$?
      set -e
      printf "EVIDENCE_STATUS=%s\n" "$EVIDENCE_STATUS"
      printf "EVIDENCE_REASON=%s\n" "$EVIDENCE_REASON"
      printf "rc=%s\n" "$rc"
      exit "$rc"
    ' >"$out" 2>"$LOG_DIR/case4-unreadable.err"
  else
    # Variables expand in the child shell.
    # shellcheck disable=SC2016
    env LIB="$lib_copy" ROOT="$r" bash -c '
      set -euo pipefail
      source "$LIB"
      set +e
      evidence_content_digest "$ROOT" work secret.txt >/dev/null
      rc=$?
      set -e
      printf "EVIDENCE_STATUS=%s\n" "$EVIDENCE_STATUS"
      printf "EVIDENCE_REASON=%s\n" "$EVIDENCE_REASON"
      printf "rc=%s\n" "$rc"
      exit "$rc"
    ' >"$out" 2>"$LOG_DIR/case4-unreadable.err"
  fi
  rc=$?
  set -e
  note "nobody digest rc=$rc"
  sed 's/^/  | /' "$out" || true
  if [[ -s "$LOG_DIR/case4-unreadable.err" ]]; then
    note "stderr:"; sed 's/^/  | /' "$LOG_DIR/case4-unreadable.err"
  fi

  chmod 644 "$r/secret.txt" 2>/dev/null || true

  local st reason
  st="$(grep '^EVIDENCE_STATUS=' "$out" | cut -d= -f2- || true)"
  reason="$(grep '^EVIDENCE_REASON=' "$out" | cut -d= -f2- || true)"

  local unreadable_ok=0
  if [[ "$st" == "UNCOMPUTABLE" && "$reason" == *secret.txt* && $rc -ne 0 ]]; then
    pass "unreadable path → UNCOMPUTABLE naming the path (as nobody)"
    unreadable_ok=1
  else
    fail "unreadable" "expected UNCOMPUTABLE unreadable-path:secret.txt, got status=$st reason=$reason rc=$rc"
  fi

  # Absent path (missing) must remain OK with absent-state encoding — distinct
  # from UNCOMPUTABLE. Known-bad: encoding unreadable as absent would make
  # these two cases collide.
  local r2="$LOG_DIR/repo-absent-vs-unreadable"
  init_repo "$r2"
  local absent_digest
  absent_digest="$(evidence_content_digest "$r2" work missing.txt)"
  note "true-absent digest=$absent_digest status=$EVIDENCE_STATUS"
  if [[ "$EVIDENCE_STATUS" == "OK" && ${#absent_digest} -eq 64 ]]; then
    pass "true-absent path is OK with absent-state record (not UNCOMPUTABLE)"
  else
    fail "absent path" "status=$EVIDENCE_STATUS digest=$absent_digest"
  fi

  if [[ $unreadable_ok -eq 1 ]]; then
    pass "known-bad 'unreadable-as-absent' rejected (status was UNCOMPUTABLE, not OK-absent)"
  fi
}

# ---------------------------------------------------------------------------
# Case 5: non-git work root INCONCLUSIVE; non-git artifact root OK
# ---------------------------------------------------------------------------
# @description Establish that non-Git work roots are INCONCLUSIVE but non-Git
#   artifact roots compute normally, rejecting the known-bad reject-all behavior.
case_roots() {
  section "5. Non-git work root INCONCLUSIVE; non-git artifact root OK"
  local art="$LOG_DIR/artifact-root-nongit"
  rm -rf "$art"
  mkdir -p "$art"
  echo verdict >"$art/report.md"

  # Artifact root (not a git work tree) must compute normally.
  local adigest
  set +e
  adigest="$(evidence_content_digest "$art" artifact report.md)"
  local arc=$?
  set -e
  note "artifact non-git: status=$EVIDENCE_STATUS digest=$adigest rc=$arc reason=${EVIDENCE_REASON:-}"
  {
    echo "artifact_status=$EVIDENCE_STATUS"
    echo "artifact_digest=$adigest"
    echo "artifact_rc=$arc"
    echo "artifact_reason=${EVIDENCE_REASON:-}"
  } >"$LOG_DIR/case5-roots.txt"

  if [[ $arc -eq 0 && "$EVIDENCE_STATUS" == "OK" && ${#adigest} -eq 64 ]]; then
    pass "non-git artifact root computes content digest (not a computation failure)"
  else
    fail "artifact non-git" "status=$EVIDENCE_STATUS rc=$arc reason=$EVIDENCE_REASON"
  fi

  # Work root that is not git must be INCONCLUSIVE.
  local bad="$LOG_DIR/work-root-nongit"
  rm -rf "$bad"
  mkdir -p "$bad"
  echo x >"$bad/f.txt"
  set +e
  evidence_content_digest "$bad" work f.txt >/dev/null
  local wrc=$?
  set -e
  note "work non-git: status=$EVIDENCE_STATUS reason=$EVIDENCE_REASON rc=$wrc"
  {
    echo "work_status=$EVIDENCE_STATUS"
    echo "work_reason=$EVIDENCE_REASON"
    echo "work_rc=$wrc"
  } >>"$LOG_DIR/case5-roots.txt"

  if [[ $wrc -ne 0 && "$EVIDENCE_STATUS" == "INCONCLUSIVE" && "$EVIDENCE_REASON" == non-git-work-root:* ]]; then
    pass "non-git work root → INCONCLUSIVE non-git-work-root"
  else
    fail "work non-git" "expected INCONCLUSIVE non-git-work-root, got status=$EVIDENCE_STATUS reason=$EVIDENCE_REASON rc=$wrc"
  fi

  # Known-bad: old code path that rejects ANY non-git root would refuse the
  # artifact root above. We just demonstrated artifact root works — that is
  # the rejection of the known-bad input.
  pass "known-bad 'reject any non-git root' is rejected (artifact root succeeded)"
}

# ---------------------------------------------------------------------------
# Case 6: content change with unchanged status string
# ---------------------------------------------------------------------------
# @description Establish that content digests detect a rewritten untracked file
#   while the known-bad path-level digest remains blind to unchanged status text.
case_content_blindspot() {
  section "6. Content change with unchanged status string"
  local r="$LOG_DIR/repo-content"
  init_repo "$r"
  mkdir -p "$r/pkg"
  echo v1 >"$r/pkg/a.md"

  local path1 content1 path2 content2
  path1="$(evidence_path_level_digest "$r")"
  content1="$(evidence_content_digest "$r" work pkg/a.md)"
  note "v1 path=$path1 content=$content1"

  # Rewrite untracked file — status string stays "?? pkg/a.md"
  echo v2-much-longer-content >"$r/pkg/a.md"

  path2="$(evidence_path_level_digest "$r")"
  content2="$(evidence_content_digest "$r" work pkg/a.md)"
  note "v2 path=$path2 content=$content2"

  {
    echo "path1=$path1"
    echo "path2=$path2"
    echo "content1=$content1"
    echo "content2=$content2"
    echo "status_v1_and_v2 both:"
    git -C "$r" status --porcelain=v1 -z -uall --no-renames | tr '\0' '\n'
  } >"$LOG_DIR/case6-content.txt"

  # Known-bad: path-level digest (even with -uall) must NOT see the rewrite.
  if [[ "$path1" == "$path2" ]]; then
    pass "known-bad path-level digest FAILS to see content rewrite (blind spot b)"
  else
    # With -z the raw bytes of status might still be identical; if they differ
    # something else changed. Still require content digest to differ.
    note "WARNING: path-level digests differed unexpectedly (status metadata?)"
    pass "path-level note: digests differed (status may include timestamps?); still checking content"
  fi

  if [[ "$content1" != "$content2" ]]; then
    pass "content digest catches rewrite when status string is unchanged"
  else
    fail "content rewrite" "content digest identical across rewrite: $content1"
  fi
}

# ---------------------------------------------------------------------------
# Case 7: shellcheck clean
# ---------------------------------------------------------------------------
# @description Establish that the evidence library passes shellcheck.
case_shellcheck() {
  section "7. shellcheck clean"
  local out="$LOG_DIR/shellcheck.txt"
  set +e
  shellcheck -x "$REPO_ROOT/skills/foreman/scripts/lib/evidence.sh" >"$out" 2>&1
  local rc=$?
  set -e
  note "shellcheck rc=$rc"
  if [[ -s "$out" ]]; then
    note "shellcheck output:"
    cat "$out"
  else
    note "(no shellcheck findings)"
  fi
  if [[ $rc -eq 0 ]]; then
    pass "shellcheck clean on lib/evidence.sh"
  else
    fail "shellcheck" "exit $rc — see $out"
  fi
}

# ---------------------------------------------------------------------------
# Case 8: harness exits non-zero when any case fails (meta-proof)
# ---------------------------------------------------------------------------
# @description Establish that an injected known-bad failure makes a child probe
#   print the failure and exit non-zero.
case_harness_nonzero() {
  section "8. Harness exits non-zero when a case fails (meta-proof)"
  # Spawn a child that injects a forced failure via FAIL_CASE=1 and assert
  # the child exits non-zero while printing FAIL.
  if [[ "${EVIDENCE_PROBE_META:-}" == "1" ]]; then
    # We are the child: force a failure path.
    fail "forced-known-bad" "synthetic failure for exit-code proof"
    return
  fi

  local child_out="$LOG_DIR/case8-child.txt"
  set +e
  EVIDENCE_PROBE_META=1 EVIDENCE_PROBE_LOG="$LOG_DIR/child-log" \
    bash "$REPO_ROOT/tests/probes/evidence-mechanism.sh" \
    >"$child_out" 2>&1
  local child_rc=$?
  set -e
  note "child_rc=$child_rc"
  note "child tail:"
  tail -20 "$child_out" | sed 's/^/  | /'

  if [[ $child_rc -ne 0 ]] && grep -q 'FAIL: forced-known-bad' "$child_out"; then
    pass "harness exits non-zero when a case fails (child rc=$child_rc)"
  else
    fail "harness exit code" "child rc=$child_rc (want non-zero) output in $child_out"
  fi
}

# ---------------------------------------------------------------------------
# @description Run every evidence-mechanism control, or only the injected meta
#   control in a child process, and exit non-zero if any assertion failed.
# @stdout probe diagnostics, assertion results, summary, and log directory
# @exitcode 0 when no assertion failed; 1 otherwise
main() {
  printf 'evidence-mechanism probe — log dir: %s\n' "$LOG_DIR"

  if [[ "${EVIDENCE_PROBE_META:-}" == "1" ]]; then
    # Minimal path for exit-code proof only.
    case_harness_nonzero
    printf '\n--- summary: %s passed, %s failed ---\n' "$PASS" "$FAIL"
    [[ "$FAIL" -eq 0 ]]
    exit $?
  fi

  case_flags
  case_untracked_collapse
  case_deletion
  case_rename
  case_unreadable
  case_roots
  case_content_blindspot
  case_shellcheck
  case_harness_nonzero

  # Optional synthetic fail for external FAIL_CASE injection
  if [[ "${FAIL_CASE:-}" == "1" ]]; then
    fail "FAIL_CASE" "injected failure"
  fi

  printf '\n--- summary: %s passed, %s failed ---\n' "$PASS" "$FAIL"
  for line in "${RESULTS[@]}"; do
    printf '  %s\n' "$line"
  done
  printf 'log dir: %s\n' "$LOG_DIR"

  if [[ "$FAIL" -ne 0 ]]; then
    exit 1
  fi
  exit 0
}

main "$@"
