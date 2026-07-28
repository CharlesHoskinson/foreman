# FINDING F-UUTILS-MKDIR — the portable mkdir-mutex is not atomic on Ubuntu 26.04

**Severity: BLOCKER for v0.2.9.** Discovered 2026-07-28 during fresh-clone WSL
bring-up, not by a lane. Filed here because it invalidates an invariant the
durable-lanes design (v0.2.0) treats as axiomatic.

## Claim

`skills/foreman/scripts/lib/eventlog.sh` implements its lock as a `mkdir`
mutex, justified in-code by the comment:

> `mkdir` is atomic on Git Bash and WSL (no flock on MSYS2). This is a pure
> portable-lock choice.

On Ubuntu 26.04 that premise is **false**. The distribution ships a hybrid
coreutils: `mkdir`, `stat`, `date`, `sort`, `ln`, `stdbuf` resolve to
**uutils (Rust) 0.8.0**, while `mv`, `rm` remain **GNU 9.7**. The uutils
`mkdir` is not usable as a mutual-exclusion primitive.

## Evidence — measured, reproducible

Eight concurrent racers contending on one lock, losers spinning and retrying
(the exact pattern `el_emit` and `el_attempt_new` use), counting how often a
second process entered the critical section while another held it:

| mkdir implementation | violations / 15 rounds of 8 racers |
|---|---|
| `/usr/bin/mkdir` — uutils 0.8.0 (system default) | **57** |
| `/usr/bin/gnumkdir` — GNU 9.7 | **0** |

A smaller 5-round sample gave 14 vs 0. The result is stable across runs.

## Mechanism — the smoking gun

`strace` of each implementation against an existing directory:

```
# uutils: checks first, then never issues the syscall
statx(AT_FDCWD, "/tmp/.../x", ...) = 0
mkdir: /tmp/.../x: File exists

# GNU: issues the syscall, lets the kernel decide, atomically
mkdir("/tmp/.../x", 0777) = -1 EEXIST (File exists)
```

uutils performs a **check-then-act (TOCTOU)** on the userspace side. GNU
relies on `mkdir(2)` returning `EEXIST` from the kernel, which is atomic by
POSIX. Any lock built on the former has a window between the `statx` and the
create in which a second process can also observe "absent" and proceed.

## Blast radius

Every lock in the system is this primitive:

- `el_emit`'s `.seq.lock` — allocates event-log sequence numbers. The event
  log is the documented **source of truth** for durable lanes; duplicate or
  lost sequences corrupt crash recovery and replay.
- `el_attempt_new`'s `.attempt.lock` — attempt allocation.
- `el_compact`'s lock.
- `wt-new.sh` worktree locks (its own tests passed — lower contention, not
  proof of safety).

Concurrency caps were raised in v0.2.8 to grok=3 / codex=2, so multi-lane
contention is the normal operating mode, not an edge case.

## How this surfaced

Baseline suite on the fresh clone: **373 pass / 9 fail**. Three failures are
the event-log concurrency tests (43, 50, 54). Test 43 passes in isolation
(load-sensitive); 50 and 54 reproduce deterministically. Standalone repro of
`el_attempt_new` with 8 racers loses 1–3 allocations per run to
`mv: cannot stat '...attempt.tmp'` — the signature of two processes inside
the critical section, one deleting the other's temp file.

## Separate finding, same triage: test 50 is invalid as root

`"append failure leaves a gap, never a duplicate seq"` forces a write failure
with `chmod 000`. The WSL default user here is **root**, and root bypasses
permission bits, so the write succeeds and the assertion inverts. This is a
test-validity bug under a root user, not a product defect — and it connects
to the v0.2.9 residual already inventoried as "non-root WSL Setup migration".

## Proposed remedy (for the v0.2.9 roadmap)

1. **Stop trusting `mkdir` as the primitive.** Prefer, in order: `flock`
   where available (present on WSL — `util-linux`, already a required tool in
   `reference-manifest.toml`); fall back to the mkdir mutex only on MSYS2 /
   Git-Bash where `flock` genuinely does not exist.
2. **Detect the hazard rather than assume it away.** A Setup/preflight probe
   should assert the resolved `mkdir` takes `EEXIST` from the kernel, and
   refuse or loud-warn when it does not. This belongs with the `wsl-preflight`
   package already specced for v0.2.9.
3. **Add a permanent regression test** that measures mutual exclusion under
   release-contention, rather than asserting the union of allocated ids —
   the current test detects the symptom, and only sometimes.
4. Fix test 50 to skip when `EUID == 0`, or force the failure by a means root
   cannot bypass (unwritable directory, full filesystem, or a read-only bind
   mount).

## Why this matters beyond the bug

The v0.2.9 graph plane is designed to have **many lanes publishing graph
updates concurrently**. Whatever store is chosen, the write path will lean on
the same locking discipline this finding shows to be broken. Fixing the
primitive is a prerequisite for the graph work, not a side quest.
