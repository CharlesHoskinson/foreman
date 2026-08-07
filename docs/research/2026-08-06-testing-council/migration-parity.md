# Council report — testing a port so the port is provably faithful

**Lens:** migration parity. Proving new code matches old code.
**Repo read:** `/root/fm-hyg/foreman` @ `6bfb59b` (+ `7bd0428` on
`fix/repo-hygiene-typescript-port`).

---

## 0. What the ground actually says

I ran things rather than reading about them. Four measurements frame everything
below.

**(a) The lane-queue tests fail, and they fail for a reason nobody wrote down.**
`bats tests/lane-queue.bats` on this host, today: `1..23`, **14 pass, 2 skip, 7
fail**. All seven failures are in `add`.

The received story is "behaviour was deleted." That is *not* what happened. The
behaviour is present in TypeScript — `posixQuote`, `pwshQuote`, the
`daemon.shell_command` closed YAML parse, the unclassifiable-override refusal,
and `LANE_QUEUE_FORCE_MISSING` degraded direct-spawn all live in
`packages/orchestration/src/queue-admission.ts`. What changed is the **argv
contract**:

```
old:  lane-queue.sh add GROUP -- CMD...
new:  lane-queue.sh add GROUP --endstop-state-root ABS --endstop-contract-id ID \
        --endstop-contract-sha SHA256 --endstop-action ACTION \
        --endstop-candidate-sha SHA256 -- CMD...
```

`parseQueueArgv` in `packages/orchestration/src/queue-cli.ts` hard-positions
those five flags at `args[2..12]`. Every old-form invocation now returns
`usage`, exit 2. Confirmed directly:

```
$ bash skills/foreman/scripts/lane-queue.sh add grok -- echo hi ; echo $?
usage: lane-queue.sh ensure|add GROUP --endstop-state-root ABS ...
2
```

This was a **deliberate** change from
`openspec/changes/bounded-execution-terminal-policy` — endstop contract binding
at the dispatch boundary. It is documented in `skills/foreman/SKILL.md:245`. It
is a good change. But it is recorded in exactly one place, and three other
places that encode the same contract were never updated:

| Site | State |
| --- | --- |
| `skills/foreman/SKILL.md:245` | new form ✅ |
| `docs/USAGE.md:296-297` | **old form**, and still advertises the `claude` group that T7 removed |
| `packages/orchestration/src/queue-admission.ts:639` | prints **the old usage string** — the port disagrees with itself |
| `tests/lane-queue.bats` (7 tests) | **old form** — hence red |
| `tests/baseline.tsv` | `tests/lane-queue.bats  21` — stale by 7 |

So the cautionary tale is sharper and more useful than "tests left behind." It
is: **a port silently widened a required-argument contract, and the four
artifacts that encode that contract drifted apart with nothing to notice.** Fix
the rule for *that* and you also fix the weaker version.

**(b) Nothing was ever going to notice.** `tests/run.sh:15` —
`GATE_MODE="${TEST_GATE_MODE:-shadow}"`. `tools/ci-local.sh:238` re-defaults it
to `shadow`, and `gate_bats` is only *called* when `FOREMAN_CI_BATS=1`. The
repo's own session store already knows this and says so (`.foreman/session.ndjson`
fact id 34: *"The bats gate is OFF, not shadow, and turning it on needs TWO
changes"*). The pass-baseline in `tests/baseline.tsv` is a genuinely good
mechanism pointed at a disarmed trigger.

**(c) The repo-hygiene port is the model to copy — with one hole.**
`7bd0428` turned a 143-line shell rule engine into a 9-line adapter, 501 lines
of `packages/policy/src/repo-hygiene.ts`, and 286 lines of unit test. It
ported *every message string verbatim*, ran old and new side by side on the real
checkout, and printed the diff in the commit message. That is textbook. The
hole: **the entire parity argument is prose in a commit message.** Nothing
re-runs it. `git log` is not a gate. Meanwhile `tools/repo-hygiene.sh` never had
a `.bats` file at all, so unlike lane-queue there was no test to go red — parity
here rests on one human's one-time observation, forever.

**(d) fm-session.py is bigger than its tests and smaller than its callers.**
1090 lines, 13 subcommands. `tests/session.bats` is 565 lines / 33 tests and
hardcodes `SESS="python3 $SCRIPTS/fm-session.py"` in `setup()` — no indirection,
so the identical suite *cannot* be aimed at a TypeScript replacement. Coverage is
badly skewed:

| subcommand | assertions in session.bats | non-devlog repo references |
| --- | --- | --- |
| `measure` | 24 | 13 |
| `recover` | 23 | 18 |
| `fact` | 15 | 5 |
| `sidecar` | 9 | 1 |
| `retire` | 8 | 12 |
| `import-sidecar` | 6 | 1 |
| `freshness` | 4 | 1 |
| `obligation` | 3 | 3 |
| `supersede` | 3 | 4 |
| `begin` / `project` | 2 | 1 / 6 |
| `close` | 1 | 22 |
| **`end`** | **0** | **5** |

`close` is the most-called subcommand in the repo and has one assertion. `end`
has **zero** — and it is invoked from `skills/checkpoint/SKILL.md:101`, i.e. from
a shipped skill. A port driven by `session.bats` would ship `end` untested and
`close` effectively untested.

The rest of this report is written against those four facts.

---

## 1. Characterization / golden-master: record reality before you touch it

### The rule

> **R1 — No port begins until the old implementation has been recorded.**
> The recording is a tracked, machine-replayable artifact produced *by executing
> the old code*, committed in its own commit, before one line of the replacement
> exists. The commit that adds the recording must not modify the thing being
> recorded.

Mechanically checkable: `git show --stat <recording-commit>` touches only paths
under `tests/parity/<unit>/`. A pre-merge check can assert that the parity
fixture directory for a unit exists and predates the port commit.

### What a recording is, concretely, for a CLI

Not a screenshot of stdout. A **transcript**: an executable case list plus, per
case, the full observable surface. For `fm-session.py` the observable surface is
larger than stdout, and this is where ports usually go wrong. Record all six:

1. `exit code`
2. `stdout` bytes (normalized — see below)
3. `stderr` bytes
4. **the sqlite store after the call**, captured as the tool's own NDJSON sidecar
   (`fm-session.py sidecar`) rather than as a `.db` binary — sidecar is already
   deterministic, sorted, and diffable, and `tests/session.bats:255` already pins
   that it is
5. **files created/removed** under `$FOREMAN_SESSION_DB`'s directory and
   `.foreman/`
6. **the git commands invoked**, via a PATH shim recording `argv` — because
   `measurement_validity()` shells out to `git rev-list` and the freshness
   verdict *is* the product

Item 4 is the important one and it is nearly free here: the sidecar format
(`{"format":"foreman-session-sidecar","format_version":1}` + one
`{"table":...,"row":{...}}` per line) is exactly a golden-master serialization
that the tool already ships. Use it. Do not invent a parity serializer.

### Where the corpus comes from

Three tiers, in priority order:

- **Tier A — the real store.** `.foreman/session.ndjson` is tracked and has 761
  lines of genuine production rows: superseded facts, retired measurements,
  closed obligations, null vs non-null `supersede_reason`. That is a better
  fixture than anything anyone will invent. Freeze a copy at
  `tests/parity/session/corpus.ndjson` and drive every read-path subcommand
  (`recover`, `project`, `freshness`, `sidecar`) against it.
- **Tier B — the existing bats cases, replayed and captured.** The 33 cases in
  `session.bats` encode hard-won knowledge (the `--git-common-dir` worktree fix,
  `measure` refusing without `--scope`, `retire` refusing self-supersession).
  Run them under recording and keep the transcripts, so the port is pinned to the
  *bytes* they produced, not just to their substring assertions. `session.bats`
  asserts `[[ "$output" == *"STALE=0"* ]]`; the transcript pins the whole line.
- **Tier C — adversarial cases the old code never saw.** Empty store, unicode in
  `--evidence`, a fact statement containing a newline, a scope path with a space,
  `import-sidecar` on a truncated file, a measurement whose `measured_sha` no
  longer exists after a rebase. Record what Python *actually does* — including
  crashing — and then decide (§3) whether the port copies it.

### Determinism: the part everyone under-plans

`fm-session.py` has four non-deterministic inputs. All four must be pinned at
record time and at replay time, or the golden master rots in a day:

| Source | Line | Pin |
| --- | --- | --- |
| `now_iso()` | 139 | inject a clock; env `FOREMAN_FAKE_NOW` at record time, same at replay |
| `mint_session_id()` | 315 | `time.gmtime()` + `os.urandom(3)` — seed or inject |
| `git_sha()` / `repo_root()` | 160/143 | build the fixture repo with fixed author, date, and message so SHAs are stable |
| sqlite `AUTOINCREMENT` ids | schema | already deterministic given a fixed call order — assert it |

Cost: injecting a clock and an id source into a 1090-line Python file you are
about to delete feels like waste. It is not: it is a ~30-line change to the
*old* file that buys byte-exact transcripts. Budget half a day. Refuse to
normalize with regexes at compare time — every `s/[0-9a-f]{40}/SHA/` in a parity
harness is a place a real difference hides.

### Cost

- Harness: 1–2 days for the recorder + replayer (shared across every future port).
- Per-unit recording: 0.5–1 day for fm-session, hours for a smaller unit.
- Ongoing: the transcripts are large and churn on any *intended* output change.
  Accept that; a noisy diff on an intended change is the mechanism working.

---

## 2. Differential testing: same input, both binaries, diff

### When it is worth it

Differential testing earns its harness when **at least two** of these hold:

- the unit's output is machine-consumed (another script parses it),
- the unit owns durable state that outlives the process,
- the input space is combinatorial enough that a hand-written case list will
  provably miss cases,
- old and new must **coexist** for a release or more.

`fm-session.py` scores 4/4 and is the strongest candidate in the repo.
`tools/repo-hygiene.sh` scored maybe 2/4 and, correctly, got a one-shot manual
A/B instead. Do not build a differential rig for a 143-line rule engine; do build
one for a 13-subcommand CLI that owns the project's memory.

### The rule

> **R2 — For any ported unit with durable state, `old` and `new` must be
> selectable by a single environment variable, and the parity job runs the same
> case list through both and diffs all six observables.**

Concretely, the first change to `tests/session.bats` is one line:

```bash
# tests/session.bats setup()
SESS="${FM_SESSION_CMD:-python3 $SCRIPTS/fm-session.py}"
```

That single edit converts the existing 33-test suite from a Python test into a
**conformance suite**, runnable as `FM_SESSION_CMD="node .../session.js" bats
tests/session.bats`. It costs one line and it is the highest-leverage change
available today. It is also the thing that did not exist for lane-queue: had
`tests/lane-queue.bats` been parameterized on the *invocation form*, the argv
widening would have been a visible, named decision instead of seven red tests.

### How it works for a sqlite + NDJSON CLI

The state ownership is what makes this tractable rather than hard. Run in
**lockstep**, not in parallel:

```
for case in corpus:
    reset()                      # fresh tmp repo, fresh empty store, fixed clock
    old_result = run(python3 fm-session.py, case)
    old_state  = run(python3 fm-session.py, "sidecar")     # canonical dump
    reset()
    new_result = run(node session.js, case)
    new_state  = run(node session.js,  "sidecar")
    diff(old_result, new_result); diff(old_state, new_state)
```

Four properties make this cheap and reliable here:

1. **Sidecar is the state oracle.** Never diff `session.db` bytes — sqlite page
   layout, freelists, and `VACUUM` timing differ between drivers for identical
   logical content. Diff the NDJSON. `session.bats:282` already pins that
   sidecar reads every table from one snapshot, so it is a complete dump.
2. **Cross-implementation round-trip is a free, very strong oracle.** Run
   `python3 fm-session.py sidecar` → `node session.js import-sidecar` → `node
   session.js sidecar` and require byte equality with the original; then the
   same in reverse. This catches type coercions (Python `float` vs JS `number`,
   `None` vs `null`, integer ids becoming strings) that a stdout diff will never
   surface. This is the single best test you can write for this port and it is
   about 20 lines.
3. **Sequences, not single calls.** State bugs live in ordering. Generate
   randomized command sequences from a small grammar (`begin`, `fact`, `measure`,
   `supersede`, `retire`, `obligation`, `close`, commit-to-repo, `recover`) with
   a seed printed on failure. A few thousand seeds overnight is worth more than
   a hundred hand-written cases, precisely because the interesting bugs are
   `retire`-after-`supersede`-after-`close` shapes nobody would write by hand.
4. **`recover` and `project` are pure functions of (store, git HEAD).** Diff them
   after every mutating step for free. Freshness is *computed at read time*
   (`measurement_validity`, line 322) — so the parity assertion must include a
   real commit that touches a measured scope, then re-`recover`. That transition
   is the load-bearing property of the whole store; it deserves a dedicated
   differential case, not a substring check.

### Retire the rig, deliberately

> **R2b — A differential rig has a stated end date in its own README: the release
> after which the old implementation is deleted.** Past that date, transcripts
> are frozen as ordinary golden-master fixtures and the old binary goes.

Otherwise you keep Python alive to test the thing that exists to delete Python,
and the release thesis ("one runtime, one language") quietly becomes false.

### Cost

- Lockstep runner: 2–3 days including the reset/clock plumbing.
- Sequence generator + shrinker: 2 days. Skip the shrinker at first; a printed
  seed plus a manual bisect is 80% of the value.
- Recurring: the rig requires `python3` in CI for the duration. That is a real
  and visible cost, which is exactly why R2b makes it expire.

---

## 3. What "faithful" must NOT mean

Bug-for-bug fidelity is not the goal and pretending otherwise produces a port
that is worse than the original — it inherits the defects *and* pays the
migration cost. Four categories where the port **should** diverge:

1. **Recorded bugs.** Python `except Exception: return Path.cwd()` in
   `repo_root()` silently fragments the store when `git` is missing. The port
   should fail loudly. That is a divergence and an improvement.
2. **Platform assumptions.** The shell/Python code is full of them, and the repo
   has already paid for this repeatedly (`tests/helpers.bash` wraps `jq` because
   Windows `jq.exe` emits CRLF; `12391ac` fixed credential profiles on Windows;
   `0266e56` tolerated a missing Windows directory-fsync barrier). Porting a
   POSIX-only assumption verbatim into TypeScript is not fidelity, it is
   importing a bug into a runtime that does not need it.
3. **Implementation strategy with identical semantics.** The repo-hygiene case:
   shell ran `git hash-object` per file (N subprocesses); the port reads index
   object ids via one `git ls-files -s`. Identical values, different cost. This
   should never even be called a divergence in the behavioural sense — but it
   **must** still be recorded, because it changes what happens for a file whose
   worktree content differs from its index content. That is a real, if narrow,
   semantic edge, and it is the kind of thing that is obvious on the day and
   invisible six months later.
4. **Dead surface.** See §5.

### The rule

> **R3 — Every known behavioural difference between old and new is an entry in a
> tracked, machine-readable divergence ledger. A parity diff that is not covered
> by a ledger entry fails the build. A ledger entry with no corresponding diff
> also fails the build.**

The second half matters as much as the first. A ledger that can accumulate
stale entries becomes a suppression file, and a suppression file is how a
regression gets waved through.

`tests/parity/<unit>/divergences.tsv` (or TOML — TSV matches
`tests/baseline.tsv` and `tests/skip-budget.tsv`, so it fits the house style):

```
id      case_id            kind        old_behaviour              new_behaviour             reason
D-001   repo_root_no_git   bugfix      falls back to cwd          exits 3, names git        silent store fragmentation, bugeventlog 2026-07-xx
D-002   hygiene_hash       strategy    git hash-object per file   git ls-files -s index id  N subprocesses -> 1; index id is what the repo stores
D-003   add_argv_contract  interface   add GROUP -- CMD           add GROUP --endstop-* --  endstop contract binding, bounded-execution-terminal-policy
```

Why this beats a commit message — and this is the specific gap in `7bd0428`,
which is otherwise the best port in the repo:

- a commit message is read once, by one person, on one day
- the ledger is **re-read by the parity job on every run**
- the ledger is **greppable by the next porter**, who otherwise re-derives the
  reasoning or, worse, "fixes" the divergence back
- an unexplained diff has one legal resolution: fix the port, or add a ledger
  entry with a reason someone signs. Both are decisions. Silence is not available.

The repo already has the shape of this and should reuse it rather than invent:
`ALLOWED_MODE_CHANGES` in `packages/policy/src/repo-hygiene.ts` is precisely a
divergence ledger — *path plus the reason it is not a regression*, printed with
the reason so a reader can judge the exemption rather than take it on trust.
Generalize that idea; do not build a second mechanism.

Enforcement is a ~50-line script and belongs in `tools/ci-local.sh` next to the
other gates.

---

## 4. The lane-queue rule: what must be true before a file becomes an adapter

The architecture policy already enforces the *shape* of an adapter with real
rigor — `packages/policy/src/architecture-adapter.ts` defines a closed
six/eight-production grammar, rejects `$NODE`/`$BUNDLE` smuggling, and pins two
migration exceptions (`lane-run.sh`, `lane-supervise.sh`) by full-body SHA-256.
That machinery is excellent and it is aimed at the wrong axis. It proves the
adapter is *nine safe lines*. It says nothing about whether the 583 lines that
vanished still exist somewhere.

### The rule

> **R4 — Adapter reduction gate.** A tracked `.sh`/`.py` file may be reduced to a
> thin adapter only in a commit that satisfies all five:
>
> 1. **Every test that exercised the old file passes against the new one, or is
>    re-pointed in the same commit.** Not deleted. Not skipped. Re-pointed —
>    which means the suite is parameterized on the invocation (`FM_SESSION_CMD`,
>    `LANE_QUEUE_CMD`), so re-pointing is an env var and not a rewrite.
> 2. **Net test count does not decrease.** Assertion count, ideally; test count
>    at minimum. Mechanically checkable from `tests/baseline.tsv`.
> 3. **The pass-baseline for every affected `.bats` file is updated in the same
>    commit, and the gate that reads it is armed.** Today `lane-queue.bats` is
>    `21` in `tests/baseline.tsv` while the truth is 14 — a number that is only
>    wrong because nothing checks it.
> 4. **Divergence ledger entries exist for every intended behaviour or interface
>    change** (R3), and every red test is attributable to a ledger entry.
> 5. **A caller sweep proves no in-repo caller still uses the old contract.**
>    `docs/USAGE.md:296` and `queue-admission.ts:639` both still speak the old
>    lane-queue argv. Both would have failed this check.

### The mechanical check

This is not a code review checklist; it is a script. Pre-commit / CI:

```
for each file in the diff whose line count dropped by >70% and whose new body
matches the thin-adapter grammar:
    unit := adapter_unit_name(file)
    require tests/parity/<unit>/ exists and is non-empty         # R1
    require every tests/*.bats naming <file> is green            # R4.1
    require baseline delta for those files is >= 0               # R4.2
    require tests/parity/<unit>/divergences.tsv covers each diff # R3, R4.4
    require no tracked non-devlog file outside <unit> matches the
            old invocation grammar                               # R4.5
```

`architecture-adapter.ts` already detects "this file is now a thin adapter" —
that classifier is the trigger. The gate is the missing consequent.

### Arm the trigger, first

None of R4 matters while the bats gate is off. Ordered, and each step is small:

1. Remove the `FOREMAN_CI_BATS=1` guard so `gate_bats` is actually called
   (`tools/ci-local.sh:344`).
2. Fix or ledger the 7 lane-queue failures. They are a two-hour job: re-point the
   6 old-form `add` cases to the endstop form and add one new case asserting that
   the *old* form is now rejected with exit 2 — that last test is the ledger
   entry made executable.
3. Refresh `tests/baseline.tsv` from a green run.
4. Flip `TEST_GATE_MODE` to `enforce`. The baseline + skip-budget mechanism then
   does what it was built to do.

Steps 1–4 are the single highest-value thing on this list, because every other
rule here degrades to a suggestion without them.

### Cost

The reduction gate adds real friction: a port that would have taken a day now
takes a day plus the re-pointing. That friction is the point — it is exactly the
work that lane-queue skipped, and the repo has been carrying the debt since
`a1e0dcf` on 2026-08-04. Also expect one bad week where the gate is enforcing and
several suites are red; budget it as migration work, not as an interruption.

---

## 5. Shrinking the surface honestly

Porting 13 subcommands when 10 are live is a 30% waste, and worse, it ports dead
code into the language you intend to keep. But "I couldn't find a caller" is not
evidence, and retiring on that basis is how you discover a caller in production.

### The rule

> **R5 — A subcommand may be retired instead of ported only with three
> independent negative results plus one positive:**
>
> 1. **Static:** no reference in tracked files outside `devlog/` and archived
>    evidence. Recorded as the exact command that produced the result, so it is
>    re-runnable — not "I grepped."
> 2. **Documentary:** no reference in any shipped `SKILL.md`, `docs/USAGE.md`,
>    `README.md`, or installed plugin manifest. A skill is a caller. This is
>    where `end` fails: `skills/checkpoint/SKILL.md:101` invokes it.
> 3. **Observational:** a deprecation period during which the old
>    implementation logs every invocation, and the log shows zero uses over a
>    defined window across all known hosts. For this repo that window must span
>    the multi-host reality already recorded in the session store (a Windows
>    checkout and a WSL checkout that diverge) — a single-host quiet week proves
>    single-host quiet.
> 4. **Positive:** the port implements the subcommand as an explicit refusal —
>    exit non-zero, naming the retirement and the commit that decided it — rather
>    than as a missing command whose error is a generic usage string. A caller
>    that surfaces later then gets a diagnosis instead of a puzzle.

### Instrumenting for evidence 3 is cheap here

`fm-session.py` already has one obvious hook point: `main()` dispatch. Ten lines
appending `{ts, subcommand, argv_shape, cwd, host}` to
`$FOREMAN_HOME/usage.ndjson` gives real telemetry. Add it **before** the port
starts, in the same commit as the R1 recording. Then the retirement decision is
made on data collected during the port rather than on a guess made after it.

This is the piece most teams skip and it is the cheapest of the three negatives.

### What this repo would find

`end` is the interesting case, and it cuts the opposite way from the naive read:
zero assertions in `session.bats`, so a coverage-driven porter might call it dead
— but it has five references including a shipped skill
(`skills/checkpoint/SKILL.md:101`) and a design doc that gives it a future role
(`docs/design/session-store-ontology-links.md:137`, projecting a closed session's
rows). It must be ported *and* it needs tests it has never had. Meanwhile
`sidecar`/`import-sidecar` have 15 combined assertions and 2 non-devlog callers —
they look low-traffic by reference count, but they are the disaster-recovery path
and the cross-implementation oracle from §2. Neither is a retirement candidate.

The honest conclusion for fm-session is that **the surface does not shrink**; it
is 13 out of 13. Recommend saying so explicitly in the port's design doc, with
the table, rather than leaving the question open — because an unstated
"we'll drop the unused ones" is how `end` gets quietly lost.

### Cost

Evidence 3 costs a release cycle of latency. That is a real schedule cost and the
right response is to start the usage logging *now*, before the port, so the
window elapses during work you were doing anyway.

---

## 6. Recommendation, ordered by value per day of effort

| # | Action | Effort | Why first |
| --- | --- | --- | --- |
| 1 | Arm the bats gate: drop `FOREMAN_CI_BATS`, fix/ledger the 7 lane-queue tests, refresh `baseline.tsv`, set `TEST_GATE_MODE=enforce` | ~2 days | Every other rule is advisory without it. The mechanisms already exist and are disarmed. |
| 2 | One-line indirection in `tests/session.bats`: `SESS="${FM_SESSION_CMD:-python3 ...}"` | ~1 hour | Converts 33 existing tests into a conformance suite. Highest leverage line in the migration. |
| 3 | `tests/parity/session/` — record transcripts + freeze the 761-line real sidecar corpus, before any TS is written | ~2 days | R1. Records reality while reality still exists. |
| 4 | Divergence ledger + enforcement script, retrofitted with the repo-hygiene `git hash-object` → index-id entry as D-001 | ~1 day | Turns `7bd0428`'s prose into a re-checked artifact; sets the precedent before fm-session needs it. |
| 5 | Usage logging in `fm-session.py` `main()` dispatch | ~2 hours | Starts the R5 observation window now, so it costs no schedule later. |
| 6 | Lockstep differential runner + cross-implementation sidecar round-trip | ~3 days | The strong oracle for the sqlite/NDJSON port. Expires at the release that deletes Python (R2b). |
| 7 | Adapter reduction gate wired to the existing `architecture-adapter.ts` classifier | ~2 days | Makes lane-queue structurally impossible to repeat. |

Items 1, 2, and 5 total under three days and would have prevented the entire
lane-queue situation.

### Three things not to do

- **Do not diff `session.db` bytes.** Diff the sidecar. sqlite page layout is not
  behaviour.
- **Do not normalize with regexes at compare time.** Inject the clock, the id
  source, and the git identity at record time. Every `s/SHA/…/` in a parity
  harness is a hiding place.
- **Do not let the divergence ledger become a suppression file.** Enforce both
  directions: an unexplained diff fails, *and* an unmatched ledger entry fails.
