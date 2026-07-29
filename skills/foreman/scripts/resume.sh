#!/usr/bin/env bash
# @description Restore a lane worktree to its last checkpoint after a crash or
#   stall. Lane-filtered checkpoint resolution from the event log (fallback to
#   the checkpoint ref); refuses to destroy uncommitted work unless --force
#   (with a pre-resume backup); overlay vs --exact restore; recovers the last
#   prompt payload so the architect can restart the round.
#
# Usage: resume.sh [--force] [--exact] RUN_ID LANE WORKTREE
#
# Restore semantics:
#   Default (overlay): `git checkout SHA -- .` restores every path that existed
#   in the checkpoint tree (overwriting files that differ) but does NOT delete
#   paths present in the worktree now that were absent from the checkpoint
#   (files created after the checkpoint survive untouched).
#   --exact: after the same overlay checkout, delete paths present in the
#   worktree but absent from the checkpoint tree, excluding .git/, .harness/,
#   and anything matching FOREMAN_REPORT* so transcripts and reports survive.
#   The comm-based extra-path scan assumes simple filenames without embedded
#   newlines; exotic filenames are out of scope for this dev harness.
#
# Exit-code nuance: upfront WORKTREE validation that the path is not a git
# worktree is a usage error (exit 2). Exit 1 is reserved for the case where SHA
# resolution falls through to ckpt_latest and that call itself reports rc=1
# (real not-a-worktree or for-each-ref failure) after the upfront worktree check
# already passed — not a contradiction.
#
# Exit codes:
#   0 success
#   2 usage error (bad args, bad charset, WORKTREE not a git worktree at upfront validation)
#   4 no checkpoint found for run/lane, OR checkpoint sha does not resolve to a valid commit object
#   5 dirty-worktree refusal (no --force given)
#   1 all other failures (backup-before-force failed, checkout failed, ckpt_latest reported a real non-worktree or for-each-ref failure during fallback resolution, --exact deletion failure, etc.)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/eventlog.sh
source "$SCRIPT_DIR/lib/eventlog.sh"
# shellcheck source=lib/checkpoint.sh
source "$SCRIPT_DIR/lib/checkpoint.sh"

# @description Print usage to stderr and exit 2.
# @exitcode 2 always
usage() {
  printf 'Usage: resume.sh [--force] [--exact] RUN_ID LANE WORKTREE\n' >&2
  exit 2
}

# @description Resolve the latest checkpoint SHA for a lane from the event log,
#   falling back to ckpt_latest on the worktree ref.
# @arg $1 run_id
# @arg $2 lane
# @arg $3 worktree
# @arg $4 events (newline-delimited JSON already read via el_read)
# @stdout the checkpoint commit sha
# @exitcode 0 on success; 1 if ckpt_latest reports a real git failure; 4 if no
#   usable checkpoint exists or the sha is not a commit object
resolve_checkpoint_sha() {
  local run_id="$1" lane="$2" worktree="$3" events="$4"
  local sha="" line

  # Lane-filtered last checkpoint/round_done; commit then payload.checkpoint.
  # Empty events: skip jq so set -e / pipefail never abort on a no-op pipe.
  if [[ -n "$events" ]]; then
    # shellcheck disable=SC2016
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line//$'\r'/}"
      if [[ -n "$line" && "$line" != "null" ]]; then
        sha="$line"
      fi
    done < <(printf '%s\n' "$events" | jq -r --arg lane "$lane" '
      select(.lane == $lane and (.type == "checkpoint" or .type == "round_done"))
      | (.commit // .payload.checkpoint // empty)
    ' 2>/dev/null || true)
    sha="${sha//$'\r'/}"
  fi

  if [[ -z "$sha" ]]; then
    # Capture ckpt_latest without letting set -e abort on rc=1.
    local ckpt_out=""
    if ckpt_out="$(ckpt_latest "$worktree" "$lane")"; then
      sha="${ckpt_out//$'\r'/}"
      sha="${sha//$'\n'/}"
    else
      printf 'not a git worktree\n' >&2
      return 1
    fi
  fi

  if [[ -z "$sha" ]]; then
    printf 'no checkpoint exists for run/lane\n' >&2
    return 4
  fi

  if ! git -C "$worktree" cat-file -e "${sha}^{commit}" 2>/dev/null; then
    printf 'checkpoint ref points at a missing object\n' >&2
    return 4
  fi

  printf '%s\n' "$sha"
  return 0
}

# @description Extract the last prompt payload for a lane as compact JSON.
# @arg $1 lane
# @arg $2 events (newline-delimited JSON)
# @stdout compact JSON object ({} when no prompt event exists)
recover_prompt_payload() {
  local lane="$1" events="$2"
  local payload="{}" line

  if [[ -n "$events" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line//$'\r'/}"
      if [[ -n "$line" && "$line" != "null" ]]; then
        payload="$line"
      fi
    done < <(printf '%s\n' "$events" | jq -c --arg lane "$lane" '
      select(.lane == $lane and .type == "prompt") | .payload
    ' 2>/dev/null || true)
    payload="${payload//$'\r'/}"
    if [[ -z "$payload" || "$payload" == "null" ]]; then
      payload="{}"
    fi
  fi

  printf '%s\n' "$payload"
}

# @description Delete worktree paths absent from the checkpoint tree (exact restore).
#   Excludes .git/, .harness/, and FOREMAN_REPORT*. Aborts on the first rm failure.
# @arg $1 worktree
# @arg $2 checkpoint sha
# @exitcode 0 on success; 1 on list/delete failure
exact_delete_extras() {
  local worktree="$1" sha="$2"
  local list_ckpt list_wt extras path base rc=0

  list_ckpt="$(mktemp)"
  list_wt="$(mktemp)"
  extras="$(mktemp)"

  if ! git -C "$worktree" ls-tree -r --name-only "$sha" | sort >"$list_ckpt"; then
    printf 'exact restore: failed to list checkpoint tree\n' >&2
    rm -f "$list_ckpt" "$list_wt" "$extras" 2>/dev/null || true
    return 1
  fi
  # No --exclude-standard: gitignored extras (build artifacts, .env, stray
  # dirs created after the checkpoint) must also be candidates for deletion
  # under --exact. The deletion loop below is what protects .git/, .harness/,
  # and FOREMAN_REPORT* -- "not tracked by git" must not be conflated with
  # "should survive --exact".
  if ! git -C "$worktree" ls-files --cached --others | sort >"$list_wt"; then
    printf 'exact restore: failed to list worktree files\n' >&2
    rm -f "$list_ckpt" "$list_wt" "$extras" 2>/dev/null || true
    return 1
  fi
  if ! comm -23 "$list_wt" "$list_ckpt" >"$extras"; then
    printf 'exact restore: comm failed\n' >&2
    rm -f "$list_ckpt" "$list_wt" "$extras" 2>/dev/null || true
    return 1
  fi

  # Assumes simple filenames without embedded newlines (dev harness scope).
  while IFS= read -r path || [[ -n "$path" ]]; do
    path="${path//$'\r'/}"
    [[ -z "$path" ]] && continue
    # Exclude .git/, .harness/, and FOREMAN_REPORT* (report/transcript preservation).
    if [[ "$path" == .git || "$path" == .git/* || "$path" == .harness || "$path" == .harness/* ]]; then
      continue
    fi
    base="${path##*/}"
    if [[ "$path" == FOREMAN_REPORT* || "$base" == FOREMAN_REPORT* ]]; then
      continue
    fi
    # Abort on first removal failure (simpler than collecting partial failures).
    if ! rm -rf "${worktree}/${path}"; then
      printf 'exact restore: failed to remove %s\n' "$path" >&2
      rc=1
      break
    fi
  done <"$extras"

  rm -f "$list_ckpt" "$list_wt" "$extras" 2>/dev/null || true
  return "$rc"
}

# @description CLI entry: parse flags, resolve checkpoint, guard dirty trees,
#   restore, optionally exact-delete, print PROMPT payload.
# @arg $@ [--force] [--exact] RUN_ID LANE WORKTREE
# @stdout human progress lines; final line is PROMPT: <json>
# @exitcode 0|1|2|4|5 per file header
main() {
  local force=0 exact=0
  local -a pos=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force) force=1; shift ;;
      --exact) exact=1; shift ;;
      -h|--help) usage ;;
      --)
        shift
        while [[ $# -gt 0 ]]; do pos+=("$1"); shift; done
        break
        ;;
      -*)
        printf 'error: unknown flag: %s\n' "$1" >&2
        usage
        ;;
      *)
        pos+=("$1")
        shift
        ;;
    esac
  done

  if [[ ${#pos[@]} -ne 3 ]]; then
    usage
  fi

  local run_id="${pos[0]}" lane="${pos[1]}" worktree="${pos[2]}"

  if [[ ! "$run_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf 'error: invalid RUN_ID charset: %s\n' "$run_id" >&2
    usage
  fi
  if [[ ! "$lane" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf 'error: invalid LANE charset: %s\n' "$lane" >&2
    usage
  fi
  # Upfront worktree check is a usage error (exit 2), distinct from ckpt_latest
  # fallback rc=1 after this check already passed (see header).
  if [[ "$(git -C "$worktree" rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ]]; then
    printf 'error: WORKTREE is not a git worktree: %s\n' "$worktree" >&2
    exit 2
  fi

  # Tolerate el_read rc=2 (torn/malformed tail): valid prefix is still printed.
  local events=""
  events="$(el_read "$run_id" 0 2>/dev/null)" || true

  local sha="" resolve_rc=0
  # Capture resolve status without set -e abort; propagate 1 or 4.
  if sha="$(resolve_checkpoint_sha "$run_id" "$lane" "$worktree" "$events")"; then
    resolve_rc=0
  else
    resolve_rc=$?
  fi
  sha="${sha//$'\r'/}"
  sha="${sha//$'\n'/}"
  if [[ "$resolve_rc" -ne 0 ]]; then
    exit "$resolve_rc"
  fi

  local dirty=""
  if ! dirty="$(git -C "$worktree" status --porcelain)"; then
    printf 'error: git status failed in %s\n' "$worktree" >&2
    exit 1
  fi

  if [[ -n "$dirty" && "$force" -eq 0 ]]; then
    printf '%s\n' "$dirty" >&2
    printf 'refusing to overwrite uncommitted work; re-run with --force\n' >&2
    exit 5
  fi

  if [[ -n "$dirty" && "$force" -eq 1 ]]; then
    local backup_sha=""
    if ! backup_sha="$(ckpt_snapshot "$worktree" "${lane}-pre-resume")"; then
      printf 'error: pre-resume backup snapshot failed; aborting restore\n' >&2
      exit 1
    fi
    backup_sha="${backup_sha//$'\r'/}"
    printf 'pre-resume backup: %s (refs/checkpoints/%s-pre-resume)\n' "$backup_sha" "$lane"
  fi

  # Overlay restore: checkout paths from checkpoint; do not delete extras.
  # 2>/dev/null: suppress core.autocrlf LF/CRLF advisories; still check status.
  if ! git -C "$worktree" checkout "$sha" -- . 2>/dev/null; then
    printf 'error: checkout of checkpoint %s failed\n' "$sha" >&2
    exit 1
  fi

  if [[ "$exact" -eq 1 ]]; then
    if ! exact_delete_extras "$worktree" "$sha"; then
      exit 1
    fi
  fi

  local prompt_payload
  prompt_payload="$(recover_prompt_payload "$lane" "$events")"
  prompt_payload="${prompt_payload//$'\r'/}"
  # Final stdout line: PROMPT recovery for the architect restart.
  printf 'PROMPT: %s\n' "$prompt_payload"
  exit 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
