#!/usr/bin/env bash
# @description Default-deny egress firewall for the foreman-sandbox container
#   (hard-mode-launcher Task 4). Applied by entrypoint.sh, running as root,
#   before it drops to the unprivileged `worker` user via gosu — by the time
#   the worker's own command runs, CAP_NET_ADMIN is gone from its process for
#   good (setuid clears the capability sets on the way down), so the worker
#   can neither flush nor alter these rules, only run into them.
#
#   Adapted from anthropics/claude-code's own devcontainer firewall
#   (github.com/anthropics/claude-code, .devcontainer/init-firewall.sh): same
#   shape — allow loopback/DNS/established first, build an ipset allowlist of
#   resolved hosts, THEN flip the default policy to deny, verify — narrowed
#   here to exactly two allowed egress hosts instead of a broad registry/
#   telemetry list: the worker vendor's own API host
#   (FOREMAN_VENDOR_API_HOST) and the task's git remote host
#   (FOREMAN_GIT_HOST). Both are resolved at container start from env
#   (never baked into the image) — worker-run.sh supplies them via the
#   container's `--env-file`.
#
#   Apply mode (default, no args): must run as root/CAP_NET_ADMIN — configures
#   iptables + the ipset allowlist, then records what it just set up to
#   STATE_FILE (world-readable). That record is a same-process attestation of
#   what apply achieved, written only after every iptables/ipset call above
#   it has already succeeded (`set -e`: any failure aborts before the state
#   file is ever written, so its mere existence with good values means apply
#   really did reach the end).
#
#   Enforcement note: the natural way to consume an ipset from iptables is
#   the `-m set --match-set NAME dst -j ACCEPT` match extension, but that
#   extension's kernel module (xt_set) additionally demands CAP_NET_RAW
#   ("Can't open socket to ipset" otherwise) on top of CAP_NET_ADMIN --
#   confirmed empirically against this exact image under the shipped run's
#   fixed capability set (`--cap-drop ALL --cap-add NET_ADMIN`, deliberately
#   no NET_RAW: the worker's container never needs to craft raw packets).
#   Rather than widen the capability grant just to use `-m set`, each
#   resolved IP gets BOTH an ipset member (SET_NAME stays the "is anything
#   allowlisted at all" registry --check inspects) AND a plain per-
#   destination `iptables -A OUTPUT -d IP -j ACCEPT` rule (the actual
#   enforcement path, needing only CAP_NET_ADMIN) -- functionally
#   equivalent allow-listing, without the extra capability.
#
#   --check mode: verifies the running container's firewall posture.
#   Prefers re-querying the kernel directly (authoritative) when the caller
#   actually holds CAP_NET_ADMIN (root, or `docker exec -u root`) — but
#   iptables/ipset both refuse to even LIST rules without that capability
#   ("Could not fetch rule set generation id: Permission denied (you must be
#   root)"), so an unprivileged caller — e.g. the sandbox's own `worker`
#   user, exactly the case exercised by running `/init-firewall.sh --check`
#   through the full entrypoint — falls back to the state file apply already
#   wrote: the closest an unprivileged process can get to "the kernel state
#   is what apply configured" without the capability to ask the kernel
#   itself. Exits 0 only if the (live or recorded) policy is OUTPUT=DROP and
#   the allowlist set is non-empty.
set -euo pipefail

SET_NAME="foreman-allowed"
STATE_FILE="/run/foreman-firewall.state"

# @description Resolve a hostname to its IPv4 addresses; add each to the
#   allowlist ipset (the registry --check inspects) AND to a direct
#   destination-IP ACCEPT rule (the actual enforcement — see the header
#   comment on why not `-m set`). A host that fails to resolve is a soft
#   no-op (still default-deny — just nothing added for it), not a hard
#   failure, so one vendor's transient DNS hiccup at container start does
#   not wedge the whole run; --check's non-empty-set requirement still
#   guards against BOTH hosts failing to resolve (an allowlist of zero hosts
#   is indistinguishable from a misconfigured firewall and must not pass).
# @arg $1 host hostname to resolve and allow (empty is a no-op)
resolve_and_allow() {
  local host="$1" ip
  [[ -z "$host" ]] && return 0
  while IFS= read -r ip; do
    if [[ -n "$ip" ]]; then
      ipset add "$SET_NAME" "$ip" 2>/dev/null || true
      iptables -A OUTPUT -d "$ip" -j ACCEPT
    fi
  done < <(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u)
}

apply() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "init-firewall: apply requires root/CAP_NET_ADMIN" >&2
    return 1
  fi

  iptables -F OUTPUT
  ipset destroy "$SET_NAME" 2>/dev/null || true
  ipset create "$SET_NAME" hash:ip

  # Loopback and already-established/related connections always pass —
  # ahead of the default-deny policy below (allow the harmless cases before
  # locking the door, same order the reference script uses).
  iptables -A OUTPUT -o lo -j ACCEPT
  iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  # DNS — needed to resolve the allowlisted hostnames themselves (and for
  # the worker CLI's own lookups of hosts already in the allowlist).
  iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

  resolve_and_allow "${FOREMAN_VENDOR_API_HOST:-}"
  resolve_and_allow "${FOREMAN_GIT_HOST:-}"

  # Default-deny LAST: everything above is an explicit exception; anything
  # matching none of it is dropped.
  iptables -P OUTPUT DROP

  # IPv6: the allowlist is resolved v4-only (getent ahostsv4), so there is no
  # legitimate v6 egress — deny ALL of it (except loopback/DNS/established) so
  # a container with any v6 route cannot be used to exfiltrate around the v4
  # allowlist. Guarded: some minimal images/hosts have no ip6tables or no v6
  # stack at all, in which case there is nothing to lock down.
  if command -v ip6tables >/dev/null 2>&1; then
    ip6tables -F OUTPUT 2>/dev/null || true
    ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
    ip6tables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
    ip6tables -A OUTPUT -p udp --dport 53 -j ACCEPT 2>/dev/null || true
    ip6tables -A OUTPUT -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
    ip6tables -P OUTPUT DROP 2>/dev/null || true
  fi

  local count
  count="$(ipset list "$SET_NAME" 2>/dev/null | awk -F': ' '/^Number of entries/{print $2; exit}')"
  {
    printf 'OUTPUT_POLICY=DROP\n'
    printf 'ALLOW_COUNT=%s\n' "${count:-0}"
    printf 'HOSTS=%s %s\n' "${FOREMAN_VENDOR_API_HOST:-}" "${FOREMAN_GIT_HOST:-}"
  } > "$STATE_FILE"
  chmod 0644 "$STATE_FILE"
  echo "init-firewall: applied (OUTPUT DROP, ${count:-0} allowed host IP(s))"
}

check() {
  # Privileged path: ask the kernel directly when we can — authoritative, no
  # reliance on the state file.
  if [[ "$(id -u)" -eq 0 ]]; then
    local policy count
    policy="$(iptables -S OUTPUT 2>/dev/null | head -1)"
    count="$(ipset list "$SET_NAME" 2>/dev/null | awk -F': ' '/^Number of entries/{print $2; exit}')"
    if [[ "$policy" == "-P OUTPUT DROP" && -n "$count" && "$count" -gt 0 ]]; then
      echo "init-firewall --check: OK (live kernel query — OUTPUT DROP, $count allowed host IP(s))"
      return 0
    fi
    echo "init-firewall --check: FAIL (live kernel query — policy='$policy' count='${count:-0}')" >&2
    return 1
  fi

  # Unprivileged path (the worker, after entrypoint's gosu drop): iptables/
  # ipset both refuse to list rules without CAP_NET_ADMIN, so fall back to
  # apply's own recorded attestation.
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "init-firewall --check: FAIL ($STATE_FILE missing — firewall was never applied)" >&2
    return 1
  fi
  local policy count
  policy="$(awk -F= '/^OUTPUT_POLICY=/{print $2}' "$STATE_FILE")"
  count="$(awk -F= '/^ALLOW_COUNT=/{print $2}' "$STATE_FILE")"
  if [[ "$policy" == "DROP" && -n "$count" && "$count" -gt 0 ]]; then
    echo "init-firewall --check: OK (recorded state — OUTPUT DROP, $count allowed host IP(s))"
    return 0
  fi
  echo "init-firewall --check: FAIL (recorded state — policy='$policy' count='${count:-0}')" >&2
  return 1
}

case "${1:-}" in
  --check) check ;;
  "")      apply ;;
  *)       echo "usage: init-firewall.sh [--check]" >&2; exit 2 ;;
esac
