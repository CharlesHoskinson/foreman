#!/usr/bin/env bash
# @description Shared foreman lock helper: the single path by which the durable
#   core acquires every lock. Callers use fm_lock_acquire / fm_lock_release /
#   fm_with_lock rather than inline mkdir spin-loops.
#
# FLAT LOCKING (hard rule): at most one foreman lock may be held by this
# process / call-chain at a time via this helper. A nested acquisition is
# refused at runtime with FM_LOCK_NESTED. This file deliberately does NOT
# state, imply, or document any lock ordering — a stated ordering is standing
# permission to nest, and a deliberately-nesting configuration deadlocks at
# five steps under the formal model backing the lock-primitive-hardening
# spec. Nesting is refused, never scheduled.
#
# Mechanism selection: flock when available and trusted for the lock path;
# mkdir fallback under the same trust rule and no weaker one; refuse rather
# than acquire when trust is absent. Trust evaluation is a seam
# (fm_lock__verdict_for) implemented by round L2: inventory + pin + local probe.
#
# .seq.lock and .attempt.lock remain SEPARATE paths — callers pass distinct
# lock paths; this helper never collapses them.
#
# Source this file; do not execute.
#
# FM_LOCK_UNAVAILABLE detail-string shape (stable for L2/L4):
#   "<operation> <target>: <message>"
# where:
#   operation — the failing primitive name, one of:
#     "mkdir -p", "touch", "open fd", "flock -n", "mkdir"
#   target    — the path (or parent path) the operation acted on
#   message   — the primitive's stderr text when available; otherwise a short
#               fallback such as "failed" or "exec redirect failed (rc=N)".
# Bash does not expose errno numerically; the message is the portable stand-in
# for "errno" in this shell helper.

# Process-local hold state. At most one held lock (flat rule).
# Idempotent across re-source in the SAME process (H5): a genuine outer hold
# must survive. Inherited values from a parent environment are foreign and
# must not count as a live hold (N3) — gate on a process-local PID sentinel.
if [[ "${_FM_LOCK_INIT_PID:-}" != "${BASHPID:-$$}" ]]; then
  _FM_LOCK_HELD_PATH=""
  _FM_LOCK_MECHANISM=""
  _FM_LOCK_FD=""
  FM_LOCK_MECHANISM=""
  _FM_LOCK_INIT_PID="${BASHPID:-$$}"
fi
: "${_FM_LOCK_HELD_PATH:=}"
: "${_FM_LOCK_MECHANISM:=}"
: "${_FM_LOCK_FD:=}"

# Selected mechanism of the currently held lock (empty when none held).
# Callers such as el_init read this to decide conditional stale-lock
# reclamation: flock releases on process death; a mkdir lock does not.
: "${FM_LOCK_MECHANISM:=}"

# Default bounded spin, matching historical eventlog spin (~1500 * 0.02s).
: "${FM_LOCK_TIMEOUT_SEC:=30}"

# ---------------------------------------------------------------------------
# Refusal vocabulary — exactly six codes, ordered chain, first match wins.
# ---------------------------------------------------------------------------
# 1. FM_LOCK_NESTED              — decided at request time (before arg checks)
# 2. FM_LOCK_FS_UNSUPPORTED      — no available mechanism covers the FS class
# 3. FM_LOCK_NO_ATOMIC_PRIMITIVE — every available mechanism trusted-negative
# 4. FM_LOCK_PROBE_UNTRUSTED     — no trusted verdict of either polarity
# 5. FM_LOCK_UNAVAILABLE         — residual; carries a detail string
# 6. FM_LOCK_TIMEOUT             — spin expired on already-selected+engaged mech
# ---------------------------------------------------------------------------

# @description Emit one refusal in the one-shape form and return non-zero.
#   Scoped to the refused acquisition: does not release or alter any outer
#   lock already held by this process; does not enter a critical section;
#   writes the code (and optional detail) to stderr; returns non-zero.
# @arg $1 code one of the six FM_LOCK_* refusal codes
# @arg $2 detail optional detail string (required in spirit for UNAVAILABLE)
# @stderr the refusal code, optionally followed by a detail string
# @exitcode 1 always
fm_lock__refuse() {
  local code="$1"
  local detail="${2:-}"
  if [[ -n "$detail" ]]; then
    printf '%s %s\n' "$code" "$detail" >&2
  else
    printf '%s\n' "$code" >&2
  fi
  return 1
}

# ---------------------------------------------------------------------------
# T14 — verdict trust plane (reads inventory; never writes it)
# Trust exactly two evidence classes: syscall | pinned-mechanism.
# Currency: all six conditions must hold for an inventory row.
# ---------------------------------------------------------------------------

# Process-local probe cache (never written to disk).
: "${_FM_LOCK_VINIT:=}"
: "${_FM_LOCK_VINIT_PID:=}"
# Cached rows: mech|path|version|sha256|verdict|evidence_class|fs_csv|timestamp
: "${_FM_LOCK_VROWS:=}"
: "${_FM_LOCK_LOCAL_PROBED:=}"
: "${_FM_LOCK_LOCAL_PROBED_MECHS:=}"

fm_lock__repo_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$here/../../../.." && pwd
}

fm_lock__inventory_path() {
  printf '%s\n' "${FOREMAN_TOOL_CHECK_JSON:-${HOME}/.foreman/last-tool-check.json}"
}

fm_lock__manifest_path() {
  local root
  root="$(fm_lock__repo_root 2>/dev/null || true)"
  if [[ -n "$root" && -f "$root/env/reference-manifest.toml" ]]; then
    printf '%s\n' "$root/env/reference-manifest.toml"
    return 0
  fi
  if [[ -n "${FOREMAN_REPO:-}" && -f "${FOREMAN_REPO}/env/reference-manifest.toml" ]]; then
    printf '%s\n' "${FOREMAN_REPO}/env/reference-manifest.toml"
    return 0
  fi
  printf '%s\n' ""
}

# @description Filesystem class for the directory that will contain LOCKPATH.
fm_lock__fs_class() {
  local lock_path="$1" probe="$1"
  if [[ ! -e "$probe" ]]; then
    probe="$(dirname -- "$probe")"
  fi
  if [[ ! -e "$probe" ]]; then
    local p="$probe"
    while [[ ! -e "$p" && "$p" != "/" && "$p" != "." ]]; do
      p="$(dirname -- "$p")"
    done
    probe="$p"
  fi
  if [[ "$probe" == //* || "$probe" == \\\\* ]]; then
    printf '%s\n' "network"
    return 0
  fi
  local fstype="" target=""
  if command -v findmnt >/dev/null 2>&1; then
    fstype="$(findmnt -n -o FSTYPE -T "$probe" 2>/dev/null || true)"
    target="$(findmnt -n -o TARGET -T "$probe" 2>/dev/null || true)"
  elif command -v df >/dev/null 2>&1; then
    local line
    line="$(df -T "$probe" 2>/dev/null | tail -n 1 || true)"
    fstype="$(awk '{print $2}' <<<"$line")"
    target="$(awk '{print $NF}' <<<"$line")"
  fi
  fstype="${fstype,,}"
  case "$fstype" in
    nfs|nfs4|cifs|smb|smb3|smbfs|afs|ncpfs)
      printf '%s\n' "network"
      return 0
      ;;
  esac
  if [[ "$probe" == /mnt/* || "$target" == /mnt || "$target" == /mnt/* ]]; then
    printf '%s\n' "mnt-drvfs"
    return 0
  fi
  case "$fstype" in
    fuse|fuse.*|fuseblk)
      printf '%s\n' "fuse"
      return 0
      ;;
  esac
  printf '%s\n' "local"
}

fm_lock__resolve_bin() {
  local mech="$1" bin=""
  case "$mech" in
    mkdir) bin="$(command -v mkdir 2>/dev/null || true)" ;;
    flock) bin="$(command -v flock 2>/dev/null || true)" ;;
    *) bin="" ;;
  esac
  if [[ -z "$bin" ]]; then
    printf ''
    return 0
  fi
  readlink -f -- "$bin" 2>/dev/null || printf '%s' "$bin"
}

fm_lock__sha256() {
  local p="$1" real
  [[ -z "$p" || ! -e "$p" ]] && { printf ''; return 0; }
  real="$(readlink -f -- "$p" 2>/dev/null || printf '%s' "$p")"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$real" 2>/dev/null | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$real" 2>/dev/null | awk '{print $1}'
  else
    printf ''
  fi
}

fm_lock__version_now() {
  local mech="$1" bin
  bin="$(fm_lock__resolve_bin "$mech")"
  [[ -z "$bin" ]] && { printf ''; return 0; }
  case "$mech" in
    mkdir)
      mkdir --version 2>/dev/null | head -n 1 | tr -d '\r' || true
      ;;
    flock)
      local v
      v="$(flock --version 2>/dev/null | head -n 1 | tr -d '\r' || true)"
      if [[ -n "$v" ]]; then
        printf 'flock %s\n' "$v"
      else
        printf 'flock:%s\n' "$(command -v flock)"
      fi
      ;;
  esac
}

fm_lock__bin_mtime() {
  local p="$1"
  [[ -z "$p" || ! -e "$p" ]] && { printf '0'; return 0; }
  stat -c '%Y' -- "$p" 2>/dev/null || stat -f '%m' -- "$p" 2>/dev/null || printf '0'
}

fm_lock__ts_epoch() {
  local ts="$1"
  ts="${ts%Z}"
  ts="${ts%%.*}"
  if date -u -d "$ts" +%s 2>/dev/null; then
    return 0
  fi
  if date -u -j -f '%Y-%m-%dT%H:%M:%S' "$ts" +%s 2>/dev/null; then
    return 0
  fi
  printf '0'
}

fm_lock__load_inventory_rows() {
  local inv
  inv="$(fm_lock__inventory_path)"
  _FM_LOCK_VROWS=""
  if [[ ! -r "$inv" ]]; then
    return 0
  fi
  local parsed
  parsed="$(python3 -c '
import json,sys
p=sys.argv[1]
try:
  d=json.load(open(p,encoding="utf-8"))
except Exception:
  raise SystemExit(0)
for r in (d.get("lock_atomicity") or []):
  mech=r.get("mechanism") or ""
  path=r.get("path") or ""
  version=(r.get("version") or "").replace("|"," ")
  sha=r.get("sha256") or ""
  verdict=r.get("verdict") or ""
  evidence=r.get("evidence_class") or ""
  fsc=r.get("filesystem_classes") or []
  fs_csv=fsc if isinstance(fsc,str) else ",".join(fsc)
  ts=r.get("timestamp") or ""
  print("|".join([mech,path,version,sha,verdict,evidence,fs_csv,ts]))
' "$inv" 2>/dev/null || true)"
  _FM_LOCK_VROWS="$parsed"
}

fm_lock__row_for() {
  local mech="$1" line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "${line%%|*}" == "$mech" ]]; then
      printf '%s\n' "$line"
      return 0
    fi
  done <<<"${_FM_LOCK_VROWS}"
  return 0
}

fm_lock__currency_ok() {
  local mech="$1" lock_path="$2" row="$3"
  local r_path r_ver r_sha r_verdict r_ev r_fs r_ts
  IFS='|' read -r _ r_path r_ver r_sha r_verdict r_ev r_fs r_ts <<<"$row"
  local now_path now_ver now_sha now_fs
  now_path="$(fm_lock__resolve_bin "$mech")"
  now_ver="$(fm_lock__version_now "$mech")"
  now_sha="$(fm_lock__sha256 "$now_path")"
  now_fs="$(fm_lock__fs_class "$lock_path")"
  if [[ -z "$r_path" || -z "$now_path" || "$r_path" != "$now_path" ]]; then
    printf 'path-mismatch'; return 1
  fi
  if [[ "$r_ver" != "$now_ver" ]]; then
    printf 'version-mismatch'; return 1
  fi
  if [[ -z "$r_sha" || -z "$now_sha" || "$r_sha" != "$now_sha" ]]; then
    printf 'digest-mismatch'; return 1
  fi
  local covered=0 c
  local IFS=','
  local -a _fsa
  read -ra _fsa <<<"$r_fs"
  for c in "${_fsa[@]}"; do
    [[ "$c" == "$now_fs" ]] && covered=1
  done
  if (( covered == 0 )); then
    printf 'fs-uncovered'; return 1
  fi
  local ts_e mt
  ts_e="$(fm_lock__ts_epoch "$r_ts")"
  mt="$(fm_lock__bin_mtime "$now_path")"
  if [[ "${ts_e:-0}" -lt "${mt:-0}" ]]; then
    printf 'ts-before-mtime'; return 1
  fi
  local now_e age
  now_e="$(date -u +%s)"
  age=$(( now_e - ts_e ))
  if (( age > 86400 || age < 0 )); then
    printf 'stale'; return 1
  fi
  printf 'ok'
  return 0
}

fm_lock__pinned_verdict() {
  local mech="$1" sha="$2" fs_class="$3"
  local manifest
  manifest="$(fm_lock__manifest_path)"
  if [[ -z "$manifest" || ! -r "$manifest" || -z "$sha" ]]; then
    printf ''; return 0
  fi
  python3 -c '
import sys
try:
  import tomllib
except ImportError:
  try:
    import tomli as tomllib
  except ImportError:
    raise SystemExit(0)
manifest,mech,sha,fs_class=sys.argv[1:5]
try:
  data=tomllib.load(open(manifest,"rb"))
except Exception:
  raise SystemExit(0)
la=data.get("lock_atomicity") or {}
pinned=la.get("pinned") or [] if isinstance(la,dict) else []
matched=None
for entry in pinned:
  if not isinstance(entry,dict):
    continue
  if (entry.get("mechanism") or "")!=mech: continue
  if (entry.get("sha256") or "").lower()!=sha.lower(): continue
  matched=entry; break
if matched is None: raise SystemExit(0)
trace=(matched.get("trace_artifact") or "").strip()
if not trace: raise SystemExit(0)
classes=matched.get("filesystem_classes") or []
verdict=(matched.get("verdict") or "atomic").strip()
if fs_class in classes:
  if verdict in ("atomic","non-atomic"): print(verdict)
  raise SystemExit(0)
print("fs-unsupported")
' "$manifest" "$mech" "$sha" "$fs_class" 2>/dev/null || true
}

# Mechanism-relative local probe (BRIEF section 0). Never writes inventory.
fm_lock__local_probe_mech() {
  local mech="$1"
  local bin path ver sha ts fs_class verdict="unknown" evidence="flavour"
  bin="$(command -v "$mech" 2>/dev/null || true)"
  if [[ -z "$bin" ]]; then return 0; fi
  path="$(readlink -f -- "$bin" 2>/dev/null || printf '%s' "$bin")"
  ver="$(fm_lock__version_now "$mech")"
  sha="$(fm_lock__sha256 "$path")"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local work_parent="${TMPDIR:-/tmp}"
  fs_class="$(fm_lock__fs_class "$work_parent")"
  case "$mech" in
    mkdir)
      if command -v strace >/dev/null 2>&1; then
        local work lock trace
        work="$(mktemp -d "${work_parent}/fm-lock-lp.XXXXXX")"
        lock="$work/x"
        mkdir -- "$lock" 2>/dev/null || true
        trace="$(strace -f -e trace=mkdir,mkdirat,statx "$bin" -- "$lock" 2>&1 || true)"
        rm -rf -- "$work"
        if printf '%s\n' "$trace" | grep -qE 'mkdir(at)?\([^)]*\)\s*=\s*-1\s+EEXIST'; then
          verdict="atomic"; evidence="syscall"
        elif printf '%s\n' "$trace" | grep -qE 'statx\(' && \
             ! printf '%s\n' "$trace" | grep -qE 'mkdir(at)?\([^)]*\)\s*=\s*-1\s+EEXIST'; then
          verdict="non-atomic"; evidence="syscall"
        else
          verdict="unknown"; evidence="syscall"
        fi
      else
        verdict="unknown"; evidence="flavour"
      fi
      ;;
    flock)
      if command -v strace >/dev/null 2>&1; then
        local work lockf trace hp
        work="$(mktemp -d "${work_parent}/fm-lock-lf.XXXXXX")"
        lockf="$work/lockfile"
        : >"$lockf"
        (
          exec 8>>"$lockf"
          flock -n 8 || exit 9
          sleep 2
        ) &
        hp=$!
        sleep 0.1
        trace="$(strace -e trace=flock flock -n 9 9>>"$lockf" 2>&1 || true)"
        wait "$hp" 2>/dev/null || true
        rm -rf -- "$work"
        if printf '%s\n' "$trace" | grep -qE 'flock\([^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)'; then
          verdict="atomic"; evidence="syscall"
        else
          verdict="unknown"; evidence="syscall"
        fi
      else
        verdict="unknown"; evidence="flavour"
      fi
      ;;
  esac
  if [[ "$verdict" != "atomic" && "$verdict" != "non-atomic" ]]; then
    local pin
    pin="$(fm_lock__pinned_verdict "$mech" "$sha" "$fs_class")"
    if [[ "$pin" == "atomic" || "$pin" == "non-atomic" ]]; then
      verdict="$pin"; evidence="pinned-mechanism"
    fi
  fi
  printf '%s|%s|%s|%s|%s|%s|%s|%s\n' \
    "$mech" "$path" "$ver" "$sha" "$verdict" "$evidence" "$fs_class" "$ts"
}

fm_lock__ensure_verdict_cache() {
  if [[ "${_FM_LOCK_VINIT_PID:-}" == "${BASHPID:-$$}" && "${_FM_LOCK_VINIT:-}" == "1" ]]; then
    return 0
  fi
  _FM_LOCK_VINIT_PID="${BASHPID:-$$}"
  _FM_LOCK_VINIT=1
  _FM_LOCK_LOCAL_PROBED=0
  _FM_LOCK_LOCAL_PROBED_MECHS=""
  fm_lock__load_inventory_rows
}

# @description Replace cache with local probes for the given mechanisms.
# @arg $@ mechanism names (default: flock mkdir)
fm_lock__replace_with_local_probe() {
  local mechs=("$@")
  if (( ${#mechs[@]} == 0 )); then
    mechs=(flock mkdir)
  fi
  local mech row line m
  local kept="" probed=""
  # Drop existing rows for mechanisms we are re-probing
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    m="${line%%|*}"
    local drop=0 req
    for req in "${mechs[@]}"; do
      [[ "$m" == "$req" ]] && drop=1
    done
    if (( drop == 0 )); then
      if [[ -n "$kept" ]]; then kept+=$'\n'; fi
      kept+="$line"
    fi
  done <<<"${_FM_LOCK_VROWS}"
  for mech in "${mechs[@]}"; do
    command -v "$mech" >/dev/null 2>&1 || continue
    row="$(fm_lock__local_probe_mech "$mech")"
    [[ -z "$row" ]] && continue
    if [[ -n "$probed" ]]; then probed+=$'\n'; fi
    probed+="$row"
  done
  if [[ -n "$kept" && -n "$probed" ]]; then
    _FM_LOCK_VROWS="$kept"$'\n'"$probed"
  elif [[ -n "$probed" ]]; then
    _FM_LOCK_VROWS="$probed"
  else
    _FM_LOCK_VROWS="$kept"
  fi
}

fm_lock__ensure_local_probe() {
  if [[ "${_FM_LOCK_LOCAL_PROBED:-}" == "1" ]]; then return 0; fi
  _FM_LOCK_LOCAL_PROBED=1
  # Full local probe of all available mechanisms (inventory was unusable).
  fm_lock__replace_with_local_probe flock mkdir
}

# @description Trust-evaluation seam for one (mechanism, lock_path) pair.
#
#   CONTRACT (round L1 signature; round L2 body):
#     $1 MECHANISM — "flock" or "mkdir"
#     $2 LOCKPATH
#     stdout: "atomic" | "non-atomic" | "fs-unsupported" | empty
#   Trust only syscall | pinned-mechanism. Version-string match is not a digest match.
#   Mechanism-relative traces (BRIEF section 0). Never writes inventory.
fm_lock__verdict_for() {
  local mech="${1:-}" lock_path="${2:-}"
  [[ -z "$mech" || -z "$lock_path" ]] && return 0

  fm_lock__ensure_verdict_cache

  local fs_class now_path now_sha
  fs_class="$(fm_lock__fs_class "$lock_path")"
  now_path="$(fm_lock__resolve_bin "$mech")"
  now_sha="$(fm_lock__sha256 "$now_path")"

  local row currency need_local=0
  row="$(fm_lock__row_for "$mech")"
  if [[ -n "$row" ]]; then
    local r_path r_ver r_sha r_verdict r_ev r_fs r_ts
    IFS='|' read -r _ r_path r_ver r_sha r_verdict r_ev r_fs r_ts <<<"$row"
    if [[ "$r_ev" == "syscall" || "$r_ev" == "pinned-mechanism" ]]; then
      if [[ "$r_verdict" == "atomic" || "$r_verdict" == "non-atomic" ]]; then
        currency="$(fm_lock__currency_ok "$mech" "$lock_path" "$row" || true)"
        if [[ "$currency" == "ok" ]]; then
          printf '%s\n' "$r_verdict"
          return 0
        fi
        if [[ "$currency" == "fs-uncovered" ]]; then
          # Trusted polarity exists for this mechanism but not this FS class.
          # Do not re-probe into a different claim; FS barrier is the signal.
          printf '%s\n' "fs-unsupported"
          return 0
        fi
        # path/version/digest/mtime/stale mismatch → local re-probe
        need_local=1
      else
        need_local=1
      fi
    else
      # untrusted evidence class in inventory cannot license; try local/pin
      need_local=1
    fi
  else
    need_local=1
  fi

  if [[ -n "$now_sha" ]]; then
    local pin
    pin="$(fm_lock__pinned_verdict "$mech" "$now_sha" "$fs_class")"
    if [[ "$pin" == "atomic" || "$pin" == "non-atomic" || "$pin" == "fs-unsupported" ]]; then
      printf '%s\n' "$pin"
      return 0
    fi
  fi

  if (( need_local )); then
    # Re-probe only THIS mechanism (memory only). Never wipe a current trusted
    # row for a different mechanism — evidence is mechanism-relative.
    # Track which mechs have been locally probed via a space-separated list.
    if [[ " ${_FM_LOCK_LOCAL_PROBED_MECHS:-} " != *" $mech "* ]]; then
      _FM_LOCK_LOCAL_PROBED_MECHS="${_FM_LOCK_LOCAL_PROBED_MECHS:-} $mech"
      fm_lock__replace_with_local_probe "$mech"
    fi
    row="$(fm_lock__row_for "$mech")"
    if [[ -n "$row" ]]; then
      local r_path r_ver r_sha r_verdict r_ev r_fs r_ts
      IFS='|' read -r _ r_path r_ver r_sha r_verdict r_ev r_fs r_ts <<<"$row"
      if [[ "$r_ev" == "syscall" || "$r_ev" == "pinned-mechanism" ]]; then
        if [[ "$r_verdict" == "atomic" || "$r_verdict" == "non-atomic" ]]; then
          currency="$(fm_lock__currency_ok "$mech" "$lock_path" "$row" || true)"
          if [[ "$currency" == "ok" ]]; then
            printf '%s\n' "$r_verdict"
            return 0
          fi
          if [[ "$currency" == "fs-uncovered" ]]; then
            printf '%s\n' "fs-unsupported"
            return 0
          fi
        fi
      fi
    fi
  fi

  return 0
}

# @description List lock mechanisms available on this host (not yet trusted).
# @stdout one mechanism name per line: "flock" if present, always "mkdir"
# @exitcode 0
fm_lock__available_mechanisms() {
  if command -v flock >/dev/null 2>&1; then
    printf '%s\n' "flock"
  fi
  printf '%s\n' "mkdir"
}

# @description Resolve which mechanism (if any) is trusted for LOCKPATH.
#   Trust and filesystem-support causes are decided entirely here, BEFORE
#   any spin/retry loop. That ordering is structural: FM_LOCK_TIMEOUT can
#   never fire against an untrusted mechanism.
#
#   Ordered refusal chain (first matching guard wins), after NESTED which
#   is decided at request time by the caller:
#     2. FM_LOCK_FS_UNSUPPORTED       — aggregate: no available mechanism
#                                        has a trusted verdict covering the
#                                        lock path's filesystem class, and
#                                        at least one reported fs-unsupported
#     3. FM_LOCK_NO_ATOMIC_PRIMITIVE  — every available mechanism has a
#                                        trusted-negative (non-atomic) verdict
#     4. FM_LOCK_PROBE_UNTRUSTED      — no trusted verdict of either polarity
#                                        for any available mechanism
#     residual → FM_LOCK_UNAVAILABLE  — mixed states matching no guard above
#   On success, echoes the selected mechanism name (flock preferred over mkdir).
#
# @arg $1 lock_path
# @stdout selected mechanism on success
# @stderr one FM_LOCK_* code on refusal
# @exitcode 0 on selection; 1 on refusal
fm_lock__select_mechanism() {
  local lock_path="$1"
  local mech verdict
  local any_atomic=0
  local any_fs_unsup=0
  local any_trusted_polarity=0
  local all_trusted_negative=1
  local mech_count=0
  local flock_atomic=0
  local mkdir_atomic=0

  # ---- TRUST / FS RESOLUTION (no spin may begin before this returns) ----
  while IFS= read -r mech; do
    [[ -z "$mech" ]] && continue
    mech_count=$((mech_count + 1))
    # Capture verdict; empty means no trusted verdict available.
    verdict="$(fm_lock__verdict_for "$mech" "$lock_path" || true)"
    verdict="${verdict//$'\r'/}"
    verdict="${verdict//$'\n'/}"
    case "$verdict" in
      atomic)
        any_atomic=1
        any_trusted_polarity=1
        all_trusted_negative=0
        if [[ "$mech" == "flock" ]]; then
          flock_atomic=1
        elif [[ "$mech" == "mkdir" ]]; then
          mkdir_atomic=1
        fi
        ;;
      non-atomic)
        any_trusted_polarity=1
        ;;
      fs-unsupported)
        any_fs_unsup=1
        all_trusted_negative=0
        ;;
      *)
        # empty / unknown: no trusted verdict of either polarity for this mech
        all_trusted_negative=0
        ;;
    esac
  done < <(fm_lock__available_mechanisms)

  if (( mech_count == 0 )); then
    # No candidate binary at all — residual.
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" "no lock mechanism binary available"
    return 1
  fi

  if (( any_atomic )); then
    # Prefer flock when both are trusted-positive for this path.
    if (( flock_atomic )); then
      printf '%s\n' "flock"
      return 0
    fi
    if (( mkdir_atomic )); then
      printf '%s\n' "mkdir"
      return 0
    fi
  fi

  # No trusted-positive selection. Refuse via ordered guards 2–4, then residual.
  # ASSERTION: we have not entered any spin/retry loop.
  #
  # Guard 2 (aggregate coverage): the lock path's filesystem class is covered
  # by no trusted verdict (of either polarity) for any available mechanism,
  # and at least one mechanism reported the fs-unsupported barrier. A single
  # mechanism reporting fs-unsupported does NOT fire this guard if another
  # available mechanism has a covering trusted verdict.
  if (( any_fs_unsup && any_trusted_polarity == 0 )); then
    fm_lock__refuse "FM_LOCK_FS_UNSUPPORTED"
    return 1
  fi
  if (( all_trusted_negative && any_trusted_polarity )); then
    # Guard 3: trusted verdict exists for every available mechanism and
    # every one is negative. (all_trusted_negative stays 1 only when every
    # mech returned non-atomic.)
    fm_lock__refuse "FM_LOCK_NO_ATOMIC_PRIMITIVE"
    return 1
  fi
  # Guard 4: no trusted verdict of either polarity for any available mechanism.
  # Must NOT catch mixed states (some polarity present, no positive selection).
  if (( any_trusted_polarity == 0 )); then
    fm_lock__refuse "FM_LOCK_PROBE_UNTRUSTED"
    return 1
  fi
  # Residual: enum total — mixed verdicts matching no guard (e.g. flock
  # trusted-negative + mkdir absent; flock fs-unsupported + mkdir non-atomic).
  fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
    "no trusted-positive mechanism available (mixed verdicts)"
  return 1
}

# @description Spin to acquire via flock on a lock file at LOCK_PATH.
#   Prerequisite: mechanism already selected and trusted (caller asserts).
#   Contention (EWOULDBLOCK / empty-stderr non-zero from flock -n) spins until
#   timeout. Any other flock/open failure is FM_LOCK_UNAVAILABLE immediately
#   with a detail naming the operation and its message — never TIMEOUT.
# @arg $1 lock_path
# @arg $2 timeout_sec
# @stderr FM_LOCK_UNAVAILABLE detail | FM_LOCK_TIMEOUT
# @exitcode 0 held; 1 refused
fm_lock__acquire_flock() {
  local lock_path="$1"
  local timeout_sec="$2"
  local parent err errfile open_rc
  parent="$(dirname -- "$lock_path")"

  if [[ -d "$lock_path" ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "open flock lock file ${lock_path}: is a directory"
    return 1
  fi

  err="$(mkdir -p -- "$parent" 2>&1)" || {
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "mkdir -p ${parent}: ${err:-failed}"
    return 1
  }

  err="$(touch -- "$lock_path" 2>&1)" || {
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "touch ${lock_path}: ${err:-failed}"
    return 1
  }

  # Open a dedicated FD and hold it for the critical-section lifetime.
  # Capture open failure message without losing the FD on success.
  # Use automatically-allocated descriptors only — never hardcode FD 3 (or
  # any fixed FD): a caller may already own it (N1).
  local lock_fd save_stderr
  errfile="$(mktemp "${TMPDIR:-/tmp}/fm-lock-open.XXXXXX")" || {
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "open fd for ${lock_path}: mktemp failed"
    return 1
  }
  open_rc=0
  exec {save_stderr}>&2
  exec 2>"$errfile"
  exec {lock_fd}>>"$lock_path" || open_rc=$?
  exec 2>&"$save_stderr"
  eval "exec ${save_stderr}>&-" 2>/dev/null || true
  if (( open_rc != 0 )); then
    err="$(tr -d '\r' <"$errfile" 2>/dev/null | head -n 1)"
    rm -f -- "$errfile"
    eval "exec ${lock_fd}>&-" 2>/dev/null || true
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "open fd for ${lock_path}: ${err:-exec redirect failed (rc=${open_rc})}"
    return 1
  fi
  rm -f -- "$errfile"

  local start=$SECONDS
  local flock_err flock_rc engaged=0
  # ASSERTION: trust was resolved before this spin; TIMEOUT is only reachable
  # on an already-trusted, already-selected mechanism that has been engaged
  # (contention observed) at least once.
  while true; do
    flock_err="$(flock -n "$lock_fd" 2>&1)"
    flock_rc=$?
    if (( flock_rc == 0 )); then
      _FM_LOCK_FD="$lock_fd"
      return 0
    fi
    # Contention: non-zero with empty stderr (typical EWOULDBLOCK / exit 1).
    # Operation failure: non-zero with a message (ENOLCK, EOPNOTSUPP, EINVAL…).
    if [[ -n "$flock_err" ]]; then
      eval "exec ${lock_fd}>&-" 2>/dev/null || true
      flock_err="${flock_err//$'\r'/}"
      flock_err="${flock_err//$'\n'/ }"
      fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
        "flock -n ${lock_path}: ${flock_err}"
      return 1
    fi
    engaged=1
    if (( SECONDS - start >= timeout_sec )); then
      eval "exec ${lock_fd}>&-" 2>/dev/null || true
      # TIMEOUT only after the mechanism was engaged at least once.
      if (( engaged )); then
        fm_lock__refuse "FM_LOCK_TIMEOUT"
      else
        fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
          "flock -n ${lock_path}: failed without engagement"
      fi
      return 1
    fi
    sleep 0.02
  done
}

# @description Spin to acquire via mkdir mutex at LOCK_PATH (directory).
#   Prerequisite: mechanism already selected and trusted (caller asserts).
#   Contention (EEXIST / path already a directory) spins until timeout.
#   Any other mkdir failure is FM_LOCK_UNAVAILABLE immediately with a detail
#   naming the operation and its message — never TIMEOUT.
# @arg $1 lock_path
# @arg $2 timeout_sec
# @stderr FM_LOCK_UNAVAILABLE detail | FM_LOCK_TIMEOUT
# @exitcode 0 held; 1 refused
fm_lock__acquire_mkdir() {
  local lock_path="$1"
  local timeout_sec="$2"
  local parent err mkdir_err mkdir_rc
  parent="$(dirname -- "$lock_path")"

  if [[ -e "$lock_path" && ! -d "$lock_path" ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "mkdir lock ${lock_path}: path exists and is not a directory"
    return 1
  fi

  err="$(mkdir -p -- "$parent" 2>&1)" || {
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "mkdir -p ${parent}: ${err:-failed}"
    return 1
  }

  local start=$SECONDS
  local engaged=0
  # ASSERTION: trust was resolved before this spin; TIMEOUT is only reachable
  # on an already-trusted, already-selected mechanism that has been engaged
  # (contention observed) at least once.
  while true; do
    mkdir_err="$(mkdir -- "$lock_path" 2>&1)"
    mkdir_rc=$?
    if (( mkdir_rc == 0 )); then
      return 0
    fi
    # Contention: directory already exists (EEXIST).
    if [[ -d "$lock_path" ]]; then
      engaged=1
      if (( SECONDS - start >= timeout_sec )); then
        fm_lock__refuse "FM_LOCK_TIMEOUT"
        return 1
      fi
      sleep 0.02
      continue
    fi
    # Operation failure: permission denied, read-only FS, ENOSPC, etc.
    mkdir_err="${mkdir_err//$'\r'/}"
    mkdir_err="${mkdir_err//$'\n'/ }"
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "mkdir ${lock_path}: ${mkdir_err:-failed}"
    return 1
  done
}

# @description Acquire a foreman lock at LOCK_PATH.
#   On success, holds the lock, sets FM_LOCK_MECHANISM to the selected
#   mechanism (flock|mkdir), and echoes that mechanism name on stdout so
#   callers (e.g. el_init reclamation) know which regime they are in.
#   IMPORTANT: do not capture this function in $(...) / command substitution
#   if you need the lock held in the current shell — a subshell would drop
#   process-local hold state and close the flock FD. Read FM_LOCK_MECHANISM
#   instead, or redirect stdout: fm_lock_acquire path >mech.txt
#   On refusal, emits exactly one FM_LOCK_* code on stderr, holds no lock
#   for this acquisition, enters no critical section, and returns non-zero.
#   Protected files for this acquisition are left byte-identical.
# @arg $1 lock_path path of the lock (file for flock; directory for mkdir)
# @arg $2 timeout_sec optional bounded spin seconds (default FM_LOCK_TIMEOUT_SEC)
# @stdout mechanism name on success (flock|mkdir)
# @stderr one FM_LOCK_* code on refusal (UNAVAILABLE includes a detail string)
# @exitcode 0 acquired; 1 refused
fm_lock_acquire() {
  local lock_path="${1:-}"
  local timeout_sec="${2:-$FM_LOCK_TIMEOUT_SEC}"
  local selected

  # Guard 1: flat locking — refuse nesting rather than order locks.
  # Evaluated FIRST, before argument validation, so empty-path + held outer
  # still names FM_LOCK_NESTED (ordered chain requires NESTED at request time).
  if [[ -n "$_FM_LOCK_HELD_PATH" ]]; then
    fm_lock__refuse "FM_LOCK_NESTED"
    return 1
  fi

  if [[ -z "$lock_path" ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" "fm_lock_acquire: empty lock_path"
    return 1
  fi

  # Guards 2–4: trust and filesystem support — BEFORE any spin.
  # Structural guarantee: FM_LOCK_TIMEOUT cannot fire on an untrusted mechanism.
  selected="$(fm_lock__select_mechanism "$lock_path")" || return 1

  case "$selected" in
    flock)
      fm_lock__acquire_flock "$lock_path" "$timeout_sec" || return 1
      ;;
    mkdir)
      fm_lock__acquire_mkdir "$lock_path" "$timeout_sec" || return 1
      ;;
    *)
      fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
        "internal: unknown selected mechanism '${selected}'"
      return 1
      ;;
  esac

  # Hold recorded only after successful acquisition (single owner).
  _FM_LOCK_HELD_PATH="$lock_path"
  _FM_LOCK_MECHANISM="$selected"
  FM_LOCK_MECHANISM="$selected"
  printf '%s\n' "$selected"
  return 0
}

# @description Release the foreman lock held at LOCK_PATH by this process.
#   Single-unconditional-release discipline: state is cleared once up front
#   so a second call cannot double-release; the underlying unlock runs at
#   most once. Safe to call only for a lock this process currently holds.
# @arg $1 lock_path path previously passed to fm_lock_acquire
# @exitcode 0 released (or nothing held for this path); 1 path mismatch
fm_lock_release() {
  local lock_path="$1"
  local mech="$_FM_LOCK_MECHANISM"
  local fd="$_FM_LOCK_FD"
  local held="$_FM_LOCK_HELD_PATH"

  if [[ -z "$held" ]]; then
    return 0
  fi
  if [[ "$held" != "$lock_path" ]]; then
    echo "fm_lock_release: path mismatch (held=${held}, asked=${lock_path})" >&2
    return 1
  fi

  # Clear hold state first — single release, no double-release on re-entry.
  _FM_LOCK_HELD_PATH=""
  _FM_LOCK_MECHANISM=""
  _FM_LOCK_FD=""
  FM_LOCK_MECHANISM=""

  case "$mech" in
    flock)
      if [[ -n "$fd" ]]; then
        flock -u "$fd" 2>/dev/null || true
        eval "exec ${fd}>&-" 2>/dev/null || true
      fi
      ;;
    mkdir)
      rmdir -- "$lock_path" 2>/dev/null || true
      ;;
  esac
  return 0
}

# @description Acquire LOCK_PATH, run COMMAND, release on every exit path.
#   The lock is released exactly once whether COMMAND succeeds, fails, calls
#   exit, or the shell is terminated by HUP/INT/TERM. A trap plus fall-through
#   share a once-flag so release is never double.
#   COMMAND runs in a subshell so its trap mutations cannot overwrite the
#   wrapper's cleanup (N2). Pre-existing EXIT/HUP/INT/TERM traps are saved
#   and restored exactly — never cleared permanently (N2).
#   Acquisition refusal propagates without running COMMAND and installs no
#   trap.
# @arg $1 lock_path
# @arg $2 timeout_sec optional; if the next arg is --, $2 is timeout and
#   command follows --; otherwise $2 starts the command and timeout is
#   FM_LOCK_TIMEOUT_SEC
# @arg $3... command and arguments (after optional timeout and --)
# @stdout command stdout (mechanism via FM_LOCK_MECHANISM)
# @stderr refusal codes or command stderr
# @exitcode acquire refusal status, or command status after release
fm_with_lock() {
  local lock_path="${1:-}"
  shift || true
  local timeout_sec="$FM_LOCK_TIMEOUT_SEC"

  if [[ "${1:-}" == "--" ]]; then
    shift
  elif [[ "${1:-}" =~ ^[0-9]+([.][0-9]+)?$ && "${2:-}" == "--" ]]; then
    timeout_sec="$1"
    shift 2
  elif [[ "${1:-}" =~ ^[0-9]+([.][0-9]+)?$ && $# -ge 2 ]]; then
    # numeric timeout without -- : treat as timeout when a command follows
    timeout_sec="$1"
    shift
  fi

  # Guard 1 before missing-command validation (same ordering as acquire).
  if [[ -n "$_FM_LOCK_HELD_PATH" ]]; then
    fm_lock__refuse "FM_LOCK_NESTED"
    return 1
  fi

  if [[ $# -lt 1 ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" "fm_with_lock: missing command"
    return 1
  fi

  # Do NOT capture acquire in $() — that runs in a subshell, drops hold
  # state, and for flock closes the lock FD on subshell exit (silent unlock).
  # Mechanism is exposed via FM_LOCK_MECHANISM after a successful acquire.
  fm_lock_acquire "$lock_path" "$timeout_sec" >/dev/null || return 1

  # Once-flag shared by trap and fall-through — exactly one release.
  local _fm_wl_path="$lock_path"
  local _fm_wl_released=0
  # Re-executable trap definitions for EXIT/HUP/INT/TERM (may be empty).
  local _fm_wl_saved_traps
  _fm_wl_saved_traps="$(trap -p EXIT HUP INT TERM 2>/dev/null || true)"

  # shellcheck disable=SC2329
  _fm_with_lock_release_once() {
    if (( _fm_wl_released == 0 )); then
      _fm_wl_released=1
      fm_lock_release "$_fm_wl_path" || true
    fi
  }

  # shellcheck disable=SC2329
  _fm_with_lock_restore_traps() {
    trap - EXIT HUP INT TERM
    if [[ -n "${_fm_wl_saved_traps}" ]]; then
      eval "${_fm_wl_saved_traps}"
    fi
  }

  # shellcheck disable=SC2329
  _fm_with_lock_finish() {
    _fm_with_lock_release_once
    _fm_with_lock_restore_traps
  }

  # EXIT covers shell-exit paths while the lock is held. Signal traps cover
  # HUP/INT/TERM. All finish paths share the once-flag (no double release).
  # shellcheck disable=SC2064
  trap '_fm_with_lock_finish' EXIT
  # shellcheck disable=SC2064
  trap '_fm_with_lock_finish; exit 129' HUP
  # shellcheck disable=SC2064
  trap '_fm_with_lock_finish; exit 130' INT
  # shellcheck disable=SC2064
  trap '_fm_with_lock_finish; exit 143' TERM

  local rc=0
  # Subshell: command trap changes / `exit` cannot clobber parent cleanup.
  ( "$@" ) || rc=$?

  _fm_with_lock_finish
  return "$rc"
}
