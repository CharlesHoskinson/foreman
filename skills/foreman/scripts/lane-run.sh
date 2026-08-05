#!/usr/bin/env bash
# @description Run a coding-CLI lane with durable-lanes instrumentation: tee the
#   reasoning stream to disk, checkpoint the worktree, and emit lifecycle events
#   (prompt, heartbeat, checkpoint, ownership, round_done, waiting_child). Stderr
#   is joined into the transcript via 2>&1 because coding CLIs emit reasoning
#   there.
#
# CONTRACT (Rework Round 3, finding 1): CMD MUST be non-interactive. lane-run.sh
#   redirects CMD's own stdin from /dev/null (CMD only -- never lane-run.sh's own
#   stdin). This is a structural, not best-effort, fix: job control (`set -m`)
#   and the separate-process-group launch it required have been REMOVED
#   entirely, so there is no path left where CMD can be stopped as a background
#   job competing for the controlling terminal (the SIGTTIN/TTY hazard class).
#   CMD now shares lane-run.sh's own process group; since CMD never reads its
#   controlling terminal (stdin is /dev/null), it never contends for terminal
#   foreground ownership in the first place -- there is nothing left to detect
#   or fall back from. Do not re-add `set -m` / job control: see bugeventlog.md
#   and FOREMAN_REPORT.md (Rework Round 3, finding 1) for why this was a dead
#   end on Git Bash/MSYS2.
#
# CONTRACT (T2, v0.2.5 round ownership): when foreman-launch is resolvable
#   (lane_resolve_launcher: FOREMAN_LAUNCH env override > launcher/dist/
#   foreman-launch(.exe) relative to THIS script's own repo root > PATH lookup
#   > absent), CMD is spawned THROUGH it instead of directly. The variable that
#   tracks the spawned pid is renamed accordingly in that branch --
#   `launcher_pid` (the supervisor's own pid) instead of `cmd_pid` (CMD's own
#   pid, used only on the launcher-ABSENT path, unchanged/frozen) -- because
#   what lane-run.sh now waits on IS the launcher, not CMD directly.
#   `round_done.exit_code` is therefore the observed rc of whichever was
#   waited on: CMD's own code (launcher-absent, or launcher-present passthrough),
#   or the launcher's own 124 (timeout kill) / 125 (launcher error) codes.
#   `exit_source` (child|timeout|launcher) disambiguates which; it is added to
#   the round_done payload ONLY on the launcher-present path (omitted, not
#   false/null, on the frozen launcher-absent path -- see lane_exit_source).
#   NTSTATUS CAVEAT (T1 audit F3): on Windows, a child dying with an NTSTATUS
#   code (e.g. 0xC0000005) surfaces byte-masked through the launcher as a
#   small-looking exit code -- round_done.exit_code can therefore collide with
#   a legitimate small exit code in that case. This is a known, accepted
#   ambiguity (documented here per spec, NOT un-masked -- there is no reliable
#   way to recover the original NTSTATUS from a masked byte).
#   The kill_cmd_bounded + taskkill //T //F descendant sweep is GATED to the
#   launcher-ABSENT branch only (see cleanup()): Job Object KILL_ON_JOB_CLOSE
#   supersedes it on Windows. On the launcher-PRESENT branch, INT/TERM are
#   forwarded by killing the launcher process instead (kill_launcher_bounded),
#   which cascades the whole tree via the job (Windows) -- trap exit codes
#   130/143 are unchanged either way.
#   POSIX CAVEAT (launcher/README.md "POSIX asymmetry"): POSIX has NO kernel
#   cascade equivalent to KILL_ON_JOB_CLOSE -- killing launcher_pid alone
#   leaves CMD's whole process group alive. kill_launcher_bounded's POSIX
#   branch therefore ALSO signals `-pid` (the negative pid = process group,
#   using the child pid recorded in the ownership heartbeat, which equals its
#   own pgid since the launcher wraps CMD in setsid), not launcher_pid alone.
#   `--round GATE_CMD REPORT_PATH` mode makes lane-run.sh own the WHOLE round
#   (CMD -> gate -> attempt-fresh report assert -> round_done), never the
#   agent's own turn -- see the ROUND_MODE block near the end of this file.
#   STDBUF CAVEAT (Rework Round 2, architect-diagnosed): the launcher-PRESENT
#   branch NEVER prefixes the launcher with $STDBUF (unlike the
#   launcher-ABSENT branch, where it still applies and still matters).
#   Wrapping the native launcher exe in stdbuf poisons CMD's own MSYS bash
#   via an LD_PRELOAD value MSYS silently rewrites to Windows form at the
#   exec boundary, which CMD's bash then mis-parses and dies loading "C:" as
#   a shared object -- CMD's real stdout is lost while lane-run.sh's own
#   exit code still reads 0. See the CMD-launch site's own comment for the
#   full repro and the `env -u LD_PRELOAD` defense-in-depth.
#
# CONTRACT (T5a, v0.2.5 vendor config isolation plumbing): env contract
#   `LANE_VENDOR=grok|codex` + optional `LANE_CONFIG_DIR=<abs path>`
#   (default: wt-new.sh's provisioned `<WT>/.harness/vendor-home/<vendor>/`).
#   When LANE_VENDOR is set, lane-run.sh exports the mapped vendor env var
#   (grok->GROK_HOME, codex->CODEX_HOME -- one var per vendor) into its OWN
#   process environment, ONCE, before CMD is ever
#   spawned -- NOT into a per-branch argv. Both CMD-spawn sites (launcher-
#   present and launcher-absent, further down this file) therefore inherit
#   it identically with no branch-specific code: the launcher-absent branch
#   because a backgrounded `"$@"` inherits bash's own exported environment
#   like any child process; the launcher-present branch because
#   foreman-launch forwards its own environment to CMD verbatim (T1
#   contract) and is itself invoked via `env -u LD_PRELOAD ...`, which drops
#   only the two/three STDBUF droppings and passes everything else
#   (including this export) through unchanged. This is also what populates
#   the ownership event's config_dir key (lane_emit_ownership already reads
#   LANE_CONFIG_DIR unconditionally -- see its own doc comment; it was wired
#   but always empty before this task set a default). CAUTION (Bun #12970 /
#   Rework Round 1): compiled Bun exes on Windows have stripped `\` from env
#   var values in the past, AND (empirically diagnosed against the REAL
#   compiled launcher on main, Rework Round 1) bash's own msys->native
#   exec-boundary conversion silently rewrites a POSIX-style value into
#   native Windows form the instant a native (non-MSYS) launcher exe is
#   actually in the loop -- uncontrolled, and dependent on disk state
#   (whether launcher/dist/foreman-launch.exe exists), not a stable
#   contract. Fix: lane_normalize_config_dir performs ONE deterministic
#   normalization (Windows/MSYS: `cygpath -m`, mixed form e.g. `C:/x/y` --
#   valid to native CLIs and MSYS bash alike, and immune to MSYS's own
#   POSIX-path conversion heuristic since it already carries a drive
#   letter; POSIX: unchanged) BEFORE export, so the value is already in its
#   final, boundary-immune form before either hazard gets a chance to touch
#   it. See tests/vendor-isolation.bats for both the fake-launcher-shim
#   regression test and the skip-guarded real-binary case (built in-worktree,
#   asserting the normalized value survives the REAL foreman-launch.exe end
#   to end). UNSET LANE_VENDOR is the frozen path: the entire block below is
#   skipped, nothing is exported, and the ownership payload's config_dir
#   stays null -- byte-identical to pre-T5a behavior (all existing lane-run
#   tests pass unmodified). T7 deliberately removed the former claude lane:
#   CLAUDE_CONFIG_DIR does not isolate Claude's HOME-relative state, and no
#   live authenticated destructive concurrency test is available to verify a
#   distinct-HOME implementation. The adapter's explicit unsupported refusal
#   remains the honest contract. See docs/research/vendor-concurrency-results.md.
# Vendor-lane admission uses the persisted TypeScript preflight record only
#   ($FOREMAN_HOME/preflight/<vendor>.json via vendor-preflight lane-gate).
#   There is no live tool-check probe and no unverified continuation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/eventlog.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/eventlog.sh"
# shellcheck source=lib/telemetry.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/telemetry.sh"
# shellcheck source=lib/checkpoint.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/checkpoint.sh"

# Non-interactive lane shells never source ~/.bashrc, so a PATH fix that lives
# in a profile file never reaches a lane, and vendor CLIs resolve by luck -- or
# resolve to a Windows shim leaked through WSL appendWindowsPath. foreman writes
# its own env file (env/foreman-env-write.sh) and lanes source it explicitly so
# vendor CLIs resolve to their WSL-native paths. No-op when absent; `|| true`
# because this script runs under `set -euo pipefail` and a missing or failing
# env file must never abort the round.
if [[ -r "${HOME}/.foreman/env.sh" ]]; then
  # shellcheck source=/dev/null
  . "${HOME}/.foreman/env.sh" || true
fi
# shellcheck source=lib/config.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/config.sh"
# shellcheck source=lib/worktree.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/worktree.sh"

# Attempt ids come from lib/eventlog.sh's el_attempt_new (T3, sourced above):
# monotonic per lane, persisted, lock-serialized. Reconciled at T2 merge --
# the pre-merge inline stub is gone.

# @description Detect which kill-tree semantics apply on this host: "windows"
#   (Job Object / KILL_ON_JOB_CLOSE via the .exe build, MSYS/Git-Bash/Cygwin
#   userland) or "posix" (setsid process-group cascade via the ELF build,
#   e.g. WSL/Linux). Selects the launcher-candidate suffix (lane_resolve_launcher)
#   and the kill_launcher_bounded branch (see header CONTRACT / POSIX caveat).
# @stdout "windows" or "posix"
lane_platform() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo posix ;;
  esac
}
LANE_PLATFORM="$(lane_platform)"

# --- arity / validation (before unguarded positional use under set -u) ---
# Optional ownership flags are consumed FIRST, before the pre-existing
# positional checks below. Once consumed, $@ is realigned to the original
# "RUN LANE WORKTREE -- CMD..." shape, so every check that follows runs
# unchanged for owned, explicitly unowned, and durable-disabled invocations.
ROUND_MODE=0
GATE_CMD=""
REPORT_PATH=""
UNOWNED_MODE=0
UNOWNED_REASON=""
case "${1:-}" in
  --round)
    if (( $# < 3 )); then
      echo "usage: lane-run.sh --round GATE_CMD REPORT_PATH RUN_ID LANE WORKTREE -- CMD..." >&2
      exit 2
    fi
    ROUND_MODE=1
    GATE_CMD="$2"
    REPORT_PATH="$3"
    shift 3
    ;;
  --unowned)
    if (( $# < 2 )) || [[ ! "${2:-}" =~ [^[:space:]] ]]; then
      echo "usage: lane-run.sh --unowned REASON RUN_ID LANE WORKTREE -- CMD... (REASON must be non-empty)" >&2
      exit 2
    fi
    UNOWNED_MODE=1
    UNOWNED_REASON="$2"
    shift 2
    ;;
esac

if [[ "${1:-}" == "--round" || "${1:-}" == "--unowned" ]]; then
  echo "usage: lane-run.sh accepts at most one leading ownership flag: --round GATE_CMD REPORT_PATH or --unowned REASON" >&2
  exit 2
fi

if (( $# < 5 )); then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD... (CMD must be non-interactive; stdin is redirected from /dev/null)" >&2
  exit 2
fi
if [[ "${4:-}" != "--" ]]; then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD... (CMD must be non-interactive; stdin is redirected from /dev/null)" >&2
  exit 2
fi
if [[ ! "${1:-}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD..." >&2
  exit 2
fi
if [[ ! "${2:-}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD..." >&2
  exit 2
fi
if [[ ! -d "${3:-}" ]]; then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD..." >&2
  exit 2
fi

RUN="$1"
LANE="$2"
WT="$(cd "$3" && pwd)"
shift 4

# Resolve Foreman's own tools independently from the target repository. A lane
# can run in a foreign worktree, but readiness probes, the process launcher,
# and the WSL clock preflight remain Foreman-owned resources.
FOREMAN_TOOL_ROOT="${FOREMAN_TOOL_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
FOREMAN_TOOL_ROOT="$(cd "$FOREMAN_TOOL_ROOT" 2>/dev/null && pwd)" || {
  echo "lane-run: invalid FOREMAN_TOOL_ROOT" >&2
  exit "$EXIT_CONFIG"
}

if [[ -z "${TARGET_REPO_ROOT:-}" ]]; then
  target_common_dir="$(git_nohooks -C "$WT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [[ -n "$target_common_dir" ]]; then
    TARGET_REPO_ROOT="$(cd "$(dirname "$target_common_dir")" && pwd)"
  else
    TARGET_REPO_ROOT="$WT"
  fi
fi
TARGET_REPO_ROOT="$(cd "$TARGET_REPO_ROOT" 2>/dev/null && pwd)" || {
  echo "lane-run: invalid TARGET_REPO_ROOT" >&2
  exit "$EXIT_CONFIG"
}

# Session records produced by a worker belong to this run. Never let an
# external lane inherit Foreman's repository-level session store, and never
# create an untracked session database inside the target worktree.
FOREMAN_SESSION_DB="${FOREMAN_SESSION_DB:-$(run_dir "$RUN")/session.db}"
export FOREMAN_TOOL_ROOT TARGET_REPO_ROOT FOREMAN_SESSION_DB

# The worker and its gate execute in the selected target worktree regardless
# of the architect's invocation directory. Foreman-owned resources above stay
# addressable through FOREMAN_TOOL_ROOT.
cd "$WT"

# Admission is intentionally before harness mkdir, stale-lock sweeping, event
# attempts, or child spawn. cfg_load is documented as safe to re-run; the
# later interval-resolution call remains unchanged.
cfg_load
durable_enabled="$(cfg_get durable enabled true)"

if (( ROUND_MODE == 0 && UNOWNED_MODE == 0 )) && [[ "$durable_enabled" == "true" ]]; then
  echo "lane-run: round ownership is required while durable.enabled=true; use --round GATE_CMD REPORT_PATH or explicit --unowned REASON" >&2
  exit 2
fi

if (( ROUND_MODE == 1 )) && [[ ! "$GATE_CMD" =~ [^[:space:]] ]]; then
  echo "lane-run: round ownership requires a non-empty gate command" >&2
  exit 2
fi

# @description Map LANE_VENDOR to the vendor CLI's own HOME-style env var
#   (T5a spec section 3: "map vendor->var; one var per vendor", frozen).
# @arg $1 vendor grok | codex
# @stdout the mapped env var name
# @exitcode 0 known vendor; 1 anything else
lane_vendor_env_var() {
  case "$1" in
    grok) echo GROK_HOME ;;
    codex) echo CODEX_HOME ;;
    *) return 1 ;;
  esac
}

# --- Vendor admission (before any durable side effect) -------------------
# Closed vendor-name validation and the TypeScript lane-gate run before
# unowned_dispatch, harness mkdir, stale-lock sweeping, lock acquisition,
# secret scanning, and command spawn. Unset LANE_VENDOR is the frozen path.
if [[ -n "${LANE_VENDOR:-}" ]]; then
  if ! LANE_VENDOR_ENV_VAR="$(lane_vendor_env_var "$LANE_VENDOR")"; then
    if [[ "$LANE_VENDOR" == "claude" ]]; then
      echo "lane-run: LANE_VENDOR 'claude' rejected by T7 decision: claude lane advertising removed because isolated HOME is unverified" >&2
    else
      echo "lane-run: bad LANE_VENDOR '$LANE_VENDOR' (grok|codex)" >&2
    fi
    exit "$EXIT_CONFIG"
  fi

  # --- Use-path readiness: persisted vendor-preflight lane-gate ------------
  # Runs BEFORE the worktree lock and BEFORE any event is emitted. The Node
  # command owns readiness decisions; the shell only forwards arguments and
  # maps nonzero exits. No live vendor probe and no unverified continuation.
  lane_gate_node="$(command -v node || true)"
  lane_gate_runtime="$SCRIPT_DIR/../runtime/dist/vendor-preflight.js"
  if [[ -z "$lane_gate_node" ]]; then
    echo "lane-run: node is required for vendor admission" >&2
    exit "$EXIT_MISSING_CLI"
  fi
  if [[ ! -f "$lane_gate_runtime" ]]; then
    echo "lane-run: vendor admission runtime is missing" >&2
    exit "$EXIT_MISSING_CLI"
  fi
  if ! "$lane_gate_node" "$lane_gate_runtime" lane-gate \
      "$LANE_VENDOR" "$FOREMAN_HOME/preflight/$LANE_VENDOR.json"; then
    exit "$EXIT_CONFIG"
  fi
fi

if (( UNOWNED_MODE == 1 )) && [[ "$durable_enabled" == "true" ]]; then
  unowned_payload="$(
    jq -cn --arg reason "$UNOWNED_REASON" \
      '{kind:"unowned_dispatch",reason:$reason}' | tr -d '\r'
  )"
  if ! el_emit "$RUN" alert "$LANE" "$unowned_payload" >/dev/null; then
    echo "lane-run: el_emit alert (unowned_dispatch) failed" >&2
  fi
fi

mkdir -p "$WT/.harness"

# v0.2.7.5 worktree-hardening T3: sweep any 0-byte, aged lock (e.g. an
# index.lock orphaned by a crashed prior lane process against this same
# worktree) before this lane ever touches it. Never removes a lock a live
# process may still hold (non-zero size or a recent mtime) -- see
# wt_sweep_stale_locks's own doc comment in lib/worktree.sh.
wt_sweep_stale_locks "$WT"

# v0.2.7.5 worktree-hardening T4: GIT_ASK_YESNO=false for every git operation
# this lane runs, exported into lane-run.sh's own process environment ONCE,
# before CMD is ever spawned, so CMD inherits it identically on both the
# launcher-present and launcher-absent spawn branches (same mechanism as
# LANE_CONFIG_DIR's export further down) -- a Windows "Unlink failed. Try
# again? (y/n)" prompt auto-declines instead of hanging with no TTY to answer
# it. Unconditional (not gated on LANE_VENDOR): every lane's git operations
# are in scope, not just vendor-routed ones.
export GIT_ASK_YESNO=false

# @description Normalize an effective vendor config dir to the
#   platform-canonical form (T5a Rework Round 1 -- see header CONTRACT for
#   the full incident writeup). Deterministic and applied ONCE, here, to
#   whatever LANE_CONFIG_DIR ends up being (default-resolved or an explicit
#   override) -- replacing reliance on bash/MSYS's own IMPLICIT, disk-state-
#   dependent msys->native exec-boundary conversion, which only fires once
#   a real native launcher exe is actually resolved. `cygpath -m` (Windows/
#   MSYS only) produces the mixed form (forward slashes, drive letter, e.g.
#   `C:/Users/x`): valid input to native Win32 CLIs AND any MSYS bash that
#   reads it back, and immune to MSYS's own POSIX-path conversion heuristic
#   (which matches leading-"/"-style absolute paths only -- a string that
#   already carries a drive letter never matches it, regardless of which
#   slash direction it started with). Degrades to the input unchanged if
#   cygpath is unavailable (should not happen on this host class) or on
#   POSIX (no msys->native boundary exists there at all).
# @arg $1 path effective LANE_CONFIG_DIR value
# @stdout the normalized value
lane_normalize_config_dir() {
  local path="$1"
  if [[ "$LANE_PLATFORM" == "windows" ]] && command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$path" 2>/dev/null || printf '%s\n' "$path"
  else
    printf '%s\n' "$path"
  fi
}

# @description Scan a grok lane's worktree SOURCE for secret material before
#   CMD is ever spawned (package 2, grok-lane-activation Task 2; hardened in
#   Rework Round 1 per Opus audit). WHILE the whole-repo-upload behavior of
#   Grok Build is unrefuted, a lane MUST NOT hand a worktree containing
#   dotenv files or key material to grok. Scoped to worktree SOURCE:
#   `$wt/.harness` (lane-run's OWN scaffolding -- vendor-home, lane.lock,
#   heartbeat/stream files, etc.) and `$wt/.git` (git's own internal object
#   store, never user source) are both pruned via the `-prune` idiom below,
#   so provisioning/bookkeeping under either can never produce a false
#   positive -- only the tree grok would actually see is scanned.
#
#   Both checks below are capture-then-test (Rework Round 1, Opus audit Nit
#   A -- a real hole, not a nitpick): `find ... 2>/dev/null` is captured into
#   a local variable FIRST, with `|| true` guarding the assignment so a
#   nonzero find exit status never aborts this script under
#   `set -euo pipefail`; emptiness is then tested separately via `[[ -n ...
#   ]]`. GNU find returns nonzero if it hits so much as one unreadable
#   subdirectory ANYWHERE in the tree, but still completes the rest of the
#   traversal and still prints every match it COULD read -- the ORIGINAL
#   form piped find's output directly into `grep -q .`, and under `pipefail`
#   a nonzero find exit outranks grep's own successful (exit 0) match, so
#   the `if` read FALSE even when a real secret was present and printed by
#   find: a MASKED hit (a present secret silently waved through), not merely
#   a false negative from a narrow glob. The capture-then-test form has no
#   such hazard: the exit status tested is the captured variable's own
#   emptiness, never find's aggregate exit code.
#
#   Check 1 (filenames, Rework Round 1 Nit B -- broadened net): `.env` and
#   `.env.*` (excluding `.env.example`) at any depth, PLUS common private-key
#   filenames anywhere in the tree (id_rsa, id_dsa, id_ecdsa, id_ed25519,
#   *.pem, *.key, *.p12, *.pfx). Filename-only -- never evaluates file
#   CONTENT for this check, so it is injection-safe regardless of what a
#   matched file contains.
#   Check 2 (content): a PEM private-key banner at the start of a line
#   (catches an embedded/renamed key Check 1's filename list would miss).
#   The line anchor prevents documentation and test source that mentions the
#   marker inline from making Foreman's own repository unroutable. Still
#   `find ... -exec grep ... {} +` (never `xargs`): with zero matched files,
#   `-exec ... {} +` is a documented no-op, whereas an `xargs` pipeline fed
#   empty input would instead invoke `grep` with no file operand, which
#   reads stdin and could hang the script with no bound.
# @arg $1 wt worktree root to scan
# @exitcode 0 clean (no secret material found); 1 secret material found
lane_grok_secrets_scan() {
  local wt="$1" hits
  hits="$(find "$wt" \( -path "$wt/.harness" -o -path "$wt/.git" \) -prune -o \
       -type f \( \
         -name '.env' \
         -o \( -name '.env.*' ! -name '.env.example' \) \
         -o -name 'id_rsa' -o -name 'id_dsa' -o -name 'id_ecdsa' -o -name 'id_ed25519' \
         -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \
       \) -print 2>/dev/null)" || true
  [[ -n "$hits" ]] && return 1
  hits="$(find "$wt" \( -path "$wt/.harness" -o -path "$wt/.git" \) -prune -o \
       -type f -exec grep -lIE -- '^[[:space:]]*-----BEGIN[[:space:]].*PRIVATE KEY-----[[:space:]]*$' {} + \
       2>/dev/null)" || true
  [[ -n "$hits" ]] && return 1
  return 0
}

# --- T5a: per-lane vendor config isolation plumbing ----------------------
# See the header CONTRACT block for the full rationale. Strictly gated on
# LANE_VENDOR being set/non-empty -- an unset LANE_VENDOR (today's default
# for every existing caller) skips this whole block, so nothing here can
# perturb the frozen, pre-T5a behavior. Vendor name validation and the
# persisted lane-gate admission already ran above, before any durable side
# effect.
if [[ -n "${LANE_VENDOR:-}" ]]; then
  # --- Task 2 (package 2, grok-lane-activation): secrets-refusal preflight -
  # An IN-LANE guard, DISTINCT from the Use-path readiness gate above --
  # that gate is an ENVIRONMENT-readiness concern (is this vendor
  # authenticated at all), this is a PER-WORKTREE safety concern (does this
  # specific worktree contain secret material), and both apply to a grok
  # lane. Runs strictly AFTER the readiness gate (spec order) and strictly
  # BEFORE CMD is ever spawned. Gated on LANE_VENDOR=="grok" specifically
  # (not codex, and not merely "LANE_VENDOR is set") -- the
  # whole-repo-upload concern this guards against is a grok-specific,
  # currently-unrefuted behavior of Grok Build; codex lanes and the
  # unset-LANE_VENDOR frozen path are byte-unaffected by this block.
  if [[ "$LANE_VENDOR" == "grok" ]]; then
    if ! lane_grok_secrets_scan "$WT"; then
      if ! el_emit "$RUN" alert "$LANE" '{"kind":"grok_secrets_refused"}' >/dev/null; then
        echo "lane-run: el_emit alert (grok_secrets_refused) failed" >&2
      fi
      echo "lane-run: grok lane refused -- worktree contains secret material (.env or a private key); remove it before routing to grok" >&2
      exit "$EXIT_CONFIG"
    fi
  fi

  # Default (only when unset/empty -- an explicit caller-supplied
  # LANE_CONFIG_DIR, e.g. pointing at a pre-seeded config dir for T5b, is
  # never overridden): the per-lane dir wt-new.sh already provisions.
  : "${LANE_CONFIG_DIR:="$WT/.harness/vendor-home/$LANE_VENDOR"}"
  # Rework Round 1: normalize BEFORE export -- see lane_normalize_config_dir
  # doc comment. Applied uniformly whether LANE_CONFIG_DIR came from the
  # default above or an explicit caller override.
  LANE_CONFIG_DIR="$(lane_normalize_config_dir "$LANE_CONFIG_DIR")"
  export LANE_CONFIG_DIR
  # Exported ONCE, here, into lane-run.sh's own process environment -- both
  # CMD-spawn sites below inherit it identically with no branch-specific
  # code (see header CONTRACT). Already in its final, boundary-immune form
  # by this point, so no further quoting/escaping is needed here either.
  export "${LANE_VENDOR_ENV_VAR}=${LANE_CONFIG_DIR}"
fi

# @description Emit a machine-visible alert marking a bounded-kill escalation
#   (Rework Round 3, finding 2). This is deliberately an EVENT, not just a code
#   comment: full process-tree ownership does not exist in plain bash on Git
#   Bash/MSYS2 today (that arrives with foreman-launch@0.2.5), so whenever this
#   script actually has to force a kill, the limitation belongs in the
#   operator-visible event log, not buried in source.
#
#   Rework Round 4, finding 1: kill_cmd_bounded now calls this AT MOST ONCE
#   per invocation (see below) -- the escalation outcome and the sweep
#   outcome are folded into a single alert instead of two independent
#   alerts racing to describe one kill incident.
# @arg $1 which "cmd" or "tee" -- which tracked pid triggered the escalation
# @arg $2 sweep optional sweep outcome: "swept", "sweep_failed", or
#   "sweep_unavailable" (no /proc winpid). "swept" covers both an actual
#   kill AND a vacuous sweep (taskkill found nothing left to kill -- see
#   kill_cmd_bounded). Audit round-3 medium: the alert must fire ESPECIALLY
#   when the descendant sweep genuinely failed or was skipped -- that is
#   exactly when survivors are possible.
emit_kill_alert() {
  local which="$1" sweep="${2:-}"
  local payload='{"tree_kill":"best_effort","full_tree_kill_via":"foreman-launch@0.2.5"'
  if [[ -n "$sweep" ]]; then
    payload+=",\"sweep\":\"$sweep\""
  fi
  payload+='}'
  if ! el_emit "$RUN" alert "$LANE" "$payload" >/dev/null; then
    echo "lane-run: el_emit alert failed ($which kill escalation)" >&2
  fi
}

# @description Bounded TERM-then-KILL escalation against an explicitly tracked
#   pid, used to actively terminate CMD (Rework Round 3, finding 2). NEVER an
#   unbounded wait: liveness is polled via `kill -0` in a fixed loop capped by
#   ${LANE_KILL_GRACE:-5} seconds, so lane-run.sh cannot hang here even if CMD
#   ignores TERM outright. On the KILL branch, best-effort sweep CMD's
#   descendant tree via `taskkill //T //F` -- translating bash's MSYS pid to
#   the real Windows PID via /proc/<pid>/winpid first, since MSYS's own $! is
#   not a Windows PID and a raw `taskkill //PID <msys-pid>` always fails to
#   find the process. The /proc root used for that translation is itself
#   overridable via ${LANE_PROC_ROOT:-/proc} (test-only knob: pointing it at
#   an empty directory simulates a host with no /proc/*/winpid support
#   without touching the real /proc). This sweep is still best-effort (a
#   detached descendant that escapes the tree, or a host without
#   /proc/*/winpid, is not covered) -- emit_kill_alert makes that limitation
#   visible in the event log.
#
#   Rework Round 4, finding 1: this function now emits AT MOST ONE alert per
#   invocation (previously it could emit one for the KILL escalation itself
#   and a second, independent one for the sweep outcome -- two events for a
#   single kill incident). The escalation flag and the sweep outcome are
#   computed first, then folded into a single emit_kill_alert call. Rework
#   Round 4, finding 2: a taskkill exit code that means "nothing left to
#   kill" (process/tree already gone -- a VACUOUS sweep, not a failed one) is
#   no longer misreported as sweep_failed; only a genuinely unexpected
#   nonzero rc is. Empirically confirmed on this host (MSYS2/Git Bash
#   taskkill.exe wrapper): `taskkill //PID 4000000 //T //F` (a PID that does
#   not exist) exits 128 with "ERROR: The process ... not found."; that rc is
#   folded into the "swept" outcome alongside rc==0.
# @arg $1 pid pid to terminate
# shellcheck disable=SC2329  # invoked indirectly by cleanup traps
kill_cmd_bounded() {
  local pid="$1" grace="${LANE_KILL_GRACE:-5}" waited=0
  local escalated=0
  [[ -z "$pid" ]] && return 0
  kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null || true; return 0; }
  kill -TERM "$pid" 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null && (( waited < grace )); do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
    escalated=1
  fi
  # Best-effort full-tree sweep regardless of whether TERM alone already
  # stopped CMD's own pid, or KILL was needed: CMD may have spawned children
  # BEFORE it died, and killing/terminating CMD's own pid does not reach them
  # -- there is no process-group forwarding anymore (see the header contract
  # note; that is the accepted tradeoff of dropping job control). Windows
  # retains a child's recorded parent-PID in the process snapshot even after
  # the parent itself has exited, so `taskkill //T` against CMD's Windows PID
  # can still reach those children at this point. Read the winpid BEFORE the
  # final `wait` below so the winpid file is still resolvable even if $pid
  # is already a zombie.
  local winpid="" sweep_rc="" outcome=""
  winpid="$(cat "${LANE_PROC_ROOT:-/proc}/$pid/winpid" 2>/dev/null || true)"
  if [[ -n "$winpid" ]]; then
    # Capture the real rc without tripping `set -e` (this is a plain
    # statement, not part of a conditional, so an unguarded nonzero exit
    # here would abort the whole script).
    if taskkill //PID "$winpid" //T //F >/dev/null 2>&1; then
      sweep_rc=0
    else
      sweep_rc=$?
    fi
    if [[ "$sweep_rc" == "0" || "$sweep_rc" == "128" ]]; then
      # rc==0: a real kill happened. rc==128: taskkill's own "process not
      # found" rc on this host (see the function doc comment) -- a VACUOUS
      # sweep (nothing left to kill), not a failure.
      outcome=swept
    else
      # Sweep FAILED: descendants may survive. This is precisely when the
      # limitation must be operator-visible (audit round-3 medium).
      outcome=sweep_failed
    fi
  else
    # No winpid available (no /proc/<pid>/winpid on this host, or pid gone
    # from /proc): sweep skipped entirely -- same visibility requirement.
    outcome=sweep_unavailable
  fi
  # Single alert point (Rework Round 4, finding 1): fire iff KILL was needed
  # OR the sweep itself was not a clean/vacuous success. The clean path (no
  # escalation, sweep swept/vacuous) is silent -- nothing operator-visible
  # happened.
  if (( escalated == 1 )) || [[ "$outcome" == "sweep_failed" || "$outcome" == "sweep_unavailable" ]]; then
    emit_kill_alert cmd "$outcome"
  fi
  wait "$pid" 2>/dev/null || true
}

# @description Bounded reap of the tee consumer (Rework Round 3, finding 2).
#   Unlike kill_cmd_bounded, this first gives tee up to $grace seconds to exit
#   ON ITS OWN (it is likely still draining buffered output after CMD exits,
#   and killing it immediately would truncate the tail of a legitimate
#   transcript); only if it is STILL alive past that bound -- e.g. a detached
#   descendant of CMD inherited the write end of the pipe and is keeping it
#   open -- does this escalate TERM then KILL, each bounded the same way. This
#   replaces the old bare `wait` (which had no bound at all and could hang
#   lane-run.sh forever in exactly that detached-descendant scenario).
#   Sets the caller-visible `tee_escalated` flag when a kill was required, so
#   the caller can mark the round's instrumentation as degraded.
# @arg $1 pid tee's own pid (see the exec-trick note at the launch site below)
reap_tee_bounded() {
  local pid="$1" grace="${LANE_KILL_GRACE:-5}" waited=0
  tee_escalated=0
  [[ -z "$pid" ]] && return 0
  while kill -0 "$pid" 2>/dev/null && (( waited < grace )); do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    tee_escalated=1
    kill -TERM "$pid" 2>/dev/null || true
    waited=0
    while kill -0 "$pid" 2>/dev/null && (( waited < grace )); do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
      emit_kill_alert tee
    fi
  fi
  # Best-effort: on this host, `wait` on the process-substitution pid (even
  # after the exec-trick below makes it identify tee itself) sometimes returns
  # 127 ("not a child of this shell") rather than a real child of lane-run.sh
  # in bash's job-table sense. Guarded so that outcome is never fatal under
  # set -e and never blocks -- it is a fast, non-blocking call either way.
  wait "$pid" 2>/dev/null || true
}

# @description Resolve the foreman-launch executable (T2). Precedence:
#   FOREMAN_LAUNCH env override (if set and non-empty, it is AUTHORITATIVE --
#   an override pointing at a non-executable/missing path means the launcher
#   is treated as ABSENT, never a fallthrough to the probes below; this is
#   the deliberate neutralization knob bats tests use to force the
#   launcher-absent path even when the compiled binary exists on disk in this
#   checkout) > launcher/dist/foreman-launch(.exe) resolved relative to THIS
#   script's own repo root (three levels up from skills/foreman/scripts,
#   NOT the caller's cwd or WT, so detection is independent of which
#   worktree CMD runs in) > PATH lookup > absent.
# @stdout resolved executable path (nothing if absent)
# @exitcode 0 found; 1 absent
lane_resolve_launcher() {
  if [[ -n "${FOREMAN_LAUNCH:-}" ]]; then
    if [[ -x "$FOREMAN_LAUNCH" ]]; then
      printf '%s\n' "$FOREMAN_LAUNCH"
      return 0
    fi
    return 1
  fi
  local candidate
  if [[ -n "$FOREMAN_TOOL_ROOT" ]]; then
    if [[ "$LANE_PLATFORM" == "windows" ]]; then
      candidate="$FOREMAN_TOOL_ROOT/launcher/dist/foreman-launch.exe"
    else
      candidate="$FOREMAN_TOOL_ROOT/launcher/dist/foreman-launch"
    fi
    [[ -x "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  fi
  if candidate="$(command -v foreman-launch 2>/dev/null)"; then
    [[ -n "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  fi
  return 1
}

# @description Map an observed launcher rc to the documented round_done
#   exit_source vocabulary (T2 spec: "exit_code = observed rc, plus
#   exit_source: child|timeout|launcher"). Only meaningful on the
#   launcher-PRESENT path -- see the header CONTRACT note on why this key is
#   omitted entirely (not merely false) on the frozen launcher-absent path.
# @arg $1 rc observed exit code from waiting on the launcher
# @stdout "timeout" (124) | "launcher" (125) | "child" (anything else)
lane_exit_source() {
  case "$1" in
    124) echo timeout ;;
    125) echo launcher ;;
    *) echo child ;;
  esac
}

# @description Bounded (<=20s) wait for the FIRST parseable heartbeat line in
#   the round's heartbeat file, then emit the round's `ownership` event
#   (T2 spec: "Ownership event at spawn"). Runs concurrently with CMD/launcher
#   execution (called right after backgrounding the launcher, before `wait`),
#   so a long-running CMD does not delay ownership visibility. NEVER aborts
#   the round on timeout: pid/job_id degrade to null and an additional
#   `alert` event records the timeout, matching the spec's "do not abort the
#   round" instruction -- ownership is best-effort visibility, not a gate.
# @arg $1 hb heartbeat file path
# @arg $2 attempt current attempt id
# @arg $3 fallback_launcher_pid bash-tracked launcher pid, used for the
#   ownership payload's launcher_pid field only if the heartbeat line itself
#   never appears within the bound
# @set LANE_OWNERSHIP_PID the child pid recovered from the heartbeat (empty
#   on timeout) -- consumed by kill_launcher_bounded's POSIX group-kill path
lane_emit_ownership() {
  local hb="$1" attempt="$2" fallback_launcher_pid="$3"
  local waited=0 line="" ownership_launcher_pid="" ownership_pid="" ownership_job_id="" timed_out=0
  while (( waited < 200 )); do   # 200 * 0.1s = 20s bound
    if [[ -s "$hb" ]]; then
      line="$(head -n 1 "$hb" 2>/dev/null || true)"
      line="${line%$'\r'}"
      if [[ -n "$line" ]] && jq -e . >/dev/null 2>&1 <<<"$line"; then
        ownership_launcher_pid="$(jq -r '.launcher_pid // empty' <<<"$line" 2>/dev/null || true)"
        ownership_pid="$(jq -r '.pid // empty' <<<"$line" 2>/dev/null || true)"
        ownership_job_id="$(jq -r '.job_id // empty' <<<"$line" 2>/dev/null || true)"
        break
      fi
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  if [[ -z "$ownership_pid" ]]; then
    timed_out=1
    ownership_launcher_pid="${ownership_launcher_pid:-$fallback_launcher_pid}"
  fi
  LANE_OWNERSHIP_PID="$ownership_pid"
  local payload
  # MSYS_NO_PATHCONV=1 (local to this one jq.exe invocation, portability
  # checklist item -- same class of gotcha tests/launcher.bats documents for
  # its own exe-argument case): $WT is a bare absolute path, and jq.exe is a
  # real Windows PE binary, so WITHOUT this guard, Git-Bash/MSYS's automatic
  # argv path-translation layer silently rewrites a POSIX-looking absolute
  # path argument (e.g. "/c/Users/x/wt") into its Windows form
  # ("C:/Users/x/wt") before jq.exe ever sees it -- meaning the stored
  # ownership event would NOT record the same string the caller actually
  # passed as WORKTREE. No other jq call in this file passes a bare path
  # like this (existing calls only ever embed paths inside longer strings,
  # e.g. the prompt payload's whole CMD string, which MSYS's whole-argument
  # heuristic does not touch) -- this is a new, NOT a frozen-path, concern.
  payload="$(
    MSYS_NO_PATHCONV=1 jq -cn \
      --argjson attempt "$attempt" \
      --arg launcher_pid "$ownership_launcher_pid" \
      --arg pid "$ownership_pid" \
      --arg job_id "$ownership_job_id" \
      --arg worktree "$WT" \
      --arg config_dir "${LANE_CONFIG_DIR:-}" \
      '{attempt:$attempt,
        launcher_pid:(if $launcher_pid=="" then null else ($launcher_pid|tonumber) end),
        pid:(if $pid=="" then null else ($pid|tonumber) end),
        job_id:(if $job_id=="" then null else $job_id end),
        worktree:$worktree,
        config_dir:(if $config_dir=="" then null else $config_dir end),
        launcher:true}' 2>/dev/null | tr -d '\r'
  )"
  if [[ -z "$payload" ]]; then
    echo "lane-run: ownership payload build failed (jq)" >&2
  elif ! el_emit "$RUN" ownership "$LANE" "$payload" >/dev/null; then
    echo "lane-run: el_emit ownership failed" >&2
  fi
  if (( timed_out == 1 )); then
    if ! el_emit "$RUN" alert "$LANE" '{"kind":"ownership_timeout"}' >/dev/null; then
      echo "lane-run: el_emit alert (ownership_timeout) failed" >&2
    fi
  fi
}

# @description Terminate the launcher process on INT/TERM/EXIT cleanup --
#   the launcher-PRESENT counterpart to kill_cmd_bounded, GATED to that
#   branch only (T2 spec: the taskkill //T //F descendant sweep is
#   launcher-absent-only; Job Object KILL_ON_JOB_CLOSE supersedes it here).
#   Windows: killing launcher_pid alone is sufficient -- KILL_ON_JOB_CLOSE is
#   a KERNEL-ENFORCED cascade that fires the instant the job's last handle
#   closes, even without the launcher running its own cleanup code
#   (launcher/README.md). The MSYS-pid -> winpid translation mirrors
#   kill_cmd_bounded exactly (same /proc/<pid>/winpid trick, same
#   LANE_PROC_ROOT test knob) since the launcher, like CMD before it, is just
#   a directly bash-spawned Windows exe.
#   POSIX: there is NO kernel cascade (launcher/README.md "POSIX asymmetry")
#   -- killing launcher_pid alone leaves CMD's whole process group alive.
#   Also signal the child's own pgid (recovered as LANE_OWNERSHIP_PID from
#   the ownership heartbeat parse -- it equals the child's pgid because the
#   launcher wraps CMD in setsid) as a process GROUP (`kill -- -PID`), per
#   the README's explicit external-reaper guidance, THEN the launcher itself.
# @arg $1 launcher_pid
# @arg $2 child_pid optional POSIX pgid target (empty on Windows / on an
#   ownership-parse timeout -- best-effort in that case)
# shellcheck disable=SC2329  # invoked indirectly by cleanup traps
kill_launcher_bounded() {
  local lpid="$1" cpid="${2:-}"
  [[ -z "$lpid" ]] && return 0
  kill -0 "$lpid" 2>/dev/null || { wait "$lpid" 2>/dev/null || true; return 0; }
  if [[ "$LANE_PLATFORM" == "windows" ]]; then
    local winpid=""
    winpid="$(cat "${LANE_PROC_ROOT:-/proc}/$lpid/winpid" 2>/dev/null || true)"
    if [[ -n "$winpid" ]]; then
      taskkill //PID "$winpid" //F >/dev/null 2>&1 || true
    else
      kill -KILL "$lpid" 2>/dev/null || true
    fi
  else
    [[ -n "$cpid" ]] && kill -TERM -- "-$cpid" 2>/dev/null || true
    kill -TERM "$lpid" 2>/dev/null || true
  fi
  wait "$lpid" 2>/dev/null || true
}

# @description Rework round 1, F2 (Opus audit, POSIX-only SC-B gap): after
#   lane_emit_ownership runs for CMD, LANE_OWNERSHIP_PID holds CMD's child
#   pid. During the --round mode's gate phase, CMD has already exited, so
#   that pid is stale -- on POSIX, a signal arriving DURING the gate phase
#   would make kill_launcher_bounded's POSIX branch group-kill the WRONG
#   (dead) pgid while only TERM-ing the gate's own launcher process, which
#   does NOT cascade to the gate's setsid'd child group on POSIX (no kernel
#   cascade there, unlike Windows' Job Object -- launcher/README.md "POSIX
#   asymmetry"). The gate's own bash -c subtree could survive. Fix: bounded
#   (<=20s, same pattern as lane_emit_ownership) re-parse of $hb for the
#   FIRST heartbeat line PAST $baseline_lines (the line count observed just
#   before the gate launcher was backgrounded -- $hb is shared/append-only
#   across the CMD and gate phases, so "first NEW line" is how the gate's
#   own heartbeat is distinguished from CMD's). Refreshes
#   LANE_OWNERSHIP_PID to the gate's own child pid on success. NEVER
#   aborts the round and never touches LANE_OWNERSHIP_PID on timeout --
#   falls back to leaving it at CMD's stale pid (documented limitation,
#   not silently pretended-fixed): still strictly better than nothing, and
#   Windows' kill-shot (taskkill /PID launcher_pid /F) does not depend on
#   this value at all.
# @arg $1 hb heartbeat file path
# @arg $2 baseline_lines line count in $hb before the gate launcher was
#   backgrounded
# @set LANE_OWNERSHIP_PID refreshed to the gate's own child pid (unchanged
#   on timeout)
lane_refresh_gate_ownership_pid() {
  local hb="$1" baseline="$2"
  local waited=0 n line="" gate_pid=""
  while (( waited < 200 )); do   # 200 * 0.1s = 20s bound
    n="$(wc -l < "$hb" 2>/dev/null || echo 0)"
    if (( n > baseline )); then
      line="$(sed -n "$((baseline + 1))p" "$hb" 2>/dev/null || true)"
      line="${line%$'\r'}"
      if [[ -n "$line" ]] && jq -e . >/dev/null 2>&1 <<<"$line"; then
        gate_pid="$(jq -r '.pid // empty' <<<"$line" 2>/dev/null || true)"
        [[ -n "$gate_pid" ]] && break
      fi
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  [[ -n "$gate_pid" ]] && LANE_OWNERSHIP_PID="$gate_pid"
}

# Single-writer-per-worktree lock: plain mkdir (no -p). If it exists, fail
# immediately — no stale-lock reclaim (ABA-unsafe on Git Bash/MSYS).
# lane_lock_owned only flips to 1 on OUR successful mkdir, so cleanup() can
# never rmdir a lock directory some other process created (e.g. a
# hypothetical future code path that installs the trap earlier) -- ownership
# is explicit, not inferred from control flow.
#
# Rework Round 3, finding 3: a signal delivered after mkdir succeeds but
# before ownership is recorded / the real cleanup trap is installed used to
# hit bash's default disposition and exit without releasing the lock,
# stranding it for every future lane-run against this worktree. Close that
# window: install a NON-EXITING pending-signal trap first (it only records
# which signal arrived; it never itself exits), complete mkdir + ownership
# recording, THEN install the real cleanup trap, THEN honor any signal that
# arrived during that critical section.
lane_lock_owned=0
_pending_signal=""
trap '_pending_signal=INT' INT
trap '_pending_signal=TERM' TERM

if ! mkdir "$WT/.harness/lane.lock" 2>/dev/null; then
  echo "lane-run: another lane-run owns this worktree: $WT" >&2
  trap - INT TERM
  exit 2
fi
lane_lock_owned=1

watcher_pid=""
cmd_pid=""
launcher_pid=""
tee_pid=""
LANE_OWNERSHIP_PID=""

# @description Release the worktree lock (only if this process created it),
#   terminate CMD and the tee consumer via bounded escalation (never an
#   unbounded wait — see kill_cmd_bounded / reap_tee_bounded above), and stop
#   any background watcher. Invoked on EXIT/INT/TERM so nothing survives the
#   script, and lane-run.sh itself can never hang here even if CMD ignores
#   TERM or a detached descendant keeps the output pipe open.
# shellcheck disable=SC2329  # invoked indirectly by EXIT/INT/TERM traps
cleanup() {
  if [[ -n "${cmd_pid:-}" ]]; then
    kill_cmd_bounded "$cmd_pid"
    cmd_pid=""
  fi
  # Launcher-PRESENT counterpart (T2): mutually exclusive with the cmd_pid
  # branch above -- only ever ONE of {cmd_pid, launcher_pid} is non-empty for
  # a given round, depending on which branch spawned CMD. See kill_launcher_bounded
  # doc comment for why this is a different function, not a shared one.
  if [[ -n "${launcher_pid:-}" ]]; then
    kill_launcher_bounded "$launcher_pid" "${LANE_OWNERSHIP_PID:-}"
    launcher_pid=""
  fi
  if [[ -n "${tee_pid:-}" ]]; then
    reap_tee_bounded "$tee_pid"
    tee_pid=""
  fi
  if [[ -n "${watcher_pid:-}" ]]; then
    kill "$watcher_pid" 2>/dev/null || true
    wait "$watcher_pid" 2>/dev/null || true
    watcher_pid=""
  fi
  if [[ "$lane_lock_owned" == "1" ]]; then
    rmdir "$WT/.harness/lane.lock" 2>/dev/null || true
  fi
}
# INT/TERM must TERMINATE the script (audit t3-2 round 3: a trap that only
# runs cleanup and returns lets a pre-launch signal be swallowed, after which
# CMD launches anyway). cleanup() is idempotent; drop the EXIT trap before
# exiting so it does not run twice.
trap cleanup EXIT
trap 'cleanup; trap - EXIT; exit 130' INT
trap 'cleanup; trap - EXIT; exit 143' TERM

# Honor any signal that arrived during the mkdir/ownership-recording critical
# section above, now that the real cleanup trap is installed and can actually
# release the lock it just acquired.
if [[ -n "$_pending_signal" ]]; then
  echo "lane-run: signal $_pending_signal received during lock acquisition; exiting" >&2
  case "$_pending_signal" in
    INT) exit 130 ;;
    TERM) exit 143 ;;
  esac
fi

# round_prompt_epoch (T2, additive): this round's attempt-freshness reference
# instant, captured immediately before the prompt event below. Used ONLY by
# the --round mode's attempt-fresh report predicate (mtime strictly newer
# than this) -- a NEW variable, deliberately distinct from the existing
# round_start_epoch captured further below for the (frozen, unrelated)
# background stream-activity watcher, so that addition is never touched here.
round_prompt_epoch="$(date -u +%s)"

# attempt id (T2/T3): monotonic per-lane attempt counter, used in the
# ownership event and as the --round mode's attempt-fresh report predicate's
# secondary (string) signal. el_attempt_new can fail (lock timeout, persist
# failure) -- degrade to attempt=1 rather than aborting the round.
if ! attempt="$(el_attempt_new "$RUN" "$LANE")"; then
  echo "lane-run: el_attempt_new failed; defaulting attempt=1" >&2
  attempt=1
fi

# prompt event: full CMD joined as a single string, plus structured model
# identity (S4a T5) — requested alias and CLI-reported version are separate
# fields; never scraped from the command string.
_model_id="$(tl_model_identity "${LANE_VENDOR:-}")"
# Queue-wait (S4a T6): if the dispatcher recorded enqueue epoch, record it;
# otherwise omit (null) rather than invent a zero.
_queue_wait_s=""
if [[ -n "${LANE_QUEUED_AT:-}" && "$LANE_QUEUED_AT" =~ ^[0-9]+$ ]]; then
  _queue_wait_s=$(( round_prompt_epoch - LANE_QUEUED_AT ))
  (( _queue_wait_s < 0 )) && _queue_wait_s=0
fi
prompt_payload="$(
  jq -cn     --arg c "$*"     --argjson model "$_model_id"     --arg qw "${_queue_wait_s}"     '{cmd:$c, model:$model}
     + (if $qw == "" then {} else {queue_wait_s: ($qw|tonumber)} end)'   | tr -d '\r'
)"
# WSL clock-drift preflight (wsl-preflight): env/wsl-clock-preflight.sh has
# existed and been tested since v0.2.7.5 but was called from nowhere. WSL2's
# guest clock can lag the host after a sleep/resume cycle, and a lagging clock
# corrupts the event log's ordering invariants. Run it BEFORE the first
# timestamped event. No-op off WSL. Never hard-fails the lane: a preflight that
# cannot reach the host clock must not make lanes unrunnable.
if [[ "${FOREMAN_WSL_CLOCK_PREFLIGHT:-1}" == 1 ]] \
   && { [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]] \
        || grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; }; then
  _wcp="$FOREMAN_TOOL_ROOT/env/wsl-clock-preflight.sh"
  if [[ -x "$_wcp" || -f "$_wcp" ]]; then
    if ! bash "$_wcp" --threshold "${FOREMAN_WSL_CLOCK_THRESHOLD:-5}" >&2; then
      echo "lane-run: WSL clock preflight refused (see its message above); continuing, event ordering may be affected" >&2
    fi
  fi
fi
# Guarded like every other el_emit call in this file: el_emit can legitimately
# fail (mkdir-mutex retry timeout ~30s under .seq.lock contention, a jq
# failure, or a failed atomic seq write) and under `set -euo pipefail` an
# unguarded call here would abort the whole script before CMD ever runs --
# never emitting round_done and never running CMD at all. A missed prompt
# event must not block the round.
if ! el_emit "$RUN" prompt "$LANE" "$prompt_payload" >/dev/null; then
  echo "lane-run: el_emit prompt failed" >&2
fi
# Phase timing anchors (S4a T6): implement starts at CMD spawn; gate starts
# when ROUND_MODE enters the verifying state.
implement_start_epoch="$(date -u +%s)"
gate_duration_s=""

# Prefer stdbuf for line-buffered tee; gstdbuf (coreutils on some hosts) next.
# When both are absent, output is only as line-buffered as the wrapped CLI
# makes it itself.
STDBUF=""
if command -v stdbuf >/dev/null 2>&1; then
  STDBUF="stdbuf -oL"
elif command -v gstdbuf >/dev/null 2>&1; then
  STDBUF="gstdbuf -oL"
fi

# Resolved through the shared config loader: dedicated env var (as before) >
# [durable] TOML value > the same built-in defaults this always had. When
# neither DURABLE_CHECKPOINT_INTERVAL/DURABLE_HEARTBEAT_INTERVAL nor a
# .foreman/config.toml [durable] block is present, cfg_get returns these
# literal defaults -- byte-identical to the prior "${VAR:-N}" form.
cfg_load
CKPT_INTERVAL="$(cfg_get durable checkpoint_interval 20)"
HB_INTERVAL="$(cfg_get durable heartbeat_interval 30)"

stream_file_path="$WT/.harness/stream.ndjson"

# Round boundary for the background loop's stream-activity check below.
# stream.ndjson is append-only across repeated invocations against the same
# worktree, with no in-file round marker.
#
# Rework Round 3 addendum (auditor resolution note on Round B finding 6): the
# original fix compared the file's mtime against round_start_epoch with `>=`.
# Both values only have 1-second resolution, so a prior round's write landing
# in the SAME second as this round's start could still alias as current-round
# activity. Fix: prefer stream SIZE growth since round start as the activity
# signal -- it is resolution-independent (a byte count, not a clock tick), so
# a same-second collision can never produce a false positive. mtime is kept
# only as a fallback for hosts where a size stat is unavailable, now compared
# with strict `>` (equality is stale, not current) instead of `>=`.
round_start_epoch="$(date -u +%s)"
round_start_size=0
if [[ -f "$stream_file_path" ]]; then
  round_start_size="$(stat -c %s "$stream_file_path" 2>/dev/null || stat -f %z "$stream_file_path" 2>/dev/null || echo 0)"
fi

# Background watcher: mid-run heartbeats and activity-driven checkpoints.
# When both intervals are 0 (tests), skip the loop entirely and rely on the
# single post-run checkpoint in finalization.
if (( CKPT_INTERVAL > 0 || HB_INTERVAL > 0 )); then
  (
    set +e
    elapsed=0
    last_hb=0
    last_ckpt=0
    last_size="$round_start_size"
    last_mtime=""
    stream="$stream_file_path"
    while true; do
      sleep 1
      elapsed=$((elapsed + 1))
      if (( HB_INTERVAL > 0 && elapsed - last_hb >= HB_INTERVAL )); then
        last_hb=$elapsed
        if el_emit "$RUN" heartbeat "$LANE" '{}' >/dev/null; then
          :
        fi
      fi
      if (( CKPT_INTERVAL > 0 && elapsed - last_ckpt >= CKPT_INTERVAL )); then
        last_ckpt=$elapsed
        if [[ -f "$stream" ]]; then
          size="$(stat -c %s "$stream" 2>/dev/null || stat -f %z "$stream" 2>/dev/null || echo "")"
          activity=0
          if [[ -n "$size" ]]; then
            # Preferred, resolution-independent signal (see note above).
            if (( size > round_start_size )) && [[ "$size" != "$last_size" ]]; then
              activity=1
            fi
          else
            mtime="$(stat -c %Y "$stream" 2>/dev/null || stat -f %m "$stream" 2>/dev/null || echo "")"
            if [[ -n "$mtime" ]] && (( mtime > round_start_epoch )) && [[ "$mtime" != "$last_mtime" ]]; then
              activity=1
              last_mtime="$mtime"
            fi
          fi
          if (( activity )); then
            [[ -n "$size" ]] && last_size="$size"
            ckpt_err="$(mktemp)"
            if mid_sha=$(ckpt_snapshot "$WT" "$LANE" 2>"$ckpt_err"); then
              mid_payload="$(jq -cn --arg sha "$mid_sha" '{sha:$sha}' | tr -d '\r')"
              if el_emit "$RUN" checkpoint "$LANE" "$mid_payload" "$mid_sha" >/dev/null; then
                :
              fi
            fi
            rm -f "$ckpt_err"
          fi
        fi
      fi
    done
  ) &
  watcher_pid=$!
fi

stream_file="$stream_file_path"
stream_failed=0

# Launcher detection (T2): resolved ONCE per round, before CMD is spawned,
# and reused unchanged for the --round mode's GATE_CMD phase later (same $hb
# -- heartbeats continue across both phases, per spec). Absent -> exactly
# today's direct-spawn path below, PLUS one `alert` event
# {kind:"degraded",reason:"launcher_absent"} -- deliberately once per round,
# not once per phase (CMD and, in --round mode, GATE_CMD share this single
# alert instead of duplicating it).
FOREMAN_LAUNCH_RESOLVED=""
if FOREMAN_LAUNCH_RESOLVED="$(lane_resolve_launcher)"; then
  :
else
  FOREMAN_LAUNCH_RESOLVED=""
  echo "lane-run: DEGRADED launcher absent; build it during Setup with: (cd launcher && bun run build:posix)" >&2
  if ! el_emit "$RUN" alert "$LANE" '{"kind":"degraded","reason":"launcher_absent"}' >/dev/null; then
    echo "lane-run: el_emit alert (degraded) failed" >&2
  fi
fi
hb="$WT/.harness/heartbeat.ndjson"
if [[ -n "$FOREMAN_LAUNCH_RESOLVED" ]]; then
  # Fresh per round: supervise() only ever appends, so a stale line from a
  # PRIOR round against this same worktree would otherwise be mistaken for
  # THIS round's first heartbeat by lane_emit_ownership below (same class of
  # hazard the launcher's own --detach F1 fix addresses for its heartbeat
  # file -- see launcher/README.md).
  rm -f "$hb" 2>/dev/null || true
fi

# Rework Round 3, finding 1: job control (`set -m`) and the process-group
# launch it required have been REMOVED. CMD's stdin is redirected from
# /dev/null (MSYS maps /dev/null to NUL correctly) -- CMD is contractually
# non-interactive, so there is no SIGTTIN/TTY class left to detect or fall
# back from. lane-run.sh's OWN stdin is untouched.
#
# CMD's output is still routed through a process substitution (rather than a
# `|` pipeline stage) so cmd_pid from `$!` is CMD's own pid, not tee's --
# `wait "$cmd_pid"` yields CMD's real exit status directly.
#
# Rework Round 3, finding 2: tee's own pid is now captured explicitly instead
# of relying on a final bare `wait` to reap "whatever is left". The
# process-substitution subshell prints its own $BASHPID to tee_pid_file and
# then `exec`s directly into tee -- exec preserves the pid, so tee_pid_file
# ends up holding tee's REAL, individually-signalable pid (confirmed against
# this host: a CMD that backgrounds a detached grandchild holding the pipe
# open leaves tee blocked in read(), and only a direct kill against tee's OWN
# pid -- not its would-be parent -- unblocks it; see FOREMAN_REPORT.md).
tee_pid_file="$(mktemp)"
set +e
cmd_exit_source=""
if [[ -n "$FOREMAN_LAUNCH_RESOLVED" ]]; then
  # Launcher-PRESENT (T2): CMD is spawned THROUGH foreman-launch instead of
  # directly. `launcher_pid` (NOT cmd_pid -- see header CONTRACT) captures
  # the launcher's own bash job pid; `wait "$launcher_pid"` yields the
  # launcher's own exit code, which is CMD's own code passed through, or the
  # launcher's documented 124 (timeout)/125 (launcher error) -- see
  # lane_exit_source. Heartbeats stream to $hb for the whole round; ownership
  # is emitted as soon as the FIRST heartbeat line appears (bounded,
  # concurrently with CMD -- see lane_emit_ownership's doc comment), not
  # after CMD finishes, so a long CMD does not delay ownership visibility.
  #
  # Rework round 2 (architect-diagnosed present-path regression, config.bats
  # f1): NEVER prefix the launcher with $STDBUF, on either arm -- unlike the
  # launcher-absent branch below (where $STDBUF still applies and still
  # matters), stdbuf here is not merely unnecessary, it is ACTIVELY
  # POISONOUS. stdbuf works via LD_PRELOAD=/usr/lib/coreutils/libstdbuf.dll;
  # MSYS silently converts that value to Windows form
  # (C:\Program Files\Git\usr\lib\coreutils\libstdbuf.dll) at the msys->native
  # exec boundary when spawning the compiled (native) launcher exe; the
  # launcher then forwards its own environment to CMD verbatim (correct per
  # the T1 contract -- it does not know or care about stdbuf); CMD's own
  # MSYS bash then colon-splits that Windows path on ITS OWN LD_PRELOAD
  # parse and tries to dlopen "C:" as a shared object, hard-failing with
  # "*** fatal error - error while loading shared libraries: C:" before CMD
  # ever runs -- CMD's real stdout is lost entirely (the stream file never
  # grows, so no mid-run checkpoint fires) while the launcher's own exit
  # code still reads 0, making this silent. Minimal repro (architect):
  # `stdbuf -oL ./launcher/dist/foreman-launch.exe --heartbeat-file /tmp/hb -- bash -c 'echo X'`
  # is fatal (no X); the same command without the `stdbuf -oL` prefix works.
  # The launcher already forwards CMD's stdio unbuffered end to end (T1
  # contract: "stdout/stderr of CMD pass through unmodified"), so stdbuf's
  # line-buffering purpose (needed for the DIRECT-spawn absent branch, where
  # nothing else guarantees line buffering) is redundant here regardless --
  # collapsing to a single un-prefixed invocation is a pure win, not a
  # tradeoff. Defense-in-depth: also strip stdbuf's own environment
  # droppings (LD_PRELOAD, _STDBUF_O, _STDBUF_E) from the launcher's spawn
  # environment via `env -u`, so a caller who invoked lane-run.sh ITSELF
  # under an outer `stdbuf` cannot re-poison CMD through env passthrough --
  # this is belt-and-braces on top of "never wrap with $STDBUF here", not a
  # substitute for it (an inherited LD_PRELOAD would poison CMD identically
  # even without lane-run.sh wrapping anything itself).
  env -u LD_PRELOAD -u _STDBUF_O -u _STDBUF_E \
    "$FOREMAN_LAUNCH_RESOLVED" --heartbeat-file "$hb" --heartbeat-interval 15 -- "$@" \
    < /dev/null > >(printf '%s\n' "$BASHPID" > "$tee_pid_file"; exec tee -a "$stream_file") 2>&1 &
  launcher_pid=$!
  lane_emit_ownership "$hb" "$attempt" "$launcher_pid"
  wait "$launcher_pid"
  rc=$?
  cmd_exit_source="$(lane_exit_source "$rc")"
else
  if [[ -n "$STDBUF" ]]; then
    # STDBUF is a fixed non-attacker-controlled string ("stdbuf -oL" or "gstdbuf -oL")
    # safe to word-split unquoted when non-empty.
    $STDBUF "$@" < /dev/null > >(printf '%s\n' "$BASHPID" > "$tee_pid_file"; exec tee -a "$stream_file") 2>&1 &
  else
    "$@" < /dev/null > >(printf '%s\n' "$BASHPID" > "$tee_pid_file"; exec tee -a "$stream_file") 2>&1 &
  fi
  cmd_pid=$!
  wait "$cmd_pid"
  rc=$?
fi

# Reap the background checkpoint/heartbeat watcher NOW, immediately after CMD
# finishes -- before anything else waits on background jobs, and before the
# finalization checkpoint below. Two reasons this must happen here first:
# (1) the watcher loops (`while true`) until explicitly killed, so reaping the
#     tee consumer next would otherwise race a still-running watcher's own
#     mid-run checkpoint; (2) per this rework's fix, the watcher's own
#     ckpt_snapshot must not still be in flight when the finalization
#     ckpt_snapshot runs below, or nothing serializes which checkpoint/
#     round_done event lands in events.jsonl first relative to which commit
#     actually became the ref tip. cleanup()'s own kill/wait remains a no-op
#     safety net for signal-driven exits (watcher_pid is cleared here so that
#     later no-op is truly a no-op).
if [[ -n "$watcher_pid" ]]; then
  kill "$watcher_pid" 2>/dev/null || true
  wait "$watcher_pid" 2>/dev/null || true
  watcher_pid=""
fi

# Retrieve tee's own pid (written by the process-substitution subshell before
# it execs into tee -- see the launch comment above). Bounded poll, not an
# unbounded wait: the write happens as the very first statement in that
# subshell, well before any real work, so this loop resolves almost
# immediately in practice; the cap just keeps it from ever hanging outright.
for _ in $(seq 1 100); do
  tee_pid="$(cat "$tee_pid_file" 2>/dev/null || true)"
  [[ -n "$tee_pid" ]] && break
  sleep 0.02
done
rm -f "$tee_pid_file"

# Rework Round 3, finding 2: replaces the old bare `wait` (which reaped
# "whatever background job is left" with no bound at all, and could hang
# forever if a detached descendant of CMD kept the output pipe open). This
# gives tee bounded time to finish draining, then escalates the same bounded
# way (TERM, then KILL) only if it is genuinely stuck.
reap_tee_bounded "$tee_pid"
tee_pid=""
if (( tee_escalated )); then
  echo "lane-run: tee consumer required forced termination; round is instrumentation-degraded" >&2
  stream_failed=1
fi
set -e

# Implement-phase duration (S4a T6): wall clock from CMD spawn to CMD exit+reap.
implement_end_epoch="$(date -u +%s)"
implement_duration_s=$(( implement_end_epoch - implement_start_epoch ))
(( implement_duration_s < 0 )) && implement_duration_s=0

# --- Finalization: post-run checkpoint + round_done ---
# Required if-assignment pattern so set -e does not abort on ckpt_snapshot
# failure, and the real exit status is still observed for checkpoint_failed.
ckpt_err_file="$(mktemp)"
if sha=$(ckpt_snapshot "$WT" "$LANE" 2>"$ckpt_err_file"); then
  checkpoint_failed=0
else
  checkpoint_failed=1
  sha=""
  cat "$ckpt_err_file" >&2
fi
rm -f "$ckpt_err_file"

# Build round_done payload. Omit stream_failed / checkpoint_failed when false
# (do not set them to false). checkpoint is JSON null when sha is empty.
# exit_source (T2): omitted entirely (not false/null) when cmd_exit_source is
# empty -- the launcher-ABSENT path never sets it, so this payload stays
# byte-identical to the pre-T2 shape there (frozen path, existing bats
# assertions only query specific keys but this keeps the shape honest too).
# tr -d '\r': Windows jq.exe emits CRLF; strip before storing/passing to el_emit.
# Usage (S4a T5): prefer vendor-reported figures from the stream when present;
# otherwise record source:"unavailable" with numeric fields absent (never zero).
_usage_vendor="${LANE_VENDOR:-}"
_usage_model="$(tl_requested_alias "${LANE_VENDOR:-}")"
_usage_effort=""
case "${LANE_VENDOR:-}" in
  codex) _usage_effort="${WC_CODEX_REASONING_EFFORT:-medium}" ;;
  grok)  _usage_effort="${WC_GROK_EFFORT:-}" ;;
esac
round_usage="$(tl_usage_from_file "$stream_file_path" "$_usage_vendor" "$_usage_model" "$_usage_effort")"
_model_id_done="$(tl_model_identity "${LANE_VENDOR:-}")"

# @description Count paths the WORKER changed in the lane worktree, excluding
#   artifacts the harness manufactured. Mirrors vendor-multiround.sh's
#   changed_paths exclusions: .harness/** is lane-run's own heartbeat and stream
#   telemetry, and SPEC-*.md is a spec staged inside the tree by the caller.
#
#   Bug ledger 2026-07-30 Event 1: round_done carried exit_code but nothing
#   about whether the round produced any work, so three lanes recorded
#   exit_code=0 with checkpoint SHAs having implemented nothing. A count lets a
#   downstream gate discriminate instead of inferring success from an exit code.
#   Never fails the round: a non-git or unreadable worktree yields 0.
# @stdout an integer
lane_files_changed() {
  git -C "$WT" status --porcelain 2>/dev/null | awk '
    {
      path = substr($0, 4)
      sub(/^"/, "", path); sub(/"$/, "", path)
      if (path ~ /^\.harness\//) next
      if (path ~ /^SPEC-[^\/]*\.md$/) next
      n++
    }
    END { print n+0 }' 2>/dev/null || printf '0'
}
_files_changed="$(lane_files_changed)"
[[ "$_files_changed" =~ ^[0-9]+$ ]] || _files_changed=0

round_payload="$(
  jq -cn \
    --argjson files_changed "$_files_changed" \
    --argjson exit_code "$rc" \
    --arg sha "$sha" \
    --argjson stream_failed "$stream_failed" \
    --argjson checkpoint_failed "$checkpoint_failed" \
    --arg exit_source "${cmd_exit_source:-}" \
    --argjson usage "$round_usage" \
    --argjson model "$_model_id_done" \
    --argjson implement_s "${implement_duration_s:-0}" \
    --arg queue_wait "${_queue_wait_s:-}" \
    --arg gate_s "${gate_duration_s:-}" \
    '{
       exit_code:$exit_code,
       files_changed:$files_changed,
       checkpoint:(if $sha == "" then null else $sha end),
       usage:$usage,
       model:$model,
       phases: (
         {implement_s: $implement_s}
         + (if $queue_wait == "" then {} else {queue_wait_s: ($queue_wait|tonumber)} end)
         + (if $gate_s == "" then {} else {gate_s: ($gate_s|tonumber)} end)
       )
     }
     | if $stream_failed != 0 then . + {stream_failed:true} else . end
     | if $checkpoint_failed != 0 then . + {checkpoint_failed:true} else . end
     | if $exit_source != "" then . + {exit_source:$exit_source} else . end' \
  | tr -d '\r'
)"

# --- ROUND_MODE (T2 `--round GATE_CMD REPORT_PATH`): lane-run.sh owns the
# WHOLE round, not just CMD. After CMD exits (any code, handled above) and is
# checkpointed (above), run GATE_CMD through the launcher the same way
# (heartbeats continue on the SAME $hb -- no gap in liveness signal across
# the CMD -> gate transition), then assert REPORT_PATH is attempt-fresh.
# round_done fires ONLY when the gate passed AND the report is fresh; a
# stale/missing report or a failing gate NEVER emits round_done (SC-D: a
# prior round's report never satisfies the predicate) -- instead a
# `waiting_child` state event and a terminal `round_incomplete` alert fire,
# and this script exits nonzero directly (bypassing the round_done emission
# below entirely).
if (( ROUND_MODE == 1 )); then
  gate_rc=0
  # T4b (v2 typed states, MINIMAL additive change -- nothing else in this
  # file changes for T4b): mark the gate-phase transition so watch.sh's
  # typed-state machine can distinguish VERIFYING from RUNNING_IMPL without
  # relying on file writes. This fires ONCE, right as the gate is about to
  # spawn (T2's F5 note: the event log goes quiet for the rest of the gate
  # phase -- $hb, not the event log, carries liveness from here on; watch.sh
  # reads $hb directly rather than expecting further structural events).
  # Unconditional (both the launcher-present and launcher-absent GATE_CMD
  # branches below) -- VERIFYING is a phase concept independent of launcher
  # presence; a launcher-absent (pure v1) round simply never has an
  # `ownership` event, so watch.sh's v1-compatibility path never looks at
  # `state` events at all and this line is inert there. Guarded exactly like
  # every other el_emit call in this file: a missed phase event must not
  # block the round.
  state_payload="$(jq -cn --argjson attempt "$attempt" '{state:"verifying",attempt:$attempt}' | tr -d '\r')"
  if ! el_emit "$RUN" state "$LANE" "$state_payload" >/dev/null; then
    echo "lane-run: el_emit state (verifying) failed" >&2
  fi
  gate_start_epoch="$(date -u +%s)"
  # Backgrounded (`&` + explicit wait), NOT a plain synchronous foreground
  # call, even though set -e is back in effect here (guarded via the
  # if-wraps-wait pattern below, matching this file's ckpt_snapshot capture
  # style) -- this is deliberate, not incidental: it is what lets cleanup()
  # (cmd_pid/launcher_pid branch) actually reach and kill the in-flight GATE
  # process if INT/TERM arrives DURING the gate phase (SC-B: "killing the
  # launcher/parent during the gate/report phase leaves zero orphan gate
  # processes"). A plain foreground call here would leave lane-run.sh's trap
  # with no pid to act on, orphaning the gate launcher on a signal.
  if [[ -n "$FOREMAN_LAUNCH_RESOLVED" ]]; then
    # Same launcher, same $hb (heartbeats continue) -- GATE_CMD is a single
    # positional word in the `--round GATE_CMD REPORT_PATH` grammar (not a
    # CMD-style ARGS... array like the round's own CMD), so it is run via
    # `bash -c` -- this lets a caller pass e.g. "scripts/gate-eval.sh run1"
    # as one quoted string.
    gate_hb_baseline="$(wc -l < "$hb" 2>/dev/null || echo 0)"
    "$FOREMAN_LAUNCH_RESOLVED" --heartbeat-file "$hb" --heartbeat-interval 15 -- bash -c "$GATE_CMD" < /dev/null &
    launcher_pid=$!
    # Rework round 1, F2: refresh LANE_OWNERSHIP_PID to the GATE's own child
    # pid (see lane_refresh_gate_ownership_pid doc comment) -- concurrent
    # with the gate running, same pattern as lane_emit_ownership for CMD, so
    # a signal arriving during this phase has the right POSIX group-kill
    # target available in cleanup() the instant it needs it.
    lane_refresh_gate_ownership_pid "$hb" "$gate_hb_baseline"
    if wait "$launcher_pid"; then gate_rc=0; else gate_rc=$?; fi
    launcher_pid=""
  else
    bash -c "$GATE_CMD" < /dev/null &
    cmd_pid=$!
    if wait "$cmd_pid"; then gate_rc=0; else gate_rc=$?; fi
    cmd_pid=""
  fi

  gate_end_epoch="$(date -u +%s)"
  gate_duration_s=$(( gate_end_epoch - gate_start_epoch ))
  (( gate_duration_s < 0 )) && gate_duration_s=0

  # Attempt-fresh predicate (spec): mtime strictly newer than THIS round's
  # prompt-event ts (round_prompt_epoch, captured before CMD ever ran), OR
  # the report contains "attempt: <current attempt id>" as a secondary
  # signal -- mtime is primary since it needs no cooperation from whatever
  # wrote the report; the attempt-string check is a fallback for filesystems/
  # transports that do not preserve mtime faithfully. Implemented inline
  # (not a helper) since it is a single-use, single-branch predicate.
  report_fresh=false
  if [[ -f "$REPORT_PATH" ]]; then
    report_mtime="$(stat -c %Y "$REPORT_PATH" 2>/dev/null || stat -f %m "$REPORT_PATH" 2>/dev/null || echo "")"
    if [[ -n "$report_mtime" ]] && (( report_mtime > round_prompt_epoch )); then
      report_fresh=true
    elif grep -Eq "attempt:[[:space:]]*${attempt}([^0-9]|\$)" "$REPORT_PATH" 2>/dev/null; then
      report_fresh=true
    fi
  fi

  if (( gate_rc == 0 )) && [[ "$report_fresh" == "true" ]]; then
    # Fold gate phase duration into the already-built round_done payload (T6).
    round_payload="$(
      jq -c         --argjson gate_rc "$gate_rc"         --argjson gate_s "${gate_duration_s:-0}"         '. + {gate_rc:$gate_rc, report_fresh:true}
         | .phases = ((.phases // {}) + {gate_s: $gate_s})'         <<<"$round_payload" | tr -d '\r'
    )"
  else
    waiting_payload="$(jq -cn --argjson gate_rc "$gate_rc" --argjson fresh "$([[ "$report_fresh" == "true" ]] && echo true || echo false)" '{gate_rc:$gate_rc, report_fresh:$fresh}' | tr -d '\r')"
    if ! el_emit "$RUN" waiting_child "$LANE" "$waiting_payload" >/dev/null; then
      echo "lane-run: el_emit waiting_child failed" >&2
    fi
    alert_payload="$(jq -cn --argjson gate_rc "$gate_rc" '{kind:"round_incomplete", gate_rc:$gate_rc, report_fresh:false}' | tr -d '\r')"
    if ! el_emit "$RUN" alert "$LANE" "$alert_payload" >/dev/null; then
      echo "lane-run: el_emit alert (round_incomplete) failed" >&2
    fi
    # NEVER emit round_done here (SC-D). Exit nonzero directly -- the EXIT
    # trap still runs cleanup() normally.
    if (( gate_rc != 0 )); then
      exit "$gate_rc"
    fi
    exit 1
  fi
fi

if (( checkpoint_failed == 0 )); then
  if ! el_emit "$RUN" round_done "$LANE" "$round_payload" "$sha" >/dev/null; then
    echo "lane-run: el_emit round_done failed" >&2
  fi
else
  if ! el_emit "$RUN" round_done "$LANE" "$round_payload" >/dev/null; then
    echo "lane-run: el_emit round_done failed" >&2
  fi
fi

# Always exit with CMD's real exit code (checkpoint/el_emit failures do not alter it).
exit "$rc"
