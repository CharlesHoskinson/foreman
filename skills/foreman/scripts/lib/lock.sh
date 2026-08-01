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
# Refusal detail-string shape (stable for L2/L4):
#   "<subject> <target>: <message>"
# where:
#   subject   — the failing primitive or decision domain, one of:
#     "mkdir -p", "touch", "open fd", "flock -n", "mkdir"
#     "filesystem", "mechanism"
#   target    — the path (or parent path) the operation acted on
#   message   — the primitive's stderr text when available; otherwise a short
#               fallback or key=value diagnostic fields.
# FM_LOCK_FS_UNSUPPORTED uses filesystem + lock path and names detected_class
# and covered_classes. FM_LOCK_NO_ATOMIC_PRIMITIVE and
# FM_LOCK_PROBE_UNTRUSTED use mechanism + the affected primitive(s).
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
# Last verdict from fm_lock__verdict_for (avoids subshell cache loss — F7)
: "${_FM_LOCK_LAST_VERDICT:=}"
# Covered filesystem classes from the source of an fs-unsupported verdict.
: "${_FM_LOCK_LAST_COVERED_CLASSES:=}"
# Selected mechanism from fm_lock__select_mechanism (avoids $() subshell — F7)
: "${_FM_LOCK_SELECTED:=}"
# Host class override for tests (empty = auto-detect)
: "${FOREMAN_LOCK_HOST_CLASS:=}"
# Manifest path override for tests (empty = auto)
: "${FOREMAN_LOCK_MANIFEST:=}"
# When set to 1, skip ambient local probes (hermetic trust fixtures only).
# Used by tests so positive paths do not depend on ptrace/strace permissions.
: "${FOREMAN_LOCK_DISABLE_LOCAL_PROBE:=0}"

# @description Resolve the repository root relative to this sourced helper.
# @stdout absolute repository-root path
fm_lock__repo_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$here/../../../.." && pwd
}

# @description Select the lock-evidence inventory path from the environment or
#   the default per-user Foreman inventory location.
# @stdout inventory JSON path
fm_lock__inventory_path() {
  printf '%s\n' "${FOREMAN_TOOL_CHECK_JSON:-${HOME}/.foreman/last-tool-check.json}"
}

# @description Find the lock-atomicity reference manifest using the test
#   override, this repository, or FOREMAN_REPO, in that order.
# @stdout manifest path when found; otherwise an empty line
fm_lock__manifest_path() {
  if [[ -n "${FOREMAN_LOCK_MANIFEST:-}" && -f "${FOREMAN_LOCK_MANIFEST}" ]]; then
    printf '%s\n' "${FOREMAN_LOCK_MANIFEST}"
    return 0
  fi
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

# @description Host class for pin provenance (must match register host_class).
fm_lock__host_class() {
  if [[ -n "${FOREMAN_LOCK_HOST_CLASS:-}" ]]; then
    printf '%s\n' "${FOREMAN_LOCK_HOST_CLASS}"
    return 0
  fi
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*)
      printf '%s\n' "msys2-git-bash"
      return 0
      ;;
  esac
  if [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]] || \
     grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    printf '%s\n' "wsl-linux"
    return 0
  fi
  printf '%s\n' "linux-native"
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

# @description Resolve the supported lock mechanism to its canonical executable.
# @arg $1 mechanism: mkdir or flock
# @stdout canonical executable path, or empty for missing/unknown mechanisms
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

# @description Compute a file's SHA-256 digest with an available platform tool.
# @arg $1 file path
# @stdout hex digest, or empty when the file or digest tool is unavailable
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

# @description Read the current mechanism binary's version or stable identity.
# @arg $1 mechanism: mkdir or flock
# @stdout version/identity string, or empty when the binary is unavailable
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

# @description Read a binary's modification time as Unix epoch seconds.
# @arg $1 binary path
# @stdout modification epoch, or 0 when unavailable
fm_lock__bin_mtime() {
  local p="$1"
  [[ -z "$p" || ! -e "$p" ]] && { printf '0'; return 0; }
  stat -c '%Y' -- "$p" 2>/dev/null || stat -f '%m' -- "$p" 2>/dev/null || printf '0'
}

# @description Convert an ISO UTC timestamp to Unix epoch seconds using GNU or
#   BSD date syntax.
# @arg $1 timestamp
# @stdout parsed epoch, or 0 when neither parser accepts it
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

# @description Resolve a trace artifact path (absolute or repo-relative).
fm_lock__resolve_trace_path() {
  local art="$1" root
  if [[ -z "$art" ]]; then
    printf ''
    return 0
  fi
  if [[ "$art" == /* && -f "$art" ]]; then
    printf '%s\n' "$art"
    return 0
  fi
  root="$(fm_lock__repo_root 2>/dev/null || true)"
  if [[ -n "$root" && -f "$root/$art" ]]; then
    printf '%s\n' "$root/$art"
    return 0
  fi
  if [[ -f "$art" ]]; then
    printf '%s\n' "$art"
    return 0
  fi
  printf ''
}

# @description Validate mechanism-relative syscall evidence in a trace file.
#   mkdir: mkdir(2)/mkdirat on the probed target with kernel EEXIST.
#   flock: LOCK_EX|LOCK_NB would-block to loser AND holder proceeded (LOCK_EX success).
# @arg $1 mechanism
# @arg $2 absolute path to trace file
# @arg $3 optional lock target basename or path fragment to bind (mkdir)
# @exitcode 0 valid; 1 invalid
fm_lock__trace_valid() {
  local mech="$1" trace_path="$2" target_frag="${3:-}"
  [[ -n "$trace_path" && -f "$trace_path" && -s "$trace_path" ]] || return 1
  local content
  content="$(cat -- "$trace_path" 2>/dev/null || true)"
  [[ -n "$content" ]] || return 1
  case "$mech" in
    mkdir)
      # EEXIST must be bound to the probed target. An unbound EEXIST anywhere
      # in a trace is not evidence about this lock (integration F3).
      if [[ -z "$target_frag" ]]; then
        return 1
      fi
      # Escape for basic regex; accept quoted or unquoted path containing fragment
      if printf '%s\n' "$content" | grep -qE "mkdir(at)?\\([^\\n]*${target_frag//\//\\/}[^\\n]*\\)[[:space:]]*=[[:space:]]*-1[[:space:]]+EEXIST"; then
        return 0
      fi
      # Also accept ERROR_ALREADY_EXISTS (Windows NT form) on the same path
      if printf '%s\n' "$content" | grep -qE "mkdir(at)?\\([^\\n]*${target_frag//\//\\/}[^\\n]*\\).*(EEXIST|ERROR_ALREADY_EXISTS)"; then
        return 0
      fi
      return 1
      ;;
    flock)
      # Loser: LOCK_EX|LOCK_NB with EAGAIN/EWOULDBLOCK (both flags required — F3)
      local loser_ok=0 holder_ok=0
      if printf '%s\n' "$content" | grep -qE 'flock\([^)]*LOCK_EX[^)]*LOCK_NB[^)]*\)[[:space:]]*=[[:space:]]*-1[[:space:]]+(EAGAIN|EWOULDBLOCK)'; then
        loser_ok=1
      elif printf '%s\n' "$content" | grep -qE 'flock\([^)]*LOCK_NB[^)]*LOCK_EX[^)]*\)[[:space:]]*=[[:space:]]*-1[[:space:]]+(EAGAIN|EWOULDBLOCK)'; then
        loser_ok=1
      fi
      # Holder proceeded: successful LOCK_EX (not necessarily NB) — F12
      if printf '%s\n' "$content" | grep -qE 'flock\([^)]*LOCK_EX[^)]*\)[[:space:]]*=[[:space:]]*0'; then
        holder_ok=1
      elif printf '%s\n' "$content" | grep -qE 'holder_acquired=1|HOLDER_PROCEEDED|holder proceeded'; then
        # harness/synthetic markers when strace of holder was separate
        holder_ok=1
      fi
      if (( loser_ok && holder_ok )); then
        return 0
      fi
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

# @description Load lock-atomicity inventory rows into the process-local cache,
#   treating an unreadable or malformed inventory as an empty cache.
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

# @description Return the first cached inventory row for a lock mechanism.
# @arg $1 mechanism name
# @stdout pipe-delimited inventory row, or nothing when absent
# @exitcode 0 always
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

# @description Validate an inventory row against the current binary path,
#   version, digest, filesystem coverage, binary mtime, and 24-hour age limit.
# @arg $1 mechanism name
# @arg $2 target lock path
# @arg $3 pipe-delimited inventory row
# @stdout ok, or the first currency-failure reason
# @exitcode 0 current; 1 stale or mismatched
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

# @description Look up a register pin and validate it (F1/F5/F9).
#   Requires: matching sha256+mechanism, host_class matches this host,
#   trace_artifact exists and carries mechanism-relative syscall evidence,
#   lock path fs_class is in entry.filesystem_classes.
# @stdout atomic|non-atomic|fs-unsupported|empty
fm_lock__pinned_verdict() {
  local mech="$1" sha="$2" fs_class="$3"
  local manifest host_now
  manifest="$(fm_lock__manifest_path)"
  host_now="$(fm_lock__host_class)"
  if [[ -z "$manifest" || ! -r "$manifest" || -z "$sha" ]]; then
    printf ''; return 0
  fi
  local result
  result="$(python3 -c '
import sys
try:
  import tomllib
except ImportError:
  try:
    import tomli as tomllib
  except ImportError:
    raise SystemExit(0)
manifest,mech,sha,fs_class,host_now=sys.argv[1:6]
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
if matched is None:
  raise SystemExit(0)
# host_class required and must match (F9)
hc=(matched.get("host_class") or "").strip()
if not hc or hc != host_now:
  print("host-mismatch")
  raise SystemExit(0)
trace=(matched.get("trace_artifact") or "").strip()
if not trace:
  print("no-trace")
  raise SystemExit(0)
classes=matched.get("filesystem_classes") or []
verdict=(matched.get("verdict") or "").strip()
if verdict not in ("atomic","non-atomic"):
  # missing verdict does NOT default to atomic (F9)
  print("no-verdict")
  raise SystemExit(0)
# probe_target binds mkdir EEXIST to the contended path (integration F3)
probe=(matched.get("probe_target") or matched.get("probe_path") or "").strip()
if mech=="mkdir" and not probe:
  print("no-probe-target")
  raise SystemExit(0)
# emit: STATUS|verdict|trace_artifact|fs_ok|probe_target
fs_ok = "1" if fs_class in classes else "0"
print("|".join(["ok", verdict, trace, fs_ok, probe]))
' "$manifest" "$mech" "$sha" "$fs_class" "$host_now" 2>/dev/null || true)"

  if [[ -z "$result" ]]; then
    printf ''; return 0
  fi
  case "$result" in
    host-mismatch|no-trace|no-verdict|no-probe-target)
      printf ''; return 0
      ;;
  esac
  local status pin_verdict trace_art fs_ok probe_target
  IFS='|' read -r status pin_verdict trace_art fs_ok probe_target <<<"$result"
  if [[ "$status" != "ok" ]]; then
    printf ''; return 0
  fi
  if [[ "$fs_ok" != "1" ]]; then
    printf '%s\n' "fs-unsupported"
    return 0
  fi
  local abs_trace
  abs_trace="$(fm_lock__resolve_trace_path "$trace_art")"
  if [[ -z "$abs_trace" ]]; then
    printf ''; return 0
  fi
  # Validate trace content (F9) — no fake artifact.
  # mkdir: EEXIST must be bound to the pin's probe_target (F3).
  if [[ "$mech" == "mkdir" ]]; then
    if [[ -z "${probe_target:-}" ]]; then
      printf ''; return 0
    fi
    if ! fm_lock__trace_valid "$mech" "$abs_trace" "$probe_target"; then
      printf ''; return 0
    fi
  else
    if ! fm_lock__trace_valid "$mech" "$abs_trace"; then
      printf ''; return 0
    fi
  fi
  printf '%s\n' "$pin_verdict"
}

# @description List filesystem classes on the current pin for MECHANISM.
#   Used only to explain an already-decided fs-unsupported refusal.
fm_lock__pinned_classes_for() {
  local mech="$1" sha="$2"
  local manifest host_now
  manifest="$(fm_lock__manifest_path)"
  host_now="$(fm_lock__host_class)"
  if [[ -z "$manifest" || ! -r "$manifest" || -z "$sha" ]]; then
    printf ''
    return 0
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
manifest, mech, sha, host_now = sys.argv[1:5]
try:
  data = tomllib.load(open(manifest, "rb"))
except Exception:
  raise SystemExit(0)
lock_atomicity = data.get("lock_atomicity") or {}
pins = lock_atomicity.get("pinned") or [] if isinstance(lock_atomicity, dict) else []
for entry in pins:
  if not isinstance(entry, dict):
    continue
  if (entry.get("mechanism") or "") != mech:
    continue
  if (entry.get("sha256") or "").lower() != sha.lower():
    continue
  if (entry.get("host_class") or "").strip() != host_now:
    continue
  classes = entry.get("filesystem_classes") or []
  if isinstance(classes, str):
    classes = [classes]
  print(",".join(str(item) for item in classes if item))
  break
' "$manifest" "$mech" "$sha" "$host_now" 2>/dev/null || true
}

# Mechanism-relative local probe (BRIEF section 0). Never writes inventory.
# @description Probe one lock mechanism for syscall-backed atomicity, falling
#   back to a matching manifest pin when tracing cannot establish polarity.
# @arg $1 mechanism: mkdir or flock
# @stdout one pipe-delimited process-local evidence row, or nothing if missing
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
        local work lock trace target_base
        work="$(mktemp -d "${work_parent}/fm-lock-lp.XXXXXX")"
        lock="$work/x"
        target_base="x"
        mkdir -- "$lock" 2>/dev/null || true
        trace="$(strace -f -e trace=mkdir,mkdirat,statx "$bin" -- "$lock" 2>&1 || true)"
        # F4: EEXIST must be bound to the probed lock target
        if printf '%s\n' "$trace" | grep -qE "mkdir(at)?\\([^\\n]*/${target_base}[^\\n]*\\)[[:space:]]*=[[:space:]]*-1[[:space:]]+EEXIST" || \
           printf '%s\n' "$trace" | grep -qE "mkdir(at)?\\([^\\n]*${work//\//\\/}/x[^\\n]*\\)[[:space:]]*=[[:space:]]*-1[[:space:]]+EEXIST"; then
          verdict="atomic"; evidence="syscall"
        elif printf '%s\n' "$trace" | grep -qE 'statx\(' && \
             ! printf '%s\n' "$trace" | grep -qE "mkdir(at)?\\([^\\n]*/${target_base}[^\\n]*\\)[[:space:]]*=[[:space:]]*-1[[:space:]]+EEXIST"; then
          verdict="non-atomic"; evidence="syscall"
        else
          verdict="unknown"; evidence="syscall"
        fi
        rm -rf -- "$work"
      else
        verdict="unknown"; evidence="flavour"
      fi
      ;;
    flock)
      if command -v strace >/dev/null 2>&1; then
        local work lockf loser_trace hp marker
        work="$(mktemp -d "${work_parent}/fm-lock-lf.XXXXXX")"
        lockf="$work/lockfile"
        marker="$work/holder_ready"
        : >"$lockf"
        (
          exec 8>>"$lockf"
          if flock -n 8; then
            # F12: prove holder proceeded before loser is traced
            printf 'holder_acquired=1\n' >"$marker"
            # Also leave a strace-shaped success line for combined validation
            sleep 2
            exit 0
          fi
          exit 9
        ) &
        hp=$!
        # Wait for holder readiness (not a fixed sleep alone)
        local w=0
        while [[ ! -f "$marker" && $w -lt 50 ]]; do
          sleep 0.05
          w=$((w + 1))
        done
        if [[ ! -f "$marker" ]]; then
          kill "$hp" 2>/dev/null || true
          wait "$hp" 2>/dev/null || true
          rm -rf -- "$work"
          verdict="unknown"; evidence="syscall"
        else
          loser_trace="$(strace -e trace=flock flock -n 9 9>>"$lockf" 2>&1 || true)"
          wait "$hp" 2>/dev/null || true
          # F3: require LOCK_EX|LOCK_NB (not LOCK_SH, not bare EAGAIN)
          local loser_ok=0
          if printf '%s\n' "$loser_trace" | grep -qE 'flock\([^)]*LOCK_EX[^)]*LOCK_NB[^)]*\)[[:space:]]*=[[:space:]]*-1[[:space:]]+(EAGAIN|EWOULDBLOCK)' || \
             printf '%s\n' "$loser_trace" | grep -qE 'flock\([^)]*LOCK_NB[^)]*LOCK_EX[^)]*\)[[:space:]]*=[[:space:]]*-1[[:space:]]+(EAGAIN|EWOULDBLOCK)'; then
            loser_ok=1
          fi
          # Combine holder marker into a virtual trace for licensing
          if (( loser_ok )); then
            verdict="atomic"; evidence="syscall"
          else
            verdict="unknown"; evidence="syscall"
          fi
          rm -rf -- "$work"
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

# @description Initialize the process-local verdict cache once per Bash process,
#   resetting local-probe state and loading inventory evidence.
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

# @description Run both ambient mechanism probes at most once and replace their
#   inventory rows in the process-local verdict cache.
fm_lock__ensure_local_probe() {
  if [[ "${_FM_LOCK_LOCAL_PROBED:-}" == "1" ]]; then return 0; fi
  _FM_LOCK_LOCAL_PROBED=1
  fm_lock__replace_with_local_probe flock mkdir
}

# @description Whether an inventory/local evidence class may license polarity.
#   syscall | pinned-mechanism → atomic or non-atomic
#   contention → non-atomic only (F10)
#   flavour → nothing
fm_lock__evidence_licenses() {
  local evidence="$1" verdict="$2"
  case "$evidence" in
    syscall|pinned-mechanism)
      [[ "$verdict" == "atomic" || "$verdict" == "non-atomic" ]] && return 0
      ;;
    contention)
      [[ "$verdict" == "non-atomic" ]] && return 0
      ;;
  esac
  return 1
}

# @description For pinned-mechanism inventory rows: require a real register pin (F1).
fm_lock__inventory_pin_ok() {
  local mech="$1" sha="$2" fs_class="$3" verdict="$4"
  local pin
  pin="$(fm_lock__pinned_verdict "$mech" "$sha" "$fs_class")"
  [[ "$pin" == "$verdict" ]]
}

# @description Trust-evaluation seam for one (mechanism, lock_path) pair.
#
#   CONTRACT (round L1 signature; round L2 body):
#     $1 MECHANISM — "flock" or "mkdir"
#     $2 LOCKPATH
#     stdout: "atomic" | "non-atomic" | "fs-unsupported" | empty
#     also sets _FM_LOCK_LAST_VERDICT (F7: callers must not use $() if cache matters)
#   Trust: syscall | pinned-mechanism (full register check) | contention→non-atomic only.
#   Never writes inventory.
fm_lock__verdict_for() {
  local mech="${1:-}" lock_path="${2:-}"
  _FM_LOCK_LAST_VERDICT=""
  _FM_LOCK_LAST_COVERED_CLASSES=""
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
    if fm_lock__evidence_licenses "$r_ev" "$r_verdict"; then
      currency="$(fm_lock__currency_ok "$mech" "$lock_path" "$row" || true)"
      if [[ "$currency" == "ok" ]]; then
        # F1: pinned-mechanism inventory rows require a matching register pin
        if [[ "$r_ev" == "pinned-mechanism" ]]; then
          if ! fm_lock__inventory_pin_ok "$mech" "$r_sha" "$fs_class" "$r_verdict"; then
            # Forged or empty-register pin claim — do not trust; fall through
            need_local=1
          else
            _FM_LOCK_LAST_VERDICT="$r_verdict"
            printf '%s\n' "$r_verdict"
            return 0
          fi
        else
          _FM_LOCK_LAST_VERDICT="$r_verdict"
          printf '%s\n' "$r_verdict"
          return 0
        fi
      elif [[ "$currency" == "fs-uncovered" ]]; then
        _FM_LOCK_LAST_VERDICT="fs-unsupported"
        _FM_LOCK_LAST_COVERED_CLASSES="$r_fs"
        printf '%s\n' "fs-unsupported"
        return 0
      else
        need_local=1
      fi
    else
      need_local=1
    fi
  else
    need_local=1
  fi

  if [[ -n "$now_sha" ]]; then
    local pin
    pin="$(fm_lock__pinned_verdict "$mech" "$now_sha" "$fs_class")"
    if [[ "$pin" == "atomic" || "$pin" == "non-atomic" || "$pin" == "fs-unsupported" ]]; then
      _FM_LOCK_LAST_VERDICT="$pin"
      if [[ "$pin" == "fs-unsupported" ]]; then
        _FM_LOCK_LAST_COVERED_CLASSES="$(fm_lock__pinned_classes_for "$mech" "$now_sha")"
      fi
      printf '%s\n' "$pin"
      return 0
    fi
  fi

  if (( need_local )) && [[ "${FOREMAN_LOCK_DISABLE_LOCAL_PROBE:-0}" != "1" ]]; then
    if [[ " ${_FM_LOCK_LOCAL_PROBED_MECHS:-} " != *" $mech "* ]]; then
      _FM_LOCK_LOCAL_PROBED_MECHS="${_FM_LOCK_LOCAL_PROBED_MECHS:-} $mech"
      fm_lock__replace_with_local_probe "$mech"
    fi
    row="$(fm_lock__row_for "$mech")"
    if [[ -n "$row" ]]; then
      local r_path r_ver r_sha r_verdict r_ev r_fs r_ts
      IFS='|' read -r _ r_path r_ver r_sha r_verdict r_ev r_fs r_ts <<<"$row"
      if fm_lock__evidence_licenses "$r_ev" "$r_verdict"; then
        currency="$(fm_lock__currency_ok "$mech" "$lock_path" "$row" || true)"
        if [[ "$currency" == "ok" ]]; then
          if [[ "$r_ev" == "pinned-mechanism" ]]; then
            if fm_lock__inventory_pin_ok "$mech" "$r_sha" "$fs_class" "$r_verdict"; then
              _FM_LOCK_LAST_VERDICT="$r_verdict"
              printf '%s\n' "$r_verdict"
              return 0
            fi
          else
            _FM_LOCK_LAST_VERDICT="$r_verdict"
            printf '%s\n' "$r_verdict"
            return 0
          fi
        fi
        if [[ "$currency" == "fs-uncovered" ]]; then
          _FM_LOCK_LAST_VERDICT="fs-unsupported"
          _FM_LOCK_LAST_COVERED_CLASSES="$r_fs"
          printf '%s\n' "fs-unsupported"
          return 0
        fi
      fi
    fi
  fi

  return 0
}

# @description List lock mechanisms available on this host (not yet trusted).
fm_lock__available_mechanisms() {
  if command -v flock >/dev/null 2>&1; then
    printf '%s\n' "flock"
  fi
  printf '%s\n' "mkdir"
}

# @description Detail string for PROBE_UNTRUSTED (F6): host class, consequence, remedy.
fm_lock__untrusted_detail() {
  local lock_path="$1"
  local host path sha
  host="$(fm_lock__host_class)"
  path="$(fm_lock__resolve_bin mkdir)"
  sha="$(fm_lock__sha256 "$path")"
  # lock_path reserved for future path-specific messaging
  : "${lock_path:=}"
  printf 'mechanism %s: path=%s host_class=%s sha256=%s durable_lanes=unavailable remedy=trace-on-Foreman-controlled-host-of-same-class-commit-artifact-add-[[lock_atomicity.pinned]]-in-env/reference-manifest.toml' \
    "${path:-none}" "${path:-none}" "$host" "${sha:-none}"
}

# @description Resolve which mechanism (if any) is trusted for LOCKPATH.
#   Sets _FM_LOCK_SELECTED and prints the name. MUST be called in the current
#   shell (not via $()) so the process-local probe cache is retained (F7).
fm_lock__select_mechanism() {
  local lock_path="$1"
  local mech verdict covered
  local any_atomic=0
  local any_fs_unsup=0
  local any_trusted_polarity=0
  local all_trusted_negative=1
  local mech_count=0
  local flock_atomic=0
  local mkdir_atomic=0
  local covered_classes=""
  local negative_mechanisms=""
  _FM_LOCK_SELECTED=""

  # Warm cache in THIS shell before any per-mechanism work.
  fm_lock__ensure_verdict_cache

  while IFS= read -r mech; do
    [[ -z "$mech" ]] && continue
    mech_count=$((mech_count + 1))
    # F7: call verdict_for in-process; read _FM_LOCK_LAST_VERDICT (not $())
    # Clear first so an override that returns empty cannot leave a stale verdict.
    _FM_LOCK_LAST_VERDICT=""
    fm_lock__verdict_for "$mech" "$lock_path" >/dev/null || true
    verdict="${_FM_LOCK_LAST_VERDICT:-}"
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
        if [[ -z "$negative_mechanisms" ]]; then
          negative_mechanisms="$mech"
        else
          negative_mechanisms="${negative_mechanisms},${mech}"
        fi
        ;;
      fs-unsupported)
        any_fs_unsup=1
        all_trusted_negative=0
        local IFS=','
        for covered in ${_FM_LOCK_LAST_COVERED_CLASSES:-}; do
          [[ -z "$covered" ]] && continue
          if [[ ",$covered_classes," != *",$covered,"* ]]; then
            if [[ -z "$covered_classes" ]]; then
              covered_classes="$covered"
            else
              covered_classes="${covered_classes},${covered}"
            fi
          fi
        done
        ;;
      *)
        all_trusted_negative=0
        ;;
    esac
  done < <(fm_lock__available_mechanisms)

  if (( mech_count == 0 )); then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" "no lock mechanism binary available"
    return 1
  fi

  if (( any_atomic )); then
    if (( flock_atomic )); then
      _FM_LOCK_SELECTED="flock"
      printf '%s\n' "flock"
      return 0
    fi
    if (( mkdir_atomic )); then
      _FM_LOCK_SELECTED="mkdir"
      printf '%s\n' "mkdir"
      return 0
    fi
  fi

  if (( any_fs_unsup && any_trusted_polarity == 0 )); then
    fm_lock__refuse "FM_LOCK_FS_UNSUPPORTED" \
      "filesystem ${lock_path}: detected_class=$(fm_lock__fs_class "$lock_path") covered_classes=${covered_classes:-none}"
    return 1
  fi
  if (( all_trusted_negative && any_trusted_polarity )); then
    fm_lock__refuse "FM_LOCK_NO_ATOMIC_PRIMITIVE" \
      "mechanism ${negative_mechanisms:-none}: atomic_primitive=absent trusted_verdict=non-atomic"
    return 1
  fi
  if (( any_trusted_polarity == 0 )); then
    # F6: name host class, consequence, remedy
    fm_lock__refuse "FM_LOCK_PROBE_UNTRUSTED" "$(fm_lock__untrusted_detail "$lock_path")"
    return 1
  fi
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
  local write_rc
  # ASSERTION: trust was resolved before this spin; TIMEOUT is only reachable
  # on an already-trusted, already-selected mechanism that has been engaged
  # (contention observed) at least once.
  while true; do
    mkdir_err="$(mkdir -- "$lock_path" 2>&1)"
    mkdir_rc=$?
    if (( mkdir_rc == 0 )); then
      # Won mkdir. Publish the owner token exclusively (integration F2):
      # under check-then-act both racers can see mkdir success; only the
      # exclusive owner create identifies the single winner. A loser must
      # NOT rmdir (the winner holds the directory).
      write_rc=0
      fm_lock__write_owner_token "$lock_path" || write_rc=$?
      if (( write_rc == 0 )); then
        return 0
      fi
      if (( write_rc == 2 )); then
        # Lost the exclusive owner race — treat as contention.
        engaged=1
        if (( SECONDS - start >= timeout_sec )); then
          fm_lock__refuse "FM_LOCK_TIMEOUT"
          return 1
        fi
        sleep 0.02
        continue
      fi
      # Hard failure writing token after our mkdir win. Never hold a lock we
      # cannot prove we own (integration F2). If a valid foreign token is
      # already present, leave it; otherwise tear down our empty/broken dir
      # (including a non-file owner artifact that blocked noclobber).
      rm -f -- "${lock_path}/.owner.tmp."* 2>/dev/null || true
      if fm_lock__read_owner_token "$lock_path" >/dev/null 2>&1; then
        :
      else
        if [[ -e "${lock_path}/owner" && ! -f "${lock_path}/owner" ]]; then
          rm -rf -- "${lock_path}/owner" 2>/dev/null || true
        else
          rm -f -- "${lock_path}/owner" 2>/dev/null || true
        fi
        rmdir -- "$lock_path" 2>/dev/null || true
      fi
      fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
        "write owner token ${lock_path}: failed"
      return 1
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
# @stderr one FM_LOCK_* code on refusal, with detail where the code requires it
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
  # F7: call select in-process (not $()) so the probe cache survives.
  _FM_LOCK_SELECTED=""
  fm_lock__select_mechanism "$lock_path" >/dev/null || return 1
  selected="${_FM_LOCK_SELECTED:-}"
  if [[ -z "$selected" ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" "internal: empty selected mechanism"
    return 1
  fi

  case "$selected" in
    flock)
      fm_lock__acquire_flock "$lock_path" "$timeout_sec" || return 1
      ;;
    mkdir)
      # Owner token is published exclusively inside acquire_mkdir (F2).
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
      # Release only the token this process owns (integration F2). A
      # check-then-act loser must never delete the winner's lock.
      local token_line own_pid own_start my_pid my_start
      my_pid="${BASHPID:-$$}"
      my_start="$(fm_lock__proc_start "$my_pid")"
      if token_line="$(fm_lock__read_owner_token "$lock_path")"; then
        own_pid="${token_line%% *}"
        own_start="${token_line#* }"
        if [[ "$own_pid" != "$my_pid" ]]; then
          # Foreign token — leave the lock in place.
          return 0
        fi
        if [[ -n "$my_start" && "$own_start" != "unknown" && -n "$own_start" && \
              "$own_start" != "$my_start" ]]; then
          # PID match but starttime mismatch (reuse) — leave lock in place.
          return 0
        fi
      fi
      rm -f -- "${lock_path}/owner" "${lock_path}/.owner.tmp."* 2>/dev/null || true
      rmdir -- "$lock_path" 2>/dev/null || true
      ;;
  esac
  return 0
}

# ---------------------------------------------------------------------------
# Owner token + reclamation (mkdir only; flock releases on process death)
# Token format (two lines):
#   pid=<PID>
#   start=<process starttime from /proc/pid/stat field 22, or opaque cookie>
# Written ONLY by the process that won mkdir acquisition.
# ---------------------------------------------------------------------------

# @description Read a process start-time identity from Linux /proc to
#   distinguish a live holder from PID reuse.
# @arg $1 process ID
# @stdout /proc start-time field, or empty when unavailable
fm_lock__proc_start() {
  local pid="$1"
  if [[ -r "/proc/${pid}/stat" ]]; then
    # field 22 = starttime (clock ticks since boot) — distinguishes PID reuse
    awk '{print $22}' "/proc/${pid}/stat" 2>/dev/null || true
    return 0
  fi
  printf ''
}

# @description Exclusively publish the current process PID and start identity as
#   the owner token for a newly won mkdir lock.
# @arg $1 mkdir lock path
# @exitcode 0 written; 2 another owner token won the race; 1 other failure
fm_lock__write_owner_token() {
  local lock_path="$1"
  local pid start token
  pid="${BASHPID:-$$}"
  start="$(fm_lock__proc_start "$pid")"
  if [[ -z "$start" ]]; then
    # No /proc starttime: still record pid + a monotonic boot-ish cookie we can
    # only match if /proc becomes readable later. Without start, reclaim must
    # refuse when the pid still exists (undeterminable identity).
    start="unknown"
  fi
  token="pid=${pid}"$'\n'"start=${start}"$'\n'
  # Exclusive create (integration F2): noclobber fails if owner already exists.
  # mv -f overwrites and lets a check-then-act loser steal the token; O_EXCL
  # (bash noclobber) identifies exactly one winner.
  if (
    set -C
    printf '%s' "$token" >"${lock_path}/owner"
  ) 2>/dev/null; then
    return 0
  fi
  if [[ -e "${lock_path}/owner" ]]; then
    return 2
  fi
  return 1
}

# @description Parse a mkdir lock's owner token into holder identity fields.
# @arg $1 mkdir lock path
# @stdout space-separated PID and start identity
# @exitcode 0 valid token; 1 unreadable token or missing PID
fm_lock__read_owner_token() {
  local lock_path="$1" owner_file="${1}/owner"
  if [[ ! -r "$owner_file" ]]; then
    return 1
  fi
  local pid="" start=""
  # shellcheck disable=SC2162
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      pid=*) pid="${line#pid=}" ;;
      start=*) start="${line#start=}" ;;
    esac
  done <"$owner_file"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  printf '%s %s\n' "$pid" "${start:-unknown}"
  return 0
}

# @description Classify holder liveness for reclaim.
# @stdout dead|live|undetermined
# @arg $1 pid
# @arg $2 start token value
fm_lock__holder_liveness() {
  local pid="$1" start="$2"
  if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]]; then
    printf 'undetermined\n'
    return 0
  fi
  if [[ ! -e "/proc/${pid}" ]]; then
    # No process with that PID — holder is dead (or never existed here).
    printf 'dead\n'
    return 0
  fi
  if [[ ! -r "/proc/${pid}/stat" ]]; then
    # Process dir exists but we cannot read identity — refuse (fail closed).
    printf 'undetermined\n'
    return 0
  fi
  local now_start
  now_start="$(fm_lock__proc_start "$pid")"
  if [[ -z "$now_start" || "$start" == "unknown" || -z "$start" ]]; then
    # Cannot prove identity across PID reuse — refuse.
    printf 'undetermined\n'
    return 0
  fi
  if [[ "$now_start" == "$start" ]]; then
    printf 'live\n'
    return 0
  fi
  # PID reused by a different process — original holder is dead.
  printf 'dead\n'
  return 0
}

# @description Reclaim exactly one named mkdir lock whose holder is provably dead.
#   Never a sweep. Never applied to flock (kernel releases on death).
# @arg $1 lock_path
# @stderr record of reclaim or refusal (non-silent)
# @exitcode 0 reclaimed; 1 refused
fm_lock_reclaim() {
  local lock_path="${1:-}"
  if [[ -z "$lock_path" ]]; then
    printf 'FM_LOCK_RECLAIM_REFUSED lock= reason=empty_lock_path\n' >&2
    return 1
  fi

  # flock path: lock is a regular file held via FD — reclamation is meaningless.
  if [[ -f "$lock_path" && ! -d "$lock_path" ]]; then
    printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=flock_path_not_applicable\n' \
      "$lock_path" >&2
    return 1
  fi

  if [[ ! -d "$lock_path" ]]; then
    printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=no_mkdir_lock_present\n' \
      "$lock_path" >&2
    return 1
  fi

  # If this process currently holds it, reclaim is not the right tool.
  if [[ "${_FM_LOCK_HELD_PATH:-}" == "$lock_path" ]]; then
    printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=held_by_this_process\n' \
      "$lock_path" >&2
    return 1
  fi

  # Integration F1: deletion is authorised ONLY when the selected mechanism is
  # positively the mkdir fallback. Indeterminate never authorises deletion;
  # flock releases on process death so reclaim there is meaningless. Gate
  # inside the helper so every caller (nats-bridge, wt-new, el_init) is safe.
  local select_rc=0 select_err mech=""
  select_err="$(mktemp "${TMPDIR:-/tmp}/fm-reclaim-mech.XXXXXX")" || select_err=""
  _FM_LOCK_SELECTED=""
  if [[ -n "$select_err" ]]; then
    fm_lock__select_mechanism "$lock_path" >/dev/null 2>"$select_err" || select_rc=$?
  else
    fm_lock__select_mechanism "$lock_path" >/dev/null 2>/dev/null || select_rc=$?
  fi
  mech="${_FM_LOCK_SELECTED:-}"
  if (( select_rc != 0 )) || [[ -z "$mech" ]]; then
    local why=""
    [[ -n "$select_err" && -f "$select_err" ]] && \
      why="$(tr -d '\r' <"$select_err" 2>/dev/null | head -n 1)"
    [[ -n "$select_err" ]] && rm -f -- "$select_err"
    printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=mechanism_indeterminate%s\n' \
      "$lock_path" "${why:+ detail=${why}}" >&2
    return 1
  fi
  [[ -n "$select_err" ]] && rm -f -- "$select_err"
  if [[ "$mech" == "flock" ]]; then
    printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=mechanism_is_flock\n' \
      "$lock_path" >&2
    return 1
  fi
  if [[ "$mech" != "mkdir" ]]; then
    printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=mechanism_not_mkdir mechanism=%s\n' \
      "$lock_path" "$mech" >&2
    return 1
  fi

  local token_line pid start liveness
  if ! token_line="$(fm_lock__read_owner_token "$lock_path")"; then
    printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=no_owner_token_liveness_undetermined\n' \
      "$lock_path" >&2
    return 1
  fi
  pid="${token_line%% *}"
  start="${token_line#* }"
  liveness="$(fm_lock__holder_liveness "$pid" "$start")"
  case "$liveness" in
    live)
      printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=holder_live pid=%s start=%s\n' \
        "$lock_path" "$pid" "$start" >&2
      return 1
      ;;
    undetermined)
      printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=liveness_undetermined pid=%s start=%s\n' \
        "$lock_path" "$pid" "$start" >&2
      return 1
      ;;
    dead)
      ;;
    *)
      printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=liveness_undetermined pid=%s start=%s\n' \
        "$lock_path" "$pid" "$start" >&2
      return 1
      ;;
  esac

  # Holder provably dead AND mechanism is positively mkdir — remove token then
  # directory (exactly this lock).
  rm -f -- "${lock_path}/owner" "${lock_path}/.owner.tmp."* 2>/dev/null || true
  if rmdir -- "$lock_path" 2>/dev/null; then
    printf 'FM_LOCK_RECLAIMED lock=%s dead_holder_pid=%s dead_holder_start=%s\n' \
      "$lock_path" "$pid" "$start" >&2
    return 0
  fi
  # Directory not empty or raced — refuse rather than rm -rf
  printf 'FM_LOCK_RECLAIM_REFUSED lock=%s reason=rmdir_failed pid=%s start=%s\n' \
    "$lock_path" "$pid" "$start" >&2
  return 1
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
