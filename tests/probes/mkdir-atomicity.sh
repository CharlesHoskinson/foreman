#!/usr/bin/env bash
# mkdir-atomicity.sh — is the resolved mkdir usable as a mutual-exclusion
# primitive on this host?
#
# Foreman's durable core built every lock on a mkdir mutex, justified in-code by
# "mkdir is atomic on Git Bash and WSL". On Ubuntu 26.04 that is false: the
# distro ships a hybrid coreutils and mkdir resolves to uutils, which performs a
# userspace statx check instead of issuing mkdir(2). See
# docs/research/vnext/F-uutils-mkdir-blocker.md.
#
# Two probes:
#   1. MECHANISM (deterministic) — does the binary issue mkdir(2) and take
#      EEXIST from the kernel, or check first in userspace? Needs strace.
#   2. CONTENTION (corroborating) — N racers, count entries into an occupied
#      critical section. Magnitude is load-dependent; presence is not.
#
# The mechanism probe is the acceptance signal. The contention probe can only
# ever falsify atomicity, never demonstrate it.
set -u

MKDIR_BIN="${1:-$(command -v mkdir)}"
ROUNDS="${2:-10}"
rc=0

echo "probe: $MKDIR_BIN"
"$MKDIR_BIN" --version 2>/dev/null | head -1 | sed 's/^/  version: /'

echo
echo "== 1. mechanism =="
if command -v strace >/dev/null 2>&1; then
  D=$(mktemp -d); mkdir -p "$D/x"
  TRACE=$(strace -e trace=mkdir,mkdirat,statx "$MKDIR_BIN" "$D/x" 2>&1 || true)
  rm -rf "$D"
  if echo "$TRACE" | grep -qE '^mkdir(at)?\(.*EEXIST'; then
    echo "  ATOMIC — issues mkdir(2), kernel returns EEXIST"
  elif echo "$TRACE" | grep -qE '^statx\('; then
    echo "  NOT ATOMIC — userspace statx check, no mkdir(2) syscall (TOCTOU)"
    rc=1
  else
    echo "  INCONCLUSIVE — neither signature observed"
    rc=2
  fi
else
  echo "  strace unavailable — mechanism cannot be established on this host."
  echo "  Contention below can falsify atomicity but never demonstrate it."
  rc=2
fi

echo
echo "== 2. contention ($ROUNDS rounds x 8 racers) =="
total=0
for _ in $(seq 1 "$ROUNDS"); do
  B=$(mktemp -d); LOCK="$B/lock"; TRACE="$B/t"; : > "$TRACE"
  for _ in 1 2 3 4 5 6 7 8; do
    (
      tries=0
      while ! "$MKDIR_BIN" "$LOCK" 2>/dev/null; do
        sleep 0.02; tries=$((tries+1)); [ "$tries" -gt 500 ] && exit 1
      done
      echo ENTER >> "$TRACE"; sleep 0.01; echo EXIT >> "$TRACE"
      rmdir "$LOCK" 2>/dev/null
    ) &
  done
  wait
  v=$(awk '$1=="ENTER"{d++; if(d>1)v++} $1=="EXIT"{d--} END{print (v?v:0)}' "$TRACE")
  total=$((total + v))
  rm -rf "$B"
done
echo "  $total mutual-exclusion violations"
[ "$total" -gt 0 ] && rc=1

echo
case "$rc" in
  0) echo "VERDICT: usable as a mutex on this host" ;;
  1) echo "VERDICT: NOT usable as a mutex — use flock" ;;
  *) echo "VERDICT: unproven — refuse rather than assume" ;;
esac
exit "$rc"
