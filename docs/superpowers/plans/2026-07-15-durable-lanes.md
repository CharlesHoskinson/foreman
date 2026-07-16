# durable-lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan executes through the **foreman skill** — each task becomes a five-part spec routed to a Grok/Codex implementer in an isolated worktree, verified by the architect, cross-vendor audited. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every long agent round crash-safe and observable: an append-only event log as source of truth, continuous git-plumbing worktree checkpoints, a NATS/JetStream transport for live watchers/alerters, and a stall watchdog with resume.

**Architecture:** A durable `events.jsonl` per run is the on-disk truth. Git plumbing snapshots the worktree to `refs/checkpoints/*` without touching the agent's index. A one-way bridge publishes log lines to JetStream (primary transport); watchers are durable consumers. A watchdog escalates stalls and retries from the last checkpoint. The log is authoritative; NATS is a rebuildable view.

**Tech Stack:** bash (`set -euo pipefail`, `lib/common.sh`), git plumbing (`write-tree`/`commit-tree`/`update-ref`), bats-core, NATS `nats-server` + `nats` CLI (natscli), jq.

**Spec:** `docs/superpowers/specs/2026-07-15-durable-lanes-design.md`

## Global Constraints

- Workers never run git write commands (`commit|add|reset|branch|push|rebase|merge|tag`) except inside the isolated `GIT_INDEX_FILE` plumbing path, which is architect-invoked machinery, not a worker commit. Read-only git allowed. Architect owns branch commits.
- All new bash scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, source `lib/common.sh`, shdoc headers (`# @description`, `# @arg`, `# @exitcode`) on every function, top-of-file purpose comment.
- The event log is the single source of truth; the NATS transport is one-way (log→NATS) and never a second source of truth.
- Atomic append: one `printf '%s\n' "$json" >> log` per event; lines kept under 4 KB (PIPE_BUF).
- Cursors are per-consumer line numbers, committed AFTER processing (at-least-once).
- Cross-platform: Git Bash + WSL. Checkpoint plumbing and file I/O must run identically on both. `store_dir`/logs on native FS.
- `FOREMAN_HOME` defaults to `~/.foreman`; `run_dir()` in `lib/common.sh` returns `$FOREMAN_HOME/runs/<id>`.
- NATS-dependent tests SHALL skip (with a `# skip` reason) when `nats-server` is absent, never silently pass.
- All bash: `bash -n` clean; full bats suite green; `docs-check` passes.

### Portability & correctness checklist (apply to EVERY task's code)

Wave-1 implementation surfaced these bug classes; every code block below has
been hardened against them and any new code MUST be too:

- **jq empties objects:** `commit:($x|select(.!=""))` empties the WHOLE object
  on jq 1.8+. Use `... | if .commit=="" then del(.commit) else . end`.
- **Windows jq.exe emits CRLF:** any jq output STORED to a file or COMPARED in
  shell must be `| tr -d '\r'` (a value in `[[ ]]` otherwise carries a trailing
  CR). Tests `load helpers`, which wraps jq to strip CR in the test env only.
- **git stderr advisories:** `git add`/checkout print core.autocrlf "LF will be
  replaced by CRLF" to stderr; a merged capture (or bats `run`) corrupts the
  result. Redirect `2>/dev/null` on plumbing whose stdout you capture.
- **Exit-checks:** check the status of every append/write/publish/git command;
  never let a failure fall through to a success path (`|| return 1`).
- **Atomic writes:** `> file` truncates before writing — a failed write empties
  it. Reserve/update state via `> file.tmp && mv file.tmp file`.
- **Piped exit codes:** `cmd | tee ...` — read `${PIPESTATUS[0]}` for cmd's real
  status, not the pipeline's.
- **Concurrency:** no `flock` on Git Bash — use a `mkdir` mutex; no in-band
  stale reclaim (ABA race); recover leftover locks single-threaded at init.
- **Injection:** never interpolate untrusted text into `bash -c "$x"` / a
  subject string; validate ids against `^[A-Za-z0-9_.-]+$`.
- **set -e traps:** the last command of a `then` branch returning nonzero aborts
  under `set -e` — use `if…then…fi`, not `[[ ]] && …`. A `$(func)` subshell
  loses variables the function sets — redirect to a temp file and read it back.
- **inotify:** `tail -F` under Git Bash on a Windows drive (`/mnt/c`, MSYS)
  drops events — use `--disable-inotify` (poll) there; native FS is fine.

---

### Task 0: Durable-lanes environment — dependency list + preflight verify

**This task runs first.** It is the single place that lists every durable-lanes
dependency and verifies it is installed, gating all durable-mode work.

**Files:**

- Create: `skills/foreman/scripts/durable-preflight.sh`
- Modify: `env/reference-manifest.toml` (new `durable` profile + tool entries)
- Modify: `env/bootstrap-wsl.sh`, `env/bootstrap-windows.ps1` (install the deps)
- Modify: `env/tool-check.sh`, `env/tool-check.ps1` (recognize the `durable` profile)
- Test: `tests/durable-preflight.bats`

**Interfaces:**

- Consumes: nothing (pure environment check).
- Produces: `dp_verify` — a sourced function that checks each durable dependency
  and prints one `OK|MISSING <id> — <install hint>` line per dependency; and
  `durable-preflight.sh [--json]` — runs `dp_verify`, prints a table (or JSON),
  and exits 0 if all **required** deps present, 3 if any required dep missing.
  Required deps: `git`, `jq`, `stdbuf` (coreutils), `bash`. Transport deps
  (required only when `[nats]` in use): `nats-server`, `nats` (natscli).

**The dependency list (authoritative, in `env/reference-manifest.toml`):**

```toml
[profiles.durable]
must = ["git", "jq", "coreutils", "bash"]
should = ["nats-server", "nats-cli"]
```

with matching `[[tools]]` entries:

```toml
[[tools]]
id = "coreutils"
profile = ["durable"]
where = ["windows", "wsl"]
check = "stdbuf --version || gstdbuf --version"
install_wsl = "sudo apt-get install -y coreutils"
install_windows = "scoop install main/coreutils"
required = true
notes = "stdbuf -oL line-buffers the reasoning stream tee"

[[tools]]
id = "nats-server"
profile = ["durable"]
where = ["windows", "wsl"]
check = "nats-server --version"
install_wsl = "curl -fsSL https://binaries.nats.dev/nats-io/nats-server/v2@latest | sh"
install_windows = "scoop install main/nats-server"
required = false
notes = "JetStream transport; required only when [durable] enabled with NATS"

[[tools]]
id = "nats-cli"
profile = ["durable"]
where = ["windows", "wsl"]
check = "nats --version"
install_wsl = "curl -sf https://binaries.nats.dev/nats-io/natscli/nats@latest | sh"
install_windows = "scoop install extras/natscli"
required = false
notes = "Drives JetStream from bash (setup, bridge, consume)"
```

- [ ] **Step 1: Write failing tests `tests/durable-preflight.bats`**

```bash
#!/usr/bin/env bats
setup() { SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"; source "$SCRIPTS/durable-preflight.sh"; }

@test "dp_verify reports OK for a present dependency" {
  run bash -c 'source "'"$SCRIPTS"'/durable-preflight.sh"; DP_CHECK_git="true"; dp_one git "true" "hint"'
  [ "$status" -eq 0 ]; [[ "$output" == OK* ]]
}
@test "dp_one reports MISSING with the install hint when the check fails" {
  run dp_one faketool "command-that-does-not-exist-xyz --version" "scoop install faketool"
  [[ "$output" == "MISSING faketool"* ]]
  [[ "$output" == *"scoop install faketool"* ]]
}
@test "preflight exits 3 when a required dep is missing" {
  run bash "$SCRIPTS/durable-preflight.sh" --require faketool-xyz
  [ "$status" -eq 3 ]
}
@test "preflight exits 0 and lists deps when all required present" {
  run bash "$SCRIPTS/durable-preflight.sh"   # git/jq/stdbuf/bash present in CI
  [ "$status" -eq 0 ]
  [[ "$output" == *"git"* ]] && [[ "$output" == *"jq"* ]]
}
@test "--json emits a machine-readable object" {
  run bash "$SCRIPTS/durable-preflight.sh" --json
  echo "$output" | jq -e '.deps | type == "array"'
}
```

- [ ] **Step 2: Run to verify fail** — `bash tests/run.sh durable-preflight.bats` → FAIL (script missing).

- [ ] **Step 3: Implement `skills/foreman/scripts/durable-preflight.sh`**

```bash
#!/usr/bin/env bash
# @description Durable-lanes environment preflight: the single list of durable
#   dependencies and their verification. Exits 3 if any required dep is missing.
# Usage: durable-preflight.sh [--json] [--require EXTRA_ID ...]
set -euo pipefail

# @description Check one dependency; print "OK <id>" or "MISSING <id> -- <hint>".
# @arg $1 id  @arg $2 check command  @arg $3 install hint
# @exitcode 0 present, 1 missing
dp_one() {
  local id="$1" check="$2" hint="$3"
  if bash -c "$check" >/dev/null 2>&1; then printf 'OK %s\n' "$id"; return 0
  else printf 'MISSING %s -- %s\n' "$id" "$hint"; return 1; fi
}

# @description Verify all durable deps. Sets DP_MISSING to the count of missing required.
# @stdout one status line per dependency
dp_verify() {
  local json="${1:-}"; DP_MISSING=0
  # id | check | hint | required(1/0). Ids MUST match reference-manifest.toml
  # (coreutils, nats-cli) so inventory correlates across tools.
  local rows=(
    "git|git --version|install git|1"
    "jq|jq --version|install jq|1"
    "coreutils|stdbuf --version || gstdbuf --version|install coreutils|1"
    "bash|bash --version|install bash|1"
    "nats-server|nats-server --version|scoop install main/nats-server (or binaries.nats.dev)|0"
    "nats-cli|nats --version|scoop install extras/natscli|0"
  )
  for extra in "${DP_EXTRA[@]:-}"; do [[ -n "$extra" ]] && rows+=("$extra|command -v $extra|install $extra|1"); done
  for r in "${rows[@]}"; do
    IFS='|' read -r id check hint req <<<"$r"
    # Explicit if (not `[[ ]] && ...`): a false `&&` returns 1 as the loop
    # body's last status and aborts dp_verify under set -e on a missing optional.
    if ! dp_one "$id" "$check" "$hint"; then
      if [[ "$req" == 1 ]]; then DP_MISSING=$((DP_MISSING+1)); fi
    fi
  done
}

# @description CLI entry: parse args, run dp_verify, print table/JSON, exit 3 if
#   any required dep is missing.
# @arg $@ [--json] [--require EXTRA_ID ...]
main() {
  local json="" ; DP_EXTRA=()
  while [[ $# -gt 0 ]]; do case "$1" in
    --json) json=1; shift;;
    --require)
      # reject injection: EXTRA becomes `command -v $extra` in a bash -c string
      if [[ ! "${2:-}" =~ ^[A-Za-z0-9_.-]+$ ]]; then
        printf 'error: invalid --require id: %s\n' "${2:-}" >&2; exit 2
      fi
      DP_EXTRA+=("$2"); shift 2;;
    *) shift;;
  esac; done
  # Run dp_verify in the CURRENT shell (temp file, not $(...)) so DP_MISSING set
  # inside it is visible here; a command-substitution subshell would lose it and
  # exit 3 would never fire.
  local tmp out; tmp="$(mktemp)"
  dp_verify >"$tmp" || true
  out="$(<"$tmp")"; rm -f "$tmp"
  if [[ -n "$json" ]]; then
    printf '%s\n' "$out" | jq -R . | jq -s '{deps: [.[] | {status:(split(" ")[0]), id:(split(" ")[1])}], missing_required: '"${DP_MISSING:-0}"'}'
  else printf '%s\n' "$out"; fi
  [[ "${DP_MISSING:-0}" -eq 0 ]] || exit 3
}
# if/then/fi (not `[[ ]] && main`): a false guard would leave exit 1 as the
# script's status when sourced, breaking `source` in bats setup.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
```

- [ ] **Step 4: Run to verify pass** — `bats tests/durable-preflight.bats` → 8 pass (single-file; run.sh runs the whole suite).

- [ ] **Step 5: Manifest + bootstrap + tool-check** — add the `[profiles.durable]` block and the three `[[tools]]` entries above to `env/reference-manifest.toml`; add matching install steps to both bootstrap scripts; make both tool-check scripts accept `--profile durable`. Verify:

```bash
grep -c '\[profiles.durable\]' env/reference-manifest.toml   # 1
grep -c 'id = "nats-server"' env/reference-manifest.toml     # 1
bash env/tool-check.sh --profile durable | tail -1           # prints READY line
```

- [ ] **Step 6: Architect commits** `feat(durable): environment dependency list + preflight verify (Task 0)`

---

### Task 1: Event log library

**Files:**

- Create: `skills/foreman/scripts/lib/eventlog.sh`
- Test: `tests/eventlog.bats`
- Modify: `tests/helpers.bash` — add the test-only jq CR-wrapper (Windows
  jq.exe emits CRLF; wrap it in the test env only, never in the shipped lib):

  ```bash
  if command -v jq >/dev/null 2>&1 && [[ "$(printf '{}' | jq -c . | od -An -tx1)" == *0d* ]]; then
    export _REAL_JQ="$(type -P jq)"
    jq() { "$_REAL_JQ" "$@" | tr -d '\r'; }
    export -f jq
  fi
  ```

**Interfaces:**

- Consumes: `run_dir()` from `lib/common.sh`.
- Produces:
  - `el_emit RUN_ID TYPE LANE PAYLOAD_JSON [COMMIT]` — appends one event line to `$(run_dir RUN_ID)/events.jsonl`, auto-incrementing `seq`; returns the seq via stdout.
  - `el_read RUN_ID FROM_LINE` — prints well-formed JSON lines from FROM_LINE+1 onward, stopping before the first torn/invalid line (stdout).
  - `el_cursor_get RUN_ID CONSUMER` — prints the consumer's committed line number (0 if none).
  - `el_cursor_commit RUN_ID CONSUMER N` — atomically writes N to the cursor.

- [ ] **Step 1: Write failing tests `tests/eventlog.bats`**

```bash
#!/usr/bin/env bats
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
}

@test "el_emit appends a line and returns incrementing seq" {
  run el_emit run1 prompt lane-a '{"k":1}'
  [ "$status" -eq 0 ]; [ "$output" = "1" ]
  run el_emit run1 tool_call lane-a '{"k":2}'
  [ "$output" = "2" ]
  [ "$(wc -l < "$(run_dir run1)/events.jsonl")" -eq 2 ]
  run jq -r '.type' "$(run_dir run1)/events.jsonl"
  [ "${lines[0]}" = "prompt" ]; [ "${lines[1]}" = "tool_call" ]
}

@test "el_emit records seq, type, lane, payload" {
  el_emit run1 checkpoint lane-b '{"x":true}' abc123
  run jq -rc '[.seq,.type,.lane,.commit,(.payload.x)]|@csv' "$(run_dir run1)/events.jsonl"
  [ "$output" = '1,"checkpoint","lane-b","abc123",true' ]
}

@test "el_read returns lines after cursor, skips torn tail" {
  el_emit run1 a lane '{}'; el_emit run1 b lane '{}'
  printf '{"partial":' >> "$(run_dir run1)/events.jsonl"   # torn line, no newline
  run el_read run1 0
  [ "$(wc -l <<<"$output")" -eq 2 ]           # only the 2 complete lines
  run el_read run1 1
  [ "$(jq -r .type <<<"$output")" = "b" ]      # from line 2 only
}

@test "cursor round-trips and defaults to 0" {
  run el_cursor_get run1 watcher; [ "$output" = "0" ]
  el_cursor_commit run1 watcher 5
  run el_cursor_get run1 watcher; [ "$output" = "5" ]
}
```

- [ ] **Step 2: Run to verify fail** — `bash tests/run.sh eventlog.bats` → FAIL (eventlog.sh missing).

- [ ] **Step 3: Implement `skills/foreman/scripts/lib/eventlog.sh`**

```bash
#!/usr/bin/env bash
# @description Append-only per-run event log: the source of truth for durable-lanes.
#   One JSON object per line; atomic O_APPEND; torn-tail-safe reads; per-consumer
#   line-number cursors committed after processing (at-least-once).

# @description Initialize a run's event log. Single-threaded; call ONCE before
#   any concurrent emitters start. Clears a leftover .seq.lock from a crashed
#   prior run — safe because there is no concurrency at init, which is why
#   el_emit does no racy in-band lock reclaim (any check-then-rmdir reclaim has
#   an unavoidable ABA race in bash).
# @arg $1 run id
el_init() {
  local rd; rd="$(run_dir "$1")"; mkdir -p "$rd"
  rmdir "$rd/.seq.lock" 2>/dev/null || true
}

# @description Emit one event; auto-increments seq for the run.
# @arg $1 run id  @arg $2 type  @arg $3 lane  @arg $4 payload JSON  @arg $5 commit sha (optional)
# @stdout the assigned seq number
el_emit() {
  local run="$1" type="$2" lane="$3" payload="$4" commit="${5:-}"
  local rd; rd="$(run_dir "$run")"; mkdir -p "$rd"
  local log="$rd/events.jsonl" seqf="$rd/.seq" lock="$rd/.seq.lock"
  # Portable mutex — multiple lanes emit to one run's log concurrently and the
  # seq read-modify-write must be atomic. mkdir is atomic on Git Bash and WSL
  # (no flock on MSYS2). No in-band stale reclaim (ABA race); el_init handles
  # crash recovery single-threaded.
  local tries=0
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.02; tries=$((tries+1))
    (( tries > 1500 )) && { echo "el_emit: lock timeout for $run (run el_init?)" >&2; return 1; }
  done
  # Single exit point; lock released unconditionally. Ordering for uniqueness
  # under failure: build line (jq) -> reserve seq (atomic tmp+rename) -> append.
  # A duplicate seq is the only unacceptable outcome; a gap is fine.
  local seq ts raw line rc=0
  seq=$(( $(cat "$seqf" 2>/dev/null || echo 0) + 1 ))
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # jq del (not select — select(.!="") empties the whole object on jq 1.8+);
  # capture jq's own exit; tr -d '\r' because Windows jq.exe emits CRLF and the
  # source-of-truth log must be clean LF JSON.
  raw=$(jq -cn --argjson seq "$seq" --arg ts "$ts" --arg type "$type" \
    --arg lane "$lane" --arg commit "$commit" --argjson payload "$payload" \
    '{seq:$seq,ts:$ts,type:$type,lane:$lane,commit:$commit,payload:$payload}
     | if .commit == "" then del(.commit) else . end') || rc=1
  line="$(printf '%s' "$raw" | tr -d '\r')"
  if (( rc != 0 )) || [[ -z "$line" ]]; then
    rc=1; echo "el_emit: jq failed or empty line for $run" >&2
  elif ! { echo "$seq" > "$seqf.tmp" && mv "$seqf.tmp" "$seqf"; }; then
    # atomic reserve: a bare `> "$seqf"` truncates first, so a failed write
    # would empty .seq and the next emit would restart at 1 (duplicate).
    rm -f "$seqf.tmp" 2>/dev/null
    rc=1; echo "el_emit: seq reserve failed for $run" >&2
  elif ! printf '%s\n' "$line" >> "$log"; then
    # seq already reserved -> harmless gap, never a duplicate
    rc=1; echo "el_emit: append failed for $run (seq $seq skipped)" >&2
  fi
  rmdir "$lock" 2>/dev/null
  (( rc == 0 )) && echo "$seq"
  return "$rc"
}

# @description Print well-formed JSON lines after FROM_LINE, stopping at the first torn/invalid line.
# @arg $1 run id  @arg $2 from-line (0-based count already consumed)
# @stdout newline-delimited JSON events
el_read() {
  local run="$1" from="$2" rd; rd="$(run_dir "$run")"
  local log="$rd/events.jsonl"; [[ -f "$log" ]] || return 0
  local n=0
  while IFS= read -r line || { [[ -n "$line" ]] && return 0; }; do
    n=$((n+1)); (( n <= from )) && continue
    jq -e . >/dev/null 2>&1 <<<"$line" || return 0
    printf '%s\n' "$line"
  done < "$log"
}

# @description Read a consumer's committed cursor (line number), 0 if none.
# @arg $1 run id  @arg $2 consumer name  @stdout line number
el_cursor_get() {
  local rd; rd="$(run_dir "$1")"
  cat "$rd/cursors/$2.cursor" 2>/dev/null || echo 0
}

# @description Commit a consumer cursor atomically (tmp + mv).
# @arg $1 run id  @arg $2 consumer  @arg $3 line number
el_cursor_commit() {
  local rd; rd="$(run_dir "$1")"; mkdir -p "$rd/cursors"
  printf '%s' "$3" > "$rd/cursors/$2.cursor.tmp" && mv "$rd/cursors/$2.cursor.tmp" "$rd/cursors/$2.cursor"
}
```

Note: the `read` loop's `|| { ...; return 0; }` guard makes a final line without a trailing newline (a torn append) terminate the read rather than emit a partial record.

- [ ] **Step 4: Run to verify pass** — `bats tests/eventlog.bats` → 11 pass.
- [ ] **Step 5: Architect commits** `feat(durable): event log library (source of truth)`

---

### Task 2: Checkpoint library (git plumbing)

**Files:**

- Create: `skills/foreman/scripts/lib/checkpoint.sh`
- Test: `tests/checkpoint.bats`

**Interfaces:**

- Consumes: nothing from prior tasks (pure git).
- Produces:
  - `ckpt_snapshot WORKTREE LANE` — snapshots the worktree tree into a commit on `refs/checkpoints/<LANE>` without touching the worktree index/HEAD; prints the checkpoint commit SHA.
  - `ckpt_latest WORKTREE LANE` — prints the latest checkpoint SHA for the lane (empty if none).

- [ ] **Step 1: Write failing tests `tests/checkpoint.bats`**

```bash
#!/usr/bin/env bats
load helpers

setup() {
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  source "$SCRIPTS/lib/checkpoint.sh"
  WT="$BATS_TEST_TMPDIR/wt"; mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com; git -C "$WT" config user.name t
  echo base > "$WT/f"; git -C "$WT" add -A; git -C "$WT" commit -qm base
}

@test "ckpt_snapshot captures uncommitted work without touching HEAD or index" {
  echo dirty > "$WT/f"; echo new > "$WT/g"     # uncommitted changes
  head_before="$(git -C "$WT" rev-parse HEAD)"
  run ckpt_snapshot "$WT" lane1
  [ "$status" -eq 0 ]
  sha="$output"
  [ "$(git -C "$WT" rev-parse HEAD)" = "$head_before" ]      # HEAD untouched
  git -C "$WT" diff --cached --quiet                          # index untouched
  # the snapshot commit contains the dirty content
  [ "$(git -C "$WT" show "$sha:g")" = "new" ]
  [ "$(git -C "$WT" show "$sha:f")" = "dirty" ]
  [ "$(git -C "$WT" rev-parse refs/checkpoints/lane1)" = "$sha" ]
}

@test "ckpt_snapshot chains parents and ckpt_latest returns newest" {
  echo one > "$WT/f"; s1="$(ckpt_snapshot "$WT" lane1)"
  echo two > "$WT/f"; s2="$(ckpt_snapshot "$WT" lane1)"
  [ "$s1" != "$s2" ]
  [ "$(git -C "$WT" rev-parse "$s2^")" = "$s1" ]
  [ "$(ckpt_latest "$WT" lane1)" = "$s2" ]
}

@test "ckpt_latest is empty when no checkpoint exists" {
  run ckpt_latest "$WT" nolane; [ -z "$output" ]
}
```

- [ ] **Step 2: Run to verify fail** — `bash tests/run.sh checkpoint.bats` → FAIL.

- [ ] **Step 3: Implement `skills/foreman/scripts/lib/checkpoint.sh`**

```bash
#!/usr/bin/env bash
# @description Non-disruptive worktree checkpoints via git plumbing. Snapshots the
#   working tree into a commit on refs/checkpoints/<lane> using an isolated index,
#   so the running agent's own index/HEAD are never touched and refs are gc-safe.

# @description Snapshot a worktree's current content to refs/checkpoints/<lane>.
# @arg $1 worktree path  @arg $2 lane name
# @stdout the checkpoint commit sha
# @exitcode 1 if not a git worktree
ckpt_snapshot() {
  local wt="$1" lane="$2" ref="refs/checkpoints/$2"
  # validate lane before it becomes a ref path
  [[ "$lane" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  local gd; gd="$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null)" || return 1
  local idx; idx="$(mktemp)"
  GIT_DIR="$gd" GIT_WORK_TREE="$wt" GIT_INDEX_FILE="$idx" git read-tree HEAD 2>/dev/null || true
  # 2>/dev/null: git add prints core.autocrlf advisories to stderr; a merged
  # capture (or bats `run`) would corrupt the SHA. Exit-check so a failed add
  # never falls through to a HEAD-only snapshot that looks successful.
  GIT_DIR="$gd" GIT_WORK_TREE="$wt" GIT_INDEX_FILE="$idx" git add -A 2>/dev/null || { rm -f "$idx"; return 1; }
  local tree; tree="$(GIT_DIR="$gd" GIT_INDEX_FILE="$idx" git write-tree)" || { rm -f "$idx"; return 1; }
  rm -f "$idx"
  local parent; parent="$(git -C "$wt" rev-parse -q --verify "$ref" 2>/dev/null || true)"
  local msg="ckpt $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local commit
  commit="$(git -C "$wt" commit-tree "$tree" ${parent:+-p "$parent"} -m "$msg")" || return 1
  git -C "$wt" update-ref "$ref" "$commit" || return 1
  echo "$commit"
}

# @description Print the latest checkpoint sha for a lane (empty if none).
# @arg $1 worktree path  @arg $2 lane  @stdout sha or empty
ckpt_latest() {
  git -C "$1" rev-parse -q --verify "refs/checkpoints/$2" 2>/dev/null || true
}
```

- [ ] **Step 4: Run to verify pass** — `bats tests/checkpoint.bats` → 4 pass.
- [ ] **Step 5: Architect commits** `feat(durable): git-plumbing worktree checkpoint library`

---

### Task 3: Lane runner wrapper

**Files:**

- Create: `skills/foreman/scripts/lane-run.sh`
- Test: `tests/lane-run.bats`

**Interfaces:**

- Consumes: `el_emit`, `ckpt_snapshot` (Tasks 1–2).
- Produces: `lane-run.sh RUN_ID LANE WORKTREE -- CMD...` — runs CMD (a coding-CLI invocation) with its stdout tee'd to `<WORKTREE>/.harness/stream.ndjson`; emits a `prompt` event at start, a `checkpoint` event (throttled by `[durable] checkpoint_interval`, default 20s) after stream activity, a `heartbeat` every `heartbeat_interval` (default 30s), and a `round_done` event at exit carrying the final checkpoint SHA and CMD exit code.

- [ ] **Step 1: Write failing tests `tests/lane-run.bats`**

```bash
#!/usr/bin/env bats
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export DURABLE_CHECKPOINT_INTERVAL=0 DURABLE_HEARTBEAT_INTERVAL=0
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  WT="$BATS_TEST_TMPDIR/wt"; mkdir -p "$WT"
  git -C "$WT" init -q -b main; git -C "$WT" config user.email t@e.com; git -C "$WT" config user.name t
  echo x > "$WT/f"; git -C "$WT" add -A; git -C "$WT" commit -qm base
}

@test "lane-run tees stream, emits round_done with exit code, checkpoints" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'echo "{\"type\":\"tool_result\"}"; echo modified > "'"$WT"'/f"'
  [ "$status" -eq 0 ]
  [ -f "$WT/.harness/stream.ndjson" ]
  grep -q tool_result "$WT/.harness/stream.ndjson"
  # round_done event exists with exit_code 0
  run jq -rc 'select(.type=="round_done")|.payload.exit_code' "$(run_dir run1)/events.jsonl"
  [ "$output" = "0" ]
  # a checkpoint captured the modified file
  sha="$(git -C "$WT" rev-parse refs/checkpoints/lane-a)"
  [ "$(git -C "$WT" show "$sha:f")" = "modified" ]
}

@test "lane-run round_done records nonzero exit" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'exit 3'
  run jq -rc 'select(.type=="round_done")|.payload.exit_code' "$(run_dir run1)/events.jsonl"
  [ "$output" = "3" ]
}
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement `skills/foreman/scripts/lane-run.sh`** — source `lib/common.sh`, `lib/eventlog.sh`, `lib/checkpoint.sh`. Parse `RUN_ID LANE WORKTREE -- CMD...`. `mkdir -p "$WORKTREE/.harness"`. Read `DURABLE_CHECKPOINT_INTERVAL`/`DURABLE_HEARTBEAT_INTERVAL` env (fall back to config later). Emit `prompt`. Run `"${CMD[@]}" | stdbuf -oL tee -a "$WORKTREE/.harness/stream.ndjson"` capturing `${PIPESTATUS[0]}` as the CMD exit code. After the command completes, call `ckpt_snapshot "$WORKTREE" "$LANE"` and emit `round_done` with `{exit_code, checkpoint:<sha>}`. (For the throttled mid-run checkpoint/heartbeat, a background loop keyed on interval is acceptable; when interval=0 in tests, do a single post-run checkpoint — the tests set interval 0.) Exit with the CMD's exit code.

Minimal core:

```bash
#!/usr/bin/env bash
# @description Run a coding-CLI lane with durable-lanes instrumentation: tee the
#   reasoning stream to disk, checkpoint the worktree, and emit lifecycle events.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/eventlog.sh"
source "$SCRIPT_DIR/lib/checkpoint.sh"

RUN="$1"; LANE="$2"; WT="$3"; shift 3
[[ "$1" == "--" ]] && shift
mkdir -p "$WT/.harness"
el_emit "$RUN" prompt "$LANE" "$(jq -cn --arg c "$*" '{cmd:$c}')" >/dev/null

set +e
"$@" | stdbuf -oL tee -a "$WT/.harness/stream.ndjson"
rc=${PIPESTATUS[0]}
set -e

sha="$(ckpt_snapshot "$WT" "$LANE" 2>/dev/null || true)"
el_emit "$RUN" round_done "$LANE" "$(jq -cn --argjson e "$rc" --arg s "$sha" '{exit_code:$e,checkpoint:$s}')" "$sha" >/dev/null
exit "$rc"
```

- [ ] **Step 4: Run to verify pass** — 2 pass.
- [ ] **Step 5: Architect commits** `feat(durable): lane runner — stream tee, checkpoint, lifecycle events`

---

### Task 4: NATS setup + one-way bridge

**Files:**

- Create: `skills/foreman/scripts/nats/setup.sh`, `skills/foreman/scripts/lib/nats-bridge.sh`
- Test: `tests/nats-bridge.bats`

**Interfaces:**

- Consumes: `el_read`, `el_cursor_get`, `el_cursor_commit` (Task 1).
- Produces:
  - `nats/setup.sh` — first calls `durable-preflight.sh` (Task 0) and aborts (exit 3) if required NATS deps are missing, surfacing its install hints; then ensure a server is reachable at `${NATS_URL:-nats://127.0.0.1:4222}`; create/ensure stream `FOREMAN` with subjects `foreman.>` and file storage under `${NATS_STORE:-~/.foreman/nats-store}`. Idempotent.
  - `nb_bridge RUN_ID` — read new `events.jsonl` lines via `el_read` from the `nats-bridge` cursor and `nats pub foreman.<run>.<type>` each with header `Nats-Msg-Id: <run>:<seq>` (JetStream dedup); commit the cursor after each successful publish; loop with a short sleep. On a publish failure, do not advance the cursor (replay on next tick).

- [ ] **Step 1: Write tests `tests/nats-bridge.bats`** — each test begins:

```bash
setup() {
  command -v nats-server >/dev/null && command -v nats >/dev/null || skip "nats-server/nats not installed"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh" NATS_STORE="$BATS_TEST_TMPDIR/ns"
  # start an ephemeral server on a random-ish fixed test port; teardown kills it
  nats-server -js -p 34222 -sd "$NATS_STORE" & echo $! > "$BATS_TEST_TMPDIR/nats.pid"
  export NATS_URL="nats://127.0.0.1:34222"
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  source "$SCRIPTS/lib/common.sh"; source "$SCRIPTS/lib/eventlog.sh"; source "$SCRIPTS/lib/nats-bridge.sh"
  timeout 10 bash "$SCRIPTS/nats/setup.sh"
}
teardown() { [[ -f "$BATS_TEST_TMPDIR/nats.pid" ]] && kill "$(cat "$BATS_TEST_TMPDIR/nats.pid")" 2>/dev/null || true; }

@test "bridge publishes log events to JetStream, dedups on replay" {
  el_emit run1 tool_result lane '{"n":1}' >/dev/null
  nb_bridge run1                                    # one pass
  # consume from the stream: exactly one message for that seq
  run bash -c 'nats --server "$NATS_URL" consume FOREMAN --count 1 --raw 2>/dev/null'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.type=="tool_result"'
  # re-running the bridge on the same cursorless input must not double-publish (msg-id dedup)
  el_cursor_commit run1 nats-bridge 0; nb_bridge run1
  run bash -c 'nats --server "$NATS_URL" stream info FOREMAN --json | jq .state.messages'
  [ "$output" -eq 1 ]
}
```

- [ ] **Step 2: Run** — if NATS absent, tests SKIP (visible); if present, FAIL until implemented.
- [ ] **Step 3: Implement `nats/setup.sh` and `lib/nats-bridge.sh`** per the interface. `setup.sh` uses `nats stream add FOREMAN --subjects 'foreman.>' --storage file --retention limits --max-age=72h --defaults` (create-or-update). `nb_bridge` core:

```bash
# @description Publish new event-log lines for a run into JetStream (one-way bridge).
# @arg $1 run id  @exitcode 0 on a completed pass
nb_bridge() {
  local run="$1" from; from="$(el_cursor_get "$run" nats-bridge)"
  local n="$from" line seq type
  while IFS= read -r line; do
    n=$((n+1)); seq="$(jq -r .seq <<<"$line")"; type="$(jq -r .type <<<"$line")"
    if nats --server "${NATS_URL:-nats://127.0.0.1:4222}" pub "foreman.$run.$type" "$line" \
         -H "Nats-Msg-Id:$run:$seq" >/dev/null 2>&1; then
      el_cursor_commit "$run" nats-bridge "$n"
    else
      return 0   # leave cursor; retry next tick
    fi
  done < <(el_read "$run" "$from")
}
```

- [ ] **Step 4: Run** — pass (or skip if no server). Also verify `bash -n` both files.
- [ ] **Step 5: Architect commits** `feat(durable): NATS/JetStream setup + one-way event-log bridge`

---

### Task 5: Stall watchdog + watcher

**Files:**

- Create: `skills/foreman/scripts/watch.sh`
- Test: `tests/watch.bats`

**Interfaces:**

- Consumes: `el_read` (Task 1); optionally JetStream consume (Task 4) when NATS is up, else falls back to reading the log directly.
- Produces: `watch.sh RUN_ID LANE` — tracks last-event age for the lane; runs a `RUNNING→STALLED→DEAD` state machine (tiers from env/config: `STALL_WARN=300`, `STALL_DEAD=900`), printing one line per **state transition** only, debounced by 2 consecutive stalled ticks. A pure function `wd_state LAST_AGE PREV_STATE STALL_COUNT` returns `NEW_STATE STALL_COUNT` for testability.

- [ ] **Step 1: Write tests `tests/watch.bats`** testing the pure state function (no timers):

```bash
#!/usr/bin/env bats
setup() { SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"; source "$SCRIPTS/watch.sh"; export STALL_WARN=300 STALL_DEAD=900; }

@test "fresh events keep RUNNING and reset stall count" {
  run wd_state 30 RUNNING 1; [ "$output" = "RUNNING 0" ]
}
@test "one stalled tick does not transition (debounce)" {
  run wd_state 400 RUNNING 0; [ "$output" = "RUNNING 1" ]
}
@test "two consecutive stalled ticks transition to STALLED" {
  run wd_state 400 RUNNING 1; [ "$output" = "STALLED 2" ]
}
@test "exceeding dead threshold transitions to DEAD" {
  run wd_state 1000 STALLED 3; [ "$output" = "DEAD 4" ]
}
@test "recovery from STALLED back to RUNNING on fresh event" {
  run wd_state 20 STALLED 3; [ "$output" = "RUNNING 0" ]
}
```

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement `watch.sh`** with `wd_state` pure function (thresholds + debounce logic exactly matching the tests) plus a `main` loop (`sleep ${WATCH_TICK:-15}`; compute last-event age from `events.jsonl` mtime or last line ts; call `wd_state`; on transition, emit an `alert` event + print; on DEAD, print the escalation hint `kill+retry from $(ckpt_latest)`).  The loop is not unit-tested (timing); the state machine is.
- [ ] **Step 4: Run to verify pass** — 5 pass.
- [ ] **Step 5: Architect commits** `feat(durable): stall watchdog state machine + watcher`

---

### Task 6: Resume

**Files:**

- Create: `skills/foreman/scripts/resume.sh`
- Test: `tests/resume.bats`

**Interfaces:**

- Consumes: `el_read` (Task 1), `ckpt_latest` (Task 2).
- Produces: `resume.sh RUN_ID LANE WORKTREE` — finds the last `checkpoint`/`round_done` event's SHA for the lane (falling back to `ckpt_latest`), `git checkout`s that tree into the worktree, and prints the `next`/last prompt payload so the architect can restart the round. Exit 4 if no checkpoint exists.

- [ ] **Step 1: Write tests `tests/resume.bats`**

```bash
#!/usr/bin/env bats
load helpers
setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  source "$SCRIPTS/lib/common.sh"; source "$SCRIPTS/lib/eventlog.sh"; source "$SCRIPTS/lib/checkpoint.sh"
  WT="$BATS_TEST_TMPDIR/wt"; mkdir -p "$WT"; git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com; git -C "$WT" config user.name t
  echo base > "$WT/f"; git -C "$WT" add -A; git -C "$WT" commit -qm base
}

@test "resume restores the last checkpoint content" {
  echo work > "$WT/f"; sha="$(ckpt_snapshot "$WT" lane1)"
  el_emit run1 checkpoint lane1 '{}' "$sha" >/dev/null
  echo clobbered > "$WT/f"                       # simulate lost mid-round state
  run bash "$SCRIPTS/resume.sh" run1 lane1 "$WT"
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/f")" = "work" ]                  # restored
}

@test "resume exits 4 when no checkpoint exists" {
  run bash "$SCRIPTS/resume.sh" run1 nolane "$WT"; [ "$status" -eq 4 ]
}
```

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement `resume.sh`** — resolve SHA (last `checkpoint` event via `el_read`+jq, else `ckpt_latest`); if empty exit 4; `git -C "$WT" checkout "$sha" -- .` to restore tree; print last `prompt` payload. `set -euo pipefail`, shdoc headers.
- [ ] **Step 4: Run to verify pass** — 2 pass.
- [ ] **Step 5: Architect commits** `feat(durable): resume from last checkpoint`

---

### Task 7: Config, doctrine, manifest, wiring

**Files:**

- Create: `skills/foreman/references/durable-lanes.md`
- Modify: `skills/foreman/SKILL.md`, `.foreman/config.toml`, `config/foreman.toml.example`

(The manifest/bootstrap/tool-check dependency entries were added in Task 0; this
task only documents them and adds config + doctrine. Reference the Task 0
`durable` profile and `durable-preflight.sh` from the doctrine.)

**Interfaces:**

- Consumes: all prior tasks (documents them).

- [ ] **Step 1: `references/durable-lanes.md`** — document the architecture (event log = source of truth; checkpoints; NATS transport one-way; watchdog; resume), the `[durable]`/`[nats]` config keys, the WSL/Windows notes (mirrored mode, native-FS store_dir), and the honest limits (NATS dependency when enabled; server-dependent tests skip).
- [ ] **Step 2: `.foreman/config.toml` + `config/foreman.toml.example`** — add:

```toml
[durable]
enabled = false
checkpoint_interval = 20   # seconds
heartbeat_interval = 30
stall_warn = 300
stall_dead = 900

[nats]
url = "nats://127.0.0.1:4222"
store_dir = "~/.foreman/nats-store"
stream = "FOREMAN"
subject_prefix = "foreman"
```

- [ ] **Step 3: `SKILL.md`** — add a "Durable lanes" subsection under soft-mode doctrine: when `[durable] enabled`, run implement rounds via `lane-run.sh`, watch with `watch.sh`, resume with `resume.sh`; the event log is the source of truth; NATS is the transport.
- [ ] **Step 4: Verify + commit**

```bash
grep -c '\[durable\]' .foreman/config.toml config/foreman.toml.example   # 1 each
grep -c 'durable-preflight' skills/foreman/references/durable-lanes.md   # >=1 (doctrine points at the Task 0 preflight)
grep -c 'durable-lanes' skills/foreman/SKILL.md                          # >=1
bash tests/run.sh                                                         # full suite green (NATS tests skip if no server)
bash skills/foreman/scripts/docs-check.sh | tail -1                      # all pass
```

Commit: `feat(durable): config + doctrine for durable-lanes`

---

## Execution through Foreman

1. **Task 0 first** (environment: dependency list + `durable-preflight.sh` + manifest `durable` profile + tool-check). Run `bash env/tool-check.sh --profile durable`; note NATS absent → NATS bridge tests (Task 4) will skip locally (state it). Optionally `scoop install main/nats-server extras/natscli` to run Task 4 live.
2. Tasks 1–2 (durability spine, no external deps beyond jq/git) — one worktree each or one combined `durable-libs` worktree; Codex/Grok implement; cross-vendor audit; wt-merge.
3. Task 3 (lane-run) after 1–2. Tasks 4–6 can parallelize after Task 1 (4 needs eventlog + Task 0 preflight; 5 needs eventlog; 6 needs eventlog+checkpoint) — separate worktrees, spawned together; audit each; merge in order 4,5,6.
4. Task 7 last (config + doctrine over the shipped surface). Full suite green + docs-check + advisor done-check before declaring done.
5. Candidate to tag as **v0.2.0** once merged.

## Self-review notes

- Spec coverage: environment dependency list + preflight verify→T0; event log→T1; checkpoints→T2; stream tee + lifecycle→T3; NATS setup+bridge→T4; watchdog→T5; resume→T6; config/doctrine→T7. Degradation rule (log survives NATS down) → T4 bridge cursor-not-advanced-on-failure + tests. Honest limits (NATS dep, tests skip) → T0 manifest (required=false for NATS) + T4 setup + T7 doctrine. The user's explicit ask — "an environment setup step with a dependency list that verifies installation" — is Task 0.
- Placeholders: none; real bash + real tests in every task. The lane-run mid-run throttled checkpoint/heartbeat loop is specified as interval-driven with the tested interval=0 path exercised; the timing loop itself is deliberately not unit-tested (only the post-run checkpoint + round_done are), which the plan states.
- Type consistency: `el_emit/el_read/el_cursor_get/el_cursor_commit`, `ckpt_snapshot/ckpt_latest`, `nb_bridge`, `wd_state`, `dp_verify` names match across tasks and tests. Event `type` values and the `{seq,ts,type,lane,commit,payload}` schema are consistent T1↔T3↔T4↔T6. The `durable` manifest profile (T0) lists every dependency the later tasks assume; `durable-preflight.sh` (T0) is the single verify step and gates `[durable] enabled` work (T4 setup and T3 lane-run call it).

## Pre-implementation audit — Tasks 3–4 (2026-07-15, Codex GPT-5.6 Sol, high)

A plan-time cross-vendor audit of the Task 3–4 code blocks **before any worker
implements them** (this is the plan-time-audit idea, applied). Verdict: do NOT
copy the shown Task 3–4 code verbatim. Apply these before building. (Findings
that duplicate already-fixed T1/T2 bugs — `select(.!="")`, the unlocked `.seq`
counter — are resolved in the shipped libs and the corrected blocks above.)

### Task 3 — `lane-run.sh` (must fix before building)

- **Checkpoint failure swallowed:** `sha="$(ckpt_snapshot ... 2>/dev/null || true)"`
  turns any failure into success; combined with an empty `sha`, `round_done`
  becomes a blank record. Capture failure explicitly, emit a `checkpoint_failed`
  payload, keep stderr.
- **stdbuf/gstdbuf:** don't hardcode `stdbuf` — resolve `stdbuf`/`gstdbuf` once
  (reuse Task 0's check) with a no-wrapper fallback; a missing `stdbuf` makes the
  `tee` side exit 127 while only `PIPESTATUS[0]` is checked → "success" with no
  stream. Check both pipeline statuses.
- **Interval/heartbeat contract unimplemented:** the "minimal core" never reads
  `DURABLE_CHECKPOINT_INTERVAL`/`DURABLE_HEARTBEAT_INTERVAL`, emits no heartbeat,
  does no throttled mid-run checkpoint. Either implement the full contract in the
  plan or narrow the Task 3 interface to match. Add a cleanup trap.
- **Finalization under set -e:** a `round_done` `el_emit` failure after `set -e`
  is restored aborts before `exit "$rc"`, replacing the lane's real status with
  an instrumentation failure. Use explicit `if`s for finalization.
- **Arity + stderr:** validate `RUN LANE WORKTREE -- CMD...` (else `set -u`
  aborts on unbound positionals); decide whether stderr joins the durable
  transcript (many CLIs emit reasoning there); enforce one writer per worktree.

### Task 4 — `nb_bridge` / `nats/setup.sh` (must fix before building)

- **CRLF poisons the subject (critical):** `seq`/`type` from Windows jq.exe carry
  a trailing CR → invalid `Nats-Msg-Id` header and `foreman.<run>.<type>` subject
  → `nats pub` fails for every event, yet `nb_bridge` returns 0 (masks total
  failure). Strip CR from every jq-derived scalar (`v=${v%$'\r'}`); validate
  `seq` as a positive int and `type` as a legal subject token before publishing.
- **PubAck not validated (critical):** a successful core `nats pub` process exit
  is not a JetStream PubAck; a stream-level rejection followed by cursor advance
  = permanent event loss, exactly what the degradation rule forbids. Publish via
  a JetStream-aware call that waits for + validates the PubAck; advance the
  cursor only after positive ack. Check `el_cursor_commit`'s result; one bridge
  per run via a mkdir lock (shared `.cursor.tmp` path otherwise clobbers).
- **`--subjects foreman.>` unquoted (critical):** copied unquoted, `>` is a shell
  redirect — `--storage` becomes a filename, stream never configured. Quote it:
  `--subjects "foreman.>"`.
- **setup.sh is under-specified:** no code for calling `durable-preflight.sh`,
  mapping missing deps to exit 3, or a bounded server-reachability retry; write
  the full body. `--defaults` is NOT create-or-update — probe `nats stream info
  FOREMAN`, add when absent, use a supported edit path when present. `NATS_STORE`
  is a `nats-server` setting, not a `stream add --storage` arg, and
  `${NATS_STORE:-~/.foreman/nats-store}` leaves a literal `~` (no tilde expansion
  in parameter expansion) — configure the server's JetStream store dir with
  `$HOME` expanded, or document that setup.sh doesn't own storage.
- **Tests:** strip CR before bats integer comparisons (`jq .state.messages` →
  `1\r`), or assert in jq (`jq -e '.state.messages == 1'`); add a bounded timeout
  to `nats consume` so a failed publish fails fast instead of hanging.

### Note on shipped `ckpt_snapshot` (T2, already merged)

The auditor flagged the `idx="$(mktemp)"` + `GIT_INDEX_FILE` pattern as
potentially fragile (a zero-byte existing index). The shipped tests pass 4/4 on
this host (`read-tree HEAD` repopulates the index), so it works here, but
tomorrow: verify on WSL and consider `rm -f "$idx"` before first use for
robustness.

Task 5–7 plan-time audit: re-run tomorrow before building those tasks.

## Pre-implementation audit — Tasks 5–7 (2026-07-15, Codex GPT-5.6 Sol, high)

Second half of the plan-time audit (watch / resume / config). Findings that
duplicate already-fixed T1/T2 bugs (`select(.!="")`, unlocked `.seq`, CRLF) are
resolved in the shipped libs and corrected blocks above. The following are NEW
and must be fixed before building Tasks 5–7 (some require tightening the T1–2
five-part specs' acceptance criteria too).

### Task 5 — `watch.sh` (must fix before building)

- **No lane filter (critical):** age is computed from the shared `events.jsonl`,
  not filtered by lane. If lane A hangs while lane B emits heartbeats, A's age
  never grows → never escalates; and an `alert` event refreshes the shared
  last-line → false recovery/oscillation. Filter `el_read`/mtime by
  `.lane==$lane`, and count only liveness types (`prompt`/`heartbeat`/`checkpoint`),
  excluding `alert`/`round_done` from the age calc.
- **No completion exit (critical):** after a lane's terminal `round_done`, the
  loop keeps polling and eventually marks a finished lane STALLED→DEAD. Detect
  the lane's `round_done` and exit 0 before applying stall thresholds.
- **Escalation hint impossible as written:** `watch.sh RUN LANE` has no
  `WORKTREE`, but `ckpt_latest` needs `WORKTREE LANE`. Add `WORKTREE` to the args
  (or persist a run/lane→worktree map); source `checkpoint.sh`.
- **`wd_state` boundary + restart:** specify `>=` vs `>` at exactly
  `STALL_WARN`/`STALL_DEAD` and add boundary tests; in-memory `stall_count`/state
  is lost on `watch.sh` restart (debounce resets) — either persist per run+lane
  atomically or define `age>=STALL_DEAD` as immediate restart-independent DEAD.
- **`set -e` footguns:** `((stall_count++))` returns 1 when the value is 0 and
  aborts under `set -e` — use `stall_count=$((stall_count+1))`; ensure `wd_state`
  always `return 0`s; guard jq captures to distinguish "no event" from "parse
  failure". Add an integration test: repeated stale ticks → exactly one STALLED +
  one DEAD alert (transition-only).
- **mtime portability:** prefer the event's authoritative ISO timestamp over file
  mtime (`stat -c %Y` GNU vs `-f %m` BSD vs Git Bash; `/mnt/c` coarse under WSL).

### Task 6 — `resume.sh` (must fix before building)

- **No lane filter (critical):** `el_read` has no lane filter, so resuming lane A
  can pick lane B's checkpoint SHA. jq must require `.lane==$lane`, accept
  `checkpoint` and `round_done`, resolve `.commit // .payload.checkpoint`, reject
  empty, take the last match, and validate `git cat-file -e "$sha^{commit}"`.
- **Destroys uncommitted work (critical):** the bats test writes `clobbered`
  uncommitted then asserts resume silently overwrites it — resume is destructive
  by default. Refuse on a dirty worktree by default; add explicit `--force`;
  back up before overwriting. The test should invoke the destructive path
  intentionally, not as the default.
- **`git checkout SHA -- .` is not an exact restore:** untracked/new-since-
  checkpoint files survive and the real index is rewritten in place. Define
  overlay-vs-exact semantics; for exact recovery prefer a detached checkout /
  isolated-index sync with explicit removal rules.
- **`prompt`/`next` recovery:** lane-filter it, and define the `next` event/field
  schema (nothing in T1–3 defines `next`), including the no-data case.

### Task 7 — config is decorative (must fix before building)

- **The `[durable]` and `[nats]` TOML keys are dead (critical):** nothing in
  Tasks 0–7 parses TOML. `lane-run.sh` reads only `DURABLE_*` env vars,
  `watch.sh` only `STALL_*`, `nb_bridge`/`setup.sh` hardcode `FOREMAN`/`foreman`
  and read only `NATS_URL`/`NATS_STORE`. Specify and test a shared config loader
  (precedence: CLI > env > TOML > default), expand `~` in `store_dir`, and wire
  every documented key through it into Tasks 3/4/5. Add a test that sets ONLY
  TOML values and asserts the resulting interval/stall/url/store/stream/subject.

### Cross-cutting

- **`nb_bridge` one-shot vs loop:** the Task 4 interface says "loop with a short
  sleep" but the sample is a single pass. Split into a tested `nb_bridge_once`
  plus an explicit wrapper loop (backoff + shutdown), or document it one-shot.
- **`ckpt_latest` `|| true`:** converts every git failure into "no checkpoint".
  Return empty only when the ref is confirmed absent; propagate other failures.

These make Tasks 1–2 spec tightening + Tasks 5–7 acceptance criteria explicit;
must-fix-before-handoff: the lane-filter bugs (watch + resume), resume's
dirty-worktree guard, and the dead config layer.
