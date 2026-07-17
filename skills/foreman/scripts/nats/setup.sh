#!/usr/bin/env bash
# @description Idempotently ensure a reachable NATS server and the FOREMAN JetStream
#   stream for durable-lanes transport. Does NOT start nats-server or own the
#   JetStream store directory (that is the server's -sd / store_dir setting);
#   only probes reachability and creates the stream when absent. Paths never
#   leave a literal ~ — expand via $HOME if you configure storage elsewhere.
# Usage: setup.sh
# Env: NATS_URL (default nats://127.0.0.1:4222)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATS_URL="${NATS_URL:-nats://127.0.0.1:4222}"

# @description Run durable-preflight and require NATS tools; print hints on miss.
# @exitcode 0 all required deps present (incl. nats-server + nats CLI)
# @exitcode 3 preflight required dep missing, or nats-server/nats CLI absent
require_nats_deps() {
  local tmp out
  tmp="$(mktemp)"
  # Preflight required deps (git/jq/coreutils/bash); always capture the table
  # so NATS install hints are available when optional nats rows are MISSING.
  if ! bash "$SCRIPT_DIR/../durable-preflight.sh" >"$tmp" 2>&1; then
    cat "$tmp" >&2
    rm -f "$tmp"
    exit 3
  fi
  out="$(cat "$tmp")"
  rm -f "$tmp"
  # NATS tools are optional in preflight but required for this setup script.
  if ! printf '%s\n' "$out" | grep -q '^OK nats-server'; then
    printf '%s\n' "$out" >&2
    echo "setup.sh: nats-server is required for JetStream setup" >&2
    exit 3
  fi
  if ! printf '%s\n' "$out" | grep -q '^OK nats-cli'; then
    printf '%s\n' "$out" >&2
    echo "setup.sh: nats CLI (nats-cli) is required for JetStream setup" >&2
    exit 3
  fi
}

# @description Bounded retry until nats account info succeeds.
#   Uses a short nats --timeout so a down server fails fast (default 5s per call
#   would make 5 attempts exceed typical outer timeout wrappers).
# @exitcode 0 server reachable  @exitcode 3 unreachable after 5 attempts
wait_for_server() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if nats --server "$NATS_URL" --timeout=1s account info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "setup.sh: NATS server unreachable at $NATS_URL after 5 attempts (1s apart)" >&2
  exit 3
}

# @description Ensure stream FOREMAN exists with subjects including foreman.>.
#   If absent: create with file storage, limits retention, max-age 72h.
#   If present: verify subjects contain foreman.>; otherwise leave alone
#   (reconfiguration is manual — setup is not an upsert of stream config).
# @exitcode 0 stream present and acceptable  @exitcode 1 stream add failed
ensure_foreman_stream() {
  if nats --server "$NATS_URL" --timeout=5s stream info FOREMAN >/dev/null 2>&1; then
    # subjects is a JSON array of strings, e.g. ["foreman.>"]
    if ! nats --server "$NATS_URL" --timeout=5s stream info FOREMAN --json 2>/dev/null \
      | jq -e '.config.subjects | index("foreman.>") != null' >/dev/null 2>&1; then
      echo "setup.sh: FOREMAN stream exists but subjects do not include foreman.>; reconfiguration is manual — leaving stream unchanged" >&2
    fi
    return 0
  fi
  # Subjects value MUST be quoted: an unquoted > is a shell redirect.
  # --defaults is used only for create defaults, NOT as create-or-update.
  nats --server "$NATS_URL" --timeout=5s stream add FOREMAN \
    --subjects "foreman.>" \
    --storage file \
    --retention limits \
    --max-age=72h \
    --defaults >/dev/null
}

# @description CLI entry: preflight → reachability → stream ensure.
# @exitcode 0 success  @exitcode 3 missing deps or unreachable server
main() {
  require_nats_deps
  wait_for_server
  ensure_foreman_stream
}

main "$@"
