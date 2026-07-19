#!/usr/bin/env bash
# Create an isolated git worktree for a parallel Foreman agent role.
# Usage: wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]
# Roles: search | plan | audit | implement | advisor | misc
#
# CONTRACT (T5a, v0.2.5 vendor config isolation plumbing): gains no new args.
#   Every worktree unconditionally provisions three EMPTY per-lane vendor
#   config dirs, `<WT>/.harness/vendor-home/{grok,codex,claude}/`, and prints
#   their paths (log lines, stderr) alongside the existing worktree/branch/
#   report lines -- regardless of which vendor (if any) the lane actually
#   runs, since provisioning is unconditional and cheap. This is what
#   lane-run.sh's LANE_CONFIG_DIR default resolves to (see its own header
#   CONTRACT note) when LANE_VENDOR is set and no explicit LANE_CONFIG_DIR
#   override is given. The dirs stay empty here -- seeding/exercising real
#   vendor config content is T5b (deferred; destructive, real-CLI-only).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"

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

if [[ -e "$WT" ]]; then
  die "$EXIT_CONFIG" "worktree path already exists: $WT"
fi

# git worktree add prints progress to stdout — keep it off the path echo
wt_with_lock "$ROOT" \
  git -c core.hooksPath= -C "$ROOT" worktree add "$WT" -b "$BRANCH" "$BASE_SHA" >/dev/null

git_nohooks -C "$ROOT" config extensions.worktreeConfig true 2>/dev/null || true
git_nohooks -C "$WT" config --worktree core.hooksPath '' 2>/dev/null || true

# T5a: per-lane vendor config isolation -- unconditional, empty dirs (see
# header CONTRACT note above).
VENDOR_HOME="$WT/.harness/vendor-home"
mkdir -p "$VENDOR_HOME/grok" "$VENDOR_HOME/codex" "$VENDOR_HOME/claude"

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

# Append to index.
# v0.2.7.5 worktree-hardening T6 (soak-discovered fix): this read-modify-
# write of a SHARED file across concurrent wt-new.sh invocations for the
# SAME run_id was unsynchronized and used a fixed (not per-process-unique)
# ".tmp" name -- under a genuine concurrent-lane soak (this task's own T6
# proof) two lanes racing here reliably crashed one of them ("mv: cannot
# stat ... index.json.tmp: No such file or directory", the second process's
# mv finding the first process's mv had already renamed the shared tmp file
# out from under it) and, even absent a crash, could silently lose an
# entry (both processes reading the same stale index.json and each
# overwriting the other's write). Serialized under a bounded mkdir mutex
# (mkdir is atomic on Git Bash/MSYS -- no flock dependency, matching
# lib/eventlog.sh's own .seq.lock idiom) with a per-process-unique tmp
# filename (a belt-and-braces second fix -- the lock alone already
# prevents the interleaving, but a unique name means a process that timed
# out waiting for the lock, see below, still cannot collide with another).
IDX="$RD/worktrees/index.json"
IDX_LOCK="$RD/worktrees/.index.lock"
idx_lock_owned=0
idx_waited=0
while true; do
  if mkdir "$IDX_LOCK" 2>/dev/null; then
    idx_lock_owned=1
    break
  fi
  sleep 0.1
  idx_waited=$((idx_waited + 1))
  if (( idx_waited > 300 )); then   # ~30s bound -- never spin forever
    log "WARN: index.json lock contention exceeded 30s -- proceeding unsynchronized"
    break
  fi
done

# @description Release the index.json mkdir mutex, but ONLY if this process
#   is the one that actually acquired it (v0.2.7.5 worktree-hardening Rework
#   Round 1, Risk 2, Opus audit). The critical section below used to have no
#   `trap`, so a jq/python3 failure BETWEEN `mkdir "$IDX_LOCK"` and the
#   (former) unconditional `rmdir` at the end aborted this script under
#   `set -e` before that rmdir ever ran, leaking the lock -- the next
#   same-run lane would spin the full ~30s bound above and then proceed
#   unsynchronized, exactly the race T6 already fixed once. A trap firing
#   this function is the correct fix, not just moving the rmdir earlier: it
#   fires on ANY exit from this point forward, anticipated or not. Guarded
#   on idx_lock_owned (set ONLY on the mkdir-succeeded path above) so a
#   process that gave up after the 30s bound -- and therefore never
#   actually owns the lock -- can never release a lock some OTHER process
#   legitimately still holds.
idx_release_lock() {
  if [[ "$idx_lock_owned" == "1" ]]; then
    rmdir "$IDX_LOCK" 2>/dev/null || true
  fi
}
trap idx_release_lock EXIT

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
log "vendor-home (grok): $VENDOR_HOME/grok"
log "vendor-home (codex): $VENDOR_HOME/codex"
log "vendor-home (claude): $VENDOR_HOME/claude"
echo "$WT"
