#!/usr/bin/env bats
# @description Tests for fm-session.py, the canonical session recovery store.
#   The load-bearing property is that a measurement's validity is COMPUTED at
#   read time from git, never stored -- so a number cannot be quoted without a
#   freshness verdict. That is what these tests exist to pin.

setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  # The implementation under test is overridable, so this file is a
  # cross-implementation conformance suite rather than a Python-only one.
  # 27 of these 34 tests already assert on printed output, so a port that
  # emits different stdout fails here rather than passing quietly.
  SESS="${FM_SESSION_CMD:-node $SCRIPTS/../runtime/dist/fm-session.js}"
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.email t@e.com
  git -C "$REPO" config user.name t
  mkdir -p "$REPO/src"
  echo one > "$REPO/src/a.sh"
  git -C "$REPO" add -A
  git -C "$REPO" -c core.hooksPath= commit -qm base
  export FOREMAN_SESSION_DB="$BATS_TEST_TMPDIR/session.db"
}

@test "recover on an empty store succeeds and reports no session" {
  cd "$REPO"
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"last session: (none"* ]]
}

@test "begin mints a session and recover then reports it" {
  cd "$REPO"
  run $SESS begin --note "first"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SESSION BEGUN:"* ]]
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"first"* ]]
}

@test "a fact survives recovery with its evidence" {
  cd "$REPO"
  $SESS fact "the gate is wired" --evidence "commit deadbeef"
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"the gate is wired"* ]]
  [[ "$output" == *"commit deadbeef"* ]]
}

# The core mechanism. A measurement is fresh until a commit touches its scope,
# and stale immediately afterwards -- with no write to the store in between.
@test "a measurement is fresh, then STALE once a commit touches its scope" {
  cd "$REPO"
  $SESS measure "suite pass count" 12 --command "bats tests/x.bats" --scope src/a.sh
  # Assert on the COUNT, not a bare "STALE" substring -- the counts header
  # reads "fresh=1 STALE=0" and always contains the word.
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE=0"* ]]

  echo two >> "$REPO/src/a.sh"
  git -C "$REPO" add -A
  git -C "$REPO" -c core.hooksPath= commit -qm "touch the scope"

  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE=1"* ]]
  # the re-run command must ride along, or staleness is a dead end
  [[ "$output" == *"bats tests/x.bats"* ]]
}

@test "a commit OUTSIDE the scope leaves the measurement fresh" {
  cd "$REPO"
  $SESS measure "suite pass count" 12 --command "bats tests/x.bats" --scope src/a.sh
  echo unrelated > "$REPO/other.txt"
  git -C "$REPO" add -A
  git -C "$REPO" -c core.hooksPath= commit -qm "unrelated change"
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE=0"* ]]
}

@test "measure refuses without --scope (a measurement that cannot go stale is the original bug)" {
  cd "$REPO"
  run $SESS measure "metric" 1 --command "cmd"
  [ "$status" -eq 2 ]
  [[ "$output" == *"--scope is required"* ]]
}

@test "supersede requires a reason and records it" {
  cd "$REPO"
  $SESS fact "old belief"
  run $SESS supersede 1 "new belief"
  [ "$status" -ne 0 ]

  run $SESS supersede 1 "new belief" --reason "measured again after the fix"
  [ "$status" -eq 0 ]
  run $SESS recover
  [[ "$output" == *"new belief"* ]]
  [[ "$output" != *"old belief"* ]]
}

@test "obligations appear until closed" {
  cd "$REPO"
  $SESS obligation "wire the projector"
  run $SESS recover
  [[ "$output" == *"wire the projector"* ]]
  $SESS close 1 --status done
  run $SESS recover
  [[ "$output" != *"wire the projector"* ]]
}

@test "the launch point names unfresh measurements" {
  cd "$REPO"
  $SESS measure "m" 5 --command "c" --scope src/a.sh
  echo x >> "$REPO/src/a.sh"
  git -C "$REPO" add -A
  git -C "$REPO" -c core.hooksPath= commit -qm "touch"
  run $SESS recover
  [[ "$output" == *"LAUNCH POINT"* ]]
  [[ "$output" == *"not fresh"* ]]
}


@test "a retired measurement disappears from recovery and its successor remains" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  $SESS measure "suite pass count" "11" --command "bats t.bats" --scope src/a.sh
  run $SESS retire 1 --by 2 --reason "host state poisoned the first reading"
  [ "$status" -eq 0 ]
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" != *"= 26"* ]]
  [[ "$output" == *"= 11"* ]]
}

@test "retire refuses without a reason" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  $SESS measure "suite pass count" "11" --command "bats t.bats" --scope src/a.sh
  run $SESS retire 1 --by 2
  [ "$status" -eq 2 ]
}

@test "retire refuses to point a measurement at itself" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  run $SESS retire 1 --by 1 --reason "nonsense"
  [ "$status" -eq 2 ]
  run $SESS recover
  [[ "$output" == *"= 26"* ]]
}

@test "a linked worktree shares the repo's session store" {
  cd "$REPO"
  unset FOREMAN_SESSION_DB
  git -C "$REPO" worktree add -q "$BATS_TEST_TMPDIR/wt" -b side
  cd "$BATS_TEST_TMPDIR/wt"
  $SESS fact "recorded from the side worktree"
  cd "$REPO"
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"recorded from the side worktree"* ]]
}

# B1. A retire that updates no row must not print a success line. The target
# was never checked, so a typo in the id read as a completed retirement.
@test "retire refuses a measurement id that does not exist" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  run $SESS retire 99 --by 1 --reason "nonexistent target"
  [ "$status" -eq 2 ]
  [[ "$output" == *"no measurement 99"* ]]
  [[ "$output" != *"retired, superseded by"* ]]
  run $SESS recover
  [[ "$output" == *"= 26"* ]]
}

# B3. A retired row must not supersede anything. Two rows could point at each
# other, and then recover reported zero measurements as fully fresh.
@test "retire refuses to supersede with an already-retired measurement" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  $SESS measure "suite pass count" "11" --command "bats t.bats" --scope src/a.sh
  $SESS retire 1 --by 2 --reason "host state poisoned the first reading"
  run $SESS retire 2 --by 1 --reason "cycle back onto the retired row"
  [ "$status" -eq 2 ]
  [[ "$output" == *"is itself superseded"* ]]
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"= 11"* ]]
  [[ "$output" != *"= 26"* ]]
}

# B3, second half. An empty live set is not a fresh one. The launch point said
# "every measurement is fresh" over zero rows, which reads as an all-clear.
@test "the launch point does not claim freshness when no measurement exists" {
  cd "$REPO"
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" != *"every measurement is fresh"* ]]
  [[ "$output" == *"no measurement is recorded"* ]]
}


@test "sidecar is deterministic and omits computed measurement validity" {
  cd "$REPO"
  $SESS fact "deterministic fact" --evidence "spec"
  $SESS measure "suite count" "26" --command "bats tests/session.bats" --scope src/a.sh
  $SESS obligation "deterministic obligation"

  run $SESS sidecar --out "$BATS_TEST_TMPDIR/a.ndjson"
  [ "$status" -eq 0 ]
  run $SESS sidecar --out "$BATS_TEST_TMPDIR/b.ndjson"
  [ "$status" -eq 0 ]
  cmp "$BATS_TEST_TMPDIR/a.ndjson" "$BATS_TEST_TMPDIR/b.ndjson"
  run python3 - "$BATS_TEST_TMPDIR/a.ndjson" <<'PY'
import json
import sys

FACT_FIELDS = [
    "id", "statement", "evidence", "established_ts", "session_id",
    "superseded_by", "superseded_at", "supersede_reason",
]

with open(sys.argv[1], encoding="utf-8") as stream:
    lines = stream.read().split("\n")

# exactly one terminating newline, nothing after it
if lines[-1] != "":
    raise SystemExit(1)
seen = set()
for line in lines[1:-1]:
    document = json.loads(line)
    # rows carry only kind and row, and emit every declared field in the
    # declared order -- not sorted, not omitted when null
    if list(document.keys()) != ["kind", "row"]:
        raise SystemExit(1)
    seen.add(document["kind"])
    if document["kind"] == "fact" and list(document["row"].keys()) != FACT_FIELDS:
        raise SystemExit(1)
if seen != {"fact", "measurement", "obligation"}:
    raise SystemExit(1)
PY
  [ "$status" -eq 0 ]
  [ "$(head -n 1 "$BATS_TEST_TMPDIR/a.ndjson")" = \
    '{"format":"foreman-session-sidecar","format_version":2,"session_model_version":1,"next_ids":{"fact":2,"measurement":2,"obligation":2}}' ]
  ! grep -q '"validity"' "$BATS_TEST_TMPDIR/a.ndjson"
  # undeclared tables cannot reach the tracked record: the store carries
  # store_meta and memory_outbox, and the encoder emits neither
  ! grep -q 'store_meta\|memory_outbox\|schema_meta' "$BATS_TEST_TMPDIR/a.ndjson"
}



@test "sidecar defaults beside FOREMAN_SESSION_DB" {
  cd "$REPO"
  export FOREMAN_SESSION_DB="$BATS_TEST_TMPDIR/nested/session.db"
  $SESS fact "travels beside the store"

  run $SESS sidecar
  [ "$status" -eq 0 ]
  [ -f "$BATS_TEST_TMPDIR/nested/session.ndjson" ]
}

@test "import-sidecar restores every database row and column exactly" {
  cd "$REPO"
  source_db="$FOREMAN_SESSION_DB"
  $SESS begin --note "fidelity probe"
  $SESS fact "a fact" --evidence "some evidence"
  $SESS measure some_metric 42 --command "the exact rerun command" \
    --scope docs --scope tests
  $SESS obligation "an obligation" --blocker "the blocker text"
  $SESS measure some_metric 7 --command "second reading" --scope docs
  $SESS retire 1 --by 2 --reason "proven wrong"
  $SESS sidecar --out "$BATS_TEST_TMPDIR/fidelity.ndjson"

  target_db="$BATS_TEST_TMPDIR/imported/session.db"
  export FOREMAN_SESSION_DB="$target_db"
  run $SESS import-sidecar "$BATS_TEST_TMPDIR/fidelity.ndjson"
  [ "$status" -eq 0 ]

  tables=$(sqlite3 "$source_db" \
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  for table in $tables; do
    run sqlite3 "$source_db" "SELECT * FROM \"$table\" ORDER BY 1"
    [ "$status" -eq 0 ]
    source_rows="$output"
    run sqlite3 "$target_db" "SELECT * FROM \"$table\" ORDER BY 1"
    [ "$status" -eq 0 ]
    [ "$output" = "$source_rows" ]
  done

  [ "$(sqlite3 "$target_db" \
    "SELECT command FROM measurements WHERE id=1")" = \
    "the exact rerun command" ]
  [ "$(sqlite3 "$target_db" \
    "SELECT blocker FROM obligations WHERE id=1")" = "the blocker text" ]
  [ "$(sqlite3 "$target_db" \
    "SELECT count(DISTINCT session_id) FROM facts \
     WHERE session_id IS NOT NULL")" -eq 1 ]
  [ "$(sqlite3 "$target_db" \
    "SELECT superseded_by || '|' || supersede_reason \
     FROM measurements WHERE id=1")" = "2|proven wrong" ]
  ! sqlite3 "$target_db" ".dump" | grep -q \
    "recovered superseded measurement"
}

@test "import-sidecar refuses a populated store unless forced" {
  cd "$REPO"
  $SESS fact "source fact"
  $SESS sidecar --out "$BATS_TEST_TMPDIR/source.ndjson"

  export FOREMAN_SESSION_DB="$BATS_TEST_TMPDIR/target/session.db"
  $SESS fact "target fact"
  run $SESS import-sidecar "$BATS_TEST_TMPDIR/source.ndjson"
  [ "$status" -eq 2 ]
  [[ "$output" == *"target store already has rows"* ]]
  run $SESS recover
  [[ "$output" == *"target fact"* ]]

  run $SESS import-sidecar "$BATS_TEST_TMPDIR/source.ndjson" --force
  [ "$status" -eq 0 ]
  run $SESS recover
  [[ "$output" == *"source fact"* ]]
  [[ "$output" != *"target fact"* ]]
}

@test "import-sidecar --into overrides FOREMAN_SESSION_DB" {
  cd "$REPO"
  $SESS fact "source fact"
  $SESS sidecar --out "$BATS_TEST_TMPDIR/source.ndjson"
  target="$BATS_TEST_TMPDIR/explicit/session.db"

  run $SESS import-sidecar "$BATS_TEST_TMPDIR/source.ndjson" --into "$target"
  [ "$status" -eq 0 ]
  [ -f "$target" ]
  export FOREMAN_SESSION_DB="$target"
  run $SESS recover
  [[ "$output" == *"source fact"* ]]
}

@test "sidecar refuses to overwrite the live SQLite store" {
  cd "$REPO"
  $SESS fact "must survive"

  run $SESS sidecar --out "$FOREMAN_SESSION_DB"
  [ "$status" -eq 2 ]
  [[ "$output" == *"aliases the session store"* ]]
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"must survive"* ]]
}

@test "sidecar refuses when its default path is the SQLite store" {
  cd "$REPO"
  export FOREMAN_SESSION_DB="$BATS_TEST_TMPDIR/session.ndjson"
  $SESS fact "must survive"

  run $SESS sidecar
  [ "$status" -eq 2 ]
  [[ "$output" == *"aliases the session store"* ]]
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"must survive"* ]]
}



@test "import-sidecar names an unrestorable row and rolls back the target" {
  cd "$REPO"
  sidecar="$BATS_TEST_TMPDIR/invalid-row.ndjson"
  printf '%s\n' \
    '{"format":"foreman-session-sidecar","format_version":1}' \
    '{"row":{"established_ts":"now","evidence":null,"id":7,"session_id":null,"statement":null,"supersede_reason":null,"superseded_at":null,"superseded_by":null},"table":"facts"}' \
    > "$sidecar"
  $SESS fact "target fact"

  run $SESS import-sidecar "$sidecar" --force
  [ "$status" -eq 2 ]
  [[ "$output" == *"fact.statement"* ]]
  [[ "$output" == *"id=7"* ]]
  [[ "$output" == *"null in a non-null field"* ]]
  run $SESS recover
  [[ "$output" == *"target fact"* ]]
}

@test "import-sidecar refuses an unknown format version" {
  cd "$REPO"
  sidecar="$BATS_TEST_TMPDIR/future.ndjson"
  printf '%s\n' \
    '{"format":"foreman-session-sidecar","format_version":99}' > "$sidecar"

  run $SESS import-sidecar "$sidecar"
  [ "$status" -eq 2 ]
  [[ "$output" == *"unsupported sidecar format version 99"* ]]
}

@test "legacy commands retain database-open failure behavior" {
  cd "$REPO"
  export FOREMAN_SESSION_DB="$BATS_TEST_TMPDIR"

  run $SESS recover
  [ "$status" -eq 1 ]
  [[ "$output" == *"sqlite3.OperationalError"* ]]
  [[ "$output" != *"refusing: cannot open target store"* ]]
}

@test "freshness text reports every field and names a missing command" {
  cd "$REPO"
  $SESS measure "suite pass count" "31 pass" \
    --command "bats tests/session.bats" --scope src/a.sh --scope tests/session.bats
  sqlite3 "$FOREMAN_SESSION_DB" \
    "UPDATE measurements SET command = NULL WHERE id = 1"

  run $SESS freshness
  [ "$status" -eq 0 ]
  [[ "$output" == *"[1] suite pass count = 31 pass"* ]]
  [[ "$output" == *"verdict=fresh"* ]]
  [[ "$output" == *"command=(no command recorded)"* ]]
  [[ "$output" == *"scope=src/a.sh,tests/session.bats"* ]]
  [[ "$output" == *"sha=$(git -C "$REPO" rev-parse HEAD)"* ]]
  [[ "$output" == *"timestamp="* ]]

  run $SESS freshness --format tsv
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | awk -F '\t' 'NR == 2 { print $6 }')" = \
    "(no command recorded)" ]
}

@test "freshness stale-only reports only stale rows and their invalidation" {
  cd "$REPO"
  echo stable > "$REPO/stable.txt"
  git -C "$REPO" add -A
  git -C "$REPO" -c core.hooksPath= commit -qm "add stable scope"
  $SESS measure "stale metric" 1 --command "rerun stale" --scope src/a.sh
  $SESS measure "fresh metric" 2 --command "rerun fresh" --scope stable.txt
  $SESS measure "unknown metric" 3 --command "rerun unknown" --scope stable.txt
  sqlite3 "$FOREMAN_SESSION_DB" \
    "UPDATE measurements SET measured_sha = NULL WHERE id = 3"

  echo two >> "$REPO/src/a.sh"
  git -C "$REPO" add -A
  git -C "$REPO" -c core.hooksPath= commit -qm "touch stale scope"

  run $SESS freshness --stale-only
  [ "$status" -eq 0 ]
  [[ "$output" == *"stale metric"* ]]
  [[ "$output" == *"verdict=STALE"* ]]
  [[ "$output" == *"commit(s) touched its scope since measurement"* ]]
  [[ "$output" == *"command=rerun stale"* ]]
  [[ "$output" != *"fresh metric"* ]]
  [[ "$output" == *"unknown metric"* ]]
  [[ "$output" == *"verdict=unknown"* ]]
  [[ "$output" == *"no measured_sha recorded"* ]]
}

@test "freshness tsv has fixed columns and preserves the command verbatim" {
  cd "$REPO"
  rerun='printf "%s\n" "$HOME" && echo *.bats'
  $SESS measure "suite pass count" 31 --command "$rerun" --scope src/a.sh

  run $SESS freshness --format tsv
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | awk -F '\t' 'NR == 1 { print NF }')" -eq 9 ]
  [ "$(printf '%s\n' "$output" | awk -F '\t' 'NR == 2 { print NF }')" -eq 9 ]
  [ "$(printf '%s\n' "$output" | awk -F '\t' 'NR == 2 { print $6 }')" = "$rerun" ]
  [ "$(printf '%s\n' "$output" | sed -n '1p')" = \
    $'id\tmetric\tvalue\tverdict\treason\tcommand\tscope\tsha\ttimestamp' ]
}
