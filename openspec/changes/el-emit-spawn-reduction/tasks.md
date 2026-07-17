# Tasks — el_emit spawn reduction

All edits are in `skills/foreman/scripts/lib/eventlog.sh`, function `el_emit`
only. Apply in the risk-laddered order below (each is independently revertible).

## Implementation

- [ ] **F1** (eventlog.sh:50) — replace
      `line="$(printf '%s' "$raw" | tr -d '\r')"` with
      `line="${raw//$'\r'/}"`.
- [ ] **F4** (eventlog.sh:21) — replace `local rd; rd="$(run_dir "$run")"` with
      `local rd="$FOREMAN_HOME/runs/$run"`. Do NOT modify `run_dir` in
      `common.sh`.
- [ ] **F3** (eventlog.sh:21) — replace the unconditional `mkdir -p "$rd"` with
      `[[ -d "$rd" ]] || mkdir -p "$rd"` (keep it before the `mkdir "$lock"`
      loop).
- [ ] **F2** (eventlog.sh:40–41) — add `prev=0` to the `local` declaration; replace
      `seq=$(( $(cat "$seqf" 2>/dev/null || echo 0) + 1 ))` with:
      ```sh
      [[ -f "$seqf" ]] && prev="$(<"$seqf")"
      seq=$(( ${prev:-0} + 1 ))
      ```
      Guard MUST be existence (`[[ -f ]]`) with `prev` pre-initialised to `0`;
      do NOT use a bare `$(<file)` and do NOT fold `2>/dev/null || echo 0` into
      the read.

## Do NOT change

- [ ] `jq -cn` invocation and its arguments (eventlog.sh:46–49).
- [ ] `ts="$(date -u …)"` (F5, deferred to v0.2.5).
- [ ] The `.seq` reserve `echo "$seq" > "$seqf.tmp" && mv …` (CAS).
- [ ] The `mkdir "$lock"` / `rmdir "$lock"` seq mutex.
- [ ] `run_dir` in `common.sh`; `el_init`, `el_read`, `el_cursor_*`.
- [ ] `checkpoint.sh` (F6, deferred).

## Verification (run in an isolated worktree; NOT on a host with a live gate)

- [ ] `bash tests/run.sh tests/eventlog.bats` — green (field-exactness, no-CR,
      seq monotonic, concurrent 1..20, reserve/append/lock guards).
- [ ] `bash tests/run.sh tests/lane-run.bats` — green (el_emit driven via
      lane-run under `set -euo pipefail`).
- [ ] `bash tests/run.sh` — full suite exits 0, same test count.
- [ ] Byte diff: `events.jsonl` from a fixed emit
      (`el_emit run1 checkpoint lane-b '{"x":true}' abc123`) is identical
      before/after (ignoring the `ts` wall-clock value) via `cmp`.

## Ship

- [ ] On merge, move this folder to
      `openspec/changes/archive/<YYYY-MM-DD>-el-emit-spawn-reduction/`.
