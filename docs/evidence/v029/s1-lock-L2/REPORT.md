# REPORT — lock-primitive-hardening L2 rework (round 2)

Worktree: `/root/fm-wt/s1-lock-L2`  
Date: 2026-07-29  
Scope: fix every REWORK.md finding (F1–F12 + `fm_lock_reclaim`).  
Owned files: `skills/foreman/scripts/lib/lock.sh`, `env/tool-check.sh`,
`env/tool-check.ps1`, `env/reference-manifest.toml` (+ harness / durable-lanes
docs for verification).  
**No git commit. No graphify.** `/usr/local/bin/openspec` only (not used this
round — no OpenSpec package edit).

**Preserved from round 1:** the pinned register ships **empty** with the reason
recorded. No fabricated Git-Bash digest was written.

---

## 0. Order of work

F8 first (harness must be able to fail), then F1/F9, F3/F12, F4, F2, F5, F10/F11,
F6, F7, then `fm_lock_reclaim`, then full harness re-run.

---

## 1. Fixes

### F8 — harness exit status (done first)

`scratch-lock-harness.sh` now accumulates `HARNESS_FAILS` / `HARNESS_PASSES`
via `harness_fail` / `harness_pass`, prints
`HARNESS SUMMARY pass=N fail=M`, and **exits non-zero if any case failed**.

Negative control (forced fail):

```text
CMD: harness_fail " synthetic"; summary; exit on fails
  FAIL synthetic
HARNESS SUMMARY pass=0 fail=1
HARNESS FAILED
EXIT:1
```

Negative control (streamed copy expecting `FM_LOCK_BOGUS`):

```text
BOGUS_HARNESS_EXIT:1
  FAIL: expected code FM_LOCK_BOGUS in stderr
HARNESS SUMMARY pass=61 fail=10
HARNESS FAILED
```

### F1 — `pinned-mechanism` inventory cannot forge trust

`fm_lock__verdict_for` no longer accepts `evidence_class=pinned-mechanism`
after currency alone. It requires `fm_lock__inventory_pin_ok` → real register
match via `fm_lock__pinned_verdict` (digest + host class + validated trace +
FS coverage). Empty register ⇒ pin unreachable ⇒ refuse.

Observed:

```text
CMD: forged pinned-mechanism inventory vs empty register
  stderr=[FM_LOCK_PROBE_UNTRUSTED host_class=wsl-linux durable_lanes=unavailable
    mechanism=mkdir path=/usr/lib/cargo/bin/coreutils/mkdir
    sha256=48893b0fb21436b54619db80486e83ef39dfccaf1aefe83dfa00c02d6146e8c0
    remedy=trace-on-Foreman-controlled-host-of-same-class-commit-artifact-add-
    [[lock_atomicity.pinned]]-in-env/reference-manifest.toml]
  rc=1 lock_exists=no
  PASS F1 forged pin refused, no lock created
```

### F9 — pin validation is checkable

`fm_lock__pinned_verdict` now requires:

1. matching `mechanism` + SHA-256 in register  
2. non-empty `host_class` equal to `fm_lock__host_class` (or
   `FOREMAN_LOCK_HOST_CLASS`)  
3. non-empty `verdict` in `{atomic,non-atomic}` — **no default to atomic**  
4. `trace_artifact` resolves to a non-empty file  
5. `fm_lock__trace_valid` accepts mechanism-relative content  
6. lock path FS class is in `filesystem_classes`

Observed:

```text
CMD: pin with fake trace content
  pinned_verdict=[]
  PASS F9a fake trace rejected
CMD: pin with wrong host_class
  pinned_verdict=[]
  PASS F9b wrong host_class rejected
```

### F3 / F12 — flock evidence contract

Predicates require **both**:

- loser: `flock(2)` with **`LOCK_EX|LOCK_NB`** returning `EAGAIN`/`EWOULDBLOCK`
  (`LOCK_SH` and bare-EAGAIN fallbacks removed)  
- holder: proceeded (`flock(...LOCK_EX...)=0` or `holder_acquired=1` marker)

Probes wait on a holder-ready marker before tracing the loser.

Observed:

```text
  PASS F3 LOCK_SH rejected
  PASS F3 bare EWOULDBLOCK without LOCK_NB rejected
  PASS F12 refusal without holder rejected
  PASS F3/F12 valid flock trace accepted
```

### F4 — mkdir `EEXIST` bound to probe target

Predicates require the path fragment of the probed lock in the
`mkdir`/`mkdirat` EEXIST line. An unbound `mkdir("/unrelated") = -1 EEXIST`
does not license.

```text
  PASS F4 unbound EEXIST rejected for probe/x
  PASS F4 bound EEXIST accepted
```

### F2 — no cross-class inheritance of atomic

`fm_tc_run_atomicity_probes` keeps per-class verdicts; `filesystem_classes` is
the set of classes whose **own** result equals the chosen best verdict. Local
`atomic` does not license `network`.

Live inventory after fix (both rows cover only `local`):

```json
[
  {
    "mechanism": "mkdir",
    "verdict": "non-atomic",
    "evidence_class": "syscall",
    "filesystem_classes": ["local"]
  },
  {
    "mechanism": "flock",
    "verdict": "atomic",
    "evidence_class": "syscall",
    "filesystem_classes": ["local"],
    "notes": "... LOCK_EX|LOCK_NB ... holder proceeded ..."
  }
]
```

```text
  PASS F2 cross-class inheritance blocked
```

### F5 — mkdir fallback reachable with a real pin (temp manifest only)

With a **temporary** manifest + structurally valid mkdir trace + matching
host class + flock suppressed, acquire selects `mkdir` and writes an owner
token. Real register stays empty.

```text
CMD: temp mkdir pin; flock absent; acquire
  stdout=[mkdir] stderr=[] rc=0
  PASS F5 mkdir fallback selected under valid pin
  PASS F5 real register remains empty
```

`env/tool-check.sh` / `env/tool-check.ps1` now **read** the pin register and
can emit `pinned-mechanism` when a validated pin matches. PS1: `flock`
Check-One exists; durable may proceed without flock when `trustedAtomic`
comes from a mkdir pin.

### F10 / F11 — evidence classes

- `contention` + `non-atomic` is trusted polarity → drives
  `FM_LOCK_NO_ATOMIC_PRIMITIVE` (not discarded as unproven).  
- Clean no-tracer sample records `evidence_class=contention` (not `flavour`).

```text
CMD: contention/non-atomic only; acquire
  stderr=[FM_LOCK_NO_ATOMIC_PRIMITIVE] rc=1
  PASS F10 non-atomic contention drives NO_ATOMIC_PRIMITIVE
  PASS F11 unknown clean sample serializes as contention (code path in tool-check)
```

### F6 — untrusted refusal is a stated consequence

`FM_LOCK_PROBE_UNTRUSTED` carries
`host_class=… durable_lanes=unavailable … remedy=…` (pinning procedure).
`skills/foreman/references/durable-lanes.md` documents host-class availability
and the pinning procedure.

```text
  PASS F6 refusal names host_class, consequence, remedy
```

### F7 — process-local probe cache

`fm_lock_acquire` / `fm_lock__select_mechanism` / `fm_lock__verdict_for` no
longer rely on `$()` for cache-mutating trust (sets `_FM_LOCK_SELECTED` /
`_FM_LOCK_LAST_VERDICT` in-process). Local probes are tracked in
`_FM_LOCK_LOCAL_PROBED_MECHS`.

```text
CMD: two acquires; probes first=1 second=1 rc1=0 rc2=0 mechs=[ flock]
  PASS F7 second acquire did not re-probe (probes stayed at 1)
```

### PART B — `fm_lock_reclaim`

```text
fm_lock_reclaim <lock_path>
  exit 0 — reclaimed; stderr FM_LOCK_RECLAIMED lock=… dead_holder_pid=… start=…
  exit 1 — refused;  stderr FM_LOCK_RECLAIM_REFUSED lock=… reason=…
```

- mkdir only; owner token `pid=` + `start=` (`/proc/<pid>/stat` field 22)  
- written **only** after successful mkdir win  
- reclaim only when holder provably dead; refuse live / undetermined  
- never applied to flock file path; single named lock only  

```text
CMD: fm_lock_reclaim …/a.lock (dead holder)
  rc=0 stderr=[FM_LOCK_RECLAIMED lock=… dead_holder_pid=999999 dead_holder_start=1]
  PASS reclaim dead holder
  PASS reclaim left other three locks untouched
CMD: reclaim live holder rc=1 err=[… reason=holder_live …]
  PASS reclaim refuses live holder
CMD: reclaim reused-PID token rc=0 err=[FM_LOCK_RECLAIMED …]
  PASS reclaim accepts dead identity under reused PID
CMD: reclaim flock file rc=1 err=[… reason=flock_path_not_applicable]
  PASS reclaim never applied on flock path
  PASS winner wrote owner token
  PASS loser never wrote token without lock
```

### Register honesty (unchanged)

```text
live [[lock_atomicity.pinned]] entries: 0
  PASS L2-10 no fabricated Git-Bash pin (register intentionally empty)
```

---

## 2. Full harness

```text
CMD: bash scratch-lock-harness.sh
EXIT:0
HARNESS SUMMARY pass=68 fail=0
HARNESS DONE
parsed PASS lines: 75
parsed FAIL lines: 0
```

Includes L1 six codes, ordered chain H1–H5/M1, flat rule, N1/N2/N3, L2-1…L2-10,
and R2 rework cases. Shellcheck: `lock.sh` clean; `tool-check.sh -S error` clean.

---

## 3. Unsatisfied / blockers (stated honestly)

| Item | Status |
|---|---|
| Real Git-Bash `mkdir.exe` pin in `env/reference-manifest.toml` | **Absent** — no Foreman-controlled MSYS2/Git-Bash host with a real syscall trace. Empty register is deliberate. Reachability of the fallback is proven only via **temporary** harness manifests (F5), not a production pin. |
| `tests/lock.bats` | Out of scope (L4). |
| Caller migration to `fm_lock_reclaim` | Out of scope (sibling round owns callers). Function is implemented in `lock.sh` for that round to call. |
| Durable-lanes.md availability table | Written; operator-facing. |

A stated blocker (no real Git-Bash pin) is the correct outcome. Fabricating one
would re-open the failure class this release exists to eliminate.

---

## 4. Files touched

| File | Role |
|---|---|
| `skills/foreman/scripts/lib/lock.sh` | Trust plane F1/F9/F3/F12/F4/F10/F6/F7; owner token; `fm_lock_reclaim` |
| `env/tool-check.sh` | Probe predicates F3/F4/F12; per-class aggregation F2; F11; pin lookup F5 |
| `env/tool-check.ps1` | Pin lookup + flock Check-One + durable readiness with pin (F5) |
| `env/reference-manifest.toml` | Still empty pin register + hazard notes (unchanged policy) |
| `skills/foreman/references/durable-lanes.md` | Host-class availability + pinning procedure (F6) |
| `scratch-lock-harness.sh` | F8 exit status + R2 cases |
| `REPORT.md` | This file |
