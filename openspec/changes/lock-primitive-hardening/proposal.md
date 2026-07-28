# Change: lock-primitive-hardening

## Why

`skills/foreman/scripts/lib/eventlog.sh` builds every lock in the durable-lanes
core on a `mkdir` mutex, justified in-code at `eventlog.sh:70`:

> `mkdir` is atomic on Git Bash and WSL (no flock on MSYS2). This is a pure
> portable-lock choice.

**On Ubuntu 26.04 that premise is false.** The distribution ships a hybrid
coreutils: `mkdir`, `stat`, `date`, `sort`, `ln` and `stdbuf` resolve to
**uutils (Rust) 0.8.0**, while `mv` and `rm` remain **GNU 9.7**. The uutils
`mkdir` performs a userspace check-then-act instead of letting the kernel
decide, so it is not usable as a mutual-exclusion primitive.

Measured on this reference box (2026-07-28), eight racers contending on one
lock with losers spinning — the exact pattern `el_emit` and `el_attempt_new`
use — counting entries into an already-occupied critical section:

| `mkdir` implementation | violations / 15 rounds of 8 racers |
|---|---|
| `/usr/bin/mkdir` — uutils 0.8.0 (system default) | **57** |
| `/usr/bin/gnumkdir` — GNU 9.7 | **0** |

`strace` isolates the mechanism. uutils never issues the syscall when the
path exists; GNU takes `EEXIST` from the kernel:

```
uutils:  statx(AT_FDCWD, ".../x", ...) = 0
         mkdir: /tmp/.../x: File exists
GNU:     mkdir("/tmp/.../x", 0777) = -1 EEXIST (File exists)
```

The blast radius is the whole durable core, because every lock is this one
primitive: `el_emit`'s `.seq.lock` (`eventlog.sh:76`) which allocates event-log
sequence numbers, `el_attempt_new`'s `.attempt.lock` (`eventlog.sh:221`),
`el_compact`'s reuse of `.seq.lock` (`eventlog.sh:351`), and the sibling mutex
in `lib/nats-bridge.sh`. The event log is the documented **source of truth**
for durable lanes, so a lost or duplicated sequence corrupts crash recovery and
replay — silently.

This is not a latent edge case. v0.2.8 raised the pueue caps to grok=3 /
codex=2, making multi-lane contention the normal operating mode. The defect
reproduces today: `tests/eventlog.bats` "el_attempt_new under concurrent
contention" fails deterministically on a fresh clone, losing 1-3 of 8
allocations per run to `mv: cannot stat '...attempt.tmp'` — the signature of
two processes inside the critical section, one deleting the other's temp file.

`flock` is already a `required = true` tool for the `hard` and `full` profiles
in `env/reference-manifest.toml`, is already used by `lib/worktree.sh:154` and
`scripts/task-new.sh:26`, and is present on every WSL and Linux host. The
event log is the only durable-core component that does not use it.

## What changes

- **New `skills/foreman/scripts/lib/lock.sh`** — one shared lock helper with a
  single public contract (`fm_lock_acquire` / `fm_lock_release`, or a
  `fm_with_lock` wrapper), selecting its mechanism once per process:
  - `flock` when available (WSL, Linux, and any host with `util-linux`);
  - the `mkdir` mutex **only** as the MSYS2 / Git-Bash fallback, where `flock`
    genuinely does not exist;
  - and, on the fallback path, a startup probe that refuses a `mkdir` known to
    be non-atomic rather than silently trusting it.
- **`lib/eventlog.sh` migrated onto it** — the three inline spin-loops at
  `:76`, `:221` and `:351` are replaced by calls into `lib/lock.sh`. The
  release discipline (single unconditional release on every path) and the
  `.seq.lock` / `.attempt.lock` separation documented at `eventlog.sh:195-205`
  are both preserved exactly.
- **`lib/nats-bridge.sh` migrated onto it** for the same reason.
- **A mkdir-atomicity probe added to the WSL preflight** (the `wsl-preflight`
  package already specced for this release), so a host whose `mkdir` cannot
  hold a mutex is reported at Setup rather than discovered by a corrupted run.
- **A permanent mutual-exclusion regression test** that measures occupancy of
  the critical section under release-contention, rather than asserting on the
  union of allocated ids. The existing test detects the symptom, and only
  sometimes.
- **`tests/eventlog.bats` "append failure leaves a gap" fixed** — it forces a
  write failure with `chmod 000`, which root bypasses, so the assertion
  inverts under this repo's root WSL default user. It SHALL skip when
  `EUID == 0` or force the failure by a means root cannot bypass.
- **`env/reference-manifest.toml`** records the coreutils-flavour hazard, and
  `flock` is promoted to `required = true` for the `durable` profile.

## Impact

- Affected: `skills/foreman/scripts/lib/eventlog.sh`,
  `skills/foreman/scripts/lib/nats-bridge.sh`,
  `skills/foreman/scripts/wt-new.sh` (comment at `:186` repeats the same false
  claim and must be corrected), `env/reference-manifest.toml`,
  `tests/eventlog.bats`.
- New: `skills/foreman/scripts/lib/lock.sh`, `tests/lock.bats`.
- Behaviour change: on hosts with `flock`, the lock mechanism changes from
  directory-creation to advisory file locking. Stale-lock semantics differ —
  `flock` releases on process death, whereas a leftover `.seq.lock` directory
  survives a crash and is reclaimed by `el_init` (`eventlog.sh:52-57`). That
  reclamation path MUST be preserved for the fallback and MUST NOT be assumed
  necessary for the `flock` path.
- **Ordering constraint: this lands before any graph-plane package.** The
  graph plane is specified around many lanes publishing updates concurrently
  and will lean on the same locking discipline.
