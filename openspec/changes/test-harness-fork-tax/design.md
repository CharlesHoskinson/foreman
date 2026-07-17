# Design — test-harness fork-tax reduction

Adversarial audit of record: `~/.foreman/runs/dl2d/perf/R2-testharness-audit.md`.
All edits are test-only and coverage-neutral. Per-edit exact changes, the
neutrality argument, safe edit order, and verification follow.

## Guiding invariant

Each surviving edit removes process spawns that compute a **host-constant** fact
(B#1), a **relocatable artifact** (B#2), an **already-absolute path** (B#3), or
that merely **shorten a bounded wait without changing its outcome** (A). None
changes which code paths a test exercises or what it asserts.

---

## Edit 1 — B#1: memoize the jq-CRLF probe (`tests/helpers.bash`)

### Current (lines 9-13)

```bash
if command -v jq >/dev/null 2>&1 && [[ "$(printf '{}' | jq -c . | od -An -tx1)" == *0d* ]]; then
  export _REAL_JQ="$(type -P jq)"
  jq() { "$_REAL_JQ" "$@" | tr -d '\r'; }
  export -f jq
fi
```

Fires on every test body and counting pass of all 11 helper-loading files
(~122 firings), each spawning `jq` + `od` + a `$( )` subshell.

### Replacement

```bash
if command -v jq >/dev/null 2>&1; then
  _f="${BATS_RUN_TMPDIR:-${BATS_TMPDIR:-/tmp}}/.foreman_jq_crlf"
  if [[ ! -f "$_f" ]]; then
    if [[ "$(printf '{}' | jq -c .)" == *$'\r'* ]]; then _v=1; else _v=0; fi
    printf '%s' "$_v" > "$_f.$$" && mv -f "$_f.$$" "$_f"   # atomic publish
  fi
  read -r _crlf < "$_f"
  if [[ "$_crlf" == 1 ]]; then
    export _REAL_JQ="$(type -P jq)"
    jq() { "$_REAL_JQ" "$@" | tr -d '\r'; }
    export -f jq
  fi
fi
```

Notes:
- Drops the `od` spawn permanently (CR detected with a bash glob on the
  command-substitution output; `$( )` strips only the trailing newline, leaving a
  CR to match). After the first firing per run, the probe spawns nothing — the
  decision is read with the `read` builtin.
- Keyed to `BATS_RUN_TMPDIR` (whole-run scope, fresh per `bats` invocation), so it
  is computed once and never leaks between runs.
- The `mv -f` atomic publish is belt-and-suspenders for a future `--jobs` gate;
  today `run.sh` is sequential so no race exists.

### Coverage-neutrality

The `command -v jq` guard is retained verbatim: jq-absent hosts install no wrapper
(identical to today); a broken jq yields no CR match → no wrapper (identical to
today's `od` form). On this CRLF host the wrapper is still installed (flag=1), so
every wrapped-jq test path stays exercised. The wrapper's runtime behavior is byte
-identical — only the probe's spawn count changes.

---

## Edit 2 — B#2 half-1 + B#3(line 32): rewrite `setup_tmp_repo` (`tests/helpers.bash`)

### Current (lines 19-34)

Per test: `mkdir`×2, `git`×5 (`init`, 2×`config`, `add`, `commit`), `cp`×2, and a
`cd&&pwd` subshell — ~10 spawns, incl. the two heaviest (`init`, `commit`).

### Replacement

```bash
setup_tmp_repo() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  mkdir -p "$FOREMAN_HOME"
  REPO="$BATS_TEST_TMPDIR/repo"
  local tpl="$BATS_FILE_TMPDIR/repo-tpl"
  if [[ ! -d "$tpl" ]]; then                 # built once per file
    mkdir -p "$tpl"
    git -C "$tpl" init -q -b main
    git -C "$tpl" config user.email test@example.com
    git -C "$tpl" config user.name "Foreman Test"
    echo "# fixture" > "$tpl/README.md"
    git -C "$tpl" -c core.hooksPath= add README.md
    git -C "$tpl" -c core.hooksPath= commit -qm init
    cp "$BATS_TEST_DIRNAME/../.markdownlint-cli2.jsonc" "$tpl/"
    cp "$BATS_TEST_DIRNAME/../.codespellrc" "$tpl/"
  fi
  cp -r "$tpl" "$REPO"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"   # B#3: no cd&&pwd
  export REPO SCRIPTS
}
```

The public API (`REPO`, `SCRIPTS`, `FOREMAN_HOME` exported) is unchanged, so the
five callers via `setup_tmp_repo` (docs-check, gate-eval, maintenance, wt-merge,
wt-new — plus in-body calls in watch) need **no edits**.

### Coverage-neutrality (isolation)

- `cp -r` copies file contents into new inodes (no hardlinks), so each `$REPO` is
  an independent, fully-mutable repo — every test commits into its own `.git`.
- A `git init -b main` repo is relocatable (relative internal paths); the copy is
  a valid repo with the baked-in identity/config and neutralized hooks.
- Only observable change: all tests now share one deterministic base-commit SHA
  (today each gets a distinct timestamped SHA). No test asserts base-SHA
  uniqueness or a specific base-SHA value across tests (tests are isolated), so
  this is invisible to assertions.
- `SCRIPTS` is only used to invoke scripts / source libs, both of which accept the
  `..`-containing path; no test asserts on its literal string, and `lane-run.sh`
  (and siblings) self-canonicalize their own `$BASH_SOURCE`. See Edit 4.

---

## Edit 3 — A: pin `LANE_KILL_GRACE=1` (`tests/lane-run.bats`)

### Test at ~line 356 (`sweep_failed`)

After `export LANE_PROC_ROOT="$proc_root"`, add:

```bash
  export LANE_KILL_GRACE=1
```

### Test at ~line 404 (`sweep_unavailable`)

After the `export LANE_PROC_ROOT="$BATS_TEST_TMPDIR/empty-proc"` / `mkdir -p`
block, add:

```bash
  export LANE_KILL_GRACE=1
```

### Coverage-neutrality (kill-bound contract preserved)

Both CMDs `trap "" TERM; … sleep 25`, i.e. ignore TERM and stay alive 25 s. Each
test waits for its `cmd-started` (and, for 356, `cmd-pid`) marker before sending
TERM, so `cmd_pid` is assigned and the CMD is alive. At grace=1, `kill_cmd_bounded`
runs exactly one `sleep 1`, re-checks `kill -0` (still alive) → escalates to KILL
→ `escalated=true`. The sweep outcome is fixed by the injected environment, not by
grace: 356's PATH-stubbed `taskkill` exits 1 → `sweep_failed`; 404's empty
`LANE_PROC_ROOT` → `sweep_unavailable`. The single folded alert fires identically
to grace=5, ~4 s faster. Neither test has a `<= N s` wall-clock assertion; each
only bounded-polls up to 30 s for exit, which grace=1 satisfies with margin.
Production default (5) is untouched. Test 186 (`=2`) is intentionally left as-is.

---

## Edit 4 — B#3: drop `$(cd&&pwd)` in the six non-watch setups

In each of `tests/lane-run.bats`, `tests/checkpoint.bats`, `tests/resume.bats`,
`tests/durable-preflight.bats`, `tests/eventlog.bats`, `tests/nats-bridge.bats`,
replace the `setup()` line:

```bash
SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
```

with:

```bash
SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
```

### Coverage-neutrality

`BATS_TEST_DIRNAME` is always absolute, so the value is already an absolute path;
the subshell only canonicalizes the embedded `..`, which the kernel resolves on
every `bash "$SCRIPTS/…"` / `source "$SCRIPTS/lib/…"`. No `.bats` asserts on the
literal `$SCRIPTS`. Scripts self-canonicalize their own dir
(`lane-run.sh:21: SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`) and
libs source relative to their own `$BASH_SOURCE`, so a `..`-containing invocation
path is normalized inside the callee regardless of the caller.

### `watch.bats` exclusion

`watch.bats` has the same subshell but is being edited concurrently by
WATCH_VTICK. To avoid a collision on its `setup()`, its one-liner is **out of this
change** — fold it into WATCH_VTICK or apply after that merges.
`durable-preflight.bats` does not `load helpers` but has its own subshell, so it is
edited directly here.

---

## Safe edit order

Regions are disjoint, so order is for risk-laddering (trivial/reversible first):

1. **Edit 4** (B#3 one-liners, 6 files) — mechanical, independently green.
2. **Edit 3** (A, lane-run 356/404) — two `export` lines.
3. **Edit 1** (B#1 probe) — `helpers.bash` top.
4. **Edit 2** (B#2-h1 + B#3-line32) — `setup_tmp_repo` rewrite.

In `helpers.bash`, Edit 1 (lines 9-13) and Edit 2 (`setup_tmp_repo` body) are
non-overlapping. In `lane-run.bats`, Edit 4 touches `setup()` (line 8) while Edit 3
touches `@test` bodies (356/404) — no textual conflict. All survivors fit one
worktree without self-conflict.

## Verification

```bash
# Coverage gate: full suite stays green (no filter → runs everything).
bash tests/run.sh

# Before/after wall-clock on the files the spawn cuts touch.
# Capture BEFORE on a clean checkout, then AFTER with the change applied:
time bash tests/run.sh tests/lane-run.bats     # A + B#3
time bash tests/run.sh tests/checkpoint.bats   # B#3 (+ B#1 amortized)
time bash tests/run.sh tests/docs-check.bats   # B#2 half-1 (setup_tmp_repo path)
time bash tests/run.sh tests/maintenance.bats  # B#2 half-1 (heaviest repo-build user)
```

Acceptance:
- `bash tests/run.sh` exits 0 with the same test count as before (nothing skipped
  or dropped).
- The four `time` deltas are non-positive (faster or equal); no assertion changes.
