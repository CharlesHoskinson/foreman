# Design — el_emit spawn reduction

Adversarial audit of record: `~/.foreman/runs/dl2d/perf/R2-el-emit-audit.md`
(source investigation: `~/.foreman/runs/dl2d/perf/C-hotpath-spawns.md`).

All edits are confined to **one function**, `el_emit`, in
`skills/foreman/scripts/lib/eventlog.sh`. Each removes process spawns that
compute a value a bash builtin produces identically. None changes the emitted
JSON, the seq numbering, the `.seq` tmp+rename CAS, or the `mkdir`/`rmdir` seq
mutex.

## Errexit context (why the F2 guard shape is load-bearing)

`el_emit` runs not only under bats but under `lane-run.sh` which sets
`set -euo pipefail` (`skills/foreman/scripts/lane-run.sh:19`) and calls
`el_emit`. Every edit below was validated under `set -euo pipefail`, because a
command that trips errexit inside the mutex critical section would abort before
the unconditional `rmdir "$lock"` (L64) and leak the lock.

## Current `el_emit` (relevant lines, eventlog.sh)

```sh
el_emit() {
  local run="$1" type="$2" lane="$3" payload="$4" commit="${5:-}"
  local rd; rd="$(run_dir "$run")"; mkdir -p "$rd"                         # L21
  local log="$rd/events.jsonl" seqf="$rd/.seq" lock="$rd/.seq.lock"        # L22
  # … mkdir "$lock" mutex loop (L30-34) — UNCHANGED …
  local seq ts raw line rc=0                                               # L40
  seq=$(( $(cat "$seqf" 2>/dev/null || echo 0) + 1 ))                      # L41
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"                                      # L42  (F5: unchanged)
  raw=$(jq -cn --argjson seq "$seq" … ) || rc=1                           # L46-49 (UNCHANGED)
  line="$(printf '%s' "$raw" | tr -d '\r')"                               # L50
  if (( rc != 0 )) || [[ -z "$line" ]]; then … ; fi                       # L51-63 (UNCHANGED)
  rmdir "$lock" 2>/dev/null                                               # L64  (UNCHANGED)
  (( rc == 0 )) && echo "$seq"                                           # L65
  return "$rc"
}
```

## The four edits

### F1 — CR strip (L50)

```sh
# before
line="$(printf '%s' "$raw" | tr -d '\r')"
# after
line="${raw//$'\r'/}"
```

Removes a `tr` exec + a pipe subshell + a `printf` builtin. `raw` is always a
single physical line (`jq -c`, then `$( )` strips the trailing newline). Byte
comparison of the two expressions over 9 adversarial inputs (trailing/leading/
mid-string/multiple CR, embedded newline+CR, empty, `-n`-leading, literal
backslash-r) shows **all identical** — both delete only `0x0D`, neither touches
`\n`. The `[[ -z "$line" ]]` empty-guard downstream sees the same value.

### F2 — seq read (L40–41)

```sh
# before
local seq ts raw line rc=0
seq=$(( $(cat "$seqf" 2>/dev/null || echo 0) + 1 ))
# after
local seq ts raw line rc=0 prev=0
[[ -f "$seqf" ]] && prev="$(<"$seqf")"
seq=$(( ${prev:-0} + 1 ))
```

Removes a `cat` exec + a `$( )` fork (bash reads `$(<file)` in-process). Because
it is inside the mutex, it also shortens lock-hold time (less inter-lane
contention).

Guard requirements (mandatory, from the audit):

- `prev` MUST be pre-initialised to `0` on the `local` line so `set -u` and the
  missing-file path are both safe.
- The guard MUST be `[[ -f "$seqf" ]] && prev="$(<"$seqf")"` (existence). Do NOT
  write bare `prev="$(<"$seqf")"` — that trips errexit on a missing file. Do NOT
  fold error-swallowing into the read (`$(<f 2>/dev/null || echo 0)`): extra
  tokens defeat bash's no-fork `$(<file)` special case and negate the win.
- Validated under `set -euo pipefail`: missing → seq 1; empty → seq 1; `"5\n"` →
  6; `"7\n"` → 8; directory-as-seqf → seq 1; all exit 0, lock-release reached.

Documented non-issue: a *regular file that exists but fails to read* would, under
errexit, abort mid-critical-section and leak the lock (original swallowed it via
`|| echo 0`). This is unreachable on the target platform — `chmod 000` does not
make a regular file unreadable on the cygwin/Windows-ACL fs, and `.seq` is a
harness-owned 0644 file `el_emit` created itself. Out of scope; noted here so a
future reviewer does not re-derive it. The seq **reserve** (L53 `mv`) is
untouched → CAS/monotonicity unchanged.

### F3 — mkdir guard (part of L21)

```sh
# before
mkdir -p "$rd"
# after
[[ -d "$rd" ]] || mkdir -p "$rd"
```

Skips the `mkdir` spawn on the common (dir-exists) path. Preserves
self-creation: `eventlog.bats` calls `el_emit` on a fresh run with **no**
`el_init` (L12, L77), so the create path must remain — the guard runs `mkdir -p`
when the dir is absent, exactly as today. Concurrent first-create is safe:
`mkdir -p` is idempotent and does not error if the dir appears between check and
call. The guard stays **before** the `mkdir "$lock"` loop, so `$rd` exists
before the lock dir is created (unchanged ordering).

### F4 — inline run_dir (rest of L21)

```sh
# before
local rd; rd="$(run_dir "$run")"; mkdir -p "$rd"
# after
local rd="$FOREMAN_HOME/runs/$run"; [[ -d "$rd" ]] || mkdir -p "$rd"
```

`run_dir()` is `echo "$FOREMAN_HOME/runs/$1"` (common.sh:37); the inline string
is identical and strictly safer than `echo` (no `-n`/backslash interpretation).
Precedent: `watch.sh:184` inlines the same path. The `run_dir` helper is **not**
edited (still used by `el_init`, `el_read`, `el_cursor_*`, and every test that
computes paths via `$(run_dir …)`). Under `set -u`, unset `FOREMAN_HOME` errors
identically in both forms.

## Combined result (the full new L20–22 region + L40–41 + L50)

```sh
el_emit() {
  local run="$1" type="$2" lane="$3" payload="$4" commit="${5:-}"
  local rd="$FOREMAN_HOME/runs/$run"          # F4
  [[ -d "$rd" ]] || mkdir -p "$rd"            # F3
  local log="$rd/events.jsonl" seqf="$rd/.seq" lock="$rd/.seq.lock"
  # … mutex loop unchanged …
  local seq ts raw line rc=0 prev=0
  [[ -f "$seqf" ]] && prev="$(<"$seqf")"      # F2
  seq=$(( ${prev:-0} + 1 ))                   # F2
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"         # F5 deferred: unchanged
  raw=$(jq -cn … ) || rc=1                     # unchanged
  line="${raw//$'\r'/}"                        # F1
  # … rc/empty guard, seq reserve mv, append, rmdir, echo $seq — all unchanged …
}
```

## Preserved output contract (the hard requirement)

- Field set and values, `commit` omit-when-empty, single-line, LF-terminated,
  no-CR — identical (F1 byte-verified; F2/F3/F4 do not touch `jq` or its args).
- `seq` starts at 1 on missing/empty `.seq`, is monotonic, unique under
  concurrency, gap-not-dup on failure — identical (reserve/mutex untouched).
- Mutex acquire/release on every path — identical.

## Safe edit order (regions disjoint; risk-laddered)

1. **F1** (L50, one line) — provably identical, independently correct.
2. **F4** (L21 assignment) — pure string, helper untouched.
3. **F3** (L21 guard) — self-create preserved.
4. **F2** (L40–41) — the only errexit-sensitive edit; apply last so it can be
   reverted alone if a suite regresses.

All four are within one function and do not textually overlap.

## Verification

The existing suites assert the emitted JSON, so a green run is the behaviour-
preservation proof. Run in an isolated worktree (do NOT run on a host with a
live release gate — concurrent bats runs corrupt wall-clock tests):

```bash
bash tests/run.sh tests/eventlog.bats     # field-exactness, no-CR, seq mono,
                                          # concurrent 1..20, reserve/append/lock guards
bash tests/run.sh tests/lane-run.bats     # el_emit driven end-to-end via lane-run
bash tests/run.sh                         # full suite, no regressions
```

Byte-for-byte check (before/after the change, same inputs): capture
`events.jsonl` from `el_emit run1 checkpoint lane-b '{"x":true}' abc123` on a
clean checkout and on the changed tree and confirm `cmp` reports no difference
(modulo the `ts` timestamp, which F5 leaves unchanged in format).

Acceptance:

- `eventlog.bats` and `lane-run.bats` pass with the same test count.
- Full `tests/run.sh` exits 0.
- Emitted JSON is byte-identical (ignoring the wall-clock `ts` value) to the
  pre-change output for equal inputs.
