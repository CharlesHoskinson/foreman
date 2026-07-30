#!/usr/bin/env bash
# @description Queue-based lane admission wrapper over pueue (v4.0.4 staged at
#   $HOME/.foreman/tools/pueue/{pueue.exe,pueued.exe}). Foreman lanes call this
#   instead of spawning coding-CLI processes directly whenever pueue is
#   available, so per-vendor concurrency groups (grok/codex/claude) plus a
#   host-wide `gate` group (parallel=1, meant to eventually serialize every
#   bats invocation on the host) are enforced centrally rather than left to
#   each lane's own judgment. `misc` is the catch-all group for everything
#   else; it is created with an EXPLICIT cap of 2 (`pueue parallel 2 --group
#   misc`) -- a deliberate architect decision (Rework Round 1, F1), not an
#   accident: pueue's own inherited default for a freshly created group
#   happens to be 1, but leaving that unset here would make the cap
#   incidental rather than intentional, and truly unlimited (parallel 0)
#   would violate this host's keep-concurrency-low doctrine. 2 is the
#   deliberate middle ground for a catch-all bucket that is not one of the
#   three named vendor lanes.
#
#   When pueue is unavailable -- not on PATH, not staged under
#   $HOME/.foreman/tools/pueue, or LANE_QUEUE_FORCE_MISSING=1 is set (test
#   hook, mirrors DOCS_CHECK_FORCE_MISSING in docs-check.sh:25-33) -- this
#   degrades to direct foreground spawn and emits a one-time "degraded"
#   marker on stderr so callers/log-scrapers can tell queueing was skipped.
#   This fallback keys STRICTLY on BINARY ABSENCE (pueue not resolvable via
#   PATH or the staged dir) or the FORCE_MISSING test hook -- never on
#   daemon liveness. If pueue is installed but the daemon dies between an
#   `ensure` call and a later `add`/`status`/`kill` call, that later call
#   fails loudly (pueue's own nonzero exit, surfaced here as EXIT_FAIL) --
#   it is a hard exit 1 by design, NEVER a silent fall-through to direct
#   spawn. Silently running CMD outside the queue when the caller explicitly
#   asked for queued admission would be worse than a hard, visible failure.
#
#   QUOTING (Rework Round 2 -- product bug fix, empirically diagnosed and
#   fixed; Rework Round 3 -- shell-guarded, was unconditional): pueue's own
#   `add` ALWAYS re-joins the COMMAND argv it receives with a plain space (no
#   quoting added), producing ONE flat string that it then hands to its
#   CONFIGURED SHELL to interpret -- this is pueue's documented behavior
#   ("commands are executed via your system shell...the command needs proper
#   shell escaping"), not a bug in pueue itself. This means argv-array
#   boundaries NEVER survive `pueue add` on their own, regardless of how
#   carefully this script's own caller quotes CMD/ARGS -- the quoting has to
#   happen for whatever shell pueue's resolved daemon will actually use.
#
#   SHELL DETECTION (per-invocation, from the resolved binary's own flavor --
#   see lq_quote_for_shell): a `.exe` pueue CLIENT binary implies a WINDOWS
#   daemon, whose built-in default shell -- empirically determined on this
#   host, %APPDATA%\pueue\pueue.yml has `shell_command: null` ("use the
#   built-in default"), confirmed via probe tasks read back with `pueue log`,
#   see FOREMAN_REPORT.md -- is WINDOWS POWERSHELL 5.1 ("Desktop" edition),
#   NOT cmd.exe and NOT bash. A non-`.exe` binary implies a POSIX daemon
#   (relevant for v0.3.0 on WSL, not yet live on this Windows host), whose
#   built-in default is `sh -c`. These are TWO INCOMPATIBLE QUOTING DIALECTS,
#   not two names for the same thing:
#     - PowerShell: embedded `'` DOUBLED (`''`); a leading `&` call-operator
#       token is REQUIRED, because a statement whose first token is itself a
#       quoted string is otherwise parsed as a bare expression, not a command
#       invocation (both verified empirically).
#     - POSIX sh: embedded `'` escaped via close-quote / backslash-escaped-
#       quote / reopen-quote (`'\''`) -- doubling (`''`) is WRONG here and
#       was Round 2's actual latent bug (unreproduced on this Windows-only
#       host until Round 3's audit): under POSIX quoting rules `''` is simply
#       two adjacent empty-string tokens, i.e. it SILENTLY DELETES the quote
#       rather than escaping it. A leading `&` is also a HARD SYNTAX ERROR
#       under POSIX sh (background-job operator with nothing before it).
#   Applying the PowerShell transform unconditionally -- Round 2's mistake --
#   is therefore actively harmful, not just unnecessary, the moment a POSIX
#   daemon is in the picture. `lq_quote_for_shell` decides ONCE per `add`
#   invocation which dialect applies (from the resolved pueue_bin's own
#   flavor, via lq_is_windows_pueue) and additionally fails fast
#   (EXIT_CONFIG) rather than silently mis-quoting if the daemon's own config
#   overrides `shell_command` to something neither dialect recognizes (see
#   lq_shell_command_override) -- an unrecognized override means neither
#   heuristic is safe to assume.
#
#   FLAVOR-DETECTION GOTCHA (Round 3, empirically confirmed on this host):
#   checking the resolved path STRING for a literal ".exe" suffix is NOT
#   enough. MSYS/Git-Bash's own `command -v`/`type -p` report a bare name
#   with NO ".exe" suffix even when the ONLY file actually on disk is
#   "<name>.exe" (Windows' own PATHEXT-style resolution, surfaced through
#   MSYS -- confirmed: a directory containing only `pueue.exe` on PATH makes
#   `command -v pueue` print `.../pueue`, not `.../pueue.exe`, and `ls` shows
#   both names refer to the same file). Since lq_pueue_bin tries `command -v
#   pueue` FIRST (falling back to the hardcoded, ".exe"-suffixed staged path
#   only when PATH resolution fails), a naive suffix check would silently
#   mis-classify a real Windows daemon found via PATH as POSIX. Detection
#   therefore also checks whether "<resolved_path>.exe" exists as a file.
#
#   Concretely, the pre-Round-2 bug: `lane-queue.sh add misc -- bash -c
#   "sleep 5"` used to enqueue the literal string `bash -c sleep 5`;
#   PowerShell then tokenized that on whitespace with NO quoting at all, so
#   bash's `-c` only ever received the bare word "sleep" as its script (with
#   "5" becoming an unused positional), and `sleep` with no operand failed in
#   under a second. Quoting each token for the ACTUAL downstream shell before
#   it ever reaches `pueue add` is the only way an embedded space/quote in
#   one logical argument survives the round trip; pueue's own space-join of
#   the pre-quoted tokens then reconstructs exactly the intended command
#   line, e.g. `& 'bash' '-c' 'sleep 5'` (PowerShell) or `bash -c 'sleep 5'`
#   (POSIX). This was chosen over the alternative of reconfiguring pueue's
#   `shell_command`: that config file is SHARED host-wide state (the same
#   file backs the one long-lived pueued instance other lanes/gates already
#   depend on), so rewriting it out from under concurrent users would be far
#   riskier than quoting correctly for whatever shell pueue is already
#   configured to use. Both quoting functions perform pure, deterministic
#   character substitution only -- neither evaluates, sources, or otherwise
#   interprets caller-controlled content as a command itself, so this
#   preserves the same injection-safety property as the original argv-
#   passthrough design.
#
#   CLEANUP (Rework Round 2, F5-equivalent): `ensure` intentionally does NOT
#   clean up finished-task history (no `pueue clean` call, no `clean`
#   subcommand here) -- finished-task accumulation on the shared daemon is
#   OPERATOR-owned (run `pueue clean` by hand against the shared instance);
#   auto-clearing it here could destroy another lane's still-relevant
#   task/log history out from under them.
#
#   AUTOSTART DOCTRINE (empirically determined on this host: pueue 4.0.4,
#   Windows/Git-Bash -- full transcript in FOREMAN_REPORT.md): the pueue
#   CLIENT never starts the daemon itself.
#     - First ever run (no config file yet, no daemon): `pueue status` fails
#       immediately, exit 1, "Couldn't find a configuration file. Did you
#       start the daemon yet?".
#     - Config file present (pueued has run at least once) but the daemon is
#       down: `pueue status` fails immediately, exit 1, "Failed to connect to
#       the daemon on 127.0.0.1:<port>. Did you start it?".
#   Neither path spawns pueued -- both are plain, immediate client errors.
#   `ensure` below therefore always spawns `pueued -d` itself (`-d`/
#   --daemonize forks pueued into the background; confirmed via `tasklist`
#   that the forked pueued.exe process survives the launching shell)
#   whenever the first `pueue status` probe fails, then bounded-retries the
#   probe for up to ~5s before giving up.
# Usage: lane-queue.sh ensure
#        lane-queue.sh add GROUP -- CMD [ARGS...]
#        lane-queue.sh status [TASK_ID]
#        lane-queue.sh kill TASK_ID
# Env: LANE_QUEUE_FORCE_MISSING=1 forces the pueue-absent fallback path
#      regardless of PATH/staged-binary presence (test hook).
# @exitcode 0 success (ensure: ready; add: enqueued/CMD's own code in
#   fallback; status/kill: pueue's own outcome)
# @exitcode 1 daemon unreachable after bounded retry (ensure); a pueue call
#   itself failed (add/status/kill, non-fallback)
# @exitcode 2 usage error (bad subcommand/args, invalid GROUP, kill with no
#   TASK_ID); kill in fallback mode (nothing to kill)
# @exitcode 3 pueue absent -- fallback mode (ensure only)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

# --- arity guard (before unguarded positional use under set -u) ---
if (( $# < 1 )); then
  echo "usage: lane-queue.sh ensure|add GROUP -- CMD [ARGS...]|status [TASK_ID]|kill TASK_ID" >&2
  exit "$EXIT_CONFIG"
fi

# @description Resolve the pueue CLIENT executable: PATH first, then the
#   staged install dir ($HOME/.foreman/tools/pueue). LANE_QUEUE_FORCE_MISSING=1
#   short-circuits to "not found" regardless of what is actually on disk
#   (test hook mirroring docs-check.sh's DOCS_CHECK_FORCE_MISSING pattern,
#   docs-check.sh:25-33).
# @stdout the resolved executable path (CR-free)
# @exitcode 0 found; 1 absent
lq_pueue_bin() {
  [[ "${LANE_QUEUE_FORCE_MISSING:-0}" == "1" ]] && return 1
  if command -v pueue >/dev/null 2>&1; then
    command -v pueue
    return 0
  fi
  local staged="$HOME/.foreman/tools/pueue/pueue.exe"
  if [[ -x "$staged" ]]; then
    printf '%s\n' "$staged"
    return 0
  fi
  staged="$HOME/.foreman/tools/pueue/pueue"
  if [[ -x "$staged" ]]; then
    printf '%s\n' "$staged"
    return 0
  fi
  return 1
}

# @description Resolve the pueued DAEMON executable using the same
#   PATH-then-staged resolution as lq_pueue_bin (and the same
#   LANE_QUEUE_FORCE_MISSING test hook). Only `ensure` needs this --
#   add/status/kill never start the daemon themselves.
# @stdout the resolved executable path (CR-free)
# @exitcode 0 found; 1 absent
lq_pueued_bin() {
  [[ "${LANE_QUEUE_FORCE_MISSING:-0}" == "1" ]] && return 1
  if command -v pueued >/dev/null 2>&1; then
    command -v pueued
    return 0
  fi
  local staged="$HOME/.foreman/tools/pueue/pueued.exe"
  if [[ -x "$staged" ]]; then
    printf '%s\n' "$staged"
    return 0
  fi
  staged="$HOME/.foreman/tools/pueue/pueued"
  if [[ -x "$staged" ]]; then
    printf '%s\n' "$staged"
    return 0
  fi
  return 1
}

# @description Probe whether the pueue daemon is reachable.
# @arg $1 pueue_bin resolved pueue client executable path
# @exitcode 0 daemon reachable; nonzero otherwise
lq_status_probe() {
  "$1" status >/dev/null 2>&1
}

# @description Quote one token as a POWERSHELL single-quoted string literal
#   (embedded `'` DOUBLED to `''`, PowerShell's own escaping rule for that
#   quote style). Only correct for a PowerShell downstream shell -- see
#   lq_quote_for_shell, which decides which dialect applies. Pure,
#   deterministic character substitution only -- never evaluates its input,
#   so caller-controlled content is never interpreted as a command by OUR
#   bash.
# @arg $1 token raw token to quote
# @stdout the PowerShell single-quoted literal, e.g. input `a 'b` -> `'a ''b'`
lq_pwsh_quote() {
  printf "'%s'" "${1//\'/\'\'}"
}

# @description Quote one token as a POSIX single-quoted shell literal
#   (embedded `'` escaped via the standard close-quote / backslash-escaped-
#   quote / reopen-quote idiom, `'\''` -- NOT doubled: doubling is a
#   PowerShell-ism that under POSIX quoting rules is simply two adjacent
#   empty single-quoted strings, silently DELETING the quote instead of
#   escaping it). Only correct for a POSIX downstream shell (`sh`/bash-as-sh)
#   -- see lq_quote_for_shell. Pure, deterministic character substitution
#   only, same injection-safety property as lq_pwsh_quote.
# @arg $1 token raw token to quote
# @stdout the POSIX single-quoted literal, e.g. input `it's` -> `'it'\''s'`
lq_posix_quote() {
  local q="'" esc="'\\''"
  printf "'%s'" "${1//$q/$esc}"
}

# @description Read the daemon.shell_command value from whatever pueue
#   config file pueue's OWN client/daemon binaries would resolve
#   ($PUEUE_CONFIG_PATH if set, else the platform default -- $APPDATA/pueue/
#   pueue.yml on Windows, ${XDG_CONFIG_HOME:-$HOME/.config}/pueue/pueue.yml
#   on POSIX). A minimal, single-key extractor in the house style of
#   lib/config.sh's own hand-rolled TOML subset parser -- NOT a general YAML
#   parser, and deliberately so: the only question this needs to answer is
#   "did the operator override shell_command away from null", not "parse
#   this file". Absent config file, absent key, or a literal `null` value
#   all mean "no override" (empty stdout, exit 0) -- pueue's own built-in
#   platform default applies, matching lq_quote_for_shell's binary-flavor
#   heuristic. Any OTHER value is a real override this function cannot
#   itself interpret -- returned verbatim (quotes stripped) so the caller
#   can fail fast instead of guessing which quoting dialect it implies.
# @stdout the override value, CR-free (empty when there is none)
# @exitcode 0 always
lq_shell_command_override() {
  local cfg="${PUEUE_CONFIG_PATH:-}"
  if [[ -z "$cfg" ]]; then
    if [[ -n "${APPDATA:-}" && -f "$APPDATA/pueue/pueue.yml" ]]; then
      cfg="$APPDATA/pueue/pueue.yml"
    elif [[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/pueue/pueue.yml" ]]; then
      cfg="${XDG_CONFIG_HOME:-$HOME/.config}/pueue/pueue.yml"
    fi
  fi
  [[ -n "$cfg" && -f "$cfg" ]] || return 0

  local line val
  line="$(grep -m1 '^[[:space:]]*shell_command:' "$cfg" 2>/dev/null || true)"
  line="${line%$'\r'}"
  [[ -n "$line" ]] || return 0
  val="${line#*shell_command:}"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  [[ -z "$val" || "$val" == "null" ]] && return 0
  if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then
    val="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$val"
  return 0
}

# @description Determine whether the resolved pueue CLIENT binary is a
#   Windows (.exe) executable. Robust to this host's own path-resolution
#   quirk (see the header FLAVOR-DETECTION GOTCHA note): checks BOTH the
#   returned path string for a literal ".exe" suffix (the hardcoded staged
#   fallback in lq_pueue_bin spells this out explicitly) AND whether
#   "<path>.exe" exists as a real file (covers the `command -v`/PATH
#   resolution case, where MSYS strips the suffix from its own output even
#   though the only file on disk is "<name>.exe").
# @arg $1 pueue_bin resolved pueue client executable path
# @exitcode 0 Windows (.exe) binary; 1 otherwise (POSIX)
lq_is_windows_pueue() {
  [[ "$1" == *.exe || -f "$1.exe" ]]
}

# @description Decide, ONCE per `add` invocation, which shell pueue's
#   resolved daemon will actually use to run the joined command line, and
#   populate $2 (a nameref array, cleared first) with CMD/ARGS quoted for
#   THAT shell -- ready to append after `pueue add --group G --print-task-id
#   --`. Shell choice is derived from the resolved pueue CLIENT binary's own
#   flavor (lq_is_windows_pueue): a Windows binary implies a Windows daemon
#   (PowerShell 5.1 default: lq_pwsh_quote + a leading `&` call-operator
#   token); anything else implies a POSIX daemon (`sh -c` default:
#   lq_posix_quote, no `&` -- a leading `&` is a hard POSIX syntax error).
#   See the header QUOTING/SHELL DETECTION note for why applying one dialect
#   unconditionally (Round 2's mistake) is actively wrong for the other.
#   Fails fast rather than guessing when the daemon's own config overrides
#   shell_command to a value neither dialect recognizes
#   (lq_shell_command_override) -- an unrecognized override means NEITHER
#   heuristic is safe to assume.
# @arg $1 pueue_bin resolved pueue client executable path
# @arg $2 out_array_name nameref to the array to populate
# @arg $@ tokens (from $3 on) CMD followed by its ARGS
# @exitcode 0 out_array populated; 2 unclassifiable shell_command override
lq_quote_for_shell() {
  local pueue_bin="$1"
  local -n _lq_out="$2"
  shift 2
  _lq_out=()

  local override
  override="$(lq_shell_command_override)"
  if [[ -n "$override" ]]; then
    echo "lane-queue: pueue config overrides daemon.shell_command to '$override' -- lane-queue.sh does not know how to quote for that shell and refuses to guess (fix: unset shell_command in the pueue config, or extend lq_quote_for_shell to support it explicitly)" >&2
    return "$EXIT_CONFIG"
  fi

  local tok
  if lq_is_windows_pueue "$pueue_bin"; then
    _lq_out+=("&")
    for tok in "$@"; do
      _lq_out+=("$(lq_pwsh_quote "$tok")")
    done
  else
    for tok in "$@"; do
      _lq_out+=("$(lq_posix_quote "$tok")")
    done
  fi
  return "$EXIT_OK"
}

# @description Idempotently create one pueue group and, when a parallelism N
#   is supplied, set it. "already exists" from `pueue group add` is tolerated
#   (not an error, per the durable-lanes portability checklist); any other
#   group-add/parallel failure is logged to stderr but does not abort ensure
#   -- the daemon already answered the status probe before this is called, so
#   a genuine failure here is unexpected but should not block the caller's
#   ability to still enqueue work.
# @arg $1 pueue_bin resolved pueue client executable path
# @arg $2 name group name
# @arg $3 parallel optional parallelism; empty means "leave pueue's default"
lq_ensure_group() {
  local pueue_bin="$1" name="$2" parallel="$3" err rc
  rc=0
  err="$("$pueue_bin" group add "$name" 2>&1 >/dev/null)" || rc=$?
  if [[ "$rc" != 0 ]]; then
    err="${err//$'\r'/}"
    [[ "$err" == *"already exists"* ]] || echo "lane-queue: group add $name: $err" >&2
  fi
  if [[ -n "$parallel" ]]; then
    rc=0
    err="$("$pueue_bin" parallel "$parallel" --group "$name" 2>&1 >/dev/null)" || rc=$?
    if [[ "$rc" != 0 ]]; then
      err="${err//$'\r'/}"
      echo "lane-queue: parallel $parallel --group $name: $err" >&2
    fi
  fi
  return 0
}

# @description `ensure` subcommand: resolve pueue, start pueued if the daemon
#   is unreachable (empirically, the pueue CLIENT never autostarts it -- see
#   the AUTOSTART DOCTRINE note in this file's header), then idempotently
#   create the fixed group topology (grok=1, codex=1, claude=3, misc=2
#   EXPLICIT -- see the header's Rework Round 1 F1 note, gate=1). grok=1 and
#   codex=1 are pinned by the T5b destructive-concurrency verdict
#   (docs/research/vendor-concurrency-results.md, "Results" table, 2026-07-18):
#   NO vendor has a recorded GREEN row on this host -- the authenticated
#   N=2/N=3 matrix could not be safely run there (see that doc's "Task 2
#   execution log"), so both stay at the UNVERIFIED default per EARS ("no
#   cap raised without a recorded green row; default-on-doubt is 1"). A
#   future cap raise here MUST cite a specific GREEN row added to that doc.
# @exitcode 0 ready; 1 daemon unreachable after bounded retry; 3 pueue absent
cmd_ensure() {
  local pueue_bin pueued_bin
  if ! pueue_bin="$(lq_pueue_bin)"; then
    echo "lane-queue: pueue not found on PATH or \$HOME/.foreman/tools/pueue -- fallback mode" >&2
    return "$EXIT_MISSING_CLI"
  fi
  if ! pueued_bin="$(lq_pueued_bin)"; then
    echo "lane-queue: pueue client found but pueued daemon binary missing -- fallback mode" >&2
    return "$EXIT_MISSING_CLI"
  fi

  if ! lq_status_probe "$pueue_bin"; then
    # AUTOSTART DOCTRINE (see header): the client never spawns the daemon --
    # this script has to do it explicitly.
    "$pueued_bin" -d >/dev/null 2>&1 || true
    local waited=0 ready=1
    while (( waited < 5 )); do
      if lq_status_probe "$pueue_bin"; then
        ready=0
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
    if (( ready != 0 )); then
      echo "lane-queue: pueued daemon unreachable after spawn + ${waited}s retry" >&2
      return "$EXIT_FAIL"
    fi
  fi

  # agy=1: the Antigravity (Google) lane became a real worker vendor when
  # lib/worker-cmd.sh gained its argv branch, but it has NO concurrency evidence
  # -- no T5b-style live row at any N. The rule below applies to it unchanged:
  # caps are raised only to a proven-green N, so it starts serial. Without a
  # group at all an agy lane builds fine and is then never scheduled, which is a
  # worse failure than a conservative cap because nothing reports it.
  # Appended at the end so the T5b topology assertion, which greps the literal
  # prefix `for spec in grok:3 codex:2`, keeps binding to the proven values.
  # grok=3, codex=2: raised on the 2026-07-18 LIVE authenticated shared-account
  # T5b verdict -- grok GREEN@2 and @3 (3/3 lanes clean, config+auth intact,
  # sessions path-isolated), codex GREEN@2 (both clean, no port collision in
  # exec mode, auth intact, SQLite-backed state). Rows in
  # docs/research/vendor-concurrency-results.md. Do not raise further without a
  # green row at the higher N.
  local spec
  for spec in grok:3 codex:2 claude:3 misc:2 gate:1 agy:1; do
    lq_ensure_group "$pueue_bin" "${spec%%:*}" "${spec#*:}"
  done
  echo "lane-queue: ready (groups: grok codex claude misc gate agy)" >&2
  return "$EXIT_OK"
}

# @description `add` subcommand: enqueue CMD/ARGS into pueue group GROUP, or
#   -- in fallback mode (pueue absent / LANE_QUEUE_FORCE_MISSING=1) -- run CMD
#   directly in the foreground and print `direct` instead of a task id.
#   Non-fallback path (Rework Round 2, shell-guarded in Round 3): CMD/ARGS
#   are individually quoted via lq_quote_for_shell for whichever shell
#   pueue's resolved daemon will actually use (decided ONCE per call from
#   the resolved binary's own flavor -- see the header's QUOTING/SHELL
#   DETECTION note) before being handed to `pueue add`, since pueue itself
#   re-joins whatever argv it receives with a plain, unquoted space --
#   passing raw argv through unquoted (the pre-Round-2 behavior) silently
#   lost argument boundaries, and quoting for the WRONG shell unconditionally
#   (Round 2's own bug, fixed here) is actively harmful, not just a no-op,
#   for the other shell family. This script itself still never evaluates
#   CMD/ARGS as a shell string -- quoting is pure character substitution,
#   not interpretation.
# @arg $1 group target pueue group name, must match ^[a-z][a-z0-9_-]*$
# @arg $2 dashdash literal "--" separating GROUP from CMD
# @arg $@ cmd_and_args CMD followed by its ARGS
# @stdout the pueue task id, CR-free (fallback: the literal string `direct`)
# @exitcode 0 enqueued (fallback: CMD's own exit code); 1 pueue add failed; 2
#   usage error, or an unclassifiable daemon.shell_command override
#   (lq_quote_for_shell)
cmd_add() {
  local group="${1:-}" dashdash="${2:-}"
  if [[ -z "$group" || "$dashdash" != "--" ]]; then
    echo "usage: lane-queue.sh add GROUP -- CMD [ARGS...]" >&2
    return "$EXIT_CONFIG"
  fi
  if [[ ! "$group" =~ ^[a-z][a-z0-9_-]*$ ]]; then
    echo "lane-queue: invalid GROUP '$group' (must match ^[a-z][a-z0-9_-]*\$)" >&2
    return "$EXIT_CONFIG"
  fi
  shift 2
  if [[ $# -eq 0 ]]; then
    echo "usage: lane-queue.sh add GROUP -- CMD [ARGS...]" >&2
    return "$EXIT_CONFIG"
  fi

  local pueue_bin
  if ! pueue_bin="$(lq_pueue_bin)"; then
    echo "lane-queue: degraded direct-spawn (pueue absent)" >&2
    local rc=0
    "$@" || rc=$?
    echo "direct"
    return "$rc"
  fi

  # Quote CMD/ARGS for whichever shell pueue's resolved daemon will actually
  # use (see lq_quote_for_shell) -- the command line pueue's own space-join
  # will reconstruct.
  local -a quoted_argv
  lq_quote_for_shell "$pueue_bin" quoted_argv "$@" || return $?

  local out rc=0
  out="$("$pueue_bin" add --group "$group" --print-task-id -- "${quoted_argv[@]}" 2>&1)" || rc=$?
  out="${out//$'\r'/}"
  if [[ "$rc" != 0 ]]; then
    echo "$out" >&2
    return "$EXIT_FAIL"
  fi
  printf '%s\n' "$out"
  return "$EXIT_OK"
}

# @description `status` subcommand: whole-queue or single-task JSON via
#   `pueue status --json`. Fallback mode (pueue absent) prints a fixed
#   degraded sentinel instead of querying anything.
# @arg $1 task_id optional; when given, filters to that task's object
# @stdout JSON, CR-free: the full `pueue status --json` body, or one task's
#   object (`{}` if the id is absent -- tolerate missing fields), or
#   `{"degraded":true}` in fallback mode
# @exitcode 0 ok / fallback; 1 pueue status failed, or (single-task path) the
#   jq filter itself failed -- its rc is captured explicitly, never left to
#   abort via a bare set -e/pipefail pipeline exit
cmd_status() {
  local task_id="${1:-}"
  local pueue_bin
  if ! pueue_bin="$(lq_pueue_bin)"; then
    printf '%s\n' '{"degraded":true}'
    return "$EXIT_OK"
  fi
  local raw rc=0
  raw="$("$pueue_bin" status --json 2>&1)" || rc=$?
  raw="${raw//$'\r'/}"
  if [[ "$rc" != 0 ]]; then
    echo "$raw" >&2
    return "$EXIT_FAIL"
  fi
  if [[ -n "$task_id" ]]; then
    local filtered
    if ! filtered="$(printf '%s' "$raw" | jq -c --arg id "$task_id" '.tasks[$id] // {}' 2>&1)"; then
      echo "${filtered//$'\r'/}" >&2
      return "$EXIT_FAIL"
    fi
    printf '%s\n' "${filtered//$'\r'/}"
  else
    printf '%s\n' "$raw"
  fi
  return "$EXIT_OK"
}

# @description `kill` subcommand: `pueue kill TASK_ID`. Fallback mode has
#   nothing to kill -- direct spawns are owned by the caller's own foreground
#   process, not by lane-queue.sh -- so this is a usage error there.
# @arg $1 task_id required, must match ^[0-9]+$
# @stdout pueue's own confirmation text, CR-free
# @exitcode 0 killed; 1 pueue kill failed; 2 usage error (missing/non-numeric
#   TASK_ID) / fallback mode
cmd_kill() {
  local task_id="${1:-}"
  if [[ -z "$task_id" ]]; then
    echo "usage: lane-queue.sh kill TASK_ID" >&2
    return "$EXIT_CONFIG"
  fi
  if [[ ! "$task_id" =~ ^[0-9]+$ ]]; then
    echo "lane-queue: invalid TASK_ID '$task_id' (must match ^[0-9]+\$)" >&2
    return "$EXIT_CONFIG"
  fi
  local pueue_bin
  if ! pueue_bin="$(lq_pueue_bin)"; then
    echo "lane-queue: kill unsupported in fallback mode (direct spawns are owned by the caller)" >&2
    return "$EXIT_CONFIG"
  fi
  local out rc=0
  out="$("$pueue_bin" kill "$task_id" 2>&1)" || rc=$?
  out="${out//$'\r'/}"
  if [[ "$rc" != 0 ]]; then
    echo "$out" >&2
    return "$EXIT_FAIL"
  fi
  printf '%s\n' "$out"
  return "$EXIT_OK"
}

SUBCOMMAND="$1"
shift
case "$SUBCOMMAND" in
  ensure) cmd_ensure "$@" ;;
  add) cmd_add "$@" ;;
  status) cmd_status "$@" ;;
  kill) cmd_kill "$@" ;;
  *)
    echo "usage: lane-queue.sh ensure|add GROUP -- CMD [ARGS...]|status [TASK_ID]|kill TASK_ID" >&2
    exit "$EXIT_CONFIG"
    ;;
esac
exit $?
