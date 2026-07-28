# Start here — v0.2.9 Total GeorgeCall implementation

Written at the end of the planning session so tomorrow starts without
reconstruction. Branch: `plan/v029-graph-multivendor`. Nothing pushed.

## State

| | |
|---|---|
| Live packages | 31 — **26 validate strict**, 5 legacy do not |
| Formal models | 4 Quint specs, every result re-run by the architect |
| Research | 38 documents under `docs/research/vnext/` |
| Field log | 13 entries added, `bugeventlog.md` |
| Commits | 8 on the branch, no co-author trailers |

## Dispatch S1 first

**`crlf-extensionless-hardening` + `lock-primitive-hardening`.** Both now
validate. Both had their blockers resolved:

- The exec-bit scope is now an **inventory of 41 files**, derived mechanically,
  not one of the three contradictory numbers three documents carried.
- The lock package's `syscall` evidence definition is now **mechanism-relative**
  (`mkdir(2)`+`EEXIST` for the mutex, `flock(2)`+`EWOULDBLOCK` for flock). It
  previously demanded `EEXIST` of `flock`, which creates nothing — every
  acquisition on WSL and Linux would have refused.

Both root causes reproduce live, which is why these go first:

```text
uutils mkdir 0.8.0 : 57 mutual-exclusion violations / 15 rounds of 8 racers
GNU mkdir 9.7      : 0
flock (ext4/tmpfs/drvfs) : 0
```

`tests/eventlog.bats` "el_attempt_new under concurrent contention" fails today
with the exact `mv: cannot stat '...attempt.tmp'` signature.

## Then

`LANDING-ORDER.md` has the full 11-stage order with per-stage serialisation.
S2 (test infra + formal models) next, then S3 (WSL), S4 (telemetry — the spine;
no comparative claim in this release is computable before it lands).

**S2, S4, S5 and S9 carry open findings** from `FINAL-opus.md`: the 382-row
control inventory, the S4 ordering impossibility, `doctrine-reality-drift`
failing every later gate, and `GraphUpdate` — an artifact no package produces —
carrying a load-bearing requirement in `graph-store-port`. Read that report
before dispatching any of them.

## Decisions already made

`docs/research/vnext/DECISIONS-resolved.md` resolves: exec-bit scope (41 by
inventory), the four README ambiguities (all evidence-derived, offered for
ratification), `bin/lane.sh` (keep, land it through `evidence-contracts`), the
OpenSpec conformance debt (amend the README; migrate only what a stage needs —
`crlf-extensionless-hardening` was migrated because it is S1), and the S0
archives (done).

## The one judgement still open

**Keep auditing, or start implementing?**

Three audit rounds ran. The finding count fell 102 → 37, but the structural
*share* rose 75.5% → 78%, per-package yield tripled, and **11 of 12 closure
claims carried a new defect in the same package**. Three of four S1 blockers
were *introduced by the fix rounds*.

The clearest instance: a fix round repaired a lock predicate for Git-Bash and
reintroduced the identical flaw on WSL and Linux. Another round would likely do
the same again somewhere else.

The recommendation implied by dispatching S1 is that working code should
adjudicate the specs from here — every defect that mattered today was found by
running something, not by reading it. That is a risk judgement, and it is the
operator's to make.

## Uncommitted, deliberately

- **33 filemode changes** — the `install.sh` chmod dirt. Landing them would
  quietly perform the exec-bit fix inside an unrelated commit; that fix belongs
  to `crlf-extensionless-hardening`, gated.
- **`bin/lane.sh`** — product code created outside any package's scope. Lands
  through `evidence-contracts` per D3.

## Standing environment notes

- Everything runs in WSL at `/root/foreman`. `grok` and `agy` are
  authenticated; `codex` and `claude` are.
- Use `/usr/local/bin/openspec` — `npx openspec` resolves to a broken stub.
- **Never build a heredoc inline through `bash -lc`** with prose containing
  backticks or apostrophes. It truncates mid-content and executes prose as
  shell commands. This cost four incidents in one session. Write to `/tmp`
  from a file, then `tr -d '\r' < /tmp/f > target`.
- Grok stalled on 3 of 8 lanes. When dispatching it: `--always-approve
  --max-turns 30`, inline every fact, forbid the Read tool, and write the
  validity-critical file first.
