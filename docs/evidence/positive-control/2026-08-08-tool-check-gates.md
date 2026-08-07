# Positive-control record -- 2026-08-08 -- `env/tool-check.sh`

Covers the nine `env/tool-check.sh` probes left in `tests/positive-control-todo.tsv`:
`check_one`, `fm_tc_fs_class`, `fm_tc_host_class`, `fm_tc_pinned_lookup`,
`fm_tc_probe_flock_once`, `fm_tc_probe_mkdir_once`, `fm_tc_run_atomicity_probes`,
`fm_tc_sha256`, `fm_tc_version_line`. Current platform on the host that
produced this record: `wsl` (WSL2, Ubuntu, kernel
`6.18.33.2-microsoft-standard-WSL2`).

`tool-check.sh` has no per-function CLI entry point -- it is a single linear
script that always runs its full readiness sweep and calls `exit` at the
bottom, so it cannot be `source`d just to reach one function. No test-only
seam like `FOREMAN_TEST_WSL_FORCE` exists for these nine probes specifically.
Rather than add one to a readiness checker (the brief's explicit
instruction), every demonstration below extracts the named function's literal
body straight out of the live `env/tool-check.sh` with `sed` (a read-only
operation -- the file on disk is never modified) and calls it directly with
real fixture arguments, or -- for gates whose seam is a genuine existing
production knob (`FOREMAN_LOCK_HOST_CLASS`, `FOREMAN_LOCK_MANIFEST`, `PATH`,
`$ROOT`/`$HOME`) -- drives the real script end-to-end. The extraction
one-liner used throughout:

```
sed -n '/^FN_NAME() {/,/^}/p' env/tool-check.sh
```

verified against the file's own `^}` line numbers so it captures exactly one
function body per name, no more and no less. Every arm below was executed in
the same shell session immediately before this record was written; nothing
here is inferred or backfilled from memory.

## Gate 1: `fm_tc_sha256`

### Predicate

Returns empty output (and always exits 0) when its argument is empty or
names a path that does not exist; otherwise prints the lowercase hex SHA-256
of the resolved file. It must reject a nonexistent path (empty output) and
accept an existing one (64-char digest).

### Fixture pair

Pointer-file indirection, matching the run.sh gates' pattern of varying the
*content* the check reads: `tests/fixtures/tool-check/sha256-bad.pointer`
names a path that is guaranteed never to exist;
`tests/fixtures/tool-check/sha256-good.pointer` names itself (guaranteed to
exist because it is a committed file). The registry cannot point directly at
"a path that doesn't exist" -- the row's own path column must exist -- so the
pointer file is the committed artifact and its *content* is the actual
argument fed to `fm_tc_sha256`.

`sha256-bad.pointer`: `tests/fixtures/tool-check/__does_not_exist__`
`sha256-good.pointer`: `tests/fixtures/tool-check/sha256-good.pointer`

### Known-bad arm

```
BAD="$(cat tests/fixtures/tool-check/sha256-bad.pointer)"
sed -n '/^fm_tc_sha256() {/,/^}/p' env/tool-check.sh > /tmp/fn.sh
bash -c 'source /tmp/fn.sh; fm_tc_sha256 "$1"' _ "$BAD"
```

Verbatim output: *(empty)* -- exit 0. NEGATIVE (no digest for a path that
does not exist), as required.

### Known-good arm

Same command, `GOOD="$(cat tests/fixtures/tool-check/sha256-good.pointer)"`.

Verbatim output:
```
5cf2feef791d94c6c6b02ea78f0a244a9975edaf608a9bdac1ef2f0ad50e31dc
```
POSITIVE (a real digest), as required.

## Gate 2: `fm_tc_version_line`

### Predicate

Returns empty output when its argument is empty or not executable
(`[[ ! -x "$bin" ]]`); otherwise runs `"$bin" --version`, takes the first
line, and strips `\r`. It must reject a non-executable path and accept an
executable one.

### Fixture pair

`tests/fixtures/tool-check/version-line-bad.sh` and
`.../version-line-good.sh` hold **byte-identical content** --
`#!/bin/sh\nprintf "fixture-tool 9.9.9\r\n"\n` -- and differ in exactly the
one property the gate reads: the executable bit. `bad.sh` is mode 644;
`good.sh` is mode 755. Git tracks the executable bit in its tree entries
(100644 vs 100755), so this single-bit difference survives the commit.

### Known-bad arm

```
sed -n '/^fm_tc_version_line() {/,/^}/p' env/tool-check.sh > /tmp/fn.sh
bash -c 'source /tmp/fn.sh; fm_tc_version_line "$1"' _ \
  tests/fixtures/tool-check/version-line-bad.sh
```
Verbatim output: *(empty)* -- exit 0. NEGATIVE, as required.

### Known-good arm

Same command against `version-line-good.sh`.

Verbatim output:
```
fixture-tool 9.9.9
```
POSITIVE, as required.

## Gate 3: `fm_tc_fs_class`

### Predicate

Classifies the filesystem class that owns a path: `local`, `mnt-drvfs`
(Windows-hosted DrvFs mount under WSL `/mnt`), `network`, or `fuse`. This
feeds `check_one`'s `foreman_home_fs` branch, which treats `mnt-drvfs` and
`network` as `degraded` (fsync guarantees do not hold) and everything else as
`ok`.

### Fixture pair

Pointer files naming two **real, currently-mounted** filesystems on this
host, so the discrimination is a measured host property, not a simulation:
`fs-class-bad.pointer` -> `/mnt/c` (a real `9p` DrvFs mount, verified via
`findmnt -n -o FSTYPE,TARGET -T /mnt/c` = `9p /mnt/c`); `fs-class-good.pointer`
-> `/tmp` (real `tmpfs` local mount). This arm is host-specific: it requires
a WSL host with a live `/mnt/c` mount, stated as a limitation rather than
silently assumed portable.

### Known-bad arm

```
BAD="$(cat tests/fixtures/tool-check/fs-class-bad.pointer)"
sed -n '/^fm_tc_fs_class() {/,/^}/p' env/tool-check.sh > /tmp/fn.sh
bash -c 'source /tmp/fn.sh; fm_tc_fs_class "$1"' _ "$BAD"
```
Verbatim output:
```
mnt-drvfs
```

### Known-good arm

Same command against `/tmp`.

Verbatim output:
```
local
```
Two real paths, two different real classifications, in the same session.

## Gate 4: `fm_tc_host_class`

### Predicate

Returns `"$FOREMAN_LOCK_HOST_CLASS"` verbatim when that env var is set
(an existing production override consumed by `fm_tc_pinned_lookup` and by
`lib/lock.sh` outside this file); otherwise auto-detects `msys2-git-bash`,
`wsl-linux`, or `linux-native` from `uname -s` / `/proc/version`. On this
real host, unset, it must return the true auto-detected class (`wsl-linux`);
set to a value naming a platform this host is not, it must return that value
verbatim (the override is honored, not second-guessed) -- which is the
behavior `fm_tc_pinned_lookup`'s pin-matching depends on being faithful to.

### Fixture pair

`host-class-bad.pointer` contains the literal string `msys2-git-bash` (a
platform this WSL host is not); `host-class-good.pointer` is empty (no
override -> auto-detect).

### Known-bad arm

```
OV="$(cat tests/fixtures/tool-check/host-class-bad.pointer)"
sed -n '/^fm_tc_host_class() {/,/^}/p' env/tool-check.sh > /tmp/fn.sh
FOREMAN_LOCK_HOST_CLASS="$OV" bash -c 'source /tmp/fn.sh; fm_tc_host_class'
```
Verbatim output:
```
msys2-git-bash
```

### Known-good arm

Same command with `FOREMAN_LOCK_HOST_CLASS` unset.

Verbatim output:
```
wsl-linux
```
Two different classifications for the two arms, and the good arm matches
this host's real, independently-verified identity (WSL2 kernel string
confirmed via `/proc/version`).

## Gate 5: `check_one` (id=`foreman_skill`)

### Predicate

For `id=foreman_skill`: status `ok` when
`$HOME/.claude|.agents|.grok/skills/foreman/SKILL.md` exists; else `degraded`
when `$ROOT/skills/foreman/SKILL.md` exists but the home link does not; else
`missing`. `check_one` is a 25-branch dispatcher over hardcoded tool ids;
`foreman_skill` was chosen because, unlike most branches, it reads two
already-parameterized globals (`$HOME`, `$ROOT`) rather than searching the
live `PATH`, so it can be controlled with committed fixture directories
instead of PATH surgery that would risk hiding unrelated host tools sharing
the same directory as the target (e.g. `jq` and two vendor CLIs all resolve
from the same `/root/.local/bin` on this host).

### Fixture pair

`$ROOT` is held constant at
`tests/fixtures/tool-check/check-one/neutral-root` (no `skills/foreman/`
present) for both arms, isolating the one property under test to `$HOME`:
`tests/fixtures/tool-check/check-one/home-missing` (no
`.claude/skills/foreman/SKILL.md`) vs
`tests/fixtures/tool-check/check-one/home-ok/.claude/skills/foreman/SKILL.md`
(present, fixture content).

### Known-bad arm

```
sed -n '/^check_one() {/,/^}/p' env/tool-check.sh > /tmp/fn.sh
ROOT="$PWD/tests/fixtures/tool-check/check-one/neutral-root" \
HOME="$PWD/tests/fixtures/tool-check/check-one/home-missing" \
bash -c 'source /tmp/fn.sh; check_one foreman_skill ""'
```
Verbatim output:
```
foreman_skill	missing	
```

### Known-good arm

Same command with `HOME=.../check-one/home-ok`.

Verbatim output:
```
foreman_skill	ok	skill linked under ~/.claude|agents|grok/skills/foreman
```

## Gate 6: `fm_tc_probe_mkdir_once`

### Predicate

Given an `mkdir` binary and a writable directory, determines whether that
binary's directory-creation is atomic by tracing it with `strace` against a
pre-existing lock target: an `EEXIST` bound to the probed path licenses
`atomic`; a `statx`-then-`mkdir` sequence with no bound `EEXIST` licenses
`non-atomic`; a binary whose trace shows no mkdir syscall activity at all
licenses nothing (`unknown`). It must refuse to license any verdict for a
binary that never attempts the syscall, and must license a real,
evidence-backed verdict for one that does.

### Fixture pair

Pointer files naming the binary to probe: `probe-mkdir-decoy.pointer` ->
`/bin/true` (a real binary present on effectively every POSIX host, which
exits 0 without ever touching the filesystem -- it cannot possibly attempt
`mkdir(2)`); `probe-mkdir-real.pointer` -> the bare command name `mkdir`,
resolved at demonstration time via `command -v` so the fixture stays
portable across hosts where `mkdir` lives at a different path.

### Known-bad arm

```
DECOY="$(cat tests/fixtures/tool-check/probe-mkdir-decoy.pointer)"
sed -n '/^fm_tc_fs_class() {/,/^}/p; /^fm_tc_version_line() {/,/^}/p; /^fm_tc_probe_mkdir_once() {/,/^}/p' env/tool-check.sh > /tmp/fn.sh
bash -c 'source /tmp/fn.sh; fm_tc_probe_mkdir_once "$1" /tmp' _ "$DECOY"
```
Verbatim output:
```
unknown	syscall	local	strace inconclusive for mkdir mechanism
```

### Known-good arm

Same command with `REAL="$(command -v "$(cat tests/fixtures/tool-check/probe-mkdir-real.pointer)")"` -> `/usr/bin/mkdir`.

Verbatim output:
```
non-atomic	syscall	local	userspace statx check; no mkdir(2) EEXIST (TOCTOU)
```

**Incidental finding, not fabricated for this control:** the real `mkdir` on
this host resolves to uutils (Rust coreutils) at
`/usr/lib/cargo/bin/coreutils/mkdir`, which does a userspace `statx` check
before `mkdir(2)` -- a real TOCTOU, matching the pre-existing
`[lock_atomicity.coreutils_hazard]` entry in `env/reference-manifest.toml`
("uutils performs a userspace statx check-then-act (TOCTOU)"). The good arm
did not need to produce `atomic` to discriminate -- it needed to produce a
*licensed* verdict backed by real syscall evidence instead of `unknown`, and
it did.

## Gate 7: `fm_tc_probe_flock_once`

### Predicate

Given a `flock` binary and a writable directory, spawns a holder that
acquires `flock(2) LOCK_EX|LOCK_NB`, then traces a second acquisition attempt
against the same file: an `EAGAIN`/`EWOULDBLOCK` bound to the loser plus
confirmation the holder actually proceeded licenses `atomic`. If the binary
path is not executable at all, the function short-circuits before spawning
anything.

### Fixture pair

`probe-flock-bad.pointer` -> `/nonexistent/flock-xyz` (guaranteed absent on
every host); `probe-flock-real.pointer` -> the bare command name `flock`,
resolved via `command -v` at demonstration time.

### Known-bad arm

```
BAD="$(cat tests/fixtures/tool-check/probe-flock-bad.pointer)"
sed -n '/^fm_tc_fs_class() {/,/^}/p; /^fm_tc_probe_flock_once() {/,/^}/p' env/tool-check.sh > /tmp/fn.sh
bash -c 'source /tmp/fn.sh; fm_tc_probe_flock_once "$1" /tmp' _ "$BAD"
```
Verbatim output:
```
unknown	flavour	local	flock binary missing
```

### Known-good arm

Same command with `REAL="$(command -v "$(cat tests/fixtures/tool-check/probe-flock-real.pointer)")"` -> `/usr/bin/flock`.

Verbatim output:
```
atomic	syscall	local	flock(2) LOCK_EX|LOCK_NB; kernel returned EWOULDBLOCK/EAGAIN to loser; holder proceeded
```

## Gate 8: `fm_tc_pinned_lookup`

### Predicate

Looks up a `(mechanism, sha256)` pair in the pinned-atomicity register of
`$FOREMAN_LOCK_MANIFEST` (default `env/reference-manifest.toml`); a match
requires the entry's `host_class` to equal the *current* host's
`fm_tc_host_class`, and its referenced `trace_artifact` to contain a
regex-matched syscall trace for the mechanism. On any mismatch it prints
nothing and returns 0 (a silent miss, not an error). It must reject an entry
whose `host_class` does not match this real host, and accept one that does.

### Fixture pair

`tests/fixtures/tool-check/pinned-lookup/manifest-bad.toml` and
`manifest-good.toml` differ in exactly one field, `host_class` (`bad` says
`msys2-git-bash`; `good` says `wsl-linux`, this host's real, independently
measured class from Gate 4). Both name the same `sha256` -- the **real**
digest of this host's actual `/usr/bin/flock`
(`59bc254984eefd83939a22a590d746942a4583a702b8fd2753bbb92d956e7d4c`, measured
via `sha256sum`, not invented) -- and the same
`trace-good.txt`, a synthetic-but-regex-satisfying flock trace (labeled as
such in its own header comment; it is fixture text, not a captured `strace`
run).

### Known-bad arm

```
FLOCK_SHA="$(sha256sum /usr/bin/flock | awk '{print $1}')"
sed -n '/^fm_tc_host_class() {/,/^}/p; /^fm_tc_pinned_lookup() {/,/^}/p' env/tool-check.sh > /tmp/fn.sh
ROOT="$PWD" FOREMAN_LOCK_MANIFEST="$PWD/tests/fixtures/tool-check/pinned-lookup/manifest-bad.toml" \
bash -c 'source /tmp/fn.sh; fm_tc_pinned_lookup flock "$1"' _ "$FLOCK_SHA"
```
Verbatim output: *(empty)* -- a silent miss, as the function contracts to
produce on mismatch. NEGATIVE, as required.

### Known-good arm

Same command with `FOREMAN_LOCK_MANIFEST=.../manifest-good.toml`.

Verbatim output:
```
atomic	local
```
POSITIVE, as required.

## Gate 9: `fm_tc_run_atomicity_probes`

### Predicate

Orchestrates Gates 6-8 across every distinct writable filesystem root,
picks the best-licensed verdict per mechanism, and sets
`LOCK_ATOMICITY_TRUSTED_ATOMIC=1` only when some mechanism earned `atomic`
on `syscall` or `pinned-mechanism` evidence. On `--profile durable`, if
nothing earns trusted-atomic, it appends
`lock_atomicity:no_trusted_atomic_mechanism` to `must_fail` and forces
`READY=0`. This function has no isolated CLI surface of its own (it mutates
global arrays read by the rest of the script), so it is driven through the
real `env/tool-check.sh --profile durable` end to end rather than extracted.

### Fixture pair

`tests/fixtures/tool-check/atomicity-strace-hidden.env`, sourced, rebuilds
`$PATH` as a private shadow directory populated by symlinking every
resolvable executable from the real `PATH` **except** `strace`, so every
other must/should tool (`git`, `jq`, `flock`, `mkdir`, `python3`, `bash`,
...) still resolves and only `strace`'s absence is the varying property; no
file outside `$TMPDIR` is touched and nothing is uninstalled.
`atomicity-strace-normal.env` is a no-op (`:`), leaving `PATH` -- and
`strace` -- exactly as the host provides it.

### Known-bad arm

```
source tests/fixtures/tool-check/atomicity-strace-hidden.env
bash env/tool-check.sh --profile durable
```
Verbatim relevant lines:
```
READY: no — fix must-tools before implementation work
MUST_FAIL: strace:missing lock_atomicity:no_trusted_atomic_mechanism
```
```
LOCK_ATOMICITY
MECH     VERDICT    EVIDENCE         FS_CLASSES   PATH
mkdir    non-atomic contention       local        /usr/lib/cargo/bin/coreutils/mkdir
flock    unknown    flavour          local        /usr/bin/flock
NOT-READY risk: no lock mechanism earned a trusted atomic verdict on this host
```
`MUST_FAIL` also carries `strace:missing`, which is `check_one`'s own,
separately-controlled row for the `strace` id, not this function's
predicate -- the token this control is about is
`lock_atomicity:no_trusted_atomic_mechanism`, and it is present.

### Known-good arm

```
source tests/fixtures/tool-check/atomicity-strace-normal.env
bash env/tool-check.sh --profile durable
```
Verbatim relevant lines:
```
READY: yes — profile 'durable' must-tools are OK
```
```
LOCK_ATOMICITY
MECH     VERDICT    EVIDENCE         FS_CLASSES   PATH
mkdir    non-atomic syscall          local        /usr/lib/cargo/bin/coreutils/mkdir
flock    atomic     syscall          local        /usr/bin/flock
INFO: mkdir non-atomic but flock present and trusted for probed filesystem class(es) — durable locks use flock
```
`lock_atomicity:no_trusted_atomic_mechanism` is absent, `READY` flips to
`yes`, and the informational line names flock as the trusted mechanism --
`LOCK_ATOMICITY_TRUSTED_ATOMIC` was set precisely because `flock` earned
`atomic` on `syscall` evidence in this arm and not in the bad arm.

## What this demonstrates

All nine probes were exercised in a single live session (verbatim output
above, not reconstructed). Each fixture pair varies exactly the one property
its gate reads -- an existence bit, an executable bit, a real mount class, an
override string, a HOME-relative file, a decoy vs. a syscall-performing
binary, a manifest field, or `strace`'s presence on `PATH` -- while every
other input is held constant across the two arms. Two properties of this
record are host-specific and are named as such rather than silently assumed
universal: Gate 3 requires a live WSL `/mnt/c` DrvFs mount, and Gate 8's
`sha256` is tied to this host's actual `/usr/bin/flock` binary.
