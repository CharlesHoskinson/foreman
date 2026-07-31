# SPEC — lock-primitive-hardening, Round L2: the evidence and trust plane

Read `AGENT_TRAPS.md` IN FULL first. All of it.

**This is the round the project record says was specified wrong twice.** Read
section 0 before writing anything.

Work ONLY in this worktree. Do NOT `git commit`. No graphify.
`/usr/local/bin/openspec`, never `npx`.

## 0. The two mistakes already made here — do not make either again

**Mistake 1: a mechanism-blind evidence definition.** An earlier draft defined
`syscall` evidence as "the create returning `EEXIST`". `flock` creates nothing,
so a faithful implementation of that definition **refused every acquisition on
WSL and Linux** — it made the primary mechanism unusable while looking correct.

Evidence is **mechanism-relative**:

- `mkdir` mutex: the create was issued to the kernel AND the kernel returned
  `EEXIST` (or `ERROR_ALREADY_EXISTS`) to the loser.
- `flock`: `flock(2)` was issued with `LOCK_EX|LOCK_NB` AND the kernel returned
  `EWOULDBLOCK` to the loser while the holder proceeded.

A trace SHALL be interpreted only against the mechanism it was taken for. A
trace evaluated against a different mechanism licenses **nothing**.

**Mistake 2: requiring host-produced syscall evidence everywhere.** MSYS2 /
Git-Bash is the only host the `mkdir` fallback exists for, and it ships no
tracer. Demanding `syscall` evidence there makes the fallback unreachable —
documentation rather than code. That is why `pinned-mechanism` exists.

And the standing asymmetry that drives the whole design: **contention sampling
can falsify atomicity but can never demonstrate it.** A clean 8-racer run on a
known check-then-act `mkdir` proves nothing.

## 1. Scope

Tasks **T4, T5 and T14**. You are NOT migrating callers (L3) and NOT writing
`tests/lock.bats` (L4). You ARE replacing the trust seam inside
`lib/lock.sh` — round L1 defined it as `fm_lock__verdict_for` with a
conservative empty body and documented its contract in the header. **Read that
header first and honour the contract.** L1's six refusal codes, ordered guard
chain and flat-locking rule are settled; do not redesign them.

Files: `env/tool-check.sh`, `env/tool-check.ps1`, `env/reference-manifest.toml`,
and the seam body in `skills/foreman/scripts/lib/lock.sh`.

## 2. T4 — the atomicity probe in the host inventory

Add a **deterministic** probe to `env/tool-check.sh`. Deterministic means it
observes the mechanism, not a contention sample — it must not depend on machine
load.

Write one row per probed mechanism into the JSON inventory (`--json --out`),
carrying: absolute resolved path, version string, **SHA-256 digest**, verdict
(`atomic` / `non-atomic` / `unknown`), evidence class, **the filesystem classes
the verdict covers**, and a UTC timestamp.

Probe **`flock` as well as `mkdir`**, on the same schema. An available `flock`
still needs a verdict scoped to a filesystem class: advisory locking on a
network or DrvFs mount is the "available but unsafe" state that has no code
today.

Evidence classes are exactly four, and each licenses only what it can carry:

| class | may license |
|---|---|
| `syscall` | `atomic` or `non-atomic` |
| `pinned-mechanism` | `atomic` or `non-atomic` |
| `contention` | **`non-atomic` only** |
| `flavour` | **nothing on its own** |

Anything that cannot license `atomic` reports `unknown`.

- INFO when non-atomic but `flock` is present and trusted for the class.
- NOT-READY when no mechanism can earn a trusted verdict.
- Mirror the probe in `env/tool-check.ps1`, including digest and
  filesystem-class fields. The PS1 mirror is **not** required to produce
  syscall evidence — that is exactly what `pinned-mechanism` is for.
- Degrade honestly with no tracer: report the weaker class as weaker and the
  verdict as `unknown`, never as `atomic`.
- `lib/lock.sh` **reads** this row and never writes it. `tool-check.sh` owns it.

**Required test:** a clean 8-racer contention sample against a known
check-then-act `mkdir` still reports `unknown`, never `atomic`.

## 3. T5 — reference manifest and the pinned atomicity register

In `env/reference-manifest.toml`:

- Record the coreutils-flavour hazard with the measured evidence and date:
  Ubuntu 26.04 ships a hybrid coreutils where `mkdir`, `stat`, `date`, `sort`
  and `ln` are uutils (Rust) 0.8.0 while `mv` and `rm` are GNU 9.7. Measured,
  8 racers on one lock: **uutils 57 mutual-exclusion violations / 15 rounds,
  GNU 0, flock 0 on ext4, tmpfs and drvfs**.
- Promote `flock` to `required = true` for the `durable` profile.
- Add the **pinned atomicity register**: per pinned primitive, its SHA-256
  digest, the host class it was traced on, the path of the committed trace
  artifact, the filesystem classes the verdict covers, and the date.
- Seed it with at least one MSYS2 / Git-Bash `mkdir.exe` so the fallback's only
  host has a reachable trusted path on day one. **If you cannot obtain a real
  Git-Bash trace from this environment, say so plainly in `REPORT.md` and leave
  the register entry absent rather than fabricating one.** A fabricated entry is
  worse than an unreachable fallback.
- Document that entries come only from a trace on a Foreman-controlled host —
  never from a version string or a vendor claim.

## 4. T14 — wire mechanism selection to the verdict

Replace the seam body. Read the record from
`${FOREMAN_TOOL_CHECK_JSON:-${HOME}/.foreman/last-tool-check.json}`.

**Trust exactly two classes**, per section 0: `syscall` (a trace on **this**
host) and `pinned-mechanism` (resolved primitive's SHA-256 matches a register
entry, that entry cites a committed `syscall` trace from a Foreman-controlled
host of the same class, and the lock path's filesystem class is one the entry
names).

Untrusted, with no promotion by any caller: `non-atomic`; `unknown` from the
flavour or contention classes; an absent record; a digest matching no entry.
**A version-string match is not a digest match.**

**Currency — all six conditions must hold:**

1. same absolute resolved path as resolved now
2. same version string as observed now
3. same SHA-256 digest as computed now
4. covered filesystem classes include the class the lock path resolves to now
5. record timestamp not earlier than that binary's mtime
6. record not more than 24 hours old

**Filesystem class** is computed for **the directory that will contain the
lock** — not `$PWD`, not `FOREMAN_HOME`. Distinguish at least: local fixed
volume; `/mnt` DrvFs or other Windows-hosted mount; network mount (NFS,
CIFS/SMB, `//server/share` UNC); FUSE or other userspace filesystem. A verdict
earned on one class is **never** inherited by another.

Absent, unreadable, unparsable, stale or mismatched record -> run **one bounded
local probe per process**, cached in process memory only. The helper never
writes the inventory record.

Resolve mechanism selection and verdict trust **once, at initialization, before
any spin** — L1 depends on this ordering to make `FM_LOCK_TIMEOUT` structurally
impossible on an untrusted mechanism. Do not move trust evaluation into the
spin.

Refuse per L1's existing ordered chain. Do not invent new codes.

## 5. Verification — mandatory

> Every checker must be demonstrated to FAIL against a known-bad input before
> it is trusted.

Extend `scratch-lock-harness.sh` (not `tests/lock.bats`) and capture real
output for each:

1. Forced `mkdir` fallback on a host whose probe returns a trusted
   `non-atomic` -> helper refuses naming the absent primitive.
2. Record removed or backdated -> helper probes locally rather than assuming,
   and refuses if the local probe cannot earn trust.
3. Resolved `mkdir` whose **version string matches** the register but whose
   **SHA-256 does not** -> refused `FM_LOCK_PROBE_UNTRUSTED`.
4. Pinned digest with a covered filesystem class -> fallback selected, creates
   exactly one lock directory, releases exactly once including on the error
   exit path.
5. Same pinned digest with the lock path forced onto an **uncovered** class ->
   refused, not inherited.
6. Each of the six currency conditions violated in turn -> refusal, six
   separate captures.
7. A `flock` trace evaluated against `mkdir` (and vice versa) -> licenses
   nothing. This is mistake 1; prove it cannot recur.
8. Clean 8-racer contention sample on a check-then-act `mkdir` -> `unknown`,
   never `atomic`.
9. `shellcheck` clean on every modified file.
10. **Re-run the whole existing harness** — L1's six refusal codes, flat rule,
    fail-closed default and the N1/N2/N3 fixes must all still pass.

Write `REPORT.md`: each change, the command exercising it, the ACTUAL observed
output, the full regression run, and anything unsatisfied — especially whether
you could seed the Git-Bash register entry honestly. A stated blocker is a good
outcome; a fabricated pass is the failure this release exists to eliminate.
