#!/usr/bin/env bash
# Foreman reference-env inventory (Linux / WSL).
# Usage: tool-check.sh [--profile soft|hard|full|durable] [--json] [--out FILE] [--lane grok|codex]
set -euo pipefail

PROFILE="soft"
JSON=0
OUT=""
LANE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --out) OUT="$2"; shift 2 ;;
    --lane) LANE="$2"; shift 2 ;;
    -h|--help)
      echo "usage: tool-check.sh [--profile soft|hard|full|durable] [--json] [--out FILE] [--lane grok|codex]"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$LANE" in
  ""|grok|codex) ;;
  claude)
    echo "unsupported --lane claude: T7 removed claude lane advertising because isolated HOME is unverified" >&2
    exit 2
    ;;
  *) echo "bad lane: $LANE (grok|codex)" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMON_SKILLS_ROOT=""
common_dir="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$common_dir" && -d "$(dirname "$common_dir")/skills" ]]; then
  COMMON_SKILLS_ROOT="$(cd "$(dirname "$common_dir")/skills" && pwd -P)"
fi
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOST="$(hostname 2>/dev/null || echo unknown)"
OS="$(uname -s 2>/dev/null || echo unknown)"
IS_WSL=0
case "${FOREMAN_TEST_WSL_FORCE:-}" in
  1)
    IS_WSL=1
    echo "[foreman] TEST OVERRIDE: FOREMAN_TEST_WSL_FORCE=1 forced WSL detection to wsl=1" >&2
    ;;
  0)
    IS_WSL=0
    echo "[foreman] TEST OVERRIDE: FOREMAN_TEST_WSL_FORCE=0 forced WSL detection to wsl=0" >&2
    ;;
  *) grep -qi microsoft /proc/version 2>/dev/null && IS_WSL=1 ;;
esac

# @description Test whether an executable is available on PATH.
# @arg $1 command executable name to resolve
# @exitcode 0 if the executable is available; nonzero otherwise
have() { command -v "$1" >/dev/null 2>&1; }

# @description Probe whether a vendor CLI is authenticated (not merely present).
#   Uses the non-billing auth-status command determined empirically in Task 0
#   (../openspec/changes/lifecycle-three-stage/auth-probes.md). MUST NOT run a
#   billed model inference (never `grok -p` / `codex exec` / `claude -p`).
#   grok has no exit-code-based auth signal of its own (`grok models` always
#   exits 0) -- its branch greps captured stdout+stderr instead of trusting
#   the exit code, and (Rework Round 1, Opus audit) is BOTH bounded (a
#   network stall must never hang Setup/Use -- this runs on the default
#   tool-check path AND inside every lane-run readiness gate) AND fail-CLOSED
#   (requires a POSITIVE signed-in signal, never "absence of the negative
#   string" alone -- an error banner lacking the exact phrase
#   "not authenticated" must never be misread as READY). codex's own
#   subcommand already distinguishes authenticated/not via a genuine exit-code
#   contract (a real positive signal, not an absence-of-negative shape), so
#   it is left as a plain exit-code check.
# @arg $1 vendor id (grok|codex)
# @exitcode 0 authenticated; 1 not authenticated (or unknown vendor id)
vendor_authed() {
  case "$1" in
    grok)
      local out rc=0 tmo=""
      if have timeout; then tmo="timeout"
      elif have gtimeout; then tmo="gtimeout"
      else
        # No bounded-wait tool resolvable: refuse the unbounded network call
        # rather than risk hanging the caller -- fail closed.
        return 1
      fi
      out="$("$tmo" 10 grok models 2>&1)" || rc=$?
      # Content before exit status. Measured 2026-07-30: `grok models` prints
      # "You are logged in with grok.com." then hangs (rc=124 after timeout,
      # 32 bytes of banner). rc=124 is not decisive on its own — a banner
      # already received is evidence; the process failing to exit afterwards
      # does not retract it. Negative wording still wins over a positive
      # substring. Success binds to artifact content, never to exit code alone.
      if [[ "$out" == *"not authenticated"* || "$out" == *"sign in"* || "$out" == *"log in"* ]]; then
        return 1
      fi
      if [[ "$out" == *"logged in"* ]]; then
        return 0
      fi
      # No positive signal: fall back to exit status / empty output.
      (( rc != 0 )) && return 1
      [[ -z "$out" ]] && return 1
      return 1
      ;;
    codex) codex login status >/dev/null 2>&1 ;;
    *) return 0 ;;
  esac
}

# @description Inspect one known Foreman dependency and emit its availability status and version detail.
# @arg $1 id tool identifier selecting the dependency-specific check
# @arg $2 cmd reserved command field; currently unused by the checks
# @stdout one tab-separated tool, status, and detail row
check_one() {
  local id="$1"
  : "$2"
  local status="missing" detail=""
  case "$id" in
    git)
      if have git; then status=ok; detail="$(git --version 2>&1)"; else status=missing; fi
      ;;
    python3)
      if have python3; then
        detail="$(python3 --version 2>&1)"
        # require 3.11+ for tomllib
        if python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null; then
          status=ok
        else
          status=outdated
          detail="$detail (need >= 3.11)"
        fi
        python3 -c 'import tomllib' 2>/dev/null || { status=outdated; detail="$detail (tomllib missing)"; }
      elif have python; then
        detail="$(python --version 2>&1)"
        status=outdated
      else
        status=missing
      fi
      ;;
    jq)
      if have jq; then status=ok; detail="$(jq --version 2>&1)"; else status=missing; fi
      ;;
    coreutils)
      if have stdbuf; then status=ok; detail="$(stdbuf --version 2>&1 | head -1)"
      elif have gstdbuf; then status=ok; detail="$(gstdbuf --version 2>&1 | head -1)"
      else status=missing; fi
      ;;
    bash)
      if have bash; then status=ok; detail="$(bash --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    nats-server)
      if have nats-server; then status=ok; detail="$(nats-server --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    nats-cli)
      if have nats; then status=ok; detail="$(nats --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    grok)
      if have grok; then
        detail="$(grok --version 2>&1 | head -1)"
        if vendor_authed grok; then status=ok
        else status=not_authenticated; detail="$detail (run: grok login --device-code)"; fi
      else status=missing; fi
      ;;
    codex)
      if have codex; then
        detail="$(codex --version 2>&1 | head -1)"
        if vendor_authed codex; then status=ok
        else status=not_authenticated; detail="$detail (run: codex login)"; fi
      else status=missing; fi
      ;;
    node)
      if have node; then status=ok; detail="$(node --version 2>&1)"; else status=missing; fi
      ;;
    npm)
      if have npm; then status=ok; detail="$(npm --version 2>&1)"; else status=missing; fi
      ;;
    docker)
      if have docker; then
        if docker info >/dev/null 2>&1; then
          status=ok
          detail="$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker --version)"
        else
          status=degraded
          detail="docker binary present but daemon not reachable"
        fi
      else
        status=missing
      fi
      ;;
    shellcheck)
      if have shellcheck; then status=ok; detail="$(shellcheck --version 2>&1 | head -2 | tr '\n' ' ')"; else status=missing; fi
      ;;
    bats)
      if have bats; then
        status=ok; detail="$(bats --version 2>&1)"
      elif [[ -x "$HOME/.foreman/tools/bats-core/bin/bats" ]]; then
        status=ok; detail="$("$HOME"/.foreman/tools/bats-core/bin/bats --version 2>&1)"
      else
        status=missing
      fi
      ;;
    markdownlint-cli2)
      if have markdownlint-cli2; then status=ok; detail="$(markdownlint-cli2 --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    strace)
      # Reported because it is load-bearing, not diagnostic: the syscall
      # evidence class is the only one that can license a lock mechanism as
      # atomic, so on a host whose mkdir is uutils its absence means no
      # trusted mechanism and a fail-closed lock. It was silently absent here
      # and cost 102 test failures before anyone looked for it.
      if have strace; then
        status=ok; detail="$(strace --version 2>&1 | head -1)"
      else
        status=missing; detail="lock atomicity cannot be licensed without it (syscall evidence)"
      fi
      ;;
    codespell)
      if have codespell && codespell --version >/dev/null 2>&1; then
        status=ok; detail="$(codespell --version 2>&1 | head -1)"
      elif have python3 && python3 -m codespell_lib --version >/dev/null 2>&1; then
        status=ok; detail="python3 -m codespell_lib $(python3 -m codespell_lib --version 2>&1 | head -1)"
      elif have python && python -m codespell_lib --version >/dev/null 2>&1; then
        status=ok; detail="python -m codespell_lib $(python -m codespell_lib --version 2>&1 | head -1)"
      else
        status=missing
      fi
      ;;
    bun)
      if have bun; then
        detail="$(bun --version 2>&1 | head -1)"
        if [[ "$detail" == "1.3.14" ]]; then
          status=ok
        else
          status=outdated
          detail="$detail (expected 1.3.14 pin; winget does not self-pin)"
        fi
      else
        status=missing
      fi
      ;;
    pueue)
      # v0.2.7.5 pkg-3 (Task 5): this is the Linux/WSL tool-check -- the
      # fallback staged path here was ".exe"-only (a copy-paste artifact
      # from the Windows-side convention) and could never match the
      # WSL-native ~/.foreman/tools/pueue/pueue binary env/bootstrap-wsl.sh
      # now installs; checks both.
      if have pueue; then
        status=ok; detail="$(pueue --version 2>&1 | head -1)"
      elif [[ -x "$HOME/.foreman/tools/pueue/pueue" ]]; then
        status=ok; detail="$("$HOME/.foreman/tools/pueue/pueue" --version 2>&1 | head -1)"
      elif [[ -x "$HOME/.foreman/tools/pueue/pueue.exe" ]]; then
        status=ok; detail="$("$HOME/.foreman/tools/pueue/pueue.exe" --version 2>&1 | head -1)"
      else
        status=missing
      fi
      ;;
    lychee)
      local LYCHEE_CMD
      LYCHEE_CMD="${LYCHEE:-$(command -v lychee || true)}"
      if [[ -z "$LYCHEE_CMD" && -x "${LOCALAPPDATA:-}/Microsoft/WinGet/Links/lychee.exe" ]]; then
        LYCHEE_CMD="${LOCALAPPDATA:-}/Microsoft/WinGet/Links/lychee.exe"
      fi
      if [[ -z "$LYCHEE_CMD" ]]; then
        # shellcheck disable=SC2012  # Intentional glob over WinGet's package layout.
        LYCHEE_CMD="$(ls "${LOCALAPPDATA:-}"/Microsoft/WinGet/Packages/lycheeverse.lychee*/*/lychee.exe 2>/dev/null | head -1 || true)"
      fi
      if [[ -n "$LYCHEE_CMD" ]] && "$LYCHEE_CMD" --version >/dev/null 2>&1; then
        status=ok; detail="$("$LYCHEE_CMD" --version 2>&1 | head -1)"
      else
        status=missing
      fi
      ;;
    flock)
      if have flock; then status=ok; detail="$(command -v flock)"; else status=missing; fi
      ;;
    gh)
      if have gh; then status=ok; detail="$(gh --version 2>&1 | head -1)"; else status=missing; fi
      ;;
    timeout)
      if have timeout || have gtimeout; then status=ok; detail="$(command -v timeout || command -v gtimeout)"; else status=missing; fi
      ;;
    foreman_skill)
      if [[ -f "${HOME}/.claude/skills/foreman/SKILL.md" ]] || [[ -f "${HOME}/.agents/skills/foreman/SKILL.md" ]] || [[ -f "${HOME}/.grok/skills/foreman/SKILL.md" ]]; then
        status=ok
        detail="skill linked under ~/.claude|agents|grok/skills/foreman"
      elif [[ -f "$ROOT/skills/foreman/SKILL.md" ]]; then
        status=degraded
        detail="repo has skill but not installed to home (run install.sh)"
      else
        status=missing
      fi
      ;;
    foreman-launch)
      # The compiled launcher is what makes a durable lane durable: heartbeats,
      # bounded kill, ownership events. lane_resolve_launcher (lane-run.sh)
      # picks launcher/dist/foreman-launch on POSIX and .exe on Windows.
      #
      # Readiness must NEVER be permanently blocked on a should-tier tool: bun
      # is only should_full (see the should_ lists below), so a host without bun
      # cannot build the launcher and must degrade loudly rather than report
      # NOT-READY forever.
      local fl_root fl_bin fl_suffix
      fl_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
      case "$(uname -s 2>/dev/null || echo unknown)" in
        MINGW*|MSYS*|CYGWIN*) fl_suffix=".exe" ;;
        *) fl_suffix="" ;;
      esac
      fl_bin="${FOREMAN_LAUNCH:-$fl_root/launcher/dist/foreman-launch$fl_suffix}"
      if [[ -x "$fl_bin" ]]; then
        status=ok
        detail="$fl_bin"
      elif have bun; then
        status=missing
        detail="NOT-READY: $fl_bin absent; build it: (cd launcher && bun run build:posix)"
      else
        status=degraded
        detail="DEGRADED: $fl_bin absent and bun is not installed (bun is should-tier); install bun, then run: (cd launcher && bun run build:posix)"
      fi
      ;;
    foreman_home_fs)
      local fh_path fh_probe fh_class
      fh_path="${FOREMAN_HOME:-$HOME/.foreman}"
      fh_probe="$fh_path"
      # Classify nearest existing parent when FOREMAN_HOME is not yet created.
      while [[ ! -e "$fh_probe" && "$fh_probe" != "/" && "$fh_probe" != "." ]]; do
        fh_probe="$(dirname -- "$fh_probe")"
      done
      fh_class="$(fm_tc_fs_class "$fh_probe")"
      case "$fh_class" in
        mnt-drvfs|network)
          status=degraded
          detail="$fh_path class=$fh_class (event log fsync guarantees do not hold on this filesystem)"
          ;;
        *)
          status=ok
          detail="$fh_path class=$fh_class"
          ;;
      esac
      ;;
    *)
      status=unknown
      detail="no checker for $id"
      ;;
  esac
  printf '%s\t%s\t%s\n' "$id" "$status" "$detail"
}

# ---------------------------------------------------------------------------
# Lock-primitive atomicity probe (lock-primitive-hardening T4)
# Deterministic mechanism observation — not a contention sample for atomicity.
# Evidence classes: syscall | pinned-mechanism | contention | flavour
#   syscall, pinned-mechanism → may license atomic | non-atomic
#   contention → non-atomic only
#   flavour → nothing on its own
# Anything that cannot license atomic reports unknown.
# Mechanism-relative interpretation (BRIEF §0):
#   mkdir: mkdir(2)/mkdirat issued AND kernel returned EEXIST to the loser
#   flock: flock(2) LOCK_EX|LOCK_NB issued AND kernel returned EWOULDBLOCK/EAGAIN
# A trace taken for one mechanism licenses nothing for the other.
# ---------------------------------------------------------------------------

# @description Classify the filesystem that owns PATH for lock coverage.
# @arg $1 path (file or directory; parent used if path does not exist yet)
# @stdout one of: local | mnt-drvfs | network | fuse
# @exitcode 0
fm_tc_fs_class() {
  local path="$1" probe="$1" fstype="" target=""
  if [[ ! -e "$probe" ]]; then
    probe="$(dirname -- "$probe")"
  fi
  if [[ ! -e "$probe" ]]; then
    probe="/"
  fi
  # UNC / //server/share
  if [[ "$probe" == //* || "$probe" == \\\\* ]]; then
    printf '%s\n' "network"
    return 0
  fi
  if command -v findmnt >/dev/null 2>&1; then
    # findmnt -T resolves the mount covering PATH
    fstype="$(findmnt -n -o FSTYPE -T "$probe" 2>/dev/null || true)"
    target="$(findmnt -n -o TARGET -T "$probe" 2>/dev/null || true)"
  elif command -v df >/dev/null 2>&1; then
    # df -T: Filesystem Type 1K-blocks Used Available Use% Mounted on
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
  # Windows-hosted mounts under /mnt (DrvFs, 9p, plan9, virtiofs to host)
  if [[ "$probe" == /mnt/* || "$target" == /mnt || "$target" == /mnt/* ]]; then
    case "$fstype" in
      drvfs|9p|plan9|virtiofs|fuse.drvfs|fuse)
        printf '%s\n' "mnt-drvfs"
        return 0
        ;;
    esac
    # WSL /mnt/* is typically host-backed even when type varies
    printf '%s\n' "mnt-drvfs"
    return 0
  fi
  case "$fstype" in
    fuse|fuse.*|fuseblk)
      printf '%s\n' "fuse"
      return 0
      ;;
  esac
  # local fixed volume (ext4, xfs, btrfs, tmpfs, overlay, zfs, ...)
  printf '%s\n' "local"
}

# @description SHA-256 of a resolved binary path.
# @arg $1 absolute path
# @stdout hex digest or empty
fm_tc_sha256() {
  local p="$1"
  if [[ -z "$p" || ! -e "$p" ]]; then
    printf ''
    return 0
  fi
  # Prefer real file (follow symlink once for digest of the executable body)
  local real
  real="$(readlink -f -- "$p" 2>/dev/null || printf '%s' "$p")"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$real" 2>/dev/null | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$real" 2>/dev/null | awk '{print $1}'
  else
    printf ''
  fi
}

# @description First line of --version for a binary (best-effort).
fm_tc_version_line() {
  local bin="$1"
  if [[ -z "$bin" || ! -x "$bin" ]]; then
    printf ''
    return 0
  fi
  "$bin" --version 2>/dev/null | head -n 1 | tr -d '\r' || true
}

# @description Probe mkdir atomicity for one binary on one path's filesystem.
#   Uses strace when available. Contention may only license non-atomic.
# @arg $1 mkdir binary path
# @arg $2 directory in which to create the probe lock (existing dir)
# @stdout tab fields: verdict\tevidence_class\tfs_class\tnotes
fm_tc_probe_mkdir_once() {
  local mkdir_bin="$1" work_parent="$2"
  local fs_class verdict="unknown" evidence="flavour" notes=""
  fs_class="$(fm_tc_fs_class "$work_parent")"

  local work lock target_base="x"
  work="$(mktemp -d --tmpdir="$work_parent" fm-mkdir-probe.XXXXXX 2>/dev/null || mktemp -d "$work_parent/fm-mkdir-probe.XXXXXX")"
  lock="$work/x"
  mkdir -- "$lock" 2>/dev/null || true

  if command -v strace >/dev/null 2>&1; then
    local trace="" trace_file="$work/strace.trace" trace_err="$work/strace.stderr" trace_rc=0
    # Keep strace's syscall channel separate from the tracee's stderr. With -f,
    # merging those streams can interleave and corrupt the target-bound EEXIST
    # line. The tracee is expected to exit nonzero because the lock exists, so
    # a nonzero strace status alone is not a tracer failure.
    if strace -f -e trace=mkdir,mkdirat,statx,stat,newfstatat \
      -o "$trace_file" "$mkdir_bin" -- "$lock" 2>"$trace_err"; then
      trace_rc=0
    else
      trace_rc=$?
    fi
    if [[ -r "$trace_file" ]]; then
      trace="$(<"$trace_file")"
    fi
    # F4: EEXIST must be bound to the probed lock target (not any mkdir in the trace)
    if [[ ! -s "$trace_file" ]]; then
      verdict="unknown"
      evidence="syscall"
      notes="tracer did not run (strace exit=${trace_rc}; no trace output)"
    elif printf '%s\n' "$trace" | grep -qE "mkdir(at)?\([^\n]*/${target_base}[^\n]*\)[[:space:]]*=[[:space:]]*-1[[:space:]]+EEXIST"; then
      verdict="atomic"
      evidence="syscall"
      notes="mkdir(2) on probe target; kernel returned EEXIST"
    elif printf '%s\n' "$trace" | grep -qE 'statx\(' && \
         ! printf '%s\n' "$trace" | grep -qE "mkdir(at)?\([^\n]*/${target_base}[^\n]*\)[[:space:]]*=[[:space:]]*-1[[:space:]]+EEXIST"; then
      if ! printf '%s\n' "$trace" | grep -qE "mkdir(at)?\([^\n]*/${target_base}"; then
        verdict="non-atomic"
        evidence="syscall"
        notes="userspace statx check; no mkdir(2) EEXIST (TOCTOU)"
      else
        verdict="unknown"
        evidence="syscall"
        notes="mkdir syscall observed without clear EEXIST signature on target"
      fi
    else
      verdict="unknown"
      evidence="syscall"
      notes="strace inconclusive for mkdir mechanism"
    fi
  else
    # No tracer: cannot license atomic. Flavour is corroboration only.
    local ver
    ver="$(fm_tc_version_line "$mkdir_bin")"
    if [[ "$ver" == *[Uu]utils* || "$ver" == *uutils* ]]; then
      notes="flavour=uutils (no strace; flavour licenses nothing)"
      evidence="flavour"
      verdict="unknown"
    else
      notes="no strace; flavour alone cannot license"
      evidence="flavour"
      verdict="unknown"
    fi
    # Contention may only license non-atomic
    local total=0
    local B TRACE_F
    B="$(mktemp -d --tmpdir="$work_parent" fm-mkdir-ct.XXXXXX 2>/dev/null || mktemp -d)"
    TRACE_F="$B/t"; : >"$TRACE_F"
    local LOCK="$B/lock"
    for _ in 1 2 3 4 5 6 7 8; do
      (
        local tries=0
        while ! "$mkdir_bin" -- "$LOCK" 2>/dev/null; do
          sleep 0.01
          tries=$((tries + 1))
          [[ $tries -gt 200 ]] && exit 1
        done
        echo ENTER >>"$TRACE_F"
        sleep 0.01
        echo EXIT >>"$TRACE_F"
        rmdir -- "$LOCK" 2>/dev/null || true
      ) &
    done
    wait || true
    total="$(awk '$1=="ENTER"{d++; if(d>1)v++} $1=="EXIT"{d--} END{print (v?v:0)}' "$TRACE_F" 2>/dev/null || echo 0)"
    rm -rf -- "$B"
    if [[ "${total:-0}" -gt 0 ]]; then
      verdict="non-atomic"
      evidence="contention"
      notes="contention observed ${total} mutual-exclusion violations (8 racers)"
    else
      # F11: clean sample records evidence_class=contention (not flavour)
      evidence="contention"
      notes="clean 8-racer sample; contention cannot license atomic (still unknown)"
      verdict="unknown"
    fi
  fi

  rm -rf -- "$work"
  printf '%s\t%s\t%s\t%s\n' "$verdict" "$evidence" "$fs_class" "$notes"
}

# @description Probe flock atomicity: LOCK_EX|LOCK_NB under holder must EAGAIN/EWOULDBLOCK.
# @arg $1 flock binary
# @arg $2 directory for probe file
# @stdout tab: verdict\tevidence_class\tfs_class\tnotes
fm_tc_probe_flock_once() {
  local flock_bin="$1" work_parent="$2"
  local fs_class verdict="unknown" evidence="flavour" notes=""
  fs_class="$(fm_tc_fs_class "$work_parent")"

  if [[ ! -x "$flock_bin" ]]; then
    printf '%s\t%s\t%s\t%s\n' "unknown" "flavour" "$fs_class" "flock binary missing"
    return 0
  fi

  local work lockf marker
  work="$(mktemp -d --tmpdir="$work_parent" fm-flock-probe.XXXXXX 2>/dev/null || mktemp -d)"
  lockf="$work/lockfile"
  marker="$work/holder_ready"
  : >"$lockf"

  if command -v strace >/dev/null 2>&1; then
    # Holder on FD 8; wait until holder actually acquired before tracing loser (F12)
    (
      exec 8>>"$lockf"
      if "$flock_bin" -n 8; then
        printf 'holder_acquired=1\n' >"$marker"
        sleep 2
        exit 0
      fi
      exit 9
    ) &
    local hp=$!
    local w=0
    while [[ ! -f "$marker" && $w -lt 50 ]]; do
      sleep 0.05
      w=$((w + 1))
    done
    local trace
    if [[ ! -f "$marker" ]]; then
      kill "$hp" 2>/dev/null || true
      wait "$hp" 2>/dev/null || true
      verdict="unknown"
      evidence="syscall"
      notes="holder did not proceed; cannot license flock atomicity"
    else
      trace="$(strace -e trace=flock,fcntl "$flock_bin" -n 9 9>>"$lockf" 2>&1 || true)"
      wait "$hp" 2>/dev/null || true
      # F3: LOCK_EX|LOCK_NB only (not LOCK_SH; no bare-EAGAIN fallback)
      if printf '%s\n' "$trace" | grep -qE 'flock\([^)]*LOCK_EX[^)]*LOCK_NB[^)]*\)[[:space:]]*=[[:space:]]*-1[[:space:]]+(EAGAIN|EWOULDBLOCK)' || \
         printf '%s\n' "$trace" | grep -qE 'flock\([^)]*LOCK_NB[^)]*LOCK_EX[^)]*\)[[:space:]]*=[[:space:]]*-1[[:space:]]+(EAGAIN|EWOULDBLOCK)'; then
        verdict="atomic"
        evidence="syscall"
        notes="flock(2) LOCK_EX|LOCK_NB; kernel returned EWOULDBLOCK/EAGAIN to loser; holder proceeded"
      elif printf '%s\n' "$trace" | grep -qE 'flock\('; then
        verdict="unknown"
        evidence="syscall"
        notes="flock syscall observed without LOCK_EX|LOCK_NB EAGAIN/EWOULDBLOCK"
      else
        verdict="unknown"
        evidence="syscall"
        notes="strace inconclusive for flock mechanism"
      fi
    fi
  else
    verdict="unknown"
    evidence="flavour"
    notes="no strace; flock flavour alone cannot license atomic"
  fi

  rm -rf -- "$work"
  printf '%s\t%s\t%s\t%s\n' "$verdict" "$evidence" "$fs_class" "$notes"
}

# @description Run mkdir + flock probes across local probe roots; fill LOCK_ATOMICITY_ROWS.
# Each row: mechanism\tpath\tversion\tsha256\tverdict\tevidence_class\tfs_classes_csv\ttimestamp\tnotes
LOCK_ATOMICITY_ROWS=()
LOCK_ATOMICITY_INFO=()
LOCK_ATOMICITY_TRUSTED_ATOMIC=0


# @description Host class for pin matching (mirrors lock.sh).
fm_tc_host_class() {
  if [[ -n "${FOREMAN_LOCK_HOST_CLASS:-}" ]]; then
    printf '%s\n' "${FOREMAN_LOCK_HOST_CLASS}"
    return 0
  fi
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*) printf '%s\n' "msys2-git-bash"; return 0 ;;
  esac
  if [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]] || \
     grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    printf '%s\n' "wsl-linux"
    return 0
  fi
  printf '%s\n' "linux-native"
}

# @description Look up pinned register for mechanism+sha; validate trace.
# @stdout verdict\tfs_csv  or empty
fm_tc_pinned_lookup() {
  local mech="$1" sha="$2"
  local manifest="${FOREMAN_LOCK_MANIFEST:-$ROOT/env/reference-manifest.toml}"
  local host_now
  host_now="$(fm_tc_host_class)"
  [[ -n "$sha" && -r "$manifest" ]] || return 0
  python3 -c '
import sys, os
try:
  import tomllib
except ImportError:
  try:
    import tomli as tomllib
  except ImportError:
    raise SystemExit(0)
manifest,mech,sha,host_now,root=sys.argv[1:6]
try:
  data=tomllib.load(open(manifest,"rb"))
except Exception:
  raise SystemExit(0)
la=data.get("lock_atomicity") or {}
pinned=la.get("pinned") or [] if isinstance(la,dict) else []
for entry in pinned:
  if not isinstance(entry,dict):
    continue
  if (entry.get("mechanism") or "")!=mech: continue
  if (entry.get("sha256") or "").lower()!=sha.lower(): continue
  hc=(entry.get("host_class") or "").strip()
  if not hc or hc!=host_now: raise SystemExit(0)
  trace=(entry.get("trace_artifact") or "").strip()
  if not trace: raise SystemExit(0)
  verdict=(entry.get("verdict") or "").strip()
  if verdict not in ("atomic","non-atomic"): raise SystemExit(0)
  classes=entry.get("filesystem_classes") or []
  # resolve trace
  candidates=[trace, os.path.join(root,trace)]
  path=None
  for c in candidates:
    if c and os.path.isfile(c) and os.path.getsize(c)>0:
      path=c; break
  if not path: raise SystemExit(0)
  content=open(path,encoding="utf-8",errors="replace").read()
  ok=False
  if mech=="mkdir":
    import re
    # Integration F3: EEXIST must be bound to the pin probe_target.
    probe=(entry.get("probe_target") or entry.get("probe_path") or "").strip()
    if not probe:
      raise SystemExit(0)
    frag=re.escape(probe)
    if re.search(r"mkdir(at)?\([^\n]*"+frag+r"[^\n]*\)\s*=\s*-1\s+EEXIST", content):
      ok=True
    elif re.search(r"mkdir(at)?\([^\n]*"+frag+r"[^\n]*\).*(EEXIST|ERROR_ALREADY_EXISTS)", content):
      ok=True
  elif mech=="flock":
    import re
    loser=bool(re.search(r"flock\([^)]*LOCK_EX[^)]*LOCK_NB[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)", content) or
               re.search(r"flock\([^)]*LOCK_NB[^)]*LOCK_EX[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)", content))
    holder=bool(re.search(r"flock\([^)]*LOCK_EX[^)]*\)\s*=\s*0", content) or "holder_acquired=1" in content or "HOLDER_PROCEEDED" in content)
    ok=loser and holder
  if not ok: raise SystemExit(0)
  print(verdict + "\t" + ",".join(classes))
  raise SystemExit(0)
' "$manifest" "$mech" "$sha" "$host_now" "$ROOT" 2>/dev/null || true
}

# @description Probe mkdir and flock atomicity across distinct writable filesystem classes, record the evidence rows, and fail durable-profile readiness closed when no trusted atomic mechanism is found.
fm_tc_run_atomicity_probes() {
  LOCK_ATOMICITY_ROWS=()
  LOCK_ATOMICITY_INFO=()
  LOCK_ATOMICITY_TRUSTED_ATOMIC=0
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Probe roots: prefer distinct filesystem classes when reachable.
  local roots=()
  local r
  for r in "${TMPDIR:-/tmp}" /tmp "${HOME:-/root}" /var/tmp; do
    [[ -d "$r" && -w "$r" ]] || continue
    local seen=0 existing
    for existing in "${roots[@]+"${roots[@]}"}"; do
      if [[ "$(fm_tc_fs_class "$existing")" == "$(fm_tc_fs_class "$r")" && \
            "$(findmnt -n -o TARGET -T "$existing" 2>/dev/null || echo "$existing")" == \
            "$(findmnt -n -o TARGET -T "$r" 2>/dev/null || echo "$r")" ]]; then
        seen=1
        break
      fi
    done
    if (( seen == 0 )); then
      roots+=("$r")
    fi
  done
  if (( ${#roots[@]} == 0 )); then
    roots=(/tmp)
  fi

  # --- mkdir ---
  local mkdir_bin=""
  if have mkdir; then
    mkdir_bin="$(command -v mkdir)"
    mkdir_bin="$(readlink -f -- "$mkdir_bin" 2>/dev/null || printf '%s' "$mkdir_bin")"
  fi
  if [[ -n "$mkdir_bin" ]]; then
    local ver sha best_verdict="unknown" best_evidence="flavour" notes_acc=()
    # F2: coverage is the set of classes that themselves earned the chosen verdict
    local -A class_verdict=()
    ver="$(fm_tc_version_line "$(command -v mkdir)")"
    sha="$(fm_tc_sha256 "$mkdir_bin")"
    for r in "${roots[@]}"; do
      local line v e c n rest
      line="$(fm_tc_probe_mkdir_once "$(command -v mkdir)" "$r")"
      v="${line%%$'\t'*}"; rest="${line#*$'\t'}"
      e="${rest%%$'\t'*}"; rest="${rest#*$'\t'}"
      c="${rest%%$'\t'*}"; n="${rest#*$'\t'}"
      class_verdict["$c"]="$v"
      notes_acc+=("$c:$n")
      case "$v" in
        non-atomic)
          best_verdict="non-atomic"
          best_evidence="$e"
          ;;
        atomic)
          if [[ "$best_verdict" != "non-atomic" ]]; then
            best_verdict="atomic"
            best_evidence="$e"
          fi
          ;;
        *)
          # F11: keep the probe's evidence class (contention/syscall), not flavour default
          if [[ "$best_verdict" == "unknown" && "$e" != "flavour" ]]; then
            best_evidence="$e"
          fi
          ;;
      esac
    done
    # Pin may promote (F5) when probe could not license atomic
    if [[ "$best_verdict" != "atomic" && "$best_verdict" != "non-atomic" ]]; then
      local pin_line pin_v pin_fs
      pin_line="$(fm_tc_pinned_lookup mkdir "$sha")"
      if [[ -n "$pin_line" ]]; then
        pin_v="${pin_line%%$'\t'*}"
        pin_fs="${pin_line#*$'\t'}"
        if [[ "$pin_v" == "atomic" || "$pin_v" == "non-atomic" ]]; then
          best_verdict="$pin_v"
          best_evidence="pinned-mechanism"
          # coverage = classes named by the pin
          local IFS=',' _pc
          for _pc in $pin_fs; do
            class_verdict["$_pc"]="$pin_v"
          done
          notes_acc+=("pin:${pin_v}")
        fi
      fi
    fi
    # F2: only classes whose own result matches best_verdict are licensed
    local fs_csv="" cl
    for cl in local mnt-drvfs network fuse; do
      if [[ "${class_verdict[$cl]:-}" == "$best_verdict" ]]; then
        [[ -n "$fs_csv" ]] && fs_csv+=","
        fs_csv+="$cl"
      fi
    done
    local note_join
    note_join="$(IFS='; '; printf '%s' "${notes_acc[*]}")"
    LOCK_ATOMICITY_ROWS+=("$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
      "mkdir" "$mkdir_bin" "$ver" "$sha" "$best_verdict" "$best_evidence" "$fs_csv" "$ts" "$note_join")")
    if [[ "$best_verdict" == "atomic" && ( "$best_evidence" == "syscall" || "$best_evidence" == "pinned-mechanism" ) ]]; then
      LOCK_ATOMICITY_TRUSTED_ATOMIC=1
    fi
    if [[ "$best_verdict" == "non-atomic" ]]; then
      LOCK_ATOMICITY_INFO+=("mkdir: non-atomic ($best_evidence) path=$mkdir_bin")
    fi
  fi

  # --- flock ---
  local flock_bin=""
  if have flock; then
    flock_bin="$(command -v flock)"
    flock_bin="$(readlink -f -- "$flock_bin" 2>/dev/null || printf '%s' "$flock_bin")"
  fi
  if [[ -n "$flock_bin" ]]; then
    local ver sha best_verdict="unknown" best_evidence="flavour" notes_acc=()
    local -A class_verdict=()
    ver="flock $(flock --version 2>/dev/null | head -n1 | tr -d '\r' || true)"
    if [[ -z "${ver//flock /}" || "$ver" == "flock " ]]; then
      ver="flock:$(command -v flock)"
    fi
    sha="$(fm_tc_sha256 "$flock_bin")"
    for r in "${roots[@]}"; do
      local line v e c n rest
      line="$(fm_tc_probe_flock_once "$(command -v flock)" "$r")"
      v="${line%%$'\t'*}"; rest="${line#*$'\t'}"
      e="${rest%%$'\t'*}"; rest="${rest#*$'\t'}"
      c="${rest%%$'\t'*}"; n="${rest#*$'\t'}"
      class_verdict["$c"]="$v"
      notes_acc+=("$c:$n")
      case "$v" in
        non-atomic)
          best_verdict="non-atomic"
          best_evidence="$e"
          ;;
        atomic)
          if [[ "$best_verdict" != "non-atomic" ]]; then
            best_verdict="atomic"
            best_evidence="$e"
          fi
          ;;
        *)
          if [[ "$best_verdict" == "unknown" && "$e" != "flavour" ]]; then
            best_evidence="$e"
          fi
          ;;
      esac
    done
    if [[ "$best_verdict" != "atomic" && "$best_verdict" != "non-atomic" ]]; then
      local pin_line pin_v pin_fs
      pin_line="$(fm_tc_pinned_lookup flock "$sha")"
      if [[ -n "$pin_line" ]]; then
        pin_v="${pin_line%%$'\t'*}"
        pin_fs="${pin_line#*$'\t'}"
        if [[ "$pin_v" == "atomic" || "$pin_v" == "non-atomic" ]]; then
          best_verdict="$pin_v"
          best_evidence="pinned-mechanism"
          local IFS=',' _pc
          for _pc in $pin_fs; do
            class_verdict["$_pc"]="$pin_v"
          done
          notes_acc+=("pin:${pin_v}")
        fi
      fi
    fi
    local fs_csv="" cl
    for cl in local mnt-drvfs network fuse; do
      if [[ "${class_verdict[$cl]:-}" == "$best_verdict" ]]; then
        [[ -n "$fs_csv" ]] && fs_csv+=","
        fs_csv+="$cl"
      fi
    done
    local note_join
    note_join="$(IFS='; '; printf '%s' "${notes_acc[*]}")"
    LOCK_ATOMICITY_ROWS+=("$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
      "flock" "$flock_bin" "$ver" "$sha" "$best_verdict" "$best_evidence" "$fs_csv" "$ts" "$note_join")")
    if [[ "$best_verdict" == "atomic" && ( "$best_evidence" == "syscall" || "$best_evidence" == "pinned-mechanism" ) ]]; then
      LOCK_ATOMICITY_TRUSTED_ATOMIC=1
    fi
  else
    LOCK_ATOMICITY_ROWS+=("$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
      "flock" "" "" "" "unknown" "flavour" "" "$ts" "flock not on PATH")")
  fi

  # Ready impact: INFO when mkdir non-atomic but flock trusted; NOT-READY when none trusted
  if (( LOCK_ATOMICITY_TRUSTED_ATOMIC == 0 )); then
    # Only force NOT-READY for durable (or when flock is a must and failed trust)
    case "$PROFILE" in
      durable)
        must_fail+=("lock_atomicity:no_trusted_atomic_mechanism")
        READY=0
        ;;
    esac
  fi
}

# profile membership
# strace is `must` on every POSIX profile, matching required = true in
# env/reference-manifest.toml. It is not a diagnostic: the syscall evidence
# class is the ONLY one that can license a lock mechanism as atomic -- flavour
# licenses nothing and contention can license only non-atomic or unknown -- so
# on ANY host without it no mechanism earns trust and lib/lock.sh fail-closes
# every durable lock. Grading it `should` was a hedge: it let a host report
# READY: yes and then fail 102 tests on refusals that had nothing to do with
# the code under test.
must_soft=(git python3 grok codex strace foreman_skill)
must_hard=(git python3 jq docker flock strace foreman_skill)
# The gate tooling is `must` on full and nowhere else. reference-manifest.toml
# marks bats, markdownlint-cli2, codespell and lychee required = true, and full
# is the profile that runs the gates -- a development host missing them cannot
# run the suite or the docs gate, which is a NOT-READY condition, not a note.
# They are deliberately absent from soft: a host that only drives lanes has no
# use for a docs linter.
must_full=(git python3 jq grok codex docker flock strace bats markdownlint-cli2 codespell lychee foreman_skill)
must_durable=(git jq coreutils bash flock strace)
should_soft=(node npm jq foreman_home_fs)
should_hard=(shellcheck bats gh timeout grok codex foreman_home_fs)
should_full=(node npm shellcheck gh timeout bun pueue foreman_home_fs)
should_durable=(nats-server nats-cli foreman_home_fs)
if (( IS_WSL )); then
  should_soft+=(foreman-launch)
  should_hard+=(foreman-launch)
  should_full+=(foreman-launch)
  should_durable+=(foreman-launch)
fi

case "$PROFILE" in
  soft) must=("${must_soft[@]}"); should=("${should_soft[@]}") ;;
  hard) must=("${must_hard[@]}"); should=("${should_hard[@]}") ;;
  full) must=("${must_full[@]}"); should=("${should_full[@]}") ;;
  durable) must=("${must_durable[@]}"); should=("${should_durable[@]}") ;;
  *) echo "bad profile: $PROFILE" >&2; exit 2 ;;
esac

declare -A SEEN=()
ROWS=()
for id in "${must[@]}" "${should[@]}"; do
  [[ -n "${SEEN[$id]:-}" ]] && continue
  SEEN[$id]=1
  ROWS+=("$(check_one "$id" "")")
done

SKILL_IDS=(foreman scrapling graphify superpowers)
SKILL_ROWS=()
for id in "${SKILL_IDS[@]}"; do
  skill_path="${HOME}/.claude/skills/$id"
  repo_skill_path="$(cd "$ROOT/skills/$id" && pwd -P)"
  if [[ -L "$skill_path" ]]; then
    link_target="$(readlink "$skill_path")"
    if [[ "$link_target" != /* ]]; then
      link_target="$(dirname "$skill_path")/$link_target"
    fi
    if [[ -d "$link_target" ]]; then
      link_target="$(cd "$link_target" && pwd -P)"
    fi
    if [[ "$link_target" == "$repo_skill_path" || ( -n "$COMMON_SKILLS_ROOT" && "$link_target" == "$COMMON_SKILLS_ROOT/$id" ) ]]; then
      SKILL_ROWS+=("$(printf '%s\tok\tlinked at ~/.claude/skills/%s' "$id" "$id")")
    else
      SKILL_ROWS+=("$(printf '%s\twarn\tpresent but not linked to repo' "$id")")
    fi
  elif [[ -e "$skill_path" ]]; then
    SKILL_ROWS+=("$(printf '%s\twarn\tpresent but not linked to repo' "$id")")
  else
    SKILL_ROWS+=("$(printf '%s\tmissing\tnot linked at ~/.claude/skills/%s' "$id" "$id")")
  fi
done

missing=()
outdated=()
degraded=()
not_auth=()
ok_n=0
for row in "${ROWS[@]}"; do
  id="${row%%$'\t'*}"
  rest="${row#*$'\t'}"
  st="${rest%%$'\t'*}"
  case "$st" in
    ok) ok_n=$((ok_n+1)) ;;
    missing) missing+=("$id") ;;
    outdated) outdated+=("$id") ;;
    degraded) degraded+=("$id") ;;
    not_authenticated) not_auth+=("$id") ;;
  esac
done

# must failures
must_fail=()
for id in "${must[@]}"; do
  for row in "${ROWS[@]}"; do
    rid="${row%%$'\t'*}"
    [[ "$rid" == "$id" ]] || continue
    rest="${row#*$'\t'}"
    st="${rest%%$'\t'*}"
    if [[ "$st" != "ok" ]]; then must_fail+=("$id:$st"); fi
  done
done

# On WSL hard/full, a missing launcher is a blocking Setup deliverable only
# when bun is present and can build it. If bun is absent, check_one reports a
# loud degraded row instead so a should-tier builder can never permanently
# block readiness.
if (( IS_WSL )) && [[ "$PROFILE" == "hard" || "$PROFILE" == "full" ]]; then
  for row in "${ROWS[@]}"; do
    id="${row%%$'\t'*}"
    [[ "$id" == "foreman-launch" ]] || continue
    rest="${row#*$'\t'}"
    st="${rest%%$'\t'*}"
    if [[ "$st" == "missing" ]]; then
      must_fail+=("foreman-launch:missing")
    fi
  done
fi

READY=0
[[ ${#must_fail[@]} -eq 0 ]] && READY=1

# Atomicity probes (T4). Populates LOCK_ATOMICITY_ROWS for inventory JSON.
# May append must_fail for durable when no trusted atomic mechanism exists.
fm_tc_run_atomicity_probes
# Recompute READY after probe may have extended must_fail
READY=0
[[ ${#must_fail[@]} -eq 0 ]] && READY=1
# INFO line when mkdir is non-atomic but flock earned trusted atomic
_mkdir_non_atomic=0
_flock_trusted=0
for _ar in "${LOCK_ATOMICITY_ROWS[@]+"${LOCK_ATOMICITY_ROWS[@]}"}"; do
  _amid="${_ar%%$'\t'*}"
  _arest="${_ar#*$'\t'}"
  # path version sha256 verdict evidence fs ts notes
  _p="${_arest%%$'\t'*}"; _arest="${_arest#*$'\t'}"
  _v="${_arest%%$'\t'*}"; _arest="${_arest#*$'\t'}"
  _s="${_arest%%$'\t'*}"; _arest="${_arest#*$'\t'}"
  _verdict="${_arest%%$'\t'*}"; _arest="${_arest#*$'\t'}"
  _ev="${_arest%%$'\t'*}"
  if [[ "$_amid" == "mkdir" && "$_verdict" == "non-atomic" ]]; then
    _mkdir_non_atomic=1
  fi
  if [[ "$_amid" == "flock" && "$_verdict" == "atomic" && ( "$_ev" == "syscall" || "$_ev" == "pinned-mechanism" ) ]]; then
    _flock_trusted=1
  fi
done
if (( _mkdir_non_atomic && _flock_trusted )); then
  LOCK_ATOMICITY_INFO+=("INFO: mkdir non-atomic but flock present and trusted for probed filesystem class(es) — durable locks use flock")
fi
if (( LOCK_ATOMICITY_TRUSTED_ATOMIC == 0 )); then
  LOCK_ATOMICITY_INFO+=("NOT-READY risk: no lock mechanism earned a trusted atomic verdict on this host")
fi


# @description Render the collected tool inventory and profile readiness guidance as a human-readable report.
# @stdout the formatted Foreman tool-check report
report_text() {
  echo "FOREMAN TOOL CHECK"
  echo "profile: $PROFILE"
  echo "host: $HOST  os: $OS  wsl: $IS_WSL"
  echo "time: $NOW"
  echo "repo: $ROOT"
  echo "---"
  printf '%-16s %-10s %s\n' "TOOL" "STATUS" "DETAIL"
  for row in "${ROWS[@]}"; do
    id="${row%%$'\t'*}"
    rest="${row#*$'\t'}"
    st="${rest%%$'\t'*}"
    det="${rest#*$'\t'}"
    printf '%-16s %-10s %s\n' "$id" "$st" "$det"
  done
  docs_group=()
  for did in markdownlint-cli2 codespell lychee; do
    for row in "${ROWS[@]}"; do
      [[ "${row%%$'\t'*}" == "$did" ]] || continue
      drest="${row#*$'\t'}"
      docs_group+=("$did:${drest%%$'\t'*}")
    done
  done
  [[ ${#docs_group[@]} -gt 0 ]] && echo "DOCS_GROUP: ${docs_group[*]}"
  echo "---"
  echo "LOCK_ATOMICITY"
  printf '%-8s %-10s %-16s %-12s %s\n' "MECH" "VERDICT" "EVIDENCE" "FS_CLASSES" "PATH"
  for row in "${LOCK_ATOMICITY_ROWS[@]+"${LOCK_ATOMICITY_ROWS[@]}"}"; do
    mid="${row%%$'\t'*}"
    rest="${row#*$'\t'}"
    path="${rest%%$'\t'*}"; rest="${rest#*$'\t'}"
    ver="${rest%%$'\t'*}"; rest="${rest#*$'\t'}"
    sha="${rest%%$'\t'*}"; rest="${rest#*$'\t'}"
    verdict="${rest%%$'\t'*}"; rest="${rest#*$'\t'}"
    ev="${rest%%$'\t'*}"; rest="${rest#*$'\t'}"
    fsc="${rest%%$'\t'*}"; rest="${rest#*$'\t'}"
    printf '%-8s %-10s %-16s %-12s %s\n' "$mid" "$verdict" "$ev" "$fsc" "$path"
    if [[ -n "$sha" ]]; then
      printf '  sha256=%s\n' "$sha"
    fi
    if [[ -n "$ver" ]]; then
      printf '  version=%s\n' "$ver"
    fi
  done
  for info in "${LOCK_ATOMICITY_INFO[@]+"${LOCK_ATOMICITY_INFO[@]}"}"; do
    echo "$info"
  done
  echo "---"
  echo "SKILLS"

  printf '%-16s %-10s %s\n' "SKILL" "STATUS" "DETAIL"
  for row in "${SKILL_ROWS[@]}"; do
    id="${row%%$'\t'*}"
    rest="${row#*$'\t'}"
    st="${rest%%$'\t'*}"
    det="${rest#*$'\t'}"
    printf '%-16s %-10s %s\n' "$id" "$st" "$det"
  done
  echo "---"
  if [[ $READY -eq 1 ]]; then
    echo "READY: yes — profile '$PROFILE' must-tools are OK"
  else
    echo "READY: no — fix must-tools before implementation work"
    echo "MUST_FAIL: ${must_fail[*]}"
  fi
  [[ ${#missing[@]} -gt 0 ]] && echo "MISSING: ${missing[*]}"
  [[ ${#outdated[@]} -gt 0 ]] && echo "OUTDATED: ${outdated[*]}"
  [[ ${#degraded[@]} -gt 0 ]] && echo "DEGRADED: ${degraded[*]}"
  [[ ${#not_auth[@]} -gt 0 ]] && echo "NOT_AUTHENTICATED: ${not_auth[*]}"
  if [[ -n "$LANE" ]]; then
    lane_st=""
    for row in "${ROWS[@]}"; do
      id="${row%%$'\t'*}"
      [[ "$id" == "$LANE" ]] || continue
      rest="${row#*$'\t'}"
      lane_st="${rest%%$'\t'*}"
    done
    if [[ "$lane_st" == "ok" ]]; then
      echo "LANE_READY: ${LANE}=yes"
    else
      echo "LANE_READY: ${LANE}=no"
    fi
  fi
  echo "---"
  echo "NEXT:"
  if [[ $READY -eq 0 ]]; then
    echo "  bash env/bootstrap-wsl.sh --profile $PROFILE"
    echo "  # then re-run: bash env/tool-check.sh --profile $PROFILE"
  else
    echo "  proceed with /foreman soft or hard implementation"
  fi
}

# @description Serialize the collected tool inventory and readiness state using the Foreman tool-check JSON schema.
# @stdout the formatted JSON tool-check report
report_json() {
  # Serialize lock atomicity rows as JSON-ready lines (tab-separated → python)
  local atomic_args=()
  local row
  for row in "${LOCK_ATOMICITY_ROWS[@]+"${LOCK_ATOMICITY_ROWS[@]}"}"; do
    atomic_args+=("$row")
  done
  python3 - "$PROFILE" "$HOST" "$OS" "$IS_WSL" "$NOW" "$ROOT" "$READY" "$LANE" \
    "${ROWS[@]}" --skills-- "${SKILL_ROWS[@]}" --atomic-- "${atomic_args[@]+"${atomic_args[@]}"}" <<'PY'
import json, sys
profile, host, os_, is_wsl, now, root, ready, lane = sys.argv[1:9]
rows = sys.argv[9:]
skill_marker = rows.index("--skills--")
atomic_marker = rows.index("--atomic--")
skill_rows = rows[skill_marker + 1:atomic_marker]
atomic_rows = rows[atomic_marker + 1:]
rows = rows[:skill_marker]

def parse_rows(items):
    parsed = []
    for row in items:
        parts = row.split("\t", 2)
        tid = parts[0]
        st = parts[1] if len(parts) > 1 else "unknown"
        det = parts[2] if len(parts) > 2 else ""
        parsed.append({"id": tid, "status": st, "detail": det})
    return parsed

def parse_atomic(items):
    out = []
    for row in items:
        parts = row.split("\t")
        # mechanism path version sha256 verdict evidence fs_csv timestamp notes
        while len(parts) < 9:
            parts.append("")
        mech, path, version, sha, verdict, evidence, fs_csv, ts, notes = parts[:9]
        fs_classes = [c for c in fs_csv.split(",") if c]
        out.append({
            "mechanism": mech,
            "path": path,
            "version": version,
            "sha256": sha,
            "verdict": verdict,
            "evidence_class": evidence,
            "filesystem_classes": fs_classes,
            "timestamp": ts,
            "notes": notes,
        })
    return out

tools = parse_rows(rows)
skills = parse_rows(skill_rows)
lock_atomicity = parse_atomic(atomic_rows)
out = {
    "schema": "foreman.tool-check.v1",
    "profile": profile,
    "ready": ready == "1",
    "host": host,
    "os": os_,
    "wsl": is_wsl == "1",
    "time": now,
    "repo": root,
    "tools": tools,
    "skills": skills,
    "lock_atomicity": lock_atomicity,
    "missing": [t["id"] for t in tools if t["status"] == "missing"],
    "outdated": [t["id"] for t in tools if t["status"] == "outdated"],
    "degraded": [t["id"] for t in tools if t["status"] == "degraded"],
    "not_authenticated": [t["id"] for t in tools if t["status"] == "not_authenticated"],
}
if lane:
    out["lane"] = lane
    out["lane_ready"] = any(t["id"] == lane and t["status"] == "ok" for t in tools)
print(json.dumps(out, indent=2))
PY
}

if [[ $JSON -eq 1 ]]; then
  BODY="$(report_json)"
else
  BODY="$(report_text)"
fi

echo "$BODY"
if [[ -n "$OUT" ]]; then
  mkdir -p "$(dirname "$OUT")"
  printf '%s\n' "$BODY" > "$OUT"
  echo "[tool-check] wrote $OUT" >&2
fi

exit $((1 - READY))
