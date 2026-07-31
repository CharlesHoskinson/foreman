# L2 Lock Primitive Hardening — Cold Audit

## VERDICT

**BLOCKED**

Six high-severity and six medium-severity findings remain. Most importantly,
an inventory row can forge `pinned-mechanism` trust despite the empty register
(F1), filesystem-class aggregation inherits local evidence onto an unknown
network class (F2), syscall predicates license evidence weaker than the
mechanism-relative contract (F3/F4/F12), the Git-Bash fallback remains
unreachable even after a real pin (F5), and a fake trace artifact is accepted
as a pin (F9).

## Scope

- Repository: `/root/fm-wt/s1-lock-L2`
- Branch: `s1/lock-L2-trust`
- Diff: `94eb08d..448b506`
- Mode: cold audit; repository read-only except for this report

## Findings

### F1 — HIGH — inventory can forge `pinned-mechanism` trust and bypass the empty register

- File: `skills/foreman/scripts/lib/lock.sh:517`
- Verdict impact: **BLOCKED**
- The inventory branch accepts `evidence_class == "pinned-mechanism"` and an
  `atomic`/`non-atomic` row as trusted after only the six currency comparisons,
  then returns at line 521. It does **not** require that the current digest
  match an entry in `env/reference-manifest.toml`, nor that such an entry cite
  a committed syscall trace. The separate manifest lookup at line 545 is
  unreachable after this early return.
- Concrete reproduction used the real resolved `mkdir`, its real version and
  SHA-256, a current timestamp, and `local` coverage in an inventory file
  selected through `FOREMAN_TOOL_CHECK_JSON`; it labelled the row
  `pinned-mechanism`/`atomic`. `flock` availability was suppressed only to
  exercise the specified Git-Bash fallback. Observed:

  ```text
  register_entries=0
  verdict=atomic
  acquire_rc=0
  acquire_output=mkdir
  lock_created=yes
  ```

- This is an actual fail-open path on an untrusted mechanism. The release
  register intentionally contains zero `[[lock_atomicity.pinned]]` entries, but
  an arbitrary inventory writer—or any caller-controlled
  `FOREMAN_TOOL_CHECK_JSON`—can make the check-then-act `mkdir` acquire anyway.
  The correct behavior is `FM_LOCK_PROBE_UNTRUSTED`, with no lock created.

### F2 — HIGH — probe aggregation inherits an atomic verdict across filesystem classes

- Files: `env/tool-check.sh:596`, `env/tool-check.sh:604`,
  `env/tool-check.sh:663`, `env/tool-check.sh:671`
- Verdict impact: **BLOCKED**
- `fm_tc_run_atomicity_probes` stores one best verdict for a mechanism but adds
  the filesystem class from **every** probe result to that verdict's coverage,
  including classes whose result was `unknown`. An `atomic` syscall result on
  one class therefore licenses every other sampled class.
- A known-bad aggregation test supplied `atomic/syscall` for `local` and
  `unknown/syscall` for `network`. The unmodified aggregation function emitted:

  ```text
  mkdir verdict=atomic evidence=syscall licensed_classes=local,network notes=network:no qualifying kernel verdict;local:mkdir EEXIST
  flock verdict=atomic evidence=syscall licensed_classes=local,network notes=network:no qualifying kernel verdict;local:LOCK_EX|LOCK_NB EWOULDBLOCK
  ```

- This directly violates the rule that a verdict earned on one filesystem
  class is never inherited by another. It can make the helper select either
  mechanism on a network/DrvFs/FUSE path using evidence observed only on a
  local volume.

### F3 — HIGH — flock syscall evidence does not require `LOCK_EX|LOCK_NB`

- Files: `env/tool-check.sh:507`,
  `skills/foreman/scripts/lib/lock.sh:416`
- Verdict impact: **BLOCKED**
- The primary predicate permits `LOCK_SH` as well as `LOCK_EX`. The fallback
  predicate at line 511 permits any `flock(2)` returning
  `EAGAIN`/`EWOULDBLOCK`, without checking either `LOCK_EX` or `LOCK_NB`, and
  assigns `atomic`/`syscall`.
- Known-bad trace controls against the exact predicates observed:

  ```text
  trace=flock(9, LOCK_SH|LOCK_NB) = -1 EAGAIN ...
  primary_accepts=yes fallback_accepts=yes
  trace=flock(9, LOCK_SH) = -1 EWOULDBLOCK ...
  primary_accepts=no fallback_accepts=yes
  ```

- The licensing requirement is specifically a kernel `flock(2)` call with
  `LOCK_EX|LOCK_NB` and a kernel would-block result to the loser while the
  holder proceeds. These predicates license weaker, wrong-mechanism-mode
  traces as atomic.

### F4 — HIGH — mkdir syscall evidence is not bound to the probed lock target

- Files: `env/tool-check.sh:396`,
  `skills/foreman/scripts/lib/lock.sh:388`
- Verdict impact: **BLOCKED**
- Both mkdir trace predicates accept any `mkdir(2)`/`mkdirat(2)` line ending in
  `EEXIST`; neither proves that the syscall was the create issued for the
  requested probe lock.
- A known-bad trace containing `mkdir("/unrelated", ...) = -1 EEXIST` plus a
  userspace `statx` of the real `/tmp/probe/x` target matched the licensing
  predicate (`predicate_accepts=yes`).
- Thus a mechanism that performs an unrelated create and uses check-then-act
  for the actual lock can be labelled `atomic/syscall`. The requirement is
  target-relative as well as mechanism-relative: the create for the lock
  itself must be issued to the kernel and that attempt must receive `EEXIST`.

### F5 — HIGH — the Git-Bash durable path is permanently locked out, even after a real pin

- Files: `env/tool-check.sh:628`, `env/tool-check.sh:717`,
  `env/tool-check.ps1:243`, `env/tool-check.ps1:330`,
  `env/tool-check.ps1:393`
- Verdict impact: **BLOCKED**
- The Bash checker used under Git-Bash also requires `flock` in
  `must_durable`, and no code in its atomicity probe reads the pinned register
  or ever produces `pinned-mechanism`; that label appears only in comments and
  post-probe conditionals.
- `$mustDurable` requires `flock`, but `Check-One` has no `flock` case, so the
  tool is always reported `unknown` by the Windows mirror. Separately,
  `Get-LockAtomicityProbe` initializes `trustedAtomic = $false`, emits only
  `flavour/unknown` rows, never reads the pinned register, and never changes
  that flag. The durable profile therefore always appends
  `lock_atomicity:no_trusted_atomic_mechanism`.
- Read-only execution of the mirror produced:

  ```text
  exit=1
  ready=False
  must_fail=['flock:unknown', 'lock_atomicity:no_trusted_atomic_mechanism']
  flock_tool=[{'id': 'flock', 'status': 'unknown', 'detail': 'no checker'}]
  atomicity=[('mkdir', 'unknown', 'flavour'), ('flock', 'unknown', 'flavour')]
  ```

- The empty register may honestly make Git-Bash durable lanes unavailable
  today, but the shipped procedure says that adding a real traced digest is the
  route back to availability. This implementation cannot observe such a pin,
  so that route is non-functional and the `pinned-mechanism` fallback remains
  unreachable from host readiness.

### F6 — MEDIUM — untrusted fallback refusal does not state the platform consequence or remedy

- Files: `skills/foreman/scripts/lib/lock.sh:699`,
  `skills/foreman/references/durable-lanes.md:1`
- Verdict impact: contributes to **BLOCKED**
- Guard 4 calls `fm_lock__refuse "FM_LOCK_PROBE_UNTRUSTED"` with no detail.
  Consequently the empty-register Git-Bash refusal does not name the resolved
  `mkdir`, its digest, the evidence that is missing, or the trace-and-pin
  procedure that restores availability.
- The committed release documentation contains no Git-Bash durable-lane
  availability statement; the only shipped statement found is a comment in
  `env/reference-manifest.toml:381-384`. That comment honestly records why the
  register is empty, but it is neither the runtime explanation nor the required
  supported-host availability documentation.
- This violates the requirement that an untrusted mechanism be a stated,
  scoped platform consequence rather than a silent lockout with a bare code.

### F7 — MEDIUM — process-local probe results are not cached in the process

- File: `skills/foreman/scripts/lib/lock.sh:631`
- `fm_lock__select_mechanism` captures `fm_lock__verdict_for` with command
  substitution. The trust function therefore runs in a subshell, and its
  updates to `_FM_LOCK_VINIT`, `_FM_LOCK_VROWS`, and
  `_FM_LOCK_LOCAL_PROBED_MECHS` disappear on return. The outer acquisition also
  captures mechanism selection through command substitution.
- A two-selection test in one shell, with an absent inventory and an
  instrumented bounded local probe, observed:

  ```text
  local_probe_calls=2
  markers=probe mkdir,probe mkdir,
  ```

- The required behavior is one bounded local probe per process before the
  first acquisition, with its result retained in process memory. The current
  code re-probes on every selection and does not resolve trust once at helper
  initialization.

### F8 — MEDIUM — the scratch harness prints failures but still exits success

- File: `scratch-lock-harness.sh:4`
- The harness uses `set +e`, emits `FAIL` strings ad hoc, has no accumulated
  failure counter, and ends with `echo "HARNESS DONE"` at line 1288. Its exit
  status therefore does not represent its assertions.
- Negative control: the first expected refusal code was changed in a streamed
  copy from `FM_LOCK_PROBE_UNTRUSTED` to `FM_LOCK_BOGUS`. Observed:

  ```text
  negative_control_exit=0
    FAIL: expected code FM_LOCK_BOGUS in stderr
    FAIL one-shape for FM_LOCK_BOGUS
  ```

- The unmodified harness's green-looking exit code is not independently
  trustworthy; PASS/FAIL output must be parsed, and the harness must eventually
  aggregate failures into a non-zero exit.

### F9 — HIGH — direct pin validation accepts a fake trace and ignores host class

- File: `skills/foreman/scripts/lib/lock.sh:356`
- Verdict impact: **BLOCKED**
- `fm_lock__pinned_verdict` checks only that `trace_artifact` is a non-empty
  string. It does not verify that the artifact exists, is committed, records
  mechanism-relative syscall evidence, or comes from the entry's declared host
  class. It never reads `host_class`; a missing `verdict` defaults to
  `atomic` at line 359.
- The supplied harness's L2-4 fixture writes only:

  ```text
  synthetic pin test artifact (not a production pin)
  ```

  It then places that path in a temporary pin and the unmodified helper selects
  `flock` and acquires (`PASS L2-4 pinned digest selects mechanism + single
  release`).
- A digest plus an arbitrary non-empty pathname is not
  `pinned-mechanism` evidence. This path can license atomicity without the
  required committed syscall trace or same-class provenance.

### F10 — MEDIUM — licensed `non-atomic/contention` evidence is discarded

- File: `skills/foreman/scripts/lib/lock.sh:517`
- The helper accepts polarity only from `syscall` or `pinned-mechanism`.
  Consequently a contention probe that actually observes double entry and
  reports `non-atomic/contention` is treated the same as an unlicensed atomic
  claim.
- Current-row matrix with local probe and pins disabled:

  ```text
  contention/non-atomic verdict_for=[] select_rc=1 select=[FM_LOCK_PROBE_UNTRUSTED]
  contention/atomic verdict_for=[] select_rc=1 select=[FM_LOCK_PROBE_UNTRUSTED]
  flavour/atomic verdict_for=[] select_rc=1 select=[FM_LOCK_PROBE_UNTRUSTED]
  ```

- Rejecting atomic contention and flavour is correct. Discarding
  non-atomic contention is not: an observed overlap licenses the negative
  verdict and, when it is the only mechanism, should drive
  `FM_LOCK_NO_ATOMIC_PRIMITIVE`, not the “unproven” code.

### F11 — MEDIUM — unknown probe evidence is serialized under the wrong class

- Files: `env/tool-check.sh:604`, `env/tool-check.sh:671`
- The aggregation `*` branches retain the initial
  `best_evidence="flavour"` instead of the actual evidence class returned by
  the probe. A clean no-tracer contention sample therefore does yield
  `unknown`, but its inventory row says `flavour`, not `contention`; an
  inconclusive syscall trace is also mislabeled flavour.
- Direct aggregation control:

  ```text
  mkdir source_result_note=[local:clean 8-racer sample] serialized=unknown/flavour
  flock source_result_note=[local:inconclusive trace] serialized=unknown/flavour
  ```

- This does not promote the row to atomic, but it violates the inventory schema
  and the scenario requiring the clean sample's evidence class to be recorded
  as `contention`.

### F12 — MEDIUM — flock evidence never proves that the holder proceeded

- Files: `env/tool-check.sh:500`,
  `skills/foreman/scripts/lib/lock.sh:411`
- Both probes start a background holder, sleep `0.1`, trace a loser, then ignore
  the holder's exit (`wait ... || true`). There is no readiness signal or
  assertion that the holder successfully acquired `LOCK_EX` and remained in
  its critical section.
- The required syscall evidence has two sides: the holder proceeds and the
  `LOCK_EX|LOCK_NB` loser receives kernel `EWOULDBLOCK`. Observing—or merely
  regex-matching—the loser without proving the holder side cannot license
  atomicity.

## Verification

Commands, observed outputs, and negative controls follow.

### Audit boundary established

- `git rev-parse HEAD` returned `448b506f2c2c4157f9c9427ca17547d04b87694a`.
- `git branch --show-current` returned `s1/lock-L2-trust`.
- `git diff --name-status 94eb08d..448b506` contains exactly the four committed
  product files in scope:
  `env/reference-manifest.toml`, `env/tool-check.ps1`, `env/tool-check.sh`, and
  `skills/foreman/scripts/lib/lock.sh`.
- `scratch-lock-harness.sh`, `BRIEF.md`, and `REPORT.md` are untracked review
  inputs and are not silently treated as shipped changes.
- Graphify was not run.

### Evidence-class licensing

- Direct no-tracer execution of `fm_tc_probe_mkdir_once` against a deliberately
  check-then-act test primitive under a clean eight-racer schedule returned:

  ```text
  unknown	contention	local	clean 8-racer sample; contention cannot license atomic (still unknown)
  ```

- This satisfies the asymmetric licensing rule for the clean-sample case:
  contention did not produce `atomic`; flavour alone was not used to license a
  verdict.

### Full scratch harness

- Command: `bash scratch-lock-harness.sh`
- Fresh result: exit `0`; **51 PASS lines; 0 FAIL lines**.
- Because of F8, the meaningful evidence is the parsed 51/0 output count, not
  the process exit status alone.
- The six currency mutations in the harness each refused:
  path, version, digest, filesystem coverage, timestamp before binary mtime,
  and timestamp older than 24 hours.

### L1 and N1/N2/N3 regression results

- Six refusal causes retained their one-shape/non-zero/no-protected-write
  behavior; parsed harness markers include seven one-shape/nested passes.
- Ordered-guard regression markers: 8 passes across H1/H2/H3/M1.
- Flat-rule regression markers: 3 passes (nested refusal, no ordering, distinct
  lock claims retained).
- N1: **3 passes** — caller-owned FD 3 survived flock success, mkdir success,
  and refusal.
- N2: **5 passes** — caller EXIT trap, command EXIT trap/error exit, signal
  release, no double release, and refusal trap preservation.
- N3: **2 passes** — inherited hold state did not cause false `NESTED`, while a
  genuine same-process re-source preserved the outer hold.

### Filesystem-class binding and inventory ownership

- Live classification:

  ```text
  lock_parent_class=local
  mnt_c_class=mnt-drvfs
  pwd_class=local
  ```

- With a current `flock` syscall row covering only `local`, the helper returned
  `atomic` for a `/tmp` lock and `fs-unsupported` for
  `/mnt/c/fm-audit-no-create.lock`. No lock was attempted on `/mnt/c`.
- SHA-256 of the selected inventory file was identical before and after the
  trust queries (`unchanged=yes`). Static search found no inventory write in
  `lib/lock.sh`; the only `Set-Content` owner is `env/tool-check.ps1`'s
  explicit `-Out` path.

### Invalid-record fail-closed controls

- With local replacement probing and pins disabled to isolate the record
  guards, acquisition results were:

  ```text
  absent exit=1 output=FM_LOCK_PROBE_UNTRUSTED lock_created=no
  unreadable exit=1 output=FM_LOCK_PROBE_UNTRUSTED lock_created=no
  unparsable exit=1 output=FM_LOCK_PROBE_UNTRUSTED lock_created=no
  ```

- These record-error branches fail closed in isolation. F1 remains the
  exception: a current forged `pinned-mechanism` row is accepted through
  `FOREMAN_TOOL_CHECK_JSON`.

### Empty-register honesty

- `env/reference-manifest.toml` contains zero live
  `[[lock_atomicity.pinned]]` entries; the only occurrence is the commented
  schema example.
- `94eb08d..448b506` adds no trace artifact and no pinned digest. The recorded
  reason—no Foreman-controlled Git-Bash host was available—is honest.
- The empty register does not safely enforce the intended fallback refusal
  because of F1, and its stated route back is non-functional because of F5/F9.

### Trusted-negative and initialization ordering

- A current `mkdir` row carrying `non-atomic/syscall`, with mkdir as the only
  available mechanism, produced:

  ```text
  exit=1
  output=FM_LOCK_NO_ATOMIC_PRIMITIVE
  lock_created=no
  ```

- Trust selection (`fm_lock__select_mechanism`) completes before either
  acquisition function is entered; the acquisition loops contain no calls to
  `fm_lock__verdict_for`. The fresh contention regression emitted
  `FM_LOCK_TIMEOUT` only after an overridden trusted mechanism had been
  selected.

### Syntax and static checks

- `git diff --check 94eb08d..448b506`: clean.
- `bash -n` on `lib/lock.sh`, `tool-check.sh`, and the scratch harness: clean.
- `shellcheck skills/foreman/scripts/lib/lock.sh`: clean.
- `shellcheck -S error env/tool-check.sh`: clean.
- PowerShell parser for `env/tool-check.ps1`: clean.
- Python `tomllib` parse of `env/reference-manifest.toml`: clean.
- Final tree comparison confirmed that all four audited product files remain
  byte-identical to `HEAD`; `AUDIT-L2.md` is the audit's only repository write.
  A concurrent `.fm-lane-owner` file appeared after the initial status snapshot,
  identifies `owner=claude-90b20c63`, and was preserved as external state.

## Criteria disposition

1. **Mechanism-relative evidence: FAIL.** Row lookup is mechanism-keyed and the
   cross-row harness cases pass, but F3, F4, and F12 show that the actual trace
   predicates do not enforce the required flags, target, and holder evidence.
2. **Evidence-class licensing: FAIL.** Clean contention remains unknown, but
   F10 discards licensed negative contention evidence and F11 records the wrong
   class.
3. **Six-condition currency: PASS in isolated mutation controls.** All six
   mutations refused, and a version match did not substitute for SHA-256.
   F1 is a separate trust-origin bypass after those currency comparisons pass.
4. **Filesystem class: FAIL.** Direct lock-path classification and a live
   `/mnt/c` refusal work, but the inventory producer licenses unknown classes
   with another class's atomic verdict (F2).
5. **Fail closed: FAIL.** Invalid-record controls refuse and the helper does not
   write inventory, but F1 is a concrete `FOREMAN_TOOL_CHECK_JSON` acquisition
   bypass.
6. **Ordering: PASS; process initialization cache: FAIL.** Trust selection
   precedes acquisition spins, so timeout is not reached on an untrusted
   mechanism. F7 shows that the promised once-per-process result is not
   retained.
7. **Empty register / stated consequence: FAIL overall.** The empty register
   and its reason are honest, but F1 bypasses it, F5 makes the pinning route
   unreachable, F6 omits the runtime remedy, and F9 accepts fake trace
   provenance.
8. **L1 + N regressions: PASS by parsed harness output.** Fresh run:
   **51 PASS / 0 FAIL**. F8 means exit `0` alone is not a sound checker result.
9. **New defects this round: FOUND.** Findings F1–F12 are introduced in the L2
   trust/evidence implementation or its L2 scratch verification.
