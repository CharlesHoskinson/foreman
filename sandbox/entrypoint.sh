#!/usr/bin/env bash
# @description Container PID-1 entrypoint (hard-mode-launcher Task 4). The
#   image has no USER directive, so the container always STARTS as root
#   regardless of what command `docker run` was given (a command override
#   only replaces CMD's arguments; it never bypasses ENTRYPOINT). That is
#   deliberate: this script applies the default-deny egress firewall
#   (init-firewall.sh, no args -> apply mode) AS ROOT first, then drops to
#   the unprivileged `worker` user via `gosu` before finally exec'ing the
#   real command ("$@" — worker-run.sh's WC_ARGV, or a test/operator
#   command such as `/init-firewall.sh --check` / `id -un`).
#
#   Order is load-bearing, not swappable: firewall-then-drop means the
#   worker process this hands off to never holds the CAP_NET_ADMIN it would
#   need to flush or alter these rules. `gosu`'s setuid(2)/setgid(2) drop
#   clears the process's permitted/effective/inheritable capability sets on
#   the way down (no PR_SET_KEEPCAPS is set anywhere in this image), so by
#   the time "$@" runs, root's NET_ADMIN is gone for good — reinstating it
#   would require killing the whole container, not just this process.
#
#   `exec` (not a plain call) so `gosu` REPLACES this shell: the worker's
#   command becomes the container's real PID 1 (via gosu's own exec of
#   "$@"), not a lingering entrypoint wrapper process.
#
#   Capability set (verified empirically against this exact image, not just
#   assumed): `--cap-drop ALL --cap-add NET_ADMIN` alone is NOT enough for
#   this entrypoint to run at all. `gosu`'s setuid(2)/setgid(2) drop itself
#   needs CAP_SETUID + CAP_SETGID in the (still-root) caller's effective set
#   -- without them gosu fails outright ("failed switching to \"worker\":
#   operation not permitted") and the container never starts the real
#   command. Separately, the chown below (making the --tmpfs /home/worker
#   mount, which lands root:root by default, writable by `worker`) needs
#   CAP_CHOWN for the same reason: `--cap-drop ALL` strips it from root too,
#   not just from the dropped-to user. Both are therefore also part of the
#   shipped run's `docker run`/devcontainer.json capability set (see
#   worker-run.sh's container branch and sandbox/devcontainer.json) --
#   CAP_NET_ADMIN alone, as an earlier reading of the design might suggest,
#   was verified insufficient. None of the three survive past this script:
#   all are consumed here, entirely in the root phase, before the setuid(2)
#   drop below clears the process's capability sets on the way down -- the
#   worker ends up with zero capabilities regardless, same as if only
#   NET_ADMIN had ever been granted.
set -euo pipefail

/init-firewall.sh

# The --tmpfs /home/worker mount (worker-run.sh's hardened run) lands
# root:root 0755 by default -- not writable by `worker` -- so the vendor
# CLI's own cache/token-refresh writes into $HOME would fail otherwise.
# Still running as root here (pre-drop), so this is the one place it can be
# fixed cheaply without complicating the tmpfs mount syntax itself.
chown worker:worker /home/worker 2>/dev/null || true

exec gosu worker "$@"
