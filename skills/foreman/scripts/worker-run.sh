#!/usr/bin/env bash
# @description WORKER stage (hard mode) — supervises an untrusted worker
#   under foreman-launch, mirrors its heartbeats into the event log, extracts
#   evidence, and host-side commits the diff. The worker NEVER commits and
#   NEVER holds host secrets: the host stages+commits its edits afterward via
#   git_nohooks, and the worker's env is rebuilt from scratch off a small
#   allowlist — never the ambient environment, never FOREMAN_GH_PAT.
#
#   Two profiles, selected by `--profile`/`hard_mode.profile` (default
#   launcher-only):
#     - launcher-only: runs the worker directly in the run's worktree ($WT),
#       no Docker.
#     - container (Task 4): runs the worker in a hardened devcontainer
#       (sandbox/) on an egress-firewalled bridge, working on a clean file
#       COPY of the worktree ($RD/sandbox-work, no .git — the linked
#       worktree's .git is a FILE pointing at the host repo and must never be
#       bind-mounted in) synced back afterward with `rsync -a --delete
#       --exclude='.git'` (delete-aware, so the worker's own file deletions/
#       renames propagate — a plain `tar -x` sync-back would be additive
#       only and silently leave deleted files behind).
#
#   Both profiles funnel into the SAME host-side finalize step
#   (_finalize_and_commit): batch heartbeat mirror, stage+evidence, host-side
#   commit, outcome mapping (124/125/else) — never inside the sandbox.
#
#   Test-only seam: FOREMAN_WORKER_CMD_SHIM. wc_build_argv (lib/worker-cmd.sh)
#   always builds a real vendor invocation (argv[0] literally "grok" or
#   "codex"); when FOREMAN_WORKER_CMD_SHIM is set (non-empty), argv[0] is
#   replaced with it before spawning, so tests can substitute a fake worker
#   executable without a real vendor CLI installed — the same pattern
#   FOREMAN_LAUNCH already uses for the launcher binary itself
#   (fl_resolve_launcher, lib/launch.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/launch.sh
source "$SCRIPT_DIR/lib/launch.sh"
# shellcheck source=lib/worker-cmd.sh
source "$SCRIPT_DIR/lib/worker-cmd.sh"
# shellcheck source=lib/eventlog.sh
source "$SCRIPT_DIR/lib/eventlog.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"

TASK_ID="${1:?usage: worker-run.sh TASK_ID [--profile launcher-only|container] [--vendor V]}"
shift

PROFILE_ARG="" VENDOR_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_ARG="${2:?--profile requires a value}"; shift 2 ;;
    --vendor)  VENDOR_ARG="${2:?--vendor requires a value}"; shift 2 ;;
    *) die "$EXIT_CONFIG" "unknown argument: $1" ;;
  esac
done

require_cmd jq
require_cmd git

RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/meta.json" ]] || die "$EXIT_CONFIG" "no such task: $TASK_ID (run task-new.sh first)"

WT="$(jq -r .worktree "$RD/meta.json")"
BASE_SHA="$(jq -r .base_sha "$RD/meta.json")"
ROOT="$(jq -r .repo_root "$RD/meta.json")"
CONFIG="$ROOT/.foreman/config.toml"

el_init "$TASK_ID"

# N1: toml_get (common.sh:50), NEVER config_get (nonexistent) / cfg_get
# (closed allowlist, no hard_mode.*).
PROFILE="${PROFILE_ARG:-$(toml_get "$CONFIG" hard_mode.profile launcher-only)}"
VENDOR="${VENDOR_ARG:-$(toml_get "$CONFIG" hard_mode.vendor codex)}"
TO="$(toml_get "$CONFIG" hard_mode.timeout 600)"
# N13: lane label must match ^[A-Za-z0-9._-]+$ — hyphen, no colon.
LANE="worker-$VENDOR"

wt_sweep_stale_locks "$WT"

case "$PROFILE" in
  launcher-only|container) : ;;
  *) die "$EXIT_CONFIG" "unknown hard_mode.profile: $PROFILE (expected launcher-only|container)" ;;
esac

LAUNCHER="$(fl_resolve_launcher)" || die "$EXIT_MISSING_CLI" "hard mode requires foreman-launch"

# Prompt: hard-mode preamble (the worker never commits) + the task goal.
# Shared by both profiles — a real file on the HOST either way; the
# container profile additionally bind-mounts this exact path read-only into
# the container (see the container branch below) so a vendor CLI that opens
# its prompt file itself (grok) can still find it there.
PROMPT_FILE="$RD/worker-prompt.txt"
{
  printf 'Edit files in the worktree only. Do NOT run git or commit — the host commits your changes.\n\n'
  [[ -f "$RD/task.md" ]] && cat "$RD/task.md"
} > "$PROMPT_FILE"

# --- Build worker argv (profile-aware prompt/workdir plumbing) ---------
# wc_build_argv's two vendor branches use its PROMPT_FILE argument two
# different ways: grok embeds the path LITERALLY into argv (`--prompt-file
# PATH`) and opens it itself wherever it actually runs; codex instead `cat`s
# it right here, inside wc_build_argv, on the HOST process calling it
# (worker-run.sh itself, regardless of profile) — the resulting argv carries
# the literal prompt TEXT, never a path. For launcher-only the worker runs
# natively on the host, so one host path ($PROMPT_FILE) satisfies both
# cases. For the container profile the worker runs inside a different
# filesystem namespace: grok needs a path that resolves THERE
# (/foreman-prompt.txt, a dedicated read-only bind mount of $PROMPT_FILE —
# see the container branch below), while codex's `cat` still needs the real
# HOST path ($PROMPT_FILE) since wc_build_argv itself never runs inside the
# container. WORKDIR is "/work" (the sandbox-work bind mount's in-container
# path) for both vendors under container, matching where the copy actually
# lands.
if [[ "$PROFILE" == "container" ]]; then
  case "$VENDOR" in
    grok) _WC_PROMPT_ARG="/foreman-prompt.txt" ;;
    *)    _WC_PROMPT_ARG="$PROMPT_FILE" ;;
  esac
  wc_build_argv "$VENDOR" "$_WC_PROMPT_ARG" /work
else
  wc_build_argv "$VENDOR" "$PROMPT_FILE" "$WT"
fi
# Test seam (see header comment): swap in a fake worker executable. Gated on
# executability, mirroring the FOREMAN_LAUNCH override (launch.sh) — a set-but-
# non-executable value is ignored, so a stray env var cannot silently redirect
# the worker to a bogus path.
[[ -n "${FOREMAN_WORKER_CMD_SHIM:-}" && -x "${FOREMAN_WORKER_CMD_SHIM:-}" ]] \
  && WC_ARGV[0]="$FOREMAN_WORKER_CMD_SHIM"

# --- Clean-slate env allowlist base (N6) -------------------------------
# Built from scratch below (env -i for launcher-only; a real env-file for
# container); NEVER FOREMAN_GH_PAT or the ambient environment. Base
# allowlist + per-vendor home dir, plus the vendor API key ONLY under
# API-key auth (hard_mode.auth, default oauth — under OAuth/home-isolated
# auth no key is passed at all: a documented narrowing).
# shellcheck disable=SC2034  # read indirectly via ${!_v} in each profile's env-building loop below
FOREMAN_TASK_ID="$TASK_ID"
# shellcheck disable=SC2034  # read indirectly via ${!_v} in each profile's env-building loop below
LANE_VENDOR="$VENDOR"
WORKER_ENV_ALLOW=(PATH HOME USERPROFILE FOREMAN_TASK_ID LANE_VENDOR)
case "$VENDOR" in
  grok)  WORKER_ENV_ALLOW+=(GROK_HOME) ;;
  codex) WORKER_ENV_ALLOW+=(CODEX_HOME) ;;
esac

AUTH_MODE="$(toml_get "$CONFIG" hard_mode.auth oauth)"
if [[ "$AUTH_MODE" == "api-key" ]]; then
  case "$VENDOR" in
    grok)  WORKER_ENV_ALLOW+=(XAI_API_KEY) ;;
    codex) WORKER_ENV_ALLOW+=(OPENAI_API_KEY) ;;
  esac
fi

# @description Shared post-worker finalize step for BOTH profiles: batch-
#   mirrors the launcher's heartbeat file into the event log, stages +
#   extracts evidence from $WT (host-side git_nohooks add -A + diff --cached
#   --stat BASE_SHA, so untracked new files are captured), host-side commits
#   the staged diff (git_retry, only if rc==0 and something is staged), then
#   maps rc to the documented worker-run exit contract (124 =>
#   worker_timeout alert + exit 124; 125 => worker_launcher_error alert +
#   exit 125; else => exit rc as-is). Never runs inside the sandbox — by the
#   time this is called, both profiles have already landed their edits in
#   $WT (container via its rsync sync-back; launcher-only by having the
#   worker edit $WT directly), so from here on the two profiles are
#   indistinguishable. This is the exact Task-3 launcher-only body, lifted
#   into a function so the container branch can share it byte-for-byte
#   instead of duplicating it — the launcher-only tests depend on that
#   behavior staying identical.
# @arg $1 rc the worker's/supervised-command's own exit status
_finalize_and_commit() {
  local rc="$1"

  # --- Batch heartbeat mirror (N14) -------------------------------------
  # No background process, no tail/FIFO, no lock race: a single pass over
  # the heartbeat file after the worker has already exited. foreman-launch's
  # own --heartbeat-file is the live view; the event log is the durable
  # mirror.
  if [[ -f "$RD/worker-heartbeat.jsonl" ]]; then
    # `|| [[ -n "$line" ]]` so a final line with no trailing newline is not dropped.
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -n "$line" ]] && { el_emit "$TASK_ID" heartbeat "$LANE" "$line" >/dev/null 2>&1 || true; }
    done < "$RD/worker-heartbeat.jsonl"
  fi

  # --- Stage worker edits + extract evidence (host-side, N10) -----------
  # `add -A` FIRST so both evidence and the commit include NEW/untracked
  # files (a plain `diff BASE_SHA` compares base->working-tree and omits
  # untracked files — the common "worker created a file" case would look
  # empty). The staged index vs BASE_SHA is the worker's full change, new
  # files included.
  git_nohooks -C "$WT" add -A
  mkdir -p "$RD/evidence"
  git_nohooks -C "$WT" diff --cached --stat "$BASE_SHA" > "$RD/evidence/diff-stat.txt"
  [[ -f "$RD/worker-stdout.log" ]] && cp "$RD/worker-stdout.log" "$RD/evidence/transcript.log"

  # --- Host-side commit (N10) --------------------------------------------
  # No commit inside the sandbox — this stage runs on the host, over the
  # worker's staged edits, only once the worker itself has exited cleanly
  # and there is actually something staged.
  if [[ "$rc" -eq 0 ]] && ! git_nohooks -C "$WT" diff --cached --quiet; then
    if ! git_nohooks -C "$WT" config user.email >/dev/null 2>&1 \
       || ! git_nohooks -C "$WT" config user.name >/dev/null 2>&1; then
      die "$EXIT_CONFIG" "host git identity (user.name/user.email) is not configured for $WT — cannot host-side commit"
    fi
    git_retry git_nohooks -C "$WT" commit -m "foreman(worker): $TASK_ID"
  fi

  # --- Outcome -------------------------------------------------------------
  case "$rc" in
    124)
      el_emit "$TASK_ID" alert "$LANE" '{"kind":"worker_timeout"}' >/dev/null 2>&1 || true
      exit 124
      ;;
    125)
      el_emit "$TASK_ID" alert "$LANE" '{"kind":"worker_launcher_error"}' >/dev/null 2>&1 || true
      exit 125
      ;;
    *)
      exit "$rc"
      ;;
  esac
}

# @description Delete-aware sync-back from the container's file copy
#   ($RD/sandbox-work) into the real worktree ($WT) — never touching
#   $WT/.git (the linked worktree's own .git FILE, which has no counterpart
#   under sandbox-work: that directory was built from `git archive` and
#   never had a .git to begin with, so it simply never appears in either
#   manifest below).
#
#   Prefers `rsync -a --delete --exclude='.git'` when rsync is on PATH —
#   the audited, most-correct mechanism (preserves permissions/symlinks
#   faithfully, well-trodden semantics). Falls back to a portable manifest-
#   diff when it is not: this repo's own reference Git-Bash-on-Windows dev
#   environment does not ship rsync (verified; not present anywhere on
#   PATH, and unlike git/jq/tar it is not already a dependency of any other
#   script in this codebase), and the container profile's docker-SHIM tests
#   must pass regardless of what host tooling happens to be installed —
#   only the separately Docker-guarded LIVE test may skip. Either path
#   propagates the worker's own file DELETIONS and renames, not just
#   additions: a plain additive `tar -x` sync-back would silently leave
#   deleted files behind and produce a wrong commit diff.
#
#   The fallback: BEFORE_MANIFEST (passed in, captured right after the
#   git-archive extraction, before the container ever ran) vs. an
#   AFTER_MANIFEST taken here, both sorted relative-path listings of
#   $RD/sandbox-work. Anything in BEFORE but not AFTER was deleted by the
#   worker -> removed from $WT. Everything currently in AFTER is copied
#   into $WT (directories first, so file copies always have a parent).
# @arg $1 before_manifest path to the pre-run sorted relative-path listing
_sandbox_sync_back() {
  local before_manifest="$1"

  # FOREMAN_SYNC_NO_RSYNC forces the portable fallback even where rsync exists
  # — a test seam so the deletion-propagation test deterministically exercises
  # the custom (riskier) manifest-diff path regardless of whether the host has
  # rsync installed. Unset in production => rsync is preferred when present.
  if [[ -z "${FOREMAN_SYNC_NO_RSYNC:-}" ]] && command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude='.git' "$RD/sandbox-work/" "$WT/"
    return 0
  fi

  log "WARN: rsync not found on PATH — using the portable delete-aware sync-back (manifest diff) instead"
  local after_manifest="$RD/.sandbox-after-manifest.txt" rel
  ( cd "$RD/sandbox-work" && find . -mindepth 1 | sed 's#^\./##' | sort ) > "$after_manifest"

  # Deletions first, longest-path-first (comm requires sorted input; both
  # manifests already are) — `rm -rf --` is idempotent per-entry regardless
  # of ordering, so this is a robustness preference, not a correctness one.
  while IFS= read -r rel; do
    [[ -n "$rel" ]] && { rm -rf -- "${WT:?}/$rel" 2>/dev/null || true; }
  done < <(comm -23 "$before_manifest" "$after_manifest" | sort -r)

  # Directories, so every file copy below always has a parent to land in.
  while IFS= read -r rel; do
    [[ -n "$rel" && -d "$RD/sandbox-work/$rel" ]] && mkdir -p "$WT/$rel"
  done < "$after_manifest"
  # Files/symlinks: copy (overwrite) everything the copy currently has.
  while IFS= read -r rel; do
    if [[ -n "$rel" && ! -d "$RD/sandbox-work/$rel" ]]; then
      mkdir -p "$(dirname "$WT/$rel")"
      cp -af "$RD/sandbox-work/$rel" "$WT/$rel"
    fi
  done < "$after_manifest"
}

# --- Spawn under supervision, profile branch ---------------------------
rc=0
case "$PROFILE" in

  launcher-only)
    # Windows-essential vars (native launcher-only worker only — Node's TLS/
    # DNS/crypto + auth-file discovery need them); the container profile
    # (Linux) never adds these.
    case "$(uname -s)" in
      *NT*|MINGW*|MSYS*|CYGWIN*)
        WORKER_ENV_ALLOW+=(SYSTEMROOT WINDIR APPDATA LOCALAPPDATA TEMP TMP PATHEXT COMSPEC NUMBER_OF_PROCESSORS)
        ;;
    esac

    ENV_KV=()
    for _v in "${WORKER_ENV_ALLOW[@]}"; do
      [[ -n "${!_v:-}" ]] && ENV_KV+=("$_v=${!_v}")
    done

    # The `|| rc=$?` is load-bearing under `set -e`: a 124 timeout / 125
    # launcher-error is a non-zero exit, and a bare `rc=$?` would abort
    # before the finalize path below ever runs.
    ( cd "$WT" && env -i "${ENV_KV[@]}" "$LAUNCHER" --timeout "$TO" \
        --heartbeat-file "$RD/worker-heartbeat.jsonl" -- "${WC_ARGV[@]}" \
        >"$RD/worker-stdout.log" 2>"$RD/worker-stderr.log" ) || rc=$?
    ;;

  container)
    require_cmd docker "hard mode container profile requires Docker Desktop/WSL2"

    # 1. Clean file COPY of the worktree at HEAD (no .git) — resolves the
    #    linked-worktree mount problem: $WT/.git is a FILE pointing at the
    #    host repo's common gitdir, which must never be bind-mounted into an
    #    untrusted container.
    rm -rf "$RD/sandbox-work"
    mkdir -p "$RD/sandbox-work"
    git_nohooks -C "$WT" archive HEAD | tar -x -C "$RD/sandbox-work"

    # Pre-run manifest for _sandbox_sync_back's portable-fallback path (see
    # its own definition below) — captured now, right after extraction,
    # while sandbox-work is still exactly "what HEAD had, no worker edits".
    SANDBOX_BEFORE_MANIFEST="$RD/.sandbox-before-manifest.txt"
    ( cd "$RD/sandbox-work" && find . -mindepth 1 | sed 's#^\./##' | sort ) > "$SANDBOX_BEFORE_MANIFEST"

    # 2. Egress-capable user-defined bridge (NOT --internal, NOT --network
    #    none) — init-firewall.sh inside the container is what narrows
    #    egress, not the docker network topology itself.
    docker network inspect foreman-sandbox-net >/dev/null 2>&1 \
      || docker network create foreman-sandbox-net >/dev/null

    # 3. Container env file: a CONTAINER-SPECIFIC minimal allowlist. Crucially
    #    NOT the launcher-only WORKER_ENV_ALLOW — that carries host PATH / HOME /
    #    USERPROFILE / <vendor>_HOME, which are the *native host's* paths; piped
    #    into the Linux container via --env-file they override the image's own
    #    PATH (so `gosu`/`iptables`/the vendor CLI stop resolving and the
    #    container fails before the worker even starts) and point HOME at a
    #    nonexistent host path (defeating the writable --tmpfs /home/worker).
    #    The container needs only its task identity + (in api-key mode) the one
    #    vendor key; HOME/PATH come from the image, the two allowlist hosts are
    #    appended below. No FOREMAN_GH_PAT, no host env, no docker.sock.
    CONTAINER_ENV_ALLOW=(FOREMAN_TASK_ID LANE_VENDOR)
    if [[ "$AUTH_MODE" == "api-key" ]]; then
      case "$VENDOR" in
        grok)  CONTAINER_ENV_ALLOW+=(XAI_API_KEY) ;;
        codex) CONTAINER_ENV_ALLOW+=(OPENAI_API_KEY) ;;
      esac
    fi
    : > "$RD/sandbox.env"
    chmod 0600 "$RD/sandbox.env"
    for _v in "${CONTAINER_ENV_ALLOW[@]}"; do
      [[ -n "${!_v:-}" ]] && printf '%s=%s\n' "$_v" "${!_v}" >> "$RD/sandbox.env"
    done

    case "$VENDOR" in
      grok)  VENDOR_API_HOST="${FOREMAN_VENDOR_API_HOST:-api.x.ai}" ;;
      codex) VENDOR_API_HOST="${FOREMAN_VENDOR_API_HOST:-api.openai.com}" ;;
      *)     VENDOR_API_HOST="${FOREMAN_VENDOR_API_HOST:-}" ;;
    esac
    # Best-effort: a run whose worktree has no `origin` remote yet (or any
    # other lookup failure) just means init-firewall.sh allowlists nothing
    # for git — never a reason to abort the run over a firewall nicety. The
    # `if` form (not a bare assignment) is deliberate: under `set -e` a
    # failing command substitution used directly in an assignment would
    # abort the whole script, not just this best-effort lookup.
    GIT_HOST=""
    if _origin_url="$(git_nohooks -C "$WT" remote get-url origin 2>/dev/null)"; then
      case "$_origin_url" in
        git@*)   GIT_HOST="${_origin_url#git@}"; GIT_HOST="${GIT_HOST%%:*}" ;;
        *://*)   GIT_HOST="${_origin_url#*://}"; GIT_HOST="${GIT_HOST#*@}"; GIT_HOST="${GIT_HOST%%/*}"; GIT_HOST="${GIT_HOST%%:*}" ;;
      esac
    fi
    printf 'FOREMAN_VENDOR_API_HOST=%s\n' "$VENDOR_API_HOST" >> "$RD/sandbox.env"
    printf 'FOREMAN_GIT_HOST=%s\n' "$GIT_HOST" >> "$RD/sandbox.env"

    # 4. Named container so a timeout actually reaps it: killing the
    #    `docker run` CLI on a 124 kills only the host-side client, not the
    #    dockerd-owned container process — `docker rm -f` by name is what
    #    actually stops it. The trap covers ANY exit from here on (normal
    #    completion, `die`, or _finalize_and_commit's own `exit`), not just
    #    the immediate post-run cleanup below.
    CONTAINER_NAME="foreman-$TASK_ID"
    trap 'docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true' EXIT

    # Capability set beyond NET_ADMIN is load-bearing, not decorative: gosu's
    # setuid(2)/setgid(2) drop (entrypoint.sh) needs SETUID+SETGID in the
    # still-root caller's effective set or it fails outright; the chown that
    # makes the --tmpfs /home/worker mount writable by `worker` needs CHOWN
    # for the same reason (`--cap-drop ALL` strips it from root too). Verified
    # empirically against sandbox/ — see sandbox/entrypoint.sh's header.
    # None of the three reach the worker itself: setuid(2) to a non-root uid
    # clears the process's capability sets on the way down.
    # MSYS_NO_PATHCONV/ARG_CONV_EXCL: if worker-run.sh is invoked from Windows
    # Git-Bash, MSYS rewrites the container-side `/work`, `/foreman-prompt.txt`,
    # `/tmp` etc. args into Windows paths before they reach docker — corrupting
    # the mounts. No-ops on WSL/Linux (the container profile's intended home).
    ( export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
      "$LAUNCHER" --timeout "$TO" \
        --heartbeat-file "$RD/worker-heartbeat.jsonl" -- \
        docker run --rm --name "$CONTAINER_NAME" \
          --network foreman-sandbox-net \
          --cap-drop ALL --cap-add NET_ADMIN --cap-add SETUID --cap-add SETGID --cap-add CHOWN \
          --security-opt no-new-privileges \
          --read-only --tmpfs /tmp --tmpfs /run --tmpfs /home/worker \
          -v "$RD/sandbox-work":/work \
          -v "$PROMPT_FILE":/foreman-prompt.txt:ro \
          -w /work \
          --env-file "$RD/sandbox.env" \
          foreman-sandbox "${WC_ARGV[@]}" \
        >"$RD/worker-stdout.log" 2>"$RD/worker-stderr.log" ) || rc=$?

    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

    # 5. Sync back, delete-aware (see _sandbox_sync_back below): propagates
    #    the worker's file DELETIONS and renames — a plain `tar -x` is
    #    additive only and would leave deleted files behind, producing a
    #    wrong commit diff. $WT/.git is NEVER touched (it has no counterpart
    #    under $RD/sandbox-work, which was built from `git archive` and
    #    never had a .git to begin with).
    _sandbox_sync_back "$SANDBOX_BEFORE_MANIFEST"
    ;;

esac

_finalize_and_commit "$rc"
