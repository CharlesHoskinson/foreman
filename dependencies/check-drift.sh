#!/usr/bin/env bash
# check-drift.sh -- prove the three dependency records agree with each other.
#
# Foreman states its dependencies in three places that were never compared:
#
#   1. env/reference-manifest.toml   [[tools]] ids -- calls itself the source of truth
#   2. env/tool-check.sh             must_*/should_* arrays -- what readiness actually checks
#   3. env/bootstrap-wsl.sh          install routes -- what a fresh host actually gets
#
# tool-check.sh reads the manifest ONLY for the lock-atomicity pin register and
# embeds a mirror of the profile lists, which its own header admits. Nothing
# reconciled them, so `strace` could be required by the lock, absent from all
# three records, and still leave a host reporting READY: yes while 102 tests
# failed. This script is the reconciliation.
#
# Exit 0 = records agree. Exit 1 = drift, itemised. Exit 2 = cannot run.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/env/reference-manifest.toml"
CHECKER="$ROOT/env/tool-check.sh"
BOOTSTRAP="$ROOT/env/bootstrap-wsl.sh"

for f in "$MANIFEST" "$CHECKER" "$BOOTSTRAP"; do
  [[ -r "$f" ]] || { printf 'ERROR unreadable: %s\n' "$f" >&2; exit 2; }
done

# Pseudo-entries: checked by tool-check but not installable tools, so they are
# legitimately absent from the manifest and the provisioner.
PSEUDO=" foreman_home_fs foreman_skill foreman-launch "

# ids the manifest declares
manifest_ids="$(sed -n 's/^id = "\(.*\)"$/\1/p' "$MANIFEST" | sort -u)"

# ids the checker actually gates on, across every profile array
checker_ids="$(
  sed -n 's/^\(must\|should\)_[a-z]*=(\(.*\))$/\2/p' "$CHECKER" \
    | tr ' ' '\n' | sed '/^$/d' | sort -u
)"

[[ -n "$checker_ids" ]] || {
  printf 'ERROR parsed zero ids from %s -- the array format changed; fix this script rather than ignoring it\n' "$CHECKER" >&2
  exit 2
}

drift=0

# @description Report a drift finding and mark the run as failed.
# @arg $1 message the drift description; additional arguments are joined with spaces
# @stdout the drift message
note() { printf '%s\n' "$*"; drift=1; }

# @description Test whether an id is a pseudo-entry rather than an installable tool.
# @arg $1 id the tool id to test
# @exitcode 0 the id is a pseudo-entry and is exempt from manifest and provisioner checks
# @exitcode 1 the id names a real tool
is_pseudo() { [[ "$PSEUDO" == *" $1 "* ]]; }

# 1. Anything the checker gates on must be declared in the manifest.
while read -r id; do
  [[ -n "$id" ]] || continue
  is_pseudo "$id" && continue
  if ! grep -qxF "$id" <<<"$manifest_ids"; then
    note "DRIFT checker gates on '$id' but env/reference-manifest.toml does not declare it"
  fi
done <<<"$checker_ids"

# 2. Anything required by the manifest should be visible to the checker.
#    Reported as INFO, not drift: the manifest legitimately documents tools the
#    readiness report does not gate on (psscriptanalyzer is Windows-only).
while read -r id; do
  [[ -n "$id" ]] || continue
  is_pseudo "$id" && continue
  if ! grep -qxF "$id" <<<"$checker_ids"; then
    printf 'INFO  manifest declares "%s" but env/tool-check.sh does not report it\n' "$id"
  fi
done <<<"$manifest_ids"

# 3. Anything the checker gates on for WSL must have an install route in the
#    provisioner, otherwise a fresh host cannot reach READY without manual steps.
#
#    Some binaries arrive inside a parent package rather than under their own
#    name, so searching the provisioner for the binary name alone reports a
#    false gap. Map those to the package that actually delivers them; a naive
#    grep would flag flock and timeout, both of which bootstrap does install.
# @description Map a binary name to the package that actually delivers it.
# @arg $1 id the binary name the checker gates on
# @stdout the package name to search for in the provisioner, or the id unchanged
provided_by() {
  case "$1" in
    flock)   printf 'util-linux' ;;
    timeout) printf 'coreutils' ;;
    *)       printf '%s' "$1" ;;
  esac
}

# Deliberately not provisioned: durable-transport binaries are installed by the
# durable profile's own route, or by hand on hosts that use them.
UNPROVISIONED=" nats-server nats-cli "

while read -r id; do
  [[ -n "$id" ]] || continue
  is_pseudo "$id" && continue
  if [[ "$UNPROVISIONED" == *" $id "* ]]; then
    printf 'INFO  "%s" is gated but deliberately not provisioned (durable transport, installed on demand)\n' "$id"
    continue
  fi
  if ! grep -qF -- "$(provided_by "$id")" "$BOOTSTRAP"; then
    note "DRIFT checker gates on '$id' but env/bootstrap-wsl.sh has no install route for it (looked for '$(provided_by "$id")')"
  fi
done <<<"$checker_ids"

if (( drift )); then
  printf '\nDEPENDENCY DRIFT -- records disagree. Reconcile all three, then re-run.\n'
  exit 1
fi

printf 'dependencies: no drift (manifest, tool-check and bootstrap agree)\n'
exit 0
