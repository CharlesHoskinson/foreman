#!/usr/bin/env bash
# @description T5b destructive concurrency-matrix runner: spins N same-vendor
#   lanes under isolated per-lane config dirs + throwaway workdirs + a
#   per-lane $HOME, watches all four EARS-mandated abort monitors
#   (config-file corruption, lock-acquisition freeze, cross-lane auth
#   invalidation, containment leak outside a lane's own dir -- INCLUDING via
#   its own $HOME), and prints a GREEN/RED verdict (plus, on RED, an abort
#   log). The harness LOGIC here is shim-tested
#   (tests/vendor-concurrency-test.bats) -- deterministic, no real quota.
#   Real destructive invocations (real grok/codex CLIs, real vendor quota)
#   are a manual, contained protocol run per
#   docs/research/vendor-concurrency-results.md -- this script is never
#   wired into the automatic bats suite or CI, and this file does not decide
#   pueue cap policy itself (see lane-queue.sh) -- it only reports signals.
#
#   Rework round 1 (Opus audit): the original cut shared the real ambient
#   $HOME across every lane and never re-probed auth after the run, so (a) a
#   vendor writing $HOME-relative state (Claude's own `~/.claude.json` is
#   exactly this shape -- see the Task 3 ruling in the results doc) would be
#   INVISIBLE to the containment scan (it lands outside the containment
#   root entirely), and (b) a sibling lane's auth getting invalidated by
#   concurrent use would never be observed. Both are now first-class
#   monitors: every lane gets its own `$HOME` (`<lane>/home`, also exported
#   as `$USERPROFILE` -- some cross-platform CLI runtimes resolve the home
#   directory via the Windows API / `USERPROFILE` rather than honoring
#   `$HOME`), which is a lane-owned subtree the existing whole-root
#   containment scan already covers; and a pre/post auth re-probe (the SAME
#   non-billing commands env/tool-check.sh's own `vendor_authed` uses) turns
#   a pre-run-authenticated, post-run-not lane into an explicit
#   `auth_invalidation` abort.
# Usage: vendor-concurrency-test.sh VENDOR N
#   VENDOR  vendor CLI name (also its executable name on PATH); grok/codex
#           map to GROK_HOME/CODEX_HOME (claude to CLAUDE_CONFIG_DIR); any
#           other name falls back to a generic <UPPER(VENDOR)>_HOME so the
#           harness never hard-fails on an unlisted vendor id.
#   N       number of concurrent same-vendor lane instances (>=1; the T5b
#           protocol uses 2 and 3).
# Env:
#   VCT_ROOT              explicit containment root (else BATS_TEST_TMPDIR
#                         under bats, else a fresh mktemp -d for a real
#                         manual run). Never deleted here -- a self-mktemp'd
#                         root is the only surviving transcript/evidence for
#                         a real destructive run's report.
#   VCT_SEED_CONFIG_FROM  optional directory whose contents are copied into
#                         EVERY lane's config dir before launch. Real runs:
#                         point this at a curated, auth-only seed (e.g. a
#                         copy of just auth.json/config.toml) -- never the
#                         live production config dir itself. Shim tests
#                         never set this, so lane config dirs start empty.
#   VCT_PROMPT            prompt text for the real grok/codex one-shot
#                         invocation (default: a trivial, no-tool-use ack).
#   VCT_TIMEOUT           per-lane wall-clock bound in seconds (default 150
#                         -- comfortably past the spec's 2-minute freeze
#                         threshold).
#   VCT_KILL_GRACE        seconds after VCT_TIMEOUT's SIGTERM before a
#                         SIGKILL is forced (default 5; `timeout -k`).
#   VCT_AUTH_TIMEOUT      Codex auth-probe bound in seconds (default 10).
#                         The compiled preflight owns Grok's 90-second bound.
#                         VCT_KILL_GRACE bounds the Codex probe kill grace.
# @exitcode 0 verdict computed: GREEN
# @exitcode 1 verdict computed: RED (containment/JSON/freeze/auth-invalidation
#   abort tripped -- see "abort:" reasons in stdout and the abort-log file)
# @exitcode 2 usage error (bad VENDOR/N)
# @exitcode 3 vendor CLI not found on PATH -- no verdict is printed; this is
#   an environment problem, and is reported as exactly that, never faked as
#   a GREEN/RED result
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

VENDOR="${1:-}"
N="${2:-}"
if [[ -z "$VENDOR" || -z "$N" ]]; then
  echo "usage: vendor-concurrency-test.sh VENDOR N" >&2
  exit "$EXIT_CONFIG"
fi
if [[ ! "$VENDOR" =~ ^[a-z][a-z0-9_-]*$ ]]; then
  echo "vendor-concurrency-test: invalid VENDOR '$VENDOR' (must match ^[a-z][a-z0-9_-]*\$)" >&2
  exit "$EXIT_CONFIG"
fi
if [[ ! "$N" =~ ^[0-9]+$ || "$N" -lt 1 ]]; then
  echo "vendor-concurrency-test: invalid N '$N' (must be a positive integer)" >&2
  exit "$EXIT_CONFIG"
fi

# @description Map a vendor id to its per-lane config-dir env-var name,
#   mirroring lane-run.sh's own lane_vendor_env_var for the vendors this
#   protocol covers (grok/codex; claude included for reference-only rows --
#   see the results doc). Any other vendor id falls back to a generic
#   <UPPER(VENDOR)>_HOME rather than hard-failing.
# @arg $1 vendor vendor id
# @stdout the env-var name to export per lane
vct_env_var() {
  case "$1" in
    grok)   echo GROK_HOME ;;
    codex)  echo CODEX_HOME ;;
    claude) echo CLAUDE_CONFIG_DIR ;;
    *) echo "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')_HOME" ;;
  esac
}

# @description Resolve the containment root every lane dir and any stray
#   write is measured against: an explicit VCT_ROOT override, else the
#   caller's BATS_TEST_TMPDIR (bats runs, so a shim's write to a sibling
#   path is observable), else a fresh mktemp -d for a real manual
#   invocation. Never deleted here.
# @stdout the resolved containment-root path (created if it did not exist)
vct_root() {
  local root="${VCT_ROOT:-${BATS_TEST_TMPDIR:-}}"
  if [[ -z "$root" ]]; then
    root="$(mktemp -d "${TMPDIR:-/tmp}/vct.XXXXXX")"
  fi
  mkdir -p "$root"
  printf '%s\n' "$root"
}

# @description Recursively list every path under a root, one per line,
#   sorted -- the before/after snapshot pair a containment check diffs via
#   `comm -13` to find paths that appeared during the run.
# @arg $1 root directory to list
# @stdout sorted, newline-separated absolute paths (root itself excluded)
vct_snapshot() {
  find "$1" -mindepth 1 2>/dev/null | sort
}

# @description Build the real per-lane CLI invocation for a known vendor
#   (grok/codex), populating a nameref array with argv EXCLUDING the vendor
#   executable name itself (the caller prepends that). Shim tests never
#   depend on these flags -- the bats shim scripts ignore argv entirely --
#   so hardcoding real-world, low-token, no-tool-use flags here is safe.
# @arg $1 vendor vendor id
# @arg $2 work per-lane throwaway working directory
# @arg $3 prompt prompt text for the one-shot headless call
# @arg $4 out_array_name nameref to the array to populate (cleared first)
vct_build_argv() {
  local vendor="$1" work="$2" prompt="$3"
  local -n _vct_out="$4"
  _vct_out=()
  case "$vendor" in
    grok)
      _vct_out=(-p "$prompt" --cwd "$work" --always-approve --no-alt-screen --no-auto-update --output-format json)
      ;;
    codex)
      _vct_out=(exec "$prompt" -C "$work" --sandbox read-only --skip-git-repo-check --json)
      ;;
    *)
      _vct_out=("$prompt")
      ;;
  esac
}

# @description Check whether a lane's own config dir got corrupted IN PLACE
#   (as opposed to a write escaping it -- that is the containment check).
#   Every *.json file under the dir must still parse. Feeds each file to jq
#   over STDIN (`jq empty < "$f"`), never as a path argument: a real vendor
#   CLI's own bundled-plugin cache can nest deep enough (observed: codex's
#   `.tmp/plugins/...` tree under a long containment root) to exceed
#   Windows' classic 260-char MAX_PATH, which makes jq.exe's own
#   path-argument file-open fail ("No such file or directory") even though
#   the file exists and parses fine -- bash's own redirection opens it
#   without hitting that limit, so streaming bytes over stdin sidesteps the
#   false positive entirely (empirically confirmed during the Task 2
#   destructive run; see docs/research/vendor-concurrency-results.md).
# @arg $1 dir a lane's config directory
# @stdout one bad-file path per corrupt JSON file found (empty: all valid)
vct_json_bad() {
  local dir="$1" f
  [[ -d "$dir" ]] || return 0
  while IFS= read -r f; do
    jq empty < "$f" >/dev/null 2>&1 || printf '%s\n' "$f"
  done < <(find "$dir" -type f -name '*.json' 2>/dev/null)
}

# @description Probe a lane's own auth state, run inside that lane's own
#   env (its vendor-HOME + per-lane $HOME/$USERPROFILE -- never the real
#   ambient environment). The Grok branch delegates to the compiled provider
#   preflight, which owns the bounded exact-token workload canary. The Codex
#   branch uses `codex login status`, a genuine exit-code contract. Unknown
#   vendors have no defined probe. The function returns "na" for them.
# @arg $1 vendor vendor id
# @arg $2 lane_root the lane's own root (its config/home subdirs)
# @arg $3 tmo Codex probe timeout in seconds (default 10)
# @arg $4 grace kill-grace in seconds after $3 before SIGKILL (default 3;
#   `timeout -k`)
# @stdout "yes" | "no" | "na"
vct_auth_status() {
  local vendor="$1" lane_root="$2" tmo="${3:-10}" grace="${4:-3}" env_var rc=0
  local preflight="$SCRIPT_DIR/../runtime/dist/vendor-preflight.js"
  env_var="$(vct_env_var "$vendor")"
  case "$vendor" in
    grok)
      if env "$env_var=$lane_root/config" HOME="$lane_root/home" USERPROFILE="$lane_root/home" \
        node "$preflight" inspect grok >/dev/null 2>&1; then
        echo yes
      else
        echo no
      fi
      ;;
    codex)
      if env "$env_var=$lane_root/config" HOME="$lane_root/home" USERPROFILE="$lane_root/home" \
        timeout -k "${grace}s" "${tmo}s" "$vendor" login status >/dev/null 2>&1; then
        echo yes
      else
        echo no
      fi
      ;;
    *)
      echo na
      ;;
  esac
}

# --- main ----------------------------------------------------------------
ENV_VAR="$(vct_env_var "$VENDOR")"
if ! command -v "$VENDOR" >/dev/null 2>&1; then
  echo "vendor-concurrency-test: '$VENDOR' not found on PATH -- no verdict (environment problem, not a result)" >&2
  exit "$EXIT_MISSING_CLI"
fi

ROOT="$(vct_root)"
PROMPT="${VCT_PROMPT:-Reply with exactly the single word OK. Do not use any tools, read any files, or write any files.}"
TIMEOUT_SECS="${VCT_TIMEOUT:-150}"
KILL_GRACE="${VCT_KILL_GRACE:-5}"
AUTH_TIMEOUT="${VCT_AUTH_TIMEOUT:-10}"

echo "vendor-concurrency-test: vendor=$VENDOR N=$N root=$ROOT"

BEFORE="$(vct_snapshot "$ROOT")"

declare -a LANE_ROOTS=()
for i in $(seq 1 "$N"); do
  lane_root="$ROOT/vct-$VENDOR-lane$i"
  # `home` is a lane-owned subtree (nested under lane_root, itself under
  # ROOT) -- the existing whole-root containment scan below already covers
  # it with no extra logic needed; it is created here, before the BEFORE
  # snapshot's callers spin any lane, same as config/work.
  mkdir -p "$lane_root/config" "$lane_root/work" "$lane_root/home"
  if [[ -n "${VCT_SEED_CONFIG_FROM:-}" && -d "$VCT_SEED_CONFIG_FROM" ]]; then
    cp -r "$VCT_SEED_CONFIG_FROM/." "$lane_root/config/" 2>/dev/null || true
  fi
  LANE_ROOTS+=("$lane_root")
done

# --- pre-run auth probe (baseline, before any lane's main task runs) ------
# Concurrent (like the main task below), not sequential: N sequential
# `timeout 10s`-bounded probes would otherwise multiply the wall-clock cost
# by N for no benefit -- there is no ordering dependency between lanes'
# baseline probes.
for i in $(seq 1 "$N"); do
  lane_root="${LANE_ROOTS[$((i-1))]}"
  ( vct_auth_status "$VENDOR" "$lane_root" "$AUTH_TIMEOUT" "$KILL_GRACE" > "$lane_root/pre-auth" ) &
done
wait
declare -a PRE_AUTH=()
for i in $(seq 1 "$N"); do
  PRE_AUTH+=("$(cat "${LANE_ROOTS[$((i-1))]}/pre-auth" 2>/dev/null || echo na)")
done

declare -a ARGV=()
for i in $(seq 1 "$N"); do
  lane_root="${LANE_ROOTS[$((i-1))]}"
  (
    export "$ENV_VAR=$lane_root/config"
    export HOME="$lane_root/home"
    export USERPROFILE="$lane_root/home"
    vct_build_argv "$VENDOR" "$lane_root/work" "$PROMPT" ARGV
    set +e
    timeout -k "${KILL_GRACE}s" "${TIMEOUT_SECS}s" "$VENDOR" "${ARGV[@]}" \
      >"$lane_root/stdout" 2>"$lane_root/stderr"
    printf '%s\n' "$?" > "$lane_root/rc"
  ) &
done
wait

# --- post-run auth re-probe (cross-lane auth invalidation) ---------------
for i in $(seq 1 "$N"); do
  lane_root="${LANE_ROOTS[$((i-1))]}"
  ( vct_auth_status "$VENDOR" "$lane_root" "$AUTH_TIMEOUT" "$KILL_GRACE" > "$lane_root/post-auth" ) &
done
wait
declare -a POST_AUTH=()
for i in $(seq 1 "$N"); do
  POST_AUTH+=("$(cat "${LANE_ROOTS[$((i-1))]}/post-auth" 2>/dev/null || echo na)")
done
AUTH_INVALID=""
for i in $(seq 1 "$N"); do
  if [[ "${PRE_AUTH[$((i-1))]}" == "yes" && "${POST_AUTH[$((i-1))]}" == "no" ]]; then
    AUTH_INVALID+="lane $i (pre=yes post=no)"$'\n'
  fi
done

AFTER="$(vct_snapshot "$ROOT")"

# --- containment: any new path outside every lane's own root -------------
LEAKS=""
while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  owned=0
  for lr in "${LANE_ROOTS[@]}"; do
    if [[ "$p" == "$lr" || "$p" == "$lr"/* ]]; then owned=1; break; fi
  done
  if [[ "$owned" -eq 0 ]]; then LEAKS+="$p"$'\n'; fi
done < <(comm -13 <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER"))

# --- config-JSON validity per lane -----------------------------------------
JSON_BAD=""
for lr in "${LANE_ROOTS[@]}"; do
  bad="$(vct_json_bad "$lr/config")"
  [[ -n "$bad" ]] && JSON_BAD+="$bad"$'\n'
done

# --- freeze / forced-kill --------------------------------------------------
FROZEN=""
for i in $(seq 1 "$N"); do
  lane_root="${LANE_ROOTS[$((i-1))]}"
  rc="$(cat "$lane_root/rc" 2>/dev/null || echo -1)"
  echo "lane $i: rc=$rc config=$lane_root/config work=$lane_root/work home=$lane_root/home auth(pre/post)=${PRE_AUTH[$((i-1))]}/${POST_AUTH[$((i-1))]}"
  if [[ "$rc" == "124" || "$rc" == "137" ]]; then
    FROZEN+="lane $i (rc=$rc)"$'\n'
  fi
done

# --- 429 / rate-limit pattern (report-only signal, never auto-RED) --------
# \b429\b (not a bare "429") -- empirically, a bare substring match false-
# positives on session/thread UUIDs that merely happen to contain the
# digits "429" (observed during the Task 2 destructive run: a codex
# thread_id like "...-9429-..." ); a genuine HTTP 429 is always
# word-bounded ("status 429", "429 Too Many Requests").
RATE_HIT=0
for lr in "${LANE_ROOTS[@]}"; do
  if grep -ilE '\b429\b|rate.?limit|too many requests' "$lr/stdout" "$lr/stderr" >/dev/null 2>&1; then
    RATE_HIT=1
  fi
done

if [[ -n "$LEAKS" ]]; then
  echo "containment: LEAK DETECTED:"; printf '%s' "$LEAKS" | sed 's/^/  /'
else
  echo "containment: clean"
fi
if [[ -n "$JSON_BAD" ]]; then
  echo "config-json: INVALID:"; printf '%s' "$JSON_BAD" | sed 's/^/  /'
else
  echo "config-json: valid"
fi
if [[ -n "$FROZEN" ]]; then
  echo "freeze: TRIPPED:"; printf '%s' "$FROZEN" | sed 's/^/  /'
else
  echo "freeze: none"
fi
if [[ "$RATE_HIT" -eq 1 ]]; then
  echo "rate-limit signal: 429/rate-limit pattern observed (see per-lane stderr; not auto-RED -- shared-quota 429s are expected, only a cascade beyond shared-quota math is)"
else
  echo "rate-limit signal: none"
fi
if [[ -n "$AUTH_INVALID" ]]; then
  echo "auth-invalidation: TRIPPED:"; printf '%s' "$AUTH_INVALID" | sed 's/^/  /'
else
  echo "auth-invalidation: none"
fi

if [[ -n "$LEAKS$JSON_BAD$FROZEN$AUTH_INVALID" ]]; then
  ABORT_LOG="$ROOT/vct-$VENDOR-$N-abort.log"
  {
    echo "vendor=$VENDOR N=$N root=$ROOT"
    if [[ -n "$LEAKS" ]]; then echo "trigger: containment violation (write escaped a lane's own dir)"; printf '%s' "$LEAKS"; fi
    if [[ -n "$JSON_BAD" ]]; then echo "trigger: config-JSON corruption"; printf '%s' "$JSON_BAD"; fi
    if [[ -n "$FROZEN" ]]; then echo "trigger: lock-acquisition freeze / forced kill"; printf '%s' "$FROZEN"; fi
    if [[ -n "$AUTH_INVALID" ]]; then echo "trigger: cross-lane auth invalidation"; printf '%s' "$AUTH_INVALID"; fi
  } > "$ABORT_LOG"
  echo "abort: see $ABORT_LOG"
  echo "VERDICT: RED"
  exit "$EXIT_FAIL"
fi

echo "VERDICT: GREEN"
exit "$EXIT_OK"
