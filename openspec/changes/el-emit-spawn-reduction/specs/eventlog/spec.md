# Spec delta — eventlog `el_emit` spawn reduction

EARS-phrased requirements for the modified `el_emit`. These are **preservation**
requirements: the observable contract MUST NOT change; only the internal spawn
count is reduced. See `skills/foreman/references/five-part-spec.md` for phrasing.

## MODIFIED Requirement: el_emit emits one byte-identical JSON event line

`el_emit` SHALL append exactly one JSON object per successful call to
`<run_dir>/events.jsonl`, with the field set `{seq, ts, type, lane, commit,
payload}`, `commit` omitted when the empty string, produced by the single
existing `jq -cn` invocation, terminated by a single `\n`, and containing no
carriage-return (`\r`) bytes.

- WHEN `el_emit` builds the output line, it SHALL strip all `\r` bytes using the
  bash parameter expansion `${raw//$'\r'/}` instead of `printf '%s' "$raw" | tr
  -d '\r'`, and the resulting bytes SHALL be identical to the previous pipeline
  for every possible `$raw` value.
- WHILE stripping `\r`, `el_emit` SHALL NOT alter any other byte, and SHALL NOT
  strip `\n`.

#### Scenario: stored line has no carriage returns (eventlog.bats:99)
- WHEN one event is emitted
- THEN `tr -cd '\r' < events.jsonl | wc -c` SHALL be `0`.

#### Scenario: recorded fields are byte-exact (eventlog.bats:22)
- WHEN `el_emit run1 checkpoint lane-b '{"x":true}' abc123` runs
- THEN `jq -rc '[.seq,.type,.lane,.commit,(.payload.x)]|@csv'` SHALL be
  `1,"checkpoint","lane-b","abc123",true`.

## MODIFIED Requirement: el_emit assigns monotonic non-duplicate sequence numbers

`el_emit` SHALL read the previous sequence value, assign `prev+1`, and return the
assigned `seq` on stdout on success.

- WHEN reading the previous sequence, `el_emit` SHALL use an existence-guarded
  in-process read `[[ -f "$seqf" ]] && prev="$(<"$seqf")"` (with `prev`
  pre-initialised to `0`) instead of `$(cat "$seqf" 2>/dev/null || echo 0)`.
- WHERE the `.seq` file is missing OR empty, `el_emit` SHALL assign `seq = 1`
  (identical to the prior behaviour).
- The existence guard SHALL be by existence (`[[ -f ]]`), and the read SHALL NOT
  be folded into a form that defeats bash's no-fork `$(<file)` special case.
- The sequence **reservation** (`echo "$seq" > "$seqf.tmp" && mv "$seqf.tmp"
  "$seqf"`) SHALL remain unchanged, preserving atomic tmp+rename CAS semantics.

#### Scenario: incrementing seq returned (eventlog.bats:12)
- WHEN two events are emitted on a fresh run
- THEN the first returns `1` and the second returns `2`, and the log has 2 lines.

#### Scenario: concurrent emitters, unique 1..N seqs (eventlog.bats:77)
- WHEN 20 `el_emit` calls run concurrently on one run
- THEN all 20 lines land AND the seqs are exactly `1..20`, each unique.

#### Scenario: failed reserve preserves .seq (eventlog.bats:132)
- WHEN the reserve write is forced to fail
- THEN `.seq` is NOT truncated and the next emit resumes without a duplicate.

#### Scenario: append failure leaves a gap, never a duplicate (eventlog.bats:146)
- WHEN an append fails after the seq is reserved
- THEN the next successful emit skips that seq (gap), never repeats it.

## MODIFIED Requirement: el_emit ensures the run directory without a redundant spawn

`el_emit` SHALL ensure `<run_dir>` exists before acquiring the seq mutex, but
SHALL skip the `mkdir` spawn when the directory already exists.

- WHEN the run directory already exists, `el_emit` SHALL NOT spawn `mkdir`
  (guard: `[[ -d "$rd" ]] || mkdir -p "$rd"`).
- WHERE the run directory does not yet exist (no prior `el_init`, first emit, or
  concurrent first emit), `el_emit` SHALL create it via `mkdir -p` before the
  mutex, preserving the self-initialising behaviour and concurrency-safety of
  the current unconditional `mkdir -p`.
- `el_emit` SHALL compute the run directory inline as
  `rd="$FOREMAN_HOME/runs/$run"`, byte-identical to `run_dir "$run"`; the
  `run_dir` helper itself SHALL remain unchanged.

#### Scenario: emit without prior el_init still creates the log (eventlog.bats:12)
- WHEN `el_emit` is called on a run that was never `el_init`-ed
- THEN the run directory and `events.jsonl` are created and the emit succeeds.

#### Scenario: lock released on success and on failure (eventlog.bats:115)
- WHEN a successful emit and a jq-failing emit each complete
- THEN `<run_dir>/.seq.lock` does not exist afterward (mutex released on every
  path, unchanged).
