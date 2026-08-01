#!/usr/bin/env bash
# lib/audit-call.sh — deterministic cross-family auditor selection.
# shellcheck shell=bash
# Source after lib/common.sh when available. Sourcing performs no I/O; call
# ac_select_auditor explicitly to read configuration and probe readiness.
#
# Candidate vendors come from audit.vendors, or from the legacy scalar
# audit.vendor as a one-element list. Setting both keys is invalid and refuses
# selection by name; neither key silently takes precedence. Each configured
# name is checked against the audit capability published by its adapter, not
# merely the presence of an adapter file. Candidates are sorted lexically
# before filtering: determinism comes from that explicit sort, never from
# directory enumeration order (which is not stable).
#
# WORKER_VENDORS_CSV accepts every vendor in a raced implementation. The
# current hard-mode caller supplies worker.vendor as a one-element CSV; the
# producer that will supply multiple race arms has not yet been written.

# Last selection outcome. These values are reset by every ac_select_auditor
# call and intentionally remain mutable so the caller can inspect a refusal.
AC_AUDITOR="${AC_AUDITOR:-}"
AC_STATUS="${AC_STATUS:-}"
AC_REASON="${AC_REASON:-}"
AC_MISSING_VENDOR="${AC_MISSING_VENDOR:-}"

# @description Read one dotted TOML key without requiring common.sh.
# @arg $1 config path
# @arg $2 dotted key
# @stdout scalar value or one array element per line
# @exitcode 0 key exists; 1 key is absent or the file cannot be read
_ac_config_get() {
  local config="$1" key="$2"
  if declare -F toml_get >/dev/null 2>&1; then
    toml_get "$config" "$key"
    return
  fi
  python3 - "$config" "$key" <<'PY'
import os
import sys
import tomllib

path, dotted = sys.argv[1:]
if not os.path.isfile(path):
    raise SystemExit(1)
with open(path, "rb") as handle:
    value = tomllib.load(handle)
for part in dotted.split("."):
    if not isinstance(value, dict) or part not in value:
        raise SystemExit(1)
    value = value[part]
if isinstance(value, list):
    print("\n".join(str(item) for item in value))
else:
    print(value)
PY
}

# @description Return the built-in model used when legacy config omits one.
#   agy deliberately has no default: it is a multi-family gateway and must be
#   pinned before its family can be known.
# @arg $1 vendor id
# @stdout model alias, or an empty line when no safe default exists
_ac_default_model() {
  case "$1" in
    claude) printf 'claude-opus-4-6\n' ;;
    codex) printf 'gpt-5.6-sol\n' ;;
    grok) printf 'grok-4.5\n' ;;
    *) printf '\n' ;;
  esac
}

# @description Resolve the configured model actually selected for a vendor.
#   Per-vendor role keys win, then vendor.<name>.model, then the legacy role
#   model when the role's scalar vendor matches. A safe non-gateway default is
#   used only when all configured forms are absent.
# @arg $1 config path
# @arg $2 role worker|audit
# @arg $3 vendor id
# @stdout selected model alias (possibly empty)
_ac_configured_model() {
  local config="$1" role="$2" vendor="$3"
  local model="" scalar_vendor=""
  if model="$(_ac_config_get "$config" "$role.model_$vendor" 2>/dev/null)" \
    && [[ -n "$model" ]]; then
    printf '%s\n' "$model"
    return 0
  fi
  if model="$(_ac_config_get "$config" "vendor.$vendor.model" 2>/dev/null)" \
    && [[ -n "$model" ]]; then
    printf '%s\n' "$model"
    return 0
  fi
  scalar_vendor="$(_ac_config_get "$config" "$role.vendor" 2>/dev/null || true)"
  if [[ "$scalar_vendor" == "$vendor" ]] \
    && model="$(_ac_config_get "$config" "$role.model" 2>/dev/null)" \
    && [[ -n "$model" ]]; then
    printf '%s\n' "$model"
    return 0
  fi
  _ac_default_model "$vendor"
}

# @description Classify the family of the model actually selected by VENDOR.
#   VENDOR is context only: gateway CLIs are classified from MODEL, never from
#   their CLI name.
# @arg $1 vendor id
# @arg $2 selected model alias
# @stdout openai|anthropic|google|xai|unknown
ac_model_family() {
  local vendor="${1:-}" model="${2:-}" normalized
  normalized="${model,,}"
  case "$normalized" in
    claude*) printf 'anthropic\n' ;;
    gemini*|gemma*) printf 'google\n' ;;
    grok*) printf 'xai\n' ;;
    gpt-*|gpt_*|chatgpt*|codex*|o[0-9]*|text-embedding-*) printf 'openai\n' ;;
    *)
      # Consume the contextual argument without using it as a family proxy.
      : "$vendor"
      printf 'unknown\n'
      ;;
  esac
}

# @description Print configured audit candidates one per line.
#   audit.vendors wins when present; legacy audit.vendor is one candidate.
#   With neither key configured, the historical codex default is retained.
# @arg $1 config path
# @stdout configured vendor ids, unsorted
_ac_configured_candidates() {
  local config="$1" raw="" line="" candidate=""
  if raw="$(_ac_config_get "$config" audit.vendors 2>/dev/null)"; then
    :
  elif raw="$(_ac_config_get "$config" audit.vendor 2>/dev/null)"; then
    [[ -n "$raw" ]] || raw=codex
  else
    raw=codex
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    while IFS= read -r candidate || [[ -n "$candidate" ]]; do
      candidate="${candidate#"${candidate%%[![:space:]]*}"}"
      candidate="${candidate%"${candidate##*[![:space:]]}"}"
      [[ -n "$candidate" ]] && printf '%s\n' "$candidate"
    done < <(printf '%s' "$line" | tr ',' '\n')
  done <<<"$raw"
}

# @description True when the enumerated adapter directory contains VENDOR.
# @arg $1 adapter directory
# @arg $2 vendor id
# @exitcode 0 matching <vendor>.sh exists; 1 otherwise
_ac_has_adapter() {
  local adapter_dir="$1" vendor="$2" path="" found=""
  while IFS= read -r path; do
    found="${path##*/}"
    found="${found%.sh}"
    [[ "$found" == "$vendor" ]] && return 0
  done < <(find "$adapter_dir" -maxdepth 1 -type f -name '*.sh' -print 2>/dev/null | LC_ALL=C sort)
  return 1
}

# @description True when VENDOR's adapter publishes a usable audit capability.
#   A stub adapter function is insufficient: the capability map must describe
#   an audit sandbox and must not explicitly advertise audit=false. This keeps
#   Claude's T7-disabled lane unavailable without hardcoding vendor names.
# @arg $1 adapter directory
# @arg $2 vendor id
# @exitcode 0 adapter_audit_argv exists and audit capability is published; 1 otherwise
_ac_has_audit_capability() {
  local adapter_dir="$1" vendor="$2"
  local adapter_path="$adapter_dir/$vendor.sh" caps="" key="" value=""
  local capability=0
  [[ -f "$adapter_path" ]] || return 1
  (
    # shellcheck disable=SC1090  # Adapter path is selected from the enumerated directory.
    source "$adapter_path"
    declare -F adapter_audit_argv >/dev/null 2>&1 || exit 1
    declare -F adapter_caps >/dev/null 2>&1 || exit 1
    caps="$(adapter_caps "$vendor" 2>/dev/null)" || exit 1
    while IFS='=' read -r key value; do
      if [[ "$key" == audit && "$value" == false ]]; then
        exit 1
      fi
      if [[ "$key" == sandbox && "$value" == *audit:* ]]; then
        capability=1
      fi
    done <<<"$caps"
    (( capability == 1 ))
  )
}

# @description True when VENDOR's CLI is executable at routing time.
#   Authentication is owned by Foreman's mandatory Setup-stage readiness gate;
#   repeating an auth protocol here would couple selection to vendor-specific
#   probe output and reject otherwise valid invocation fixtures.
# @arg $1 vendor id
# @exitcode 0 executable resolves on PATH; 1 otherwise
_ac_vendor_ready() {
  command -v "$1" >/dev/null 2>&1
}

# @description Select the first ready auditor distinct from every worker and
#   worker model family. Candidates are filtered in lexical adapter order.
# @arg $1 config TOML path
# @arg $2 comma-separated worker vendor set (one value for current hard mode)
# @set AC_AUDITOR selected vendor, empty on refusal
# @set AC_STATUS SELECTED|REFUSED
# @set AC_REASON refusal naming every configured candidate and its reason
# @stdout selected vendor on success
# @exitcode 0 selected; 1 every configured candidate was rejected
ac_select_auditor() {
  local config="${1:-}" worker_csv="${2:-}"
  local lib_dir adapter_dir candidate model family
  local worker item worker_model worker_family rejection separator
  local -a workers=() worker_models=() worker_families=() candidates=() rejections=()

  AC_AUDITOR=""
  AC_STATUS="REFUSED"
  AC_REASON=""
  AC_MISSING_VENDOR=""

  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  adapter_dir="${AC_ADAPTER_DIR:-$lib_dir/../adapters}"

  if _ac_config_get "$config" audit.vendor >/dev/null 2>&1 \
    && _ac_config_get "$config" audit.vendors >/dev/null 2>&1; then
    AC_REASON="audit.vendor and audit.vendors cannot both be set"
    printf 'audit selection refused: %s\n' "$AC_REASON" >&2
    return 1
  fi

  while IFS= read -r item || [[ -n "$item" ]]; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    [[ -n "$item" ]] && workers+=("$item")
  done < <(printf '%s' "$worker_csv" | tr ',' '\n')

  for worker in "${workers[@]}"; do
    worker_model="$(_ac_configured_model "$config" worker "$worker")"
    worker_family="$(ac_model_family "$worker" "$worker_model")"
    worker_models+=("$worker_model")
    worker_families+=("$worker_family")
  done

  while IFS= read -r candidate; do
    candidates+=("$candidate")
  done < <(_ac_configured_candidates "$config" | LC_ALL=C sort -u)

  for candidate in "${candidates[@]}"; do
    rejection=""
    if ! _ac_has_adapter "$adapter_dir" "$candidate"; then
      rejection="missing audit adapter"
    fi
    if [[ -z "$rejection" ]] && ! _ac_has_audit_capability "$adapter_dir" "$candidate"; then
      rejection="audit capability unavailable"
    fi

    if [[ -z "$rejection" ]]; then
      for worker in "${workers[@]}"; do
        if [[ "$candidate" == "$worker" ]]; then
          rejection="worker vendor"
          break
        fi
      done
    fi

    model="$(_ac_configured_model "$config" audit "$candidate")"
    family="$(ac_model_family "$candidate" "$model")"
    if [[ -z "$rejection" && "$family" == unknown ]]; then
      rejection="model ${model:-<empty>} has unknown family"
    fi

    if [[ -z "$rejection" ]]; then
      for item in "${!workers[@]}"; do
        worker="${workers[item]}"
        worker_model="${worker_models[item]}"
        worker_family="${worker_families[item]}"
        if [[ "$worker_family" == unknown ]]; then
          rejection="worker $worker model ${worker_model:-<empty>} has unknown family"
          break
        fi
        if [[ "$family" == "$worker_family" ]]; then
          rejection="model family $family matches worker $worker family $worker_family"
          break
        fi
      done
    fi

    if [[ -z "$rejection" ]] && ! _ac_vendor_ready "$candidate"; then
      rejection="not ready"
      AC_MISSING_VENDOR+="${AC_MISSING_VENDOR:+,}$candidate"
    fi

    if [[ -z "$rejection" ]]; then
      AC_AUDITOR="$candidate"
      AC_STATUS="SELECTED"
      AC_REASON=""
      printf '%s\n' "$candidate"
      return 0
    fi
    rejections+=("$candidate: $rejection")
  done

  separator=""
  for rejection in "${rejections[@]}"; do
    AC_REASON+="$separator$rejection"
    separator="; "
  done
  if [[ -z "$AC_REASON" ]]; then
    AC_REASON="no configured audit candidates"
  fi
  printf 'audit selection refused: %s\n' "$AC_REASON" >&2
  return 1
}
