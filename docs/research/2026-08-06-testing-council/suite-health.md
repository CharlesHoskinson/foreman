# Council report — suite health, anti-patterns, and tests that lie

Lens: what makes a green tick mean something. Repository read at
`/root/fm-hyg/foreman`, HEAD `6bfb59b`.

Primary sources read in full: `openspec/changes/test-infrastructure-hardening/proposal.md`,
`AGENT_TRAPS.md`, the tail of `bugeventlog.md`, `tools/ci-local.sh`,
`tests/run.sh`, `tests/lib/preconditions.bash`, `.github/workflows/gates-linux.yml`,
`.github/workflows/gates-windows.yml`, and the four incident commits
(`b0835e3`, `5507c61`, `67a5a3b`, `39c555e`).

---

## 0. The finding that reframes the other five

Foreman has two test suites and exactly one of them is accountable.

| property | bats suite (`tests/*.bats`) | TypeScript suite (`packages/*/src/*.test.ts`) |
|---|---|---|
| per-file pass baseline | `tests/baseline.tsv`, 57 rows | none |
| per-platform skip budget | `tests/skip-budget.tsv`, 170 rows | none |
| bare skip refused | yes, `FAIL bare skip without reason` | n/a |
| planned-vs-observed TAP check | yes, `ERROR unparsable TAP` | none |
| per-file timeout | yes, `timeout --kill-after=30 600` | none |
| ERROR distinct from FAIL | yes | none |
| machine-readable slice report | yes, 14-column TSV, uploaded as an artifact | none |
| gating command | `bash tests/run.sh` | `node --import tsx --test <globs>`; exit code only |

All four defects named in this council's brief lived in the right-hand
column. That is not a coincidence. The left-hand column is one of the better
suite-health designs I have seen in a repository this size, and it is pointed
at 635 shell tests while 1,334 TypeScript tests — the ones that actually gate
`gates-linux` step 4 and `gates-windows` step 4 — run with no baseline, no
budget, no inventory, and no report.

Almost everything below is cheaper than it sounds because the mechanism
already exists in `tests/run.sh`. The work is mostly *pointing it at the other
suite*.

---

## 1. Assertions that can pass vacuously

### 1.1 What the `/repo` incident actually was

```ts
assert.ok(!JSON.stringify(result).includes("/repo"));
```

The failure is not "wrong string". It is a **negative assertion with no
demonstration that the matcher can ever see its needle.** `67a5a3b` fixed it
correctly:

```ts
function jsonEscaped(value: string): string { return JSON.stringify(value).slice(1, -1); }
assert.ok(!JSON.stringify(result).includes(jsonEscaped(REPO_ROOT)));
```

but the fixed form is still one careless edit from vacuity, because nothing in
the test asserts that `jsonEscaped(REPO_ROOT)` is a form that *would* be found
if the leak occurred. The commit message says as much: "still green, no longer
testing anything."

### 1.2 Mechanism: the inline positive control (do this first)

Every negative assertion goes through a helper that proves the matcher
discriminates, in the same test, on the same host, at the same moment:

```ts
// tests/support/negative.ts
/**
 * Assert `needle` is absent from `haystack`, having first proven the matcher
 * can detect `needle` when it IS present. A negative assertion whose matcher
 * cannot see its needle is vacuous, not passing.
 */
export function assertAbsentAndDetectable(
  haystack: string,
  needle: string,
  label: string,
): void {
  assert.ok(haystack.length > 0, `vacuous ${label}: nothing was produced`);
  assert.ok(needle.length > 0, `vacuous ${label}: empty needle`);
  const poisoned = haystack + needle;            // control arm
  assert.ok(poisoned.includes(needle), `matcher cannot detect ${label}`);
  assert.ok(!haystack.includes(needle), `${label} leaked`);
}
```

On Windows the original form fails the control arm loudly instead of passing
silently. Three lines of control per call site.

**Cost:** ~20 lines once, one import per file. Zero runtime cost. This is the
single cheapest thing in this report and it retires the entire incident class.

### 1.3 Mechanism: syntactically ban the raw form

`no-restricted-syntax` is a *syntactic* rule — it needs no type information, so
it does not touch the typescript-eslint/TS7 hazard the project has already hit:

```js
// eslint.config.mjs (root workspace — which currently runs no linter at all)
{
  files: ["**/*.test.ts"],
  rules: {
    "no-restricted-syntax": ["error",
      { selector: "CallExpression[callee.property.name='ok'] UnaryExpression[operator='!'] CallExpression[callee.property.name='includes']",
        message: "Bare negative substring assertion. Use assertAbsentAndDetectable()." },
      { selector: "CallExpression[callee.property.name=/^(notEqual|notDeepEqual|doesNotMatch)$/]",
        message: "Negative equality must state why the positive form would hold. Use the paired helper." },
    ],
  },
}
```

The root workspace has **no ESLint at all** (`components/council` has eslint 10
+ typescript-eslint 8.65; `package.json` at root has neither). That gap is why
this class survives in `packages/` and not in `components/council/`.

**Cost:** adding eslint + `@eslint/js` to the root workspace and one flat
config, ~half a day including the first cleanup pass. No type-aware linting, so
no TS7 parser risk.

### 1.4 Anchored tokens, not substrings — extend the rule to TypeScript

`AGENT_TRAPS.md` §3 rule 1 already says a success predicate binds to an
artifact and its content, never a substring. The Quint `grep -q "violation"`
incident is the shell instance. The TypeScript instance is
`assert.match(notes, /holder proceeded|LOCK_EX\|LOCK_NB/)` in
`tool-check-atomicity.test.ts` — an unanchored alternation over free-form
notes. Make the rule mechanical: **verdicts are compared with `assert.equal`
against an exported const, never matched with a regex.** Where a regex is
unavoidable it must be anchored (`/^…$/`) — enforceable with
`no-restricted-syntax` on `Literal[regex.pattern!=/^\^/]` inside `assert.match`.

**Cost:** low; mostly it forbids a shape rather than requiring new code.

### 1.5 Mutation testing — my opinion: not yet, and not repo-wide

Stryker over 77 test files / 1,334 tests would cost hours per run and would
mostly report mutants in pure serialization code nobody cares about. I would
**not** adopt it as a gate.

What I would do instead, in this order:

1. **Build the positive-control registry that is already specified and does not
   exist.** `tests/positive-control-registry.tsv`, `tests/lib/check-inventory.sh`,
   `tests/lib/positive-control.bash`, `tests/inject-regressions.sh` — every one
   of these is named in `test-infrastructure-hardening/proposal.md` and **none
   of them is on disk.** `ls` returns "No such file or directory" for all four.
   The mechanism the project designed to prevent exactly this week's failures
   was never built. That is the headline recommendation of this report.
2. **Then**, if a residual class remains, run Stryker *scoped* to the modules
   whose green means "safe" — `install-verify`, `credential-profile` identity,
   `secret-scan`, `destruction-guard`, `architecture-policy` — on
   `maintenance.yml`'s schedule, never on a PR.

**Cost of (2) if you take it:** Stryker + config ≈ 1 day; 20–40 min per
scheduled run for a scoped set; a permanent maintenance burden of mutant
triage. Justified only after (1) is in place, because (1) tells you *which*
checks matter.

### 1.6 The zero-denominator rule, applied at the assertion

`tests/run.sh` already renders `UNCOMPUTABLE` when a denominator is missing.
Push the same idea one level down: any test containing a loop, a filter, or a
guarded branch asserts its own denominator.

```ts
let observed = 0;
for (const c of cases) { if (!applies(c)) continue; observed++; assert.equal(gate(c)._tag, "Denied"); }
assert.ok(observed > 0, "vacuous: no case reached the assertion");
```

`AGENT_TRAPS.md` §2 records a criterion that was "satisfiable by never
instrumenting at all", with three sibling criteria as zero-denominator live
passes. This is that rule, in code, for one line.

---

## 2. Skips

### 2.1 Foreman's bats skip discipline is already correct; say so and copy it

`tests/run.sh` refuses a bare skip, records every skip reason into the slice
report, budgets skips per file *per platform*, and reports
`ERROR missing skip budget for <file> on <platform>` when a file is
unregistered. `tests/lib/preconditions.bash` gives five declarative
capability predicates that always skip with an actionable reason. Nothing in
this section improves on that design. Everything in it extends it.

### 2.2 The illegitimate skip in this repo is not a skip — it is a silent `return`

In the TypeScript suite there are **49 `{ skip: cond }` sites** (correct: node
reports these as `# SKIP` and increments `# skipped`) and **168 bare
`if (…) return;` statements inside test bodies**, of which at least these are
capability guards wearing a pass:

```
packages/orchestration/src/tool-check-atomicity.test.ts:637  if (process.platform === "win32") return;
packages/orchestration/src/tool-check-atomicity.test.ts:645  if (!existsSync(whichMkdir)) return;
packages/orchestration/src/tool-check-atomicity.test.ts:673  if (process.platform === "win32") return;
packages/orchestration/src/tool-check-atomicity.test.ts:720  if (!flockPath) return;
packages/event-log/src/run-journal.test.ts:1175             if (child.exitCode !== null …) return;
```

**A test that early-returns is reported as `ok`.** It is counted in
`# pass`. It is indistinguishable in every artifact from a test that ran and
asserted. This is the same shape as `codex exec` exiting 0 having written
nothing (`AGENT_TRAPS.md` §2), reproduced inside the test framework.

Worse, some of these are load-bearing: `tool-check-atomicity.test.ts:720`
returns silently when `flock` is not found, so on a host without `flock` the
test "live flock+strace can prove atomic" passes without probing anything —
and `flock` is precisely the primitive whose evidence definition already
caused an incident (`AGENT_TRAPS.md` §2, last row).

**Mechanism.** Ban `ReturnStatement` in a test body, syntactically:

```js
{ selector: "CallExpression[callee.name=/^(it|test)$/] > ArrowFunctionExpression ReturnStatement",
  message: "A test may not return early. Use { skip: reason } or t.skip(reason) so the skip is counted." }
```

Convert every real site to `{ skip: !flockPath && 'requires flock' }` — an
option object, evaluated at collection time, which is the right semantics for a
host capability. Roughly 20 genuine conversions.

**Cost:** the rule is 6 lines; the conversion is half a day; the 148 remaining
`return;` statements that are guard clauses in *helpers* rather than test
bodies are untouched because the selector is scoped to `it`/`test`.

### 2.3 A closed capability vocabulary, not free-text reasons

Free-text reasons cannot be counted, budgeted, or reconciled. Define the
vocabulary once and generate the reason from it:

```ts
export const CAP = {
  dir_identity_anchor: "requires O_DIRECTORY|O_NOFOLLOW plus /proc/self/fd",
  proc_self_fd:        "requires /proc/self/fd",
  unshare:             "requires unshare(CLONE_NEWPID)",
  symlink_priv:        "requires SeCreateSymbolicLinkPrivilege / symlink()",
  posix_mode_bits:     "requires POSIX mode bits and a live umask",
  strace:              "requires strace",
  flock:               "requires util-linux flock",
  non_root:            "requires an unprivileged user",
  fs_no_inode_reuse:   "requires a filesystem that does not reuse freed inodes",
} as const;
export const skipUnless = (ok: boolean, cap: keyof typeof CAP) =>
  ({ skip: ok ? false : CAP[cap] });
```

This is `tests/lib/preconditions.bash` for TypeScript, with the same
"never a bare skip" property, and it makes skips *groupable by capability*,
which is what §2.5 needs.

**Cost:** ~40 lines plus mechanical adoption. Enforce with a rule banning
string literals in the `skip:` position.

### 2.4 Point the existing policy engine at the TypeScript suite

I checked what `node --test --test-reporter=tap` actually emits, because
`tests/run.sh`'s parser anchors on `^ok` and node nests subtests under a suite:

```
    ok 5 - delete-tracked rejects malformed stdin with exit 1
    1..5
ok 1 - runCli
1..1
# tests 5
# suites 1
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

So the naive TAP-line parse would count **1** for a file containing **5** tests.
The correct parse target is the **trailing summary block**, which node emits
reliably and unambiguously.

Concretely, `tests/run-ts.sh`, modelled line-for-line on `tests/run.sh`:

- run `node --import tsx --test --test-reporter=tap <one file>` per file, under
  `timeout --kill-after=30 ${TEST_FILE_TIMEOUT_S:-600}`;
- parse `# tests`, `# pass`, `# fail`, `# skipped`, `# todo`, `# cancelled`;
- **assert `tests == pass + fail + skipped + todo`** — the analogue of run.sh's
  `planned != observed` check, and the thing that catches a file that silently
  stopped collecting tests;
- **treat `# cancelled > 0` and `# todo > 0` as ERROR, not pass.** Neither has
  any policy today. `todo` is a green tick with no assertion behind it;
- look up `packages/baseline.tsv` (`file<TAB>expected_passes`) and
  `packages/skip-budget.tsv` (`file<TAB>platform<TAB>permitted_skips`);
- emit the same 14-column slice TSV, uploaded by both workflows.

This is the highest-value item in this report after the positive-control
registry. `b0835e3`'s commit message reports "807 tests, 803 pass, 0 fail,
4 skipped" — a number held nowhere, checked by nothing, and true only of one
tree state at one moment (`AGENT_TRAPS.md` §12 rule 3).

**Cost:** half a day to a day. No new dependency. Reuses a parser that has been
in production since 2026-08-01 and has already converted one 31-minute hang
into a `TIMEOUT` verdict.

### 2.5 Every capability needs both polarities, and a meta-test to prove it

`packages/orchestration/src/supervisor-live-services.test.ts` already does this
right: sixteen tests are `{ skip: !anchorOk }` and **two are `{ skip: anchorOk }`**
(lines 263, 688) — the fail-closed path that must run precisely when the
capability is *absent*. That is the discipline that keeps a legitimate skip
legitimate: skipping the live path is fine because the degraded path is still
being exercised.

Make it mechanical. A meta-test reads the capability vocabulary and the
collected skip conditions and asserts that for every capability `C` used
anywhere, the suite contains at least one test guarded on `C` present and at
least one guarded on `C` absent. A capability with only one polarity is a
coverage hole announcing itself.

**Cost:** ~50 lines of meta-test, plus writing the missing negative-polarity
tests it finds — which is real work, but it is work you wanted done.

### 2.6 The inverted skip: a test that is green only because a capability is missing

This is the most dangerous variant and it is live in the tree today.
From `b0835e3`:

> `packages/launcher/src/supervise.test.ts` fails on any host where `unshare`
> succeeds. … The hosted runner denies unshare and skips that path, so CI never
> sees it.

A broken test is permanently green in CI because the runner lacks a capability.
No skip budget catches this, because nothing is skipped — the code path simply
is not taken. The same shape produced the ext4/tmpfs inode incident in reverse:
the test passed on the developer box because tmpfs never reuses inodes.

**Mechanism: a committed CI capability manifest, probed and reconciled.**
`ci-capabilities.tsv`, one row per job:

```
job            capability            expected
gates-linux    unshare               denied
gates-linux    proc_self_fd          present
gates-linux    symlink_priv          present
gates-linux    tmpdir_fs             ext4
gates-linux    fs_no_inode_reuse     false
gates-windows  proc_self_fd          absent
gates-windows  posix_mode_bits       absent
```

A ~50-line probe runs first in each job, measures each capability, and **fails
the job when reality diverges from the declaration.** Two consequences, both
of which this week needed:

1. "no runner in the matrix provides `unshare`" stops being an accident nobody
   noticed and becomes a committed row with an owner — visible in review, and a
   standing argument for adding a privileged job or a WSL self-hosted runner.
2. `tmpdir_fs` and `fs_no_inode_reuse` become *declared*, so the
   developer-box-vs-runner divergence that made the identity-swap tests pass
   for the wrong reason is a diff, not a mystery. Pin `TMPDIR` explicitly in
   both `tools/ci-local.sh` and the workflows so a local green and a CI green
   are claims about the same filesystem.

**Cost:** ~50 lines of probe, one TSV, ~20 lines per workflow. It is the second
mechanism I would build after the run-ts policy engine.

### 2.7 Skip budgets must be enforced, and today they are not

`tests/run.sh` defaults `TEST_GATE_MODE=shadow`, and `gates-linux.yml` says
explicitly:

```yaml
# Keep TEST_GATE_MODE unset: ci-local.sh defaults the bats gate to shadow.
```

so `RESULT SHADOW mode=shadow policy_failures=N exit=0`. A `.bats` file added
with no baseline row and no skip-budget row produces `ERROR missing pass
baseline` — and exit 0. `AGENT_TRAPS.md` §9 records that "eight packages
skipped this, and it is the cheapest tripwire in the repo", and that the
registered baseline disagreeing with the observed count is what caught the
sabotage-sentinel incident. The tripwire is armed in shadow.

**Split the mode.** `policy_failures` is currently one counter mixing two
different claims:

- **registration failures** — missing/duplicate/invalid baseline or budget row,
  bare skip. These are *hygiene*, deterministic, host-independent, and have no
  flakiness risk. **Enforce these now.**
- **threshold failures** — actual passes below baseline, actual skips above
  budget. These are host-sensitive. Keep in shadow until the three consecutive
  green runs that tag criterion 2 requires.

```sh
if (( registration_failures > 0 )); then
  printf 'RESULT FAIL registration_failures=%d\n' "$registration_failures"; exit 1
fi
```

**Cost:** ~15 lines in `tests/run.sh`. It converts the cheapest tripwire in the
repo from advisory to real without taking on any flakiness risk.

---

## 3. Fail-fast versus report-all

### 3.1 The answer is not one answer

Two questions get conflated under one name:

- **Within a single check**, fail fast. An assertion stops the test; a gate
  stops at its first violation and reports it. Continuing past a failed
  precondition produces cascading nonsense.
- **Across independent checks**, report all, unconditionally. A skipped step is
  indistinguishable from a passing step in the workflow summary. That is not a
  preference; it is the mechanism by which four defects stayed invisible for
  eleven runs.

`tools/ci-local.sh` gets this exactly right and its header says why:

> Gates run in order; every gate runs even if an early one fails, so one
> invocation reports everything.

The workflow then throws it away, twice over.

### 3.2 Two nested fail-fasts stand between the gate runner and the truth

`gates-linux.yml` has twelve sequential steps in a single job. GitHub aborts the
job at the first failing step. `tools/ci-local.sh` — the only report-all
component in the system — is **step 11**. It never ran.

Inside step 4, `npm run verify` is:

```
typecheck && test && verify-runtime && verify-register-doc && smoke:dst-0060
```

`&&`-chained, so a typecheck error hides the test result, a test failure hides
`verify-runtime`, and so on. Two credential-profile assertions failed here for
eleven consecutive runs; steps 5–12 never executed; the council preflight byte
anchor had been 420 bytes stale since `d60ebdc` and nobody could see it, because
the step that would have reported it was behind the step that was red.

### 3.3 What to do

**(a) Independent gates become independent jobs.** Split `gates-linux` into
`node-workspace`, `architecture-policy`, `council`, `shared-gates`, `bats`.
Jobs run in parallel and report independently; one red does not mask four
others.

*Cost, stated honestly:* provisioning is duplicated per job — quint, lychee,
nats, bun, codespell. Factor the install into a composite action under
`.github/actions/setup-gates/` and add `actions/cache` for the pinned
downloads. Expect roughly +6–10 total CI minutes and a larger workflow surface.
Set against eleven runs during which four defects were invisible, this is
cheap. **Do it.**

**(b) Rewrite `npm run verify` in the `ci-local.sh` shape.** Even after the job
split, step 4 runs five sub-verifications. Replace the `&&` chain with a small
runner:

```
VERIFY typecheck        PASS
VERIFY test             FAIL 2 failing (credential-profile.test.ts)
VERIFY verify-runtime   PASS
VERIFY verify-register  PASS
VERIFY smoke:dst-0060   PASS
VERIFY RESULT FAIL failed=1
```

*Cost:* ~40 lines. Do this regardless of (a); it is what makes one run of
step 4 report all five claims.

**(c) A step that did not run must be rendered, not omitted.** Add a final
`if: always()` step that writes every step's `outcome` to
`$GITHUB_STEP_SUMMARY`, with `skipped` rendered as `NOT RUN — NO EVIDENCE`.
Blank is currently read as fine. *Cost:* ~20 lines.

**(d) Abolish the "informational gate".** `tools/ci-local.sh`'s own header
records the exact pathology:

> Gates 6-8 were informational until 2026-08-01 and always printed PASS. Three
> gates that could not fail sat inside the gate runner itself.

A gate has exactly three outcomes — `PASS`, `FAIL`, `NOT-AVAILABLE` — and no
fourth. Gate 2 already models `NOT-AVAILABLE` correctly, and treats it as a
failure ("packages are UNVALIDATED"), which is right: an unrun check is not a
passed check. When findings are real but not yet actionable — gate 7's 45
markdownlint findings with 44 pending obligation 56 — the answer is a
**waiver with an expiry date** (§4.5), not a green tick. *Cost:* the waiver
mechanism, ~30 lines; and the honesty of putting a date on each deferral.

**(e) `continue-on-error` must be paired with an asserted artifact.** The
Windows bats probe learned this the expensive way:

> GitHub runs `shell: bash` as `bash --noprofile --norc -eo pipefail`, so a
> non-zero bats exit aborts this step BEFORE the line that reports it, and
> continue-on-error then hides the abort as non-fatal. Three runs logged the
> "=====" banner and no result at all.

Generalise it: a non-gating probe writes a machine-readable result file, and a
*gating* step asserts that file exists and parses. Otherwise "the probe
produced nothing" and "the probe produced a clean result" are the same
observation — the `codex exec` failure again, in YAML.

**(f) Order gates by independence of signal, not by cost.** This only matters
if some gates still cannot be split; once every gate runs, ordering is
cosmetic. Resist the instinct to put the cheap gate first "to fail fast" — that
instinct is what put a slow TypeScript suite in front of a fast council gate
and hid it for eleven runs.

---

## 4. Frozen constants and golden values

### 4.1 Inventory of what is frozen here

| constant | where | how it rots |
|---|---|---|
| `CLEAN_PREFLIGHT_BYTE_COUNT`, `CLEAN_PREFLIGHT_SHA256` | `components/council/packages/runtime-node/test/preflight-cli.test.ts` | hand-written, drifted 420 bytes over three reviewed commits |
| per-artifact `byteLength` + `sha256` (16 artifacts) | `skills/foreman/runtime/manifest.json` | **cannot rot** — generated by `scripts/build-runtime.ts`, verified by `verify-runtime.ts` |
| `byteLength: 5359` + sha256 | `scripts/verify-runtime.ts:754` | hand-written fixture constant |
| expected `dist/` file list | `scripts/verify-runtime.ts` | hand-written array |
| download digests (quint, lychee, nats-server, nats) | `.github/workflows/gates-linux.yml` | supply-chain pins — correct to freeze, correct to fail on drift |
| pass baselines (57 rows), skip budgets (170 rows) | `tests/baseline.tsv`, `tests/skip-budget.tsv` | inventories; go stale by omission, currently in shadow mode |
| three dependency records | `env/reference-manifest.toml`, `env/tool-check.sh`, `env/bootstrap-wsl.sh` | reconciled by `dependencies/check-drift.sh` — the right pattern already applied |

Note the asymmetry. `manifest.json` is the one frozen artifact that has never
rotted, and the reason is structural: **it is generated by the build and the
build runs in the gate.** Nothing else in the table has that property.

### 4.2 Rule: never hand-write a derived constant

A byte count and a digest of a build output are *derived*. Writing them by hand
guarantees they encode a moment rather than a fact.

Move `CLEAN_PREFLIGHT_BYTE_COUNT` / `CLEAN_PREFLIGHT_SHA256` out of the test
and into a lockfile written by `pnpm build`:

```json
// components/council/packages/runtime-node/preflight-bundle.lock.json
{
  "bytes": 846014,
  "sha256": "d782ad5bd88f…",
  "sourceTree": "8032c59…",
  "generatedBy": "pnpm build"
}
```

The test reads the lockfile. The gate runs `pnpm build && git diff --exit-code
-- preflight-bundle.lock.json`. Now a source change that moves the bundle
produces a lockfile diff **in the same commit**, reviewed by the person who
caused it, with the byte delta visible in the PR — instead of a red test
weeks later in an unrelated branch.

**Cost:** ~30 lines in the build script, one gate line. Retires this class
permanently for every derived constant, including the `dist/` file list in
`verify-runtime.ts` (which should be read from the manifest, not restated).

### 4.3 Bind every anchor to its provenance

The comment said the anchor was taken "at 7aabc73". Nothing checked that. The
failure message was `expected 846014 to be 845594` — a number, with no
diagnosis, which is why the first instinct is to suspect the local branch.

Record the provenance in the lockfile (`sourceTree` above) and have the test
fail with it:

```
preflight bundle identity anchor is stale.
  anchored at tree 7aabc73 (845_594 bytes)
  current tree 8032c59 (846_014 bytes)
  3 commits touched components/council/packages since the anchor
  run `pnpm build` and review the lockfile diff
```

**Cost:** ~5 lines. Best value-per-line in this report. It converts "someone
broke something" into "the anchor is behind; here is by how much and since
when."

### 4.4 Delete proxy assertions whose stated purpose is a different property

The re-pin commit is unusually candid about what happened:

> the property this test actually exists to protect was verified intact:
> `PREFLIGHT_FORBIDDEN` still has zero matches in the bundle … The comment
> itself says a size cap alone is insufficient and names this as the real
> guarantee.

So the byte count was a *proxy* for isolation. It is a bad proxy in both
directions: it fails on every legitimate edit, and it passes on any leak that
happens not to change the size. Split it into three assertions with three
distinct purposes, none of which rots on an ordinary edit:

1. **Isolation** — `PREFLIGHT_FORBIDDEN` has zero matches. The real property.
2. **Reproducibility** — the digest matches the generated lockfile (§4.2).
3. **Size regression** — a *bound* (`bytes < 1_200_000`), not an equality.

**Cost: negative.** This removes maintenance rather than adding it. Apply the
same audit to every remaining equality-on-a-derived-number in the tree.

### 4.5 Waivers with expiry dates, to replace "informational"

Any anchor or gate deliberately held at a value known to be temporarily wrong
gets a row:

```
# tools/waivers.tsv
id                      owner              expires_on   reason
docs.markdownlint       obligation-56      2026-09-15   44 findings pending scope decision
bats.windows            obligation-60      2026-10-01   suite has never executed on Windows
```

The gate reads the waiver, reports `FAIL (waived until 2026-09-15)`, and
**fails hard once the date passes.** This is what lets you stop lying with
green ticks without blocking the release today. `gates-windows.yml`'s
`FOREMAN_CI_BATS: "0"` comment is already a beautifully argued waiver in prose;
it just has no expiry and no mechanism.

**Cost:** ~30 lines of parsing plus the discipline of choosing a date. The date
is the whole point — an undated deferral is indistinguishable from a decision.

### 4.6 Inventories are checked in both directions, and the check must bite

`tests/run.sh` already errors on a missing row *and* on a duplicate row — both
directions. The proposal extends this correctly to the positive-control
registry: fail on an inventory member with no row, on a row whose check no
longer exists, **and on an empty inventory** (the check that catches the
sweeper itself breaking). That third clause is the one people forget and the
one that catches the "37 regex artifacts" and "grep returns 7 lines, all
historical" failures in `AGENT_TRAPS.md` §2 and §15.

Add one more clause the proposal does not state: **compare sets, not counts.**
`AGENT_TRAPS.md` §15 records "requirements 10 → 10, scenarios 27 → 27" while 22
of 27 scenarios had been *replaced*. An inventory check that compares
cardinality is a vacuous inventory check.

---

## 5. The test that has never failed

### 5.1 The mechanism is designed, specified, and absent

`AGENT_TRAPS.md` §3 rule 2:

> Every checker must be demonstrated to FAIL against a known-bad input before
> it is trusted. A check never observed failing is not evidence.

`test-infrastructure-hardening/proposal.md` specifies the enforcement:
`tests/positive-control-registry.tsv` (six fields, keyed
`check_id = <path>::<check name>`), `tests/lib/check-inventory.sh` (full-tree
sweep at the commit under test), `tests/lib/positive-control.bash`,
`tests/inject-regressions.sh`, a fixtures directory holding the four measured
incidents, and a registry of predicates observed to be vacuous.

**None of these files exists.** This is the answer to the council's fifth
question: the project already knows how to know, and has not built it.

### 5.2 Scope it, or it will not get built

Do not require a registry row for every test. Requiring one for
`canonicalize()` round-trips is bureaucracy; requiring one for
`destruction-guard denies state_blocked` is the entire point.

**Registry scope: every gate, guard, refusal, predicate, and drift check** —
anything whose green means *safe* rather than *correct*. On this tree that is
roughly 150 checks across `tools/ci-local.sh` (10 gates), `tests/run.sh` (5
policy checks), `dependencies/check-drift.sh`, `tools/repo-hygiene.sh`,
`skills/foreman/scripts/docs-check.sh`, and the refusal predicates in
`packages/policy` and `packages/orchestration`. Not 1,969.

Keep the proposal's full-tree sweep — sweeping the diff would miss a check
promoted to gating by configuration alone, which is precisely how
`FOREMAN_CI_BATS` works.

### 5.3 Run the control every time, not annually

The proposal says "an annual/on-demand regression-injection run". I would argue
against that on this project's own evidence: an annual control has exactly the
rot profile of the anchor that went 420 bytes stale. Three tiers instead:

**Tier 1 — free, every run: paired polarity.** For a refusal predicate the
control is already sitting there:

```ts
assert.equal(gate(good)._tag, "Allowed");
assert.equal(gate(knownBad)._tag, "Denied");
assert.equal(gate(knownBad).reason, "state_blocked");   // anchored token, not substring
```

Rule: every refusal predicate is asserted in both polarities in the same file,
and the registry row names the bad input. *Cost: near zero.*

**Tier 2 — cheap, per PR, affected slices only: injection against a copy.**
`tests/inject-regressions.sh` copies the tree to a tmpdir, applies
`tests/fixtures/regressions/<id>.patch`, runs **only the owning slice**, asserts
it goes red, and discards the copy. Never mutates the worktree — which directly
satisfies `AGENT_TRAPS.md` §9 ("a destructive proof is architect-run, or run
against a COPY outside the worktree") and removes the turn-boundary hazard that
left a sabotage sentinel in tracked source. *Cost: ~120 lines plus one patch
per defect class.*

**Tier 3 — scheduled: full injection sweep** over every registry row, on
`maintenance.yml`. *Cost: one workflow, minutes of runner time per week.*

Seed tier 2 and 3 with the four incidents from this week. They are already
written up in enough detail to become patches:

| id | patch | must turn red |
|---|---|---|
| `REG-001-abs-path-leak` | revert `jsonEscaped` to the raw `"/repo"` form | the leak assertion, on Windows |
| `REG-002-inode-reuse` | revert `swapDirIdentity` to delete-then-recreate | identity-swap tests, on ext4 |
| `REG-003-anchor-drift` | add 1 byte to the council preflight source | the bundle identity anchor |
| `REG-004-skipped-step` | make step 3 exit 1 | the summary must show steps 4–12 as `NOT RUN`, not blank |

`REG-004` is the important one: it is a positive control **for the CI topology
itself**, and it is the only mechanism that proves §3 actually works.

### 5.4 Record when each check was last observed red

Add `last_red_at` (commit + date) to the registry, written by the injection
harness. Report any check whose `last_red_at` predates the last N releases, or
whose registered bad input no longer produces red — the latter meaning either
the defect became impossible (delete the row, with a note) or the check quietly
stopped discriminating (the actual failure mode).

This is what turns "how do I know this test would catch it" from a belief into
a date. *Cost: one column and the harness writing it.*

### 5.5 The evidence shape already exists — make it mechanical

`bugeventlog.md` Events 28 and 29 are, structurally, perfect positive-control
records:

> RED evidence: `.harness/council-localization-r5-red.out` SHA-256
> `874b94d0…` (both named tests `not ok` against the prior helper).

Named tests, observed `not ok`, against the prior implementation, with a digest
over the evidence file. That is exactly the registry's `evidence` field. Today
it is produced by hand, by an architect who remembered. Make it the output of
`tests/lib/positive-control.bash` and it happens whether anyone remembers or
not — which is this project's own stated doctrine: rules enforced in code, not
by convention.

---

## 6. Adoption order and honest costs

| # | Mechanism | Cost | Retires |
|---|---|---|---|
| 1 | `tests/run-ts.sh` — point the existing policy engine at the TS suite; parse the `# tests/# pass/# fail/# skipped/# todo` block; add `packages/baseline.tsv` + `packages/skip-budget.tsv` | 0.5–1 day, no new deps | the unmonitored half of the suite, where all four incidents lived |
| 2 | Split `registration_failures` from `threshold_failures` in `tests/run.sh`; enforce registration now | ~15 lines | the cheapest tripwire in the repo, currently disarmed |
| 3 | Ban `return;` in test bodies (eslint `no-restricted-syntax`); convert ~20 sites to `{ skip: reason }` | 6-line rule + 0.5 day | capability skips wearing a green tick |
| 4 | `assertAbsentAndDetectable()` + ban the bare negative-substring form; add eslint to the root workspace | ~20 lines + 0.5 day | the `/repo` class |
| 5 | Split `gates-linux` into parallel jobs; rewrite `npm run verify` as a report-all runner; `NOT RUN` in the step summary | 1 day, +6–10 CI min/run | a red step hiding four defects for eleven runs |
| 6 | `ci-capabilities.tsv` — probe and reconcile per job; pin `TMPDIR` | ~50 lines + 20/workflow | tests green only because a capability is absent (`unshare`, tmpfs inodes) |
| 7 | Derived constants into build-generated lockfiles with `sourceTree` provenance; `git diff --exit-code` in the gate | ~30 lines each | the 420-byte class, permanently |
| 8 | Build the positive-control registry the proposal already specifies; scope it to ~150 gates/guards/predicates; tiers 1–3 | 1–2 days + backfill | "a check never observed failing is not evidence", enforced |
| 9 | `waivers.tsv` with expiry dates; abolish the informational gate | ~30 lines | permanently-green gates that cannot report red |
| 10 | Capability-polarity meta-test | ~50 lines + the tests it demands | one-sided capability coverage |
| — | Repo-wide mutation testing | hours/run + permanent triage burden | **Do not adopt.** Revisit only after #8, scoped to gate modules, on a schedule |

Two things to delete rather than build: `@vitest/coverage-v8` is a
`components/council` devDependency that is never configured in
`vitest.config.ts` and never invoked by `pnpm check` — either wire it to
per-file branch thresholds on the gate modules or remove it, because an
installed-and-unused quality tool is the same decoration as a gate that always
prints PASS. And `fast-check` is installed but used in exactly one file
(`components/council/packages/domain/test/budget.test.ts`); property tests over
the path-handling and canonical-JSON boundaries would have caught the
Windows-separator class outright, so this one is worth *expanding* rather than
deleting.

---

## 7. One paragraph for the architect

The failure class in this repository is not carelessness; the incident write-ups
are more rigorous than most projects' postmortems. It is that the rigour lives
in prose and in one suite, while the checks that gate the release live in
another suite with none of it. `tests/run.sh` already implements per-file
baselines, per-platform skip budgets, bare-skip refusal, planned-vs-observed
validation, `ERROR` distinct from `FAIL`, and `UNCOMPUTABLE` for missing
denominators — and it is pointed at 635 shell tests while 1,334 TypeScript tests
run on an exit code. Point it at the other suite, arm the registration checks
that are currently in shadow mode, and build the positive-control registry that
`test-infrastructure-hardening` specified and nobody wrote. Everything else in
this report is a refinement of those three.
