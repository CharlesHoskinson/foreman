#!/usr/bin/env bash
# Create an isolated git worktree for a parallel Foreman agent role.
# Usage: wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]
# Roles: search | plan | audit | implement | advisor | misc
#
# CONTRACT (R7B2-C, v0.3.0): gains no new arguments. A worktree contains no
# credential authority. This script does not create or advertise provider-home
# directories. Lane admission resolves a verified external profile root.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"
# shellcheck source=lib/lock.sh
source "$SCRIPT_DIR/lib/lock.sh"

# v0.2.7.5 worktree-hardening T4: GIT_ASK_YESNO=false lane-wide, for every git
# operation this script (and the worktree it provisions) performs, so a
# Windows "Unlink failed. Try again? (y/n)" prompt auto-declines instead of
# hanging with no TTY to answer it. Unlike GIT_OPTIONAL_LOCKS (scoped only to
# read-only polls, below -- never a write path), this is safe script-wide: it
# only ever affects an interactive retry PROMPT, never lock semantics.
export GIT_ASK_YESNO=false

RUN_ID="${1:?usage: wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]}"
ROLE="${2:?role required}"
SLUG="${3:-}"
BASE="${4:-HEAD}"

[[ "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || die "$EXIT_CONFIG" "bad run id: $RUN_ID"
wt_role_ok "$ROLE" || die "$EXIT_CONFIG" "bad role: $ROLE (search|plan|audit|implement|advisor|misc)"
[[ -z "$SLUG" || "$SLUG" =~ ^[A-Za-z0-9._-]+$ ]] || die "$EXIT_CONFIG" "bad slug"

require_cmd git
# jq preferred; python3 fallback for Windows hosts without jq
if ! command -v jq >/dev/null 2>&1; then
  require_cmd python3 "or install jq"
fi

# v0.2.7.5 worktree-hardening T4: GIT_OPTIONAL_LOCKS=0 scoped ONLY to this
# read-only poll (a temporary env assignment prefixing the call, so it
# reaches git_nohooks's own real `git` subprocess for the duration of just
# this one invocation and never leaks into any later write, e.g. `worktree
# add` below) -- never on a write path, per spec.
ROOT="$(GIT_OPTIONAL_LOCKS=0 git_nohooks rev-parse --show-toplevel)"

# --- Live-target guard (v0.2.8.1) --------------------------------------
# soft_mode.target=live bypasses worktrees for stateful/live targets (external
# node_modules / running services the checkout doesn't carry). Resolve config
# against ROOT -- the CALLER's git-root (matching cfg_load + worker-run) -- NOT
# the foreman skill's own dir; for an EXTERNAL target (the case this guards)
# those differ, since install.* junctions the skill elsewhere. FOREMAN_CONFIG is
# a production config override (also honored by cfg_load in lib/config.sh) that
# tests drive directly. Runs before any worktree is created below.
_wt_config="${FOREMAN_CONFIG:-$ROOT/.foreman/config.toml}"
if [[ "$(toml_get "$_wt_config" soft_mode.target worktree)" == "live" ]]; then
  die "$EXIT_CONFIG" "soft_mode.target=live — worktree fan-out is bypassed for stateful/live targets; run soft mode in the working checkout (see references/parallel-worktrees.md § stateful/live-target)"
fi

RD="$(run_dir "$RUN_ID")"
mkdir -p "$RD/reports" "$RD/worktrees"

# v0.2.7.5 worktree-hardening Rework Round 1 (Risk 1, Opus audit): apply the
# concurrency-safe repo config + maintenance tick (git-guards.sh, T1) to the
# SHARED repo at worktree-creation time. Before this, git-guards.sh was
# wired NOWHERE -- the whole guard bundle only took effect if an operator
# ran it manually, so foreman itself got zero automatic hardening (the
# entire point of the package). git-guards.sh's own contract is idempotent,
# so re-applying it on every wt-new.sh call is cheap and is what makes it
# auto-effective for the worktree workflow. Best-effort and non-fatal: a
# failure here must NEVER block worktree creation, so it is the condition
# of an if/else (safe under this script's own `set -e`, unlike a bare
# unguarded statement) and only logged either way.
if bash "$SCRIPT_DIR/git-guards.sh" "$ROOT"; then
  log "git-guards applied to $ROOT"
else
  log "WARN: git-guards.sh failed against $ROOT (non-fatal; worktree creation continues)"
fi

# v0.2.7.5 worktree-hardening T3: sweep any 0-byte, aged lock (e.g. an
# index.lock orphaned by a crashed prior process) in the SHARED repo before
# this lane's own worktree add ever touches it.
wt_sweep_stale_locks "$ROOT"

WT="$(wt_path "$ROOT" "$RUN_ID" "$ROLE" "$SLUG")"
BRANCH="$(wt_branch "$RUN_ID" "$ROLE" "$SLUG")"
BASE_SHA="$(GIT_OPTIONAL_LOCKS=0 git_nohooks -C "$ROOT" rev-parse "${BASE}^{commit}")"

# Append to index (and all irreversible worktree setup) under the shared
# index lock. v0.2.7.5 worktree-hardening T6: concurrent wt-new.sh for the
# SAME run_id must serialize the index.json RMW. lock-primitive-hardening:
# acquire BEFORE any irreversible operation (git worktree add, reports, and
# metadata) so a refused acquisition leaves nothing half-created
# and a retry of the same invocation can succeed. Doctrine: "mkdir is atomic
# on Git Bash/MSYS" is FALSE on Ubuntu 26.04 hybrid coreutils. Mechanism is
# flock when trusted, mkdir fallback under the same trust rule — never a
# bare inline mkdir spin and NEVER fail-open after timeout. A timed-out
# acquisition exits non-zero; index.json is left byte-identical. Raise
# WT_INDEX_LOCK_TIMEOUT_SEC to wait longer — never bypass the lock.
IDX="$RD/worktrees/index.json"
IDX_LOCK="$RD/worktrees/.index.lock"
mkdir -p "$RD/worktrees"

# Owner-aware reclaim of this lock only (never a sweep). Mechanism
# conditionality lives inside fm_lock_reclaim. Never reclaim silently:
# surface the record (success naming lock+dead holder, or refusal reason).
idx_reclaim_rc=0
idx_reclaim_errf="$(mktemp "${TMPDIR:-/tmp}/wt-new-reclaim.XXXXXX")" || idx_reclaim_errf=""
if [[ -n "$idx_reclaim_errf" ]]; then
  fm_lock_reclaim "$IDX_LOCK" 2>"$idx_reclaim_errf" || idx_reclaim_rc=$?
  idx_reclaim_msg="$(tr -d '\r' <"$idx_reclaim_errf" 2>/dev/null)"
  rm -f -- "$idx_reclaim_errf"
else
  fm_lock_reclaim "$IDX_LOCK" || idx_reclaim_rc=$?
  idx_reclaim_msg=""
fi
if [[ -n "${idx_reclaim_msg:-}" ]]; then
  # log goes to stderr via common.sh; keep reclaim records visible.
  printf '%s\n' "$idx_reclaim_msg" >&2
fi
if (( idx_reclaim_rc != 0 )); then
  log "WARN: fm_lock_reclaim refused for $IDX_LOCK (rc=$idx_reclaim_rc); lock left in place"
fi

# Configurable timeout; default matches helper (FM_LOCK_TIMEOUT_SEC=30).
: "${WT_INDEX_LOCK_TIMEOUT_SEC:=${FM_LOCK_TIMEOUT_SEC:-30}}"
idx_lock_owned=0
idx_errf="$(mktemp "${TMPDIR:-/tmp}/wt-new-idx-lock.XXXXXX")"
if ! fm_lock_acquire "$IDX_LOCK" "$WT_INDEX_LOCK_TIMEOUT_SEC" >/dev/null 2>"$idx_errf"; then
  idx_err="$(tr -d '\r' <"$idx_errf" 2>/dev/null | head -n 1)"
  rm -f -- "$idx_errf"
  die "$EXIT_FAIL" "index.json lock acquisition refused for run $RUN_ID: ${idx_err:-FM_LOCK_TIMEOUT} (raise WT_INDEX_LOCK_TIMEOUT_SEC to wait longer; never bypass)"
fi
rm -f -- "$idx_errf"
idx_lock_owned=1

# Release only if this process acquired. Trap covers any exit from the
# critical section so a later failure cannot leak the lock. Because
# acquisition precedes irreversible setup, a refuse path never creates a
# worktree that cannot be retried.
# @description Release the shared worktree-index lock only when this process owns it, and clear the ownership flag for idempotent exit cleanup.
idx_release_lock() {
  if [[ "$idx_lock_owned" == "1" ]]; then
    fm_lock_release "$IDX_LOCK" || true
    idx_lock_owned=0
  fi
}
trap idx_release_lock EXIT

if [[ -e "$WT" ]]; then
  die "$EXIT_CONFIG" "worktree path already exists: $WT"
fi

# git worktree add prints progress to stdout — keep it off the path echo
wt_with_lock "$ROOT" \
  git -c core.hooksPath= -C "$ROOT" worktree add "$WT" -b "$BRANCH" "$BASE_SHA" >/dev/null

git_nohooks -C "$ROOT" config extensions.worktreeConfig true 2>/dev/null || true
git_nohooks -C "$WT" config --worktree core.hooksPath '' 2>/dev/null || true

# Scaffold report files so agents always have a target
cat > "$WT/FOREMAN_REPORT.md" <<EOF
# FOREMAN_REPORT

- run_id: $RUN_ID
- role: $ROLE
- slug: ${SLUG:-}
- branch: $BRANCH
- worktree: $WT
- base_sha: $BASE_SHA
- status: in_progress

## Summary
(agent: replace)

## Findings
(agent: replace)

## Evidence
(agent: paths, commands, quotes)

## Open questions
(agent: or none)
EOF

cat > "$WT/FOREMAN_REPORT.json" <<EOF
{
  "schema": "foreman.worktree-report.v1",
  "run_id": "$RUN_ID",
  "role": "$ROLE",
  "slug": "${SLUG:-}",
  "branch": "$BRANCH",
  "worktree": "$WT",
  "base_sha": "$BASE_SHA",
  "status": "in_progress",
  "summary": "",
  "findings": [],
  "evidence": [],
  "open_questions": []
}
EOF

META_ID="${ROLE}${SLUG:+-$SLUG}"
META_FILE="$RD/worktrees/${META_ID}.json"
if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg id "$META_ID" \
    --arg role "$ROLE" \
    --arg slug "${SLUG:-}" \
    --arg wt "$WT" \
    --arg branch "$BRANCH" \
    --arg base "$BASE_SHA" \
    --arg root "$ROOT" \
    '{id:$id, role:$role, slug:$slug, worktree:$wt, branch:$branch, base_sha:$base, repo_root:$root, status:"ready"}' \
    > "$META_FILE"
else
  python3 - "$META_FILE" "$META_ID" "$ROLE" "${SLUG:-}" "$WT" "$BRANCH" "$BASE_SHA" "$ROOT" <<'PY'
import json, sys
path, mid, role, slug, wt, branch, base, root = sys.argv[1:]
json.dump({"id":mid,"role":role,"slug":slug,"worktree":wt,"branch":branch,"base_sha":base,"repo_root":root,"status":"ready"}, open(path,"w"), indent=2)
open(path,"a").write("\n")
PY
fi

if command -v jq >/dev/null 2>&1; then
  if [[ -f "$IDX" ]]; then
    jq --slurpfile n "$META_FILE" '. + $n' "$IDX" > "$IDX.tmp.$$" && mv "$IDX.tmp.$$" "$IDX"
  else
    jq -n --slurpfile n "$META_FILE" '$n' > "$IDX.tmp.$$" && mv "$IDX.tmp.$$" "$IDX"
  fi
else
  python3 - "$IDX" "$META_FILE" <<'PY'
import json, sys, os
idx, meta = sys.argv[1], sys.argv[2]
item = json.load(open(meta))
data = json.load(open(idx)) if os.path.isfile(idx) else []
data.append(item)
tmp = f"{idx}.tmp.{os.getpid()}"
json.dump(data, open(tmp, "w"), indent=2)
with open(tmp, "a") as f:
    f.write("\n")
os.replace(tmp, idx)
PY
fi

idx_release_lock
trap - EXIT

log "worktree ready: $WT"
log "branch: $BRANCH"
log "report: $WT/FOREMAN_REPORT.md"
echo "$WT"
