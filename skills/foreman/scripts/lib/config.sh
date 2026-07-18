#!/usr/bin/env bash
# @description Shared [durable]/[nats] TOML config loader for the durable-lanes
#   harness. Precedence: dedicated env var (if set and non-empty) > TOML value
#   > built-in default. CLI flags stay in the callers -- they already parse
#   their own flags and win by exporting the dedicated env var before calling
#   cfg_get. Parses ONLY the 10 documented [durable]/[nats] keys (v0.2.5 T8
#   adds durable.resume_max_attempts, default 2, env RESUME_MAX_ATTEMPTS --
#   the bounded auto-resume supervisor's cap) with a minimal bash
#   TOML-subset parser ("[section]" headers, "key = value", quoted or
#   bare scalars, "#" comments); every line outside a [durable]/[nats] section
#   is skipped untouched (section-header tracking only), so unrelated TOML
#   constructs elsewhere in the file -- arrays, tables, whatever -- never trip
#   this parser. A malformed line INSIDE [durable]/[nats] makes the whole file
#   fall back to defaults (warned once on stderr); this NEVER aborts the
#   caller. Source this file; sourcing alone performs no I/O and reads no env
#   vars -- call cfg_load explicitly to actually resolve config.

# Env var cfg_get resolves for each section.key it is asked about. This is
# broader than the TOML "known keys" allowlist by exactly one entry
# (durable.watch_tick -> WATCH_TICK): watch.sh's poll tick is not one of the
# 10 documented [durable]/[nats] keys (see _cfg_parse_toml's explicit case
# statement below, which is the actual TOML allowlist), but it still needs a
# uniform cfg_get call site that honors its own pre-existing env var. Adding
# it here does NOT make it TOML-storable -- _cfg_parse_toml checks its own
# fixed 10-key case statement, not this table. resume_max_attempts (unlike
# watch_tick) is symmetric -- present in BOTH tables, per the closed-allowlist
# rule (v0.2.5 T7 CRITICAL note): a key missing from either silently no-ops.
declare -Ag _CFG_ENV_VAR=(
  [durable.enabled]=DURABLE_ENABLED
  [durable.checkpoint_interval]=DURABLE_CHECKPOINT_INTERVAL
  [durable.heartbeat_interval]=DURABLE_HEARTBEAT_INTERVAL
  [durable.stall_warn]=STALL_WARN
  [durable.stall_dead]=STALL_DEAD
  [durable.watch_tick]=WATCH_TICK
  [durable.resume_max_attempts]=RESUME_MAX_ATTEMPTS
  [nats.url]=NATS_URL
  [nats.store_dir]=NATS_STORE
  [nats.stream]=NATS_STREAM
  [nats.subject_prefix]=NATS_SUBJECT_PREFIX
)

declare -Ag _CFG_VALUES=()
_CFG_LOADED=0
_CFG_WARNED=0

# @description Parse a TOML file's [durable]/[nats] sections into _CFG_VALUES.
#   Recognizes "[section]" headers, blank lines, "#"-led comments, and
#   "key = value" scalars (double- or single-quoted strings, bare integers,
#   bare true/false), each with an optional trailing "# comment". Sections
#   other than [durable]/[nats] -- including any array/table syntax they
#   contain, e.g. this repo's own "[gate] forbidden_paths = [...]" -- are
#   tracked for header purposes only and never inspected for value syntax, so
#   they can never trip this parser. Only the 9 documented section.key
#   combinations (the case statement below -- NOT the broader _CFG_ENV_VAR
#   table, which also carries watch_tick for cfg_get's env resolution only)
#   are stored; any other key inside [durable]/[nats] is ignored, not an
#   error. Any line inside [durable]/[nats] that is neither
#   blank/comment/header/valid-key=value IS treated as malformed -- the
#   caller (cfg_load) discards partial results and falls back to defaults for
#   the whole file rather than partial-parsing it.
# @arg $1 file TOML file path (caller has already confirmed it exists)
# @exitcode 0 parsed cleanly (possibly with zero known keys found)
# @exitcode 1 malformed content inside a [durable]/[nats] section
_cfg_parse_toml() {
  local file="$1" section="" line trimmed key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    trimmed="${line#"${line%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    [[ -z "$trimmed" ]] && continue
    [[ "$trimmed" == \#* ]] && continue
    if [[ "$trimmed" =~ ^\[([A-Za-z0-9_.-]+)\][[:space:]]*(#.*)?$ ]]; then
      section="${BASH_REMATCH[1]}"
      continue
    fi
    if [[ "$section" != "durable" && "$section" != "nats" ]]; then
      # Out of scope for this loader (e.g. [gate] forbidden_paths = [...]):
      # not parsed, not validated, never fails the file.
      continue
    fi
    if [[ "$trimmed" =~ ^([A-Za-z0-9_.-]+)[[:space:]]*=[[:space:]]*(.+)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      if [[ "$val" =~ ^\"([^\"]*)\"[[:space:]]*(\#.*)?$ ]]; then
        val="${BASH_REMATCH[1]}"
      elif [[ "$val" =~ ^\'([^\']*)\'[[:space:]]*(\#.*)?$ ]]; then
        val="${BASH_REMATCH[1]}"
      elif [[ "$val" =~ ^(-?[0-9]+)[[:space:]]*(\#.*)?$ ]]; then
        val="${BASH_REMATCH[1]}"
      elif [[ "$val" =~ ^(true|false)[[:space:]]*(\#.*)?$ ]]; then
        val="${BASH_REMATCH[1]}"
      else
        return 1
      fi
      case "$section.$key" in
        durable.enabled|durable.checkpoint_interval|durable.heartbeat_interval| \
        durable.stall_warn|durable.stall_dead|durable.resume_max_attempts| \
        nats.url|nats.store_dir|nats.stream|nats.subject_prefix)
          _CFG_VALUES["$section.$key"]="$val"
          ;;
        *) : ;; # unknown key (or watch_tick, which has no TOML representation) ignored
      esac
      continue
    fi
    return 1
  done < "$file"
  return 0
}

# @description Locate and parse the Foreman config TOML, populating
#   _CFG_VALUES for cfg_get. Explicit -- sourcing config.sh performs no I/O;
#   callers call this once before the first cfg_get. Safe to call more than
#   once (re-parses from scratch each time). File resolution: $FOREMAN_CONFIG
#   if set, else "<repo-root>/.foreman/config.toml" via
#   `git rev-parse --show-toplevel` run from the CALLER's cwd. A missing file
#   is silent (defaults-only, not an error) -- most repos/hosts never create
#   .foreman/config.toml at all. On malformed content, warns ONCE per process
#   on stderr and falls back to defaults for every key. NEVER aborts the
#   caller -- always returns 0.
# @exitcode 0 always
cfg_load() {
  _CFG_VALUES=()
  _CFG_LOADED=0
  local file="${FOREMAN_CONFIG:-}"
  if [[ -z "$file" ]]; then
    local root=""
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || root=""
    [[ -n "$root" ]] && file="$root/.foreman/config.toml"
  fi
  if [[ -z "$file" ]] || [[ ! -f "$file" ]]; then
    return 0
  fi
  if _cfg_parse_toml "$file"; then
    _CFG_LOADED=1
  else
    _CFG_VALUES=()
    _CFG_LOADED=0
    if [[ "$_CFG_WARNED" != "1" ]]; then
      echo "config: malformed TOML in $file ([durable]/[nats] section); falling back to built-in defaults" >&2
      _CFG_WARNED=1
    fi
  fi
  return 0
}

# @description Resolve one config value. Precedence: dedicated env var (if
#   set and non-empty) > TOML value from the last cfg_load > DEFAULT. `~` in
#   nats.store_dir is expanded to $HOME regardless of which source supplied
#   it. CLI flags are NOT handled here -- callers that parse their own flags
#   override by exporting the dedicated env var before calling cfg_get.
# @arg $1 section
# @arg $2 key
# @arg $3 default value to use when neither env nor TOML supplies one
# @stdout the resolved value
cfg_get() {
  local section="$1" key="$2" default="${3:-}"
  local envvar="${_CFG_ENV_VAR[$section.$key]:-}" value=""
  if [[ -n "$envvar" ]]; then
    local envval="${!envvar:-}"
    [[ -n "$envval" ]] && value="$envval"
  fi
  if [[ -z "$value" && "$_CFG_LOADED" == "1" ]]; then
    local tk="$section.$key"
    [[ -n "${_CFG_VALUES[$tk]:-}" ]] && value="${_CFG_VALUES[$tk]}"
  fi
  [[ -z "$value" ]] && value="$default"
  if [[ "$section" == "nats" && "$key" == "store_dir" ]]; then
    value="${value/#\~/$HOME}"
  fi
  printf '%s\n' "$value"
}
