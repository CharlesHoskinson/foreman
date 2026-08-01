#!/usr/bin/env bats
# @description Tests for fm-session.py, the canonical session recovery store.
#   The load-bearing property is that a measurement's validity is COMPUTED at
#   read time from git, never stored -- so a number cannot be quoted without a
#   freshness verdict. That is what these tests exist to pin.

setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  SESS="python3 $SCRIPTS/fm-session.py"
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

@test "project emits typed documents and reports non-scalar values rather than coercing" {
  cd "$REPO"
  $SESS fact "a durable thing" --evidence "commit abc"
  $SESS measure "scalar metric" 26 --command "c" --scope src/a.sh
  $SESS measure "prose metric" "green everywhere" --command "c" --scope src/a.sh
  run $SESS project
  [ "$status" -eq 0 ]
  [[ "$output" == *'"@type": "Claim"'* ]]
  [[ "$output" == *'"@type": "Measurement"'* ]]
  # The scalar projects. The prose one is REPORTED rather than coerced into an
  # invented number -- note bats merges stderr into $output, so assert on the
  # report itself rather than on the absence of the value.
  [[ "$output" == *"26"* ]]
  [[ "$output" == *"SKIPPED"* ]]
  [[ "$output" == *"no projectable scalar"* ]]
  # and it must not have been smuggled into a Measurement document
  run bash -c "python3 $SCRIPTS/fm-session.py project 2>/dev/null | grep Measurement"
  [[ "$output" != *"green everywhere"* ]]
}

@test "project renders a Supersession carrying at and reason" {
  cd "$REPO"
  $SESS fact "first"
  $SESS supersede 1 "second" --reason "the tree changed"
  run $SESS project
  [ "$status" -eq 0 ]
  [[ "$output" == *'"@type": "Supersession"'* ]]
  [[ "$output" == *"the tree changed"* ]]
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
  export FOREMAN_SESSION_DB="$BATS_TEST_TMPDIR/shared/session.db"
  $SESS fact "recorded from the main worktree"
  git -C "$REPO" worktree add -q "$BATS_TEST_TMPDIR/wt" -b side
  main_root=$(python3 -c \
    "import runpy; print(runpy.run_path('$SCRIPTS/fm-session.py')['repo_root']())")
  cd "$BATS_TEST_TMPDIR/wt"
  worktree_root=$(python3 -c \
    "import runpy; print(runpy.run_path('$SCRIPTS/fm-session.py')['repo_root']())")
  [ "$main_root" = "$worktree_root" ]
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"recorded from the main worktree"* ]]
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

# B2. The projector and recover must describe the same live set. The projector
# read every row, so a retired measurement was exported as a live one.
@test "project drops a retired measurement and records the retirement" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  $SESS measure "suite pass count" "11" --command "bats t.bats" --scope src/a.sh
  $SESS retire 1 --by 2 --reason "host state poisoned the first reading"
  run bash -c "python3 $SCRIPTS/fm-session.py project 2>/dev/null"
  [ "$status" -eq 0 ]
  # the live set agrees with recover: 11 projects, 26 does not
  [[ "$output" == *'"value": 11.0'* ]]
  [[ "$output" != *'"value": 26.0'* ]]
  # lossless, not merely filtered: the retirement itself is a document
  [[ "$output" == *'"@type": "Supersession"'* ]]
  [[ "$output" == *"Measurement/fm-measurement-1"* ]]
  [[ "$output" == *"Measurement/fm-measurement-2"* ]]
  [[ "$output" == *"host state poisoned the first reading"* ]]
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
  ! grep -q '"validity"' "$BATS_TEST_TMPDIR/a.ndjson"
}

@test "sidecar defaults beside FOREMAN_SESSION_DB" {
  cd "$REPO"
  export FOREMAN_SESSION_DB="$BATS_TEST_TMPDIR/nested/session.db"
  $SESS fact "travels beside the store"

  run $SESS sidecar
  [ "$status" -eq 0 ]
  [ -f "$BATS_TEST_TMPDIR/nested/session.ndjson" ]
}

@test "import-sidecar rebuilds a projection-equivalent empty store" {
  cd "$REPO"
  $SESS fact "old fact"
  $SESS supersede 1 "current fact" --reason "new evidence"
  $SESS measure "suite count" "26" --command "old command" --scope src/a.sh
  $SESS measure "suite count" "27" --command "new command" --scope src/a.sh
  $SESS retire 1 --by 2 --reason "rerun"
  $SESS obligation "blocked work" --blocker "waiting"
  $SESS sidecar --out "$BATS_TEST_TMPDIR/original.ndjson"

  export FOREMAN_SESSION_DB="$BATS_TEST_TMPDIR/imported/session.db"
  run $SESS import-sidecar "$BATS_TEST_TMPDIR/original.ndjson"
  [ "$status" -eq 0 ]
  $SESS sidecar --out "$BATS_TEST_TMPDIR/rebuilt.ndjson"
  cmp "$BATS_TEST_TMPDIR/original.ndjson" "$BATS_TEST_TMPDIR/rebuilt.ndjson"
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

@test "import-sidecar checks for rows after acquiring the write lock" {
  cd "$REPO"
  $SESS fact "source fact"
  $SESS sidecar --out "$BATS_TEST_TMPDIR/source.ndjson"

  target="$BATS_TEST_TMPDIR/concurrent/session.db"
  run python3 - "$SCRIPTS/fm-session.py" "$target" \
    "$BATS_TEST_TMPDIR/source.ndjson" <<'PY'
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("fm_session", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
conn = module.connect(sys.argv[2])
statements = []
conn.set_trace_callback(statements.append)
module.import_sidecar(conn, sys.argv[3])
begin = next(i for i, sql in enumerate(statements) if sql == "BEGIN IMMEDIATE")
row_check = next(
    i for i, sql in enumerate(statements)
    if sql.startswith("SELECT 1 FROM sessions")
)
raise SystemExit(0 if begin < row_check else 1)
PY
  [ "$status" -eq 0 ]
}

@test "import-sidecar rejects duplicate supersessions without replacing the target" {
  cd "$REPO"
  sidecar="$BATS_TEST_TMPDIR/duplicate.ndjson"
  printf '%s\n' \
    '{"@type":"Measurement","measurement_key":"fm-measurement-2","metric":"m","subject":null,"value":2.0,"at":"now","about":[]}' \
    '{"@type":"Measurement","measurement_key":"fm-measurement-3","metric":"m","subject":null,"value":3.0,"at":"now","about":[]}' \
    '{"@type":"Supersession","old":"Measurement/fm-measurement-1","new":"Measurement/fm-measurement-2","at":"now","reason":"first"}' \
    '{"@type":"Supersession","old":"Measurement/fm-measurement-1","new":"Measurement/fm-measurement-3","at":"now","reason":"second"}' > "$sidecar"
  $SESS fact "target fact"

  run $SESS import-sidecar "$sidecar" --force
  [ "$status" -eq 2 ]
  [[ "$output" == *"duplicate supersession"* ]]
  run $SESS recover
  [[ "$output" == *"target fact"* ]]
}

@test "import-sidecar rejects supersession cycles without replacing the target" {
  cd "$REPO"
  sidecar="$BATS_TEST_TMPDIR/cycle.ndjson"
  printf '%s\n' \
    '{"@type":"Supersession","old":"Measurement/fm-measurement-1","new":"Measurement/fm-measurement-2","at":"now","reason":"forward"}' \
    '{"@type":"Supersession","old":"Measurement/fm-measurement-2","new":"Measurement/fm-measurement-1","at":"now","reason":"back"}' > "$sidecar"
  $SESS fact "target fact"

  run $SESS import-sidecar "$sidecar" --force
  [ "$status" -eq 2 ]
  [[ "$output" == *"supersession cycle"* ]]
  run $SESS recover
  [[ "$output" == *"target fact"* ]]
}
