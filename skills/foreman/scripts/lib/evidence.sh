#!/usr/bin/env bash
# lib/evidence.sh — deliverable-set content digest (evidence-contracts T1).
# shellcheck shell=bash
# Source after lib/common.sh (optional; this file is self-contained).
#
# OWNED BY: openspec/changes/evidence-contracts (sole implementation owner).
# CONSUMED BY: three-outcome-verdicts (tree_sha256 / canonical record),
#              vendor-adapter-contract (consumer only — does not redefine).
#
# ── Verified blind spots (bugeventlog.md, 2026-07-28 root-cause entry) ──
# (a) Without -uall / --untracked-files=all, `git status --porcelain`
#     collapses an untracked directory to a single `?? dir/` line, so files
#     2..N written inside it produce a byte-identical path-level digest. That
#     is how a lane that wrote four package files was reported EMPTY-BURST
#     FAILED (bugeventlog.md, 2026-07-28 ROOT CAUSE of the write-evidence
#     false negative).
# (b) With or without -uall, a path-level porcelain digest is blind to content
#     changes within a path whose status string does not change (rewritten
#     untracked file; second edit of an already-modified tracked file). A
#     path-level digest is therefore only a corroborating signal — never the
#     verdict. The content digest over the declared deliverable set is.
#
# Observational (D7): this library computes and records; it does not gate
# until the release has ten clean dogfood rounds with no false positive.
# Safe to re-run: never mutates the tree it measures.
#
# Implementation note: bash command substitution strips NUL bytes, so every
# -z porcelain stream is written to a temp file and parsed from there — never
# captured into a shell variable.

# Sixty-four zero hex digits — hash field for directories and absent paths.
readonly EVIDENCE_ZERO_HASH="0000000000000000000000000000000000000000000000000000000000000000"

# Exact status enumeration required by the package. Tests assert each flag:
#   -uall / --untracked-files=all  — untracked-directory collapse
#   -z                             — porcelain v1 shell-quotes awkward paths
#   --no-renames                   — rename → absent record + present record
# shellcheck disable=SC2034  # exported for tests / callers that re-invoke
readonly -a EVIDENCE_STATUS_ARGV=(status --porcelain=v1 -z -uall --no-renames)

# Last computation outcome (OK | INCONCLUSIVE | UNCOMPUTABLE).
EVIDENCE_STATUS="${EVIDENCE_STATUS:-}"
EVIDENCE_REASON="${EVIDENCE_REASON:-}"
EVIDENCE_DIGEST="${EVIDENCE_DIGEST:-}"
EVIDENCE_RECORDS="${EVIDENCE_RECORDS:-}"

# @description Reset evidence outcome globals before a computation.
evidence_reset() {
  EVIDENCE_STATUS=""
  EVIDENCE_REASON=""
  EVIDENCE_DIGEST=""
  EVIDENCE_RECORDS=""
}

# @description True if ROOT is a git work tree (rev-parse succeeds).
# @arg $1 root directory path
# @exitcode 0 if git work tree, 1 otherwise
# Shared git -c flags for read-only evidence probes. safe.directory=* lets the
# orchestrator measure a worktree owned by another uid (lane worker) without
# writing to that user's global gitconfig. hooksPath= disables repo hooks.
_evidence_git() {
  git -c safe.directory=* -c core.hooksPath= -c core.quotePath=false "$@"
}

evidence_is_git_worktree() {
  local root="$1" top root_abs top_abs
  [[ -n "$root" && -d "$root" ]] || return 1
  # Require ROOT itself to be a work-tree root, not merely a path inside one.
  # `rev-parse --is-inside-work-tree` is true for any subdirectory of a repo,
  # which would wrongly accept a non-git "work root" nested under another
  # checkout (the known trap when fixture dirs live inside the foreman tree).
  top="$(_evidence_git -C "$root" rev-parse --show-toplevel 2>/dev/null)" || return 1
  root_abs="$(cd "$root" && pwd -P)" || return 1
  top_abs="$(cd "$top" && pwd -P)" || return 1
  [[ "$root_abs" == "$top_abs" ]]
}

# @description Run the required status enumeration into OUT_FILE.
# Never mutates the tree. Does not capture into a shell variable (NUL-safe).
# @arg $1 root git work tree
# @arg $2 output file path
# @exitcode git's exit code
evidence_git_status_to() {
  local root="$1" out="$2"
  # Exactly these flags — do not add/remove without updating tests + header.
  _evidence_git -C "$root" \
    status --porcelain=v1 -z -uall --no-renames >"$out"
}

# @description SHA-256 of a byte string on stdin (hex only, no filename).
# @stdin bytes to hash
# @stdout 64-char lowercase hex digest
evidence_sha256_stdin() {
  sha256sum | cut -d' ' -f1
}

# @description SHA-256 of file bytes (hex only).
# @arg $1 absolute path
# @stdout 64-char lowercase hex digest
# @exitcode non-zero if unreadable
evidence_sha256_file() {
  local path="$1"
  # Fail closed: unreadable path is UNCOMPUTABLE, not absent (see call site).
  sha256sum -- "$path" 2>/dev/null | cut -d' ' -f1
}

# @description Write one canonical per-path record for REL under ROOT to OUT.
# Format: path\0state\0mode\0hash\n  (path is REL as given, not absolute).
# States: f / git file mode / SHA-256 of bytes
#         l / 120000 / SHA-256 of link target string (not referent)
#         d / 040000 / 64 zeros
#         - / 000000 / 64 zeros  (path does not exist)
# Written to a file (not stdout-capture) so embedded NULs survive bash.
# @arg $1 root directory
# @arg $2 relative path (as stored in the record)
# @arg $3 output file (created/overwritten)
# @exitcode 0 on success; 2 if path exists but is uncomputable
evidence_canonical_record_to() {
  local root="$1" rel="$2" out="$3"
  local abs state mode hash target

  # Normalize: strip leading ./ only; keep the declared relative form.
  rel="${rel#./}"
  abs="$root/$rel"

  if [[ -L "$abs" ]]; then
    # Symlink: hash the target string, not the referent.
    if ! target="$(readlink -- "$abs" 2>/dev/null)"; then
      # Exists as a link but target unreadable → UNCOMPUTABLE, not absent.
      # Encoding as absent would make a permissions failure indistinguishable
      # from a deletion (evidence-contracts T1.2d / design §canonical record).
      return 2
    fi
    state="l"
    mode="120000"
    hash="$(printf '%s' "$target" | evidence_sha256_stdin)"
  elif [[ -d "$abs" ]]; then
    state="d"
    mode="040000"
    hash="$EVIDENCE_ZERO_HASH"
  elif [[ -f "$abs" ]]; then
    # Regular file. Mode is git-style 100644 / 100755.
    if [[ -x "$abs" ]]; then
      mode="100755"
    else
      mode="100644"
    fi
    # A path that exists but whose bytes cannot be read is UNCOMPUTABLE, not
    # absent. Encoding it as absent makes a permissions failure
    # indistinguishable from a deletion. Comment required at this call site
    # (BRIEF T1 / tasks 2d).
    if ! hash="$(evidence_sha256_file "$abs")" || [[ -z "$hash" || ${#hash} -ne 64 ]]; then
      return 2
    fi
    state="f"
  elif [[ ! -e "$abs" && ! -L "$abs" ]]; then
    # Absent is a recorded value — never a missing record.
    state="-"
    mode="000000"
    hash="$EVIDENCE_ZERO_HASH"
  else
    # Exists as an exotic type we cannot encode → UNCOMPUTABLE.
    return 2
  fi

  # path\0state\0mode\0hash\n — write to file so NULs are preserved.
  printf '%s\0%s\0%s\0%s\n' "$rel" "$state" "$mode" "$hash" >"$out"
}

# @description Parse a porcelain=v1 -z file into relative paths (one per line).
# With --no-renames, rename pairs never appear; each entry is "XY path\0".
# @arg $1 path to raw -z porcelain file
# @stdout one relative path per line (unsorted, may contain duplicates)
evidence_parse_status_paths_file() {
  local file="$1"
  local entry path
  # Read NUL-terminated records directly from the file (NUL-safe).
  while IFS= read -r -d '' entry || [[ -n "${entry:-}" ]]; do
    [[ -z "${entry:-}" ]] && continue
    # Records are "XY path" (2-char status, space, path).
    if [[ ${#entry} -lt 4 ]]; then
      continue
    fi
    path="${entry:3}"
    [[ -z "$path" ]] && continue
    path="${path%/}"
    printf '%s\n' "$path"
  done <"$file"
}

# @description Collect the sorted unique path set for a digest computation.
# Work root: declared deliverables ∪ status-enumeration paths.
# Artifact root: declared deliverables only (no status enumeration).
# @arg $1 root
# @arg $2 kind  "work" | "artifact"
# @arg $3 output file for sorted paths
# @arg $@ relative deliverable paths
# @exitcode 0 on success; 1 if status enumeration fails (work kind)
evidence_collect_paths_to() {
  local root="$1" kind="$2" out="$3"
  shift 3
  local -a declared=("$@")
  local tmp status_file
  tmp="$(mktemp)"
  status_file="$(mktemp)"

  local p
  for p in "${declared[@]}"; do
    p="${p#./}"
    [[ -n "$p" ]] && printf '%s\n' "$p" >>"$tmp"
  done

  if [[ "$kind" == "work" ]]; then
    # Status enumeration only on work roots (must be a git work tree; caller
    # checks). Artifact roots are content-records-only by design.
    if ! evidence_git_status_to "$root" "$status_file"; then
      rm -f "$tmp" "$status_file"
      return 1
    fi
    if [[ -s "$status_file" ]]; then
      evidence_parse_status_paths_file "$status_file" >>"$tmp"
    fi
  fi

  # Bytewise-ascending unique paths (LC_ALL=C for pure byte order).
  if [[ -s "$tmp" ]]; then
    LC_ALL=C sort -u "$tmp" >"$out"
  else
    : >"$out"
  fi
  rm -f "$tmp" "$status_file"
  return 0
}

# @description Compute the deliverable-set content digest for one evidence root.
#
# kind=work     — root MUST be a git work tree; digest covers declared
#                 deliverables plus every path status reports changed.
# kind=artifact — root need NOT be a git work tree; digest covers exactly the
#                 declared deliverables (no status enumeration). A non-git
#                 artifact root is NOT a computation failure.
#
# Never mutates the tree. Never interprets a computation failure as "no change".
#
# On success:
#   EVIDENCE_STATUS=OK  EVIDENCE_DIGEST=<hex>  EVIDENCE_RECORDS=<canonical blob>
#   prints digest to stdout; exit 0
# On failure:
#   EVIDENCE_STATUS=INCONCLUSIVE|UNCOMPUTABLE  EVIDENCE_REASON=<specific>
#   exit 1
#
# @arg $1 root directory
# @arg $2 kind  "work" | "artifact"
# @arg $@ relative deliverable paths
evidence_content_digest() {
  local root="$1" kind="$2"
  shift 2
  local -a declared=("$@")

  evidence_reset

  if [[ -z "$root" || ! -d "$root" ]]; then
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="root-missing:${root:-<empty>}"
    return 1
  fi

  if [[ "$kind" != "work" && "$kind" != "artifact" ]]; then
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="bad-kind:${kind}"
    return 1
  fi

  # Git-work-tree requirement applies to the work root ONLY.
  if [[ "$kind" == "work" ]]; then
    if ! evidence_is_git_worktree "$root"; then
      EVIDENCE_STATUS="INCONCLUSIVE"
      EVIDENCE_REASON="non-git-work-root:${root}"
      return 1
    fi
  fi
  # Artifact root that is not a git work tree is computable by content
  # records over the declared deliverables — NOT a computation failure.
  # (The old code path that rejected any non-git root is the known-bad input.)

  local paths_file records_file one_rec path
  paths_file="$(mktemp)"
  records_file="$(mktemp)"
  one_rec="$(mktemp)"

  if ! evidence_collect_paths_to "$root" "$kind" "$paths_file" "${declared[@]}"; then
    rm -f "$paths_file" "$records_file" "$one_rec"
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="status-enumeration-failed:${root}"
    return 1
  fi

  : >"$records_file"
  local failed_path=""
  while IFS= read -r path || [[ -n "${path:-}" ]]; do
    [[ -z "${path:-}" ]] && continue
    # Write record to a temp file first (NULs must not pass through $(...)).
    if ! evidence_canonical_record_to "$root" "$path" "$one_rec"; then
      # Unreadable / uncomputable path: fail closed with a distinct reason.
      # Never emit an absent-state record for it. Break first so we do not
      # rm the file still open on stdin (shellcheck SC2094).
      failed_path="$path"
      break
    fi
    cat "$one_rec" >>"$records_file"
  done <"$paths_file"

  if [[ -n "$failed_path" ]]; then
    rm -f "$paths_file" "$records_file" "$one_rec"
    EVIDENCE_STATUS="UNCOMPUTABLE"
    EVIDENCE_REASON="unreadable-path:${failed_path}"
    return 1
  fi

  # Digest = SHA-256 of the sorted concatenation (paths already sorted).
  if ! EVIDENCE_DIGEST="$(evidence_sha256_file "$records_file")" \
    || [[ -z "$EVIDENCE_DIGEST" || ${#EVIDENCE_DIGEST} -ne 64 ]]; then
    rm -f "$paths_file" "$records_file" "$one_rec"
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="digest-command-failed:${root}"
    return 1
  fi

  # Optional side copy of the raw records blob (contains NULs).
  if [[ -n "${EVIDENCE_RECORDS_FILE:-}" ]]; then
    cp -f "$records_file" "$EVIDENCE_RECORDS_FILE"
  fi
  EVIDENCE_STATUS="OK"
  EVIDENCE_REASON=""
  printf '%s\n' "$EVIDENCE_DIGEST"
  rm -f "$paths_file" "$records_file" "$one_rec"
  return 0
}

# @description Path-level porcelain digest (corroborating signal only, never
# the verdict). Always uses the same status argv as the content digest
# (-uall required). Blind spots documented in the file header.
# @arg $1 root git work tree
# @stdout 64-char hex digest of raw porcelain -z output
# @exitcode 0 on success; 1 on failure (sets INCONCLUSIVE)
evidence_path_level_digest() {
  local root="$1"
  local status_file
  evidence_reset

  if ! evidence_is_git_worktree "$root"; then
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="non-git-work-root:${root}"
    return 1
  fi

  status_file="$(mktemp)"
  if ! evidence_git_status_to "$root" "$status_file"; then
    rm -f "$status_file"
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="status-enumeration-failed:${root}"
    return 1
  fi

  EVIDENCE_DIGEST="$(evidence_sha256_file "$status_file")"
  rm -f "$status_file"
  EVIDENCE_STATUS="OK"
  printf '%s\n' "$EVIDENCE_DIGEST"
  return 0
}

# @description Old (known-bad) path-level digest without -uall — for controls
# that must FAIL against the untracked-directory collapse. Not for production
# verdicts.
# @arg $1 root git work tree
# @stdout 64-char hex
evidence_legacy_porcelain_digest() {
  local root="$1"
  _evidence_git -C "$root" status --porcelain 2>/dev/null \
    | evidence_sha256_stdin
}

# @description Write the canonical records blob (sorted) to OUT_FILE.
# Same path collection as evidence_content_digest.
# @arg $1 root
# @arg $2 kind
# @arg $3 out_file
# @arg $@ deliverables
# @exitcode 0/1; sets EVIDENCE_STATUS / EVIDENCE_REASON on failure
evidence_records_to() {
  local root="$1" kind="$2" out="$3"
  shift 3
  local -a declared=("$@")
  local paths_file one_rec path

  evidence_reset

  if [[ -z "$root" || ! -d "$root" ]]; then
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="root-missing:${root:-<empty>}"
    return 1
  fi
  if [[ "$kind" != "work" && "$kind" != "artifact" ]]; then
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="bad-kind:${kind}"
    return 1
  fi
  if [[ "$kind" == "work" ]] && ! evidence_is_git_worktree "$root"; then
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="non-git-work-root:${root}"
    return 1
  fi

  paths_file="$(mktemp)"
  one_rec="$(mktemp)"
  if ! evidence_collect_paths_to "$root" "$kind" "$paths_file" "${declared[@]}"; then
    rm -f "$paths_file" "$one_rec"
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="status-enumeration-failed:${root}"
    return 1
  fi

  : >"$out"
  local failed_path=""
  while IFS= read -r path || [[ -n "${path:-}" ]]; do
    [[ -z "${path:-}" ]] && continue
    if ! evidence_canonical_record_to "$root" "$path" "$one_rec"; then
      failed_path="$path"
      break
    fi
    cat "$one_rec" >>"$out"
  done <"$paths_file"
  if [[ -n "$failed_path" ]]; then
    rm -f "$paths_file" "$one_rec"
    EVIDENCE_STATUS="UNCOMPUTABLE"
    EVIDENCE_REASON="unreadable-path:${failed_path}"
    return 1
  fi
  rm -f "$paths_file" "$one_rec"
  EVIDENCE_STATUS="OK"
  return 0
}
