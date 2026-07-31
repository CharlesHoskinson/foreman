# AUDIT-opus.md — independent Opus audit of bfc8af4..bbb8ad8

Auditor: Claude Opus 5 (1M). Read-only. Worktree /root/fm-wt/s1-crlf,
branch s1/crlf-extensionless-hardening.

Baseline `git status --porcelain -uall` digest (before any auditor action):
`e74f2170b534c69d1ff5182f54f9c850cfeef524a3dfe1b1e3b7ac81fee32d92`

STATUS: COMPLETE. Verdict at the end.

## a) F1 fix — is the sweep complete? (fourth uncovered family?)

**The F1 fix is real but INCOMPLETE. The same defect class Sol found survives
in a different family.**

### What the rework actually changed

`tests/line-endings.bats:32-43` `exec_bit_inventory()` now reads:

```
git ls-files 'skills/foreman/scripts/**/*.sh' 'skills/foreman/scripts/*.sh'
git ls-files 'skills/superpowers/skills/subagent-driven-development/scripts/*'
git ls-files 'skills/superpowers/hooks/*'
```

Zero literal paths remain — the three-path SDD loop is gone. Confirmed by
reading the function and by `git show bbb8ad8 -- tests/line-endings.bats`.
Derived size on this index is exactly 41, matching the spec's measured set:

```
$ git ls-files 'skills/foreman/scripts/*.sh' | wc -l          -> 34
$ git ls-files 'skills/superpowers/skills/subagent-driven-development/scripts/*'
  review-package / sdd-workspace / task-brief                 -> 3
$ git ls-files 'skills/superpowers/hooks/*'
  hooks-cursor.json / hooks.json / run-hook.cmd / session-start -> 4
  total (sort -u)                                             -> 41
```

Note `*` in a default git pathspec crosses `/` (wildmatch without
`WM_PATHNAME`), so `skills/foreman/scripts/*.sh` alone already returns the 8
`lib/*.sh` files; the `**/*.sh` term is redundant but harmless.

### FINDING A1 (HIGH) — the foreman family still carries the extension
### filter that caused F1

`tests/line-endings.bats:34-36`. The SDD family was converted to a directory
pathspec precisely because "the SDD scripts directory pathspec picks up
extensionless files that a `*.sh` glob structurally cannot" (the rework's own
comment at `tests/line-endings.bats:37`). That reasoning was not applied to
the foreman family, which is still filtered by `*.sh`. An extensionless
Foreman script added under `skills/foreman/scripts/` — the single most likely
place for a new Foreman script to land — escapes the inventory exactly as the
SDD scripts did.

Reproduced with a synthetic temporary index (real index never touched;
`GIT_INDEX_FILE` on a copy, script at `/tmp/exp-a.sh`):

```
INVENTORY SIZE (temp index): 41
MISSED  : skills/foreman/scripts/new-foreman-tool     <- 100644, bash shebang
MISSED  : skills/foreman/scripts/lib/newlib           <- 100644, bash shebang
```

Both synthetic entries were added at mode 100644 with a `#!/usr/bin/env bash`
blob. The inventory size stayed 41 and the test would pass. This is the F1
defect verbatim, relocated.

Contrast with the control: the same experiment against the SDD directory
(already reproduced by the architect) DOES name the file — so the fix is
genuine for that one family only.

### FINDING A2 (MEDIUM) — a fourth directly-executed Foreman family is
### covered by no sweep at all: repo-root and `env/`

`install.sh` is tracked, carries a bash shebang, is Foreman-owned, is index
mode **100644**, and is invoked by **direct exec**:

- `README.md:355` — `./install.sh` (no `chmod` in the copy-paste block)
- `docs/INSTALL.md:71-72` — `chmod +x install.sh` then `./install.sh`

It satisfies every predicate in the spec's own definition of the measured set
("tracked, carry a shebang or are invoked directly, are Foreman-owned, and are
currently `100644`") yet is not in the 41 and is matched by no pathspec. The
README path therefore fails on a fresh ext4 clone with `Permission denied` —
the exact failure the spec's SDD scenario exists to prevent. `docs/INSTALL.md`
works around it with a manual `chmod +x`, which is an acknowledgement that the
file ships non-executable.

Synthetic confirmation that the whole region is uncovered:

```
MISSED  : bootstrap-everything        (repo root, 100644, bash shebang)
MISSED  : env/new-provisioner.sh      (100644, bash shebang)
MISSED  : tests/probes/new-probe.sh   (100644, bash shebang)
```

I did NOT find a defect in `sandbox/`: `sandbox/entrypoint.sh` and
`sandbox/init-firewall.sh` are 100644 in the index but `sandbox/Dockerfile:46-47`
does `COPY init-firewall.sh entrypoint.sh /` followed by
`RUN chmod 0755 /init-firewall.sh /entrypoint.sh`, so the container-side direct
exec (`ENTRYPOINT ["/entrypoint.sh"]`, and `docker run … /init-firewall.sh
--check` at `tests/worker-run.bats:316`) is satisfied by the image build, not by
the index. Correctly out of scope.

Everything else with a shebang (`skills/superpowers/tests/**`,
`skills/superpowers/scripts/*.sh`, `tests/*.bats`, `tests/run.sh`,
`env/tool-check.sh`, `env/bootstrap-wsl.sh`) is documented as invoked via
`bash …` and needs no exec bit. `tests/probes/mkdir-atomicity.sh` is already
100755 and is invoked as `bash …/mkdir-atomicity.sh` (`devlog/2026-07-28.md:166`).

### Severity judgement

A1 is HIGH, not critical: no file is wrong *today*, and the spec's stated
inventory (34 `.sh` + 3 SDD + 4 hooks = 41) is met exactly. But the requirement
under audit is explicitly forward-looking — "IF a new directly executed script
is added without the exec bit, THEN the test SHALL fail naming it" — and for
the most likely directory in the repo, it will not. A2 is MEDIUM for the same
reason plus the fact that `install.sh` is already wrong today by the spec's own
predicate, though outside the spec's enumerated 41.

## b) New tests 4 and 5 — non-vacuous?

**Method.** All break experiments ran in a throwaway `git clone --no-hardlinks`
of the worktree at `/tmp/brk` (HEAD `bbb8ad8`, `tests/line-endings.bats`
hash-object `b120051…` identical to the worktree copy). The audited worktree
was never mutated — see section (f) for the before/after digests. `bats` is
`/usr/bin/bats`. Single-file runs; no concurrent bats (AGENT_TRAPS §5).

Control, unmodified clone:

```
ok 1 tracked .bat/.cmd/.ps1 line endings match git check-attr eol      rc=0
ok 1 tracked PNG binary carve-out survives git add --renormalize       rc=0
```

### Test 4 — `.bat/.cmd/.ps1` vs `git check-attr eol` (line 161)

Sweep set and resolved attributes:

```
env/bootstrap-windows.ps1                crlf
env/tool-check.ps1                       crlf
install.ps1                              crlf
launcher/build.ps1                       crlf
skills/superpowers/hooks/run-hook.cmd    lf
```

**Generality on `run-hook.cmd`: VERIFIED, not special-cased.** There is no
filename literal anywhere in the test. Break 4E replaced the `run-hook.cmd`
index blob with a CRLF version (`git hash-object -w --no-filters`; the first
attempt without `--no-filters` was silently normalised back to LF and produced
a false green — worth noting as its own checker trap):

```
not ok 1 tracked .bat/.cmd/.ps1 line endings match git check-attr eol
# offending: skills/superpowers/hooks/run-hook.cmd (attr eol=lf; materialised endings mismatch)
```

It is named, and the expectation came from `git check-attr eol` returning `lf`
via the nested `skills/superpowers/.gitattributes:12` override. Confirmed
general.

**Break 4C — bad index blob (bare CR in a crlf-attributed file): FAILS and
names.**

```
not ok 1 …
# offending: env/bootstrap-windows.ps1 (attr eol=crlf; materialised endings mismatch)
```

So the checker mechanism is non-vacuous. But:

### FINDING B1 (MEDIUM) — test 4 cannot detect deletion of the Windows
### carve-out it exists to protect

`tests/line-endings.bats:161-206`. The test derives its *expectation* from
`git check-attr eol` and its *observation* from `git checkout-index`, which
applies that same attribute. The two sides are not independent, so any change
that moves the attribute moves the expectation with it.

Break 4A — deleted all three `*.bat/*.cmd/*.ps1 text eol=crlf` lines from the
root `.gitattributes`:

```
check-attr on a .ps1 now: env/tool-check.ps1: eol: lf
ok 1 tracked .bat/.cmd/.ps1 line endings match git check-attr eol   rc=0
```

Break 4F — deleted the nested `*.cmd text eol=lf` override:

```
run-hook.cmd attr now: eol: crlf
ok 1 …   rc=0
```

The spec scenario reads "THEN a `*.bat *.cmd *.ps1 text eol=crlf` carve-out
rule is present". No test asserts that presence. Removing the carve-out — the
single most likely regression, since the catch-all `* text=auto eol=lf` above
it would then win — leaves the suite fully green.

### FINDING B2 (LOW) — test 4 asserts materialised bytes, not working-tree
### bytes

Break 4B rewrote a tracked `.ps1` in the working tree to pure LF while its
attribute says `crlf`; the test passed (rc=0), because it re-materialises from
the index via `checkout-index --prefix` rather than reading the worktree. The
spec scenario is phrased about the **working tree** ("a tracked `.ps1`/`.bat`/
`.cmd` file's working-tree line endings remain CRLF after `git add
--renormalize .`"). The chosen predicate is arguably *better* (it is
host-independent and survives a dirty tree), but it is not the one the spec
words, and it should be recorded as a deliberate substitution rather than
assumed equivalent.

Minor: at `tests/line-endings.bats:178-182` the unspecified-attribute branch
`continue`s before `checked=$((checked+1))`, so a repo where every Windows
script had an unset `eol` would fall through to the `checked == 0` branch —
which still returns 1, so no false pass. Cosmetic only.

### Test 5 — PNG binary carve-out through renormalize (line 208)

Tracked PNGs and their NUL status:

```
assets/foreman-banner.png            NUL present
assets/v029-total-georgecall.png     NUL present
skills/superpowers/assets/app-icon.png  NUL present
```

**Break 5B — true known-bad: FAILS and names, with before/after SHAs.**
A NUL-free CRLF file named `fake-asset.png` added to the index, with the
`*.png binary` rule deleted:

```
not ok 1 tracked PNG binary carve-out survives git add --renormalize
# offending: fake-asset.png (blob SHA changed under renormalize:
#   8c829561f0da6a2c5bf5fc46e56cae5b1a0973a8 -> b0d7450ccb58220ab725893406f76236efcff1bf)
```

**Break 5C — positive control: same file, carve-out intact → rc=0.** This pair
(5B vs 5C) is a genuine controlled experiment: the `*.png binary` rule is what
makes the difference, and the test detects its absence *on a susceptible file*.

### FINDING B3 (MEDIUM) — test 5 is vacuous on the current corpus

Break 5A deleted `*.png binary` from the root `.gitattributes` with no other
change:

```
png rule lines left: 0
check-attr png: assets/foreman-banner.png: text: auto   eol: lf
ok 1 tracked PNG binary carve-out survives git add --renormalize   rc=0
```

All three tracked PNGs contain NUL bytes, so `text=auto` classifies them binary
by heuristic and refuses conversion whether or not the carve-out exists. On
today's repo the carve-out could be deleted and the test would stay green;
what the test actually demonstrates is the NUL heuristic, not the rule the spec
requires. It becomes non-vacuous only if a NUL-free file matching `*.png` is
ever tracked (break 5B). The spec's "THEN a `*.png *.jpg *.jpeg *.ico *.pdf
*.exe binary` rule is present" is, again, not asserted anywhere.

Also note the sweep covers `*.png` only; `*.jpg *.jpeg *.ico *.pdf *.exe` are
in the `.gitattributes` rule and in the spec's WHERE clause but in no test.
There are currently no tracked files of those types, so the gap is latent.

Cosmetic: test 5's bats failure line attribution points at line 221
(`if ((${#pngs[@]} == 0))`) rather than the real `exit 1` inside the subshell,
because the failing status propagates out of the `( … )`. The offending path is
still printed correctly. `local rc=$?` at line 246 does capture the subshell
status correctly (the expansion happens before `local` returns).

## c) Test 2's widened condition

`tests/line-endings.bats:102-132`. Condition at line 112:

```
if [[ "${autocrlf,,}" != "true" && "$eol" != "lf" ]]; then continue; fi
```

**Non-vacuous on this host: VERIFIED.** Host state:
`core.autocrlf = UNSET`, `core.eol = UNSET`, filesystem tmpfs/ext4-class.
Instrumented count of what the loop actually examines:

```
bash-shebang files: 84
with eol=lf: 84
without eol=lf: 0
```

So `checked = 84`, the `skip` at line 123 is not reached, and the byte check
runs on every one. Under the old `f02f207` predicate (`autocrlf == true` only)
this same host gave `checked = 0` and the test always skipped. The widening is
the difference.

**It actually fails on a CR, naming the file — two independent breaks:**

Break 2A, CR injected into `skills/foreman/scripts/gate-eval.sh` (working tree
only, index untouched):

```
not ok 2 bash-shebang working trees contain no CR when autocrlf=true or path eol=lf
# offending: skills/foreman/scripts/gate-eval.sh (has CR in working tree; autocrlf=unset eol=lf)
```

Break 2B, CR injected into the extensionless SDD script `task-brief` — the
exact file family the original bug lived in:

```
not ok 2 …
# offending: skills/superpowers/skills/subagent-driven-development/scripts/task-brief
#            (has CR in working tree; autocrlf=unset eol=lf)
```

**Did the widening create a new skip case? NO.** The predicate is a
disjunction: a path is examined when `autocrlf == true` **OR** `eol == lf`. The
old predicate was the first disjunct alone, so the new checked-set is a strict
superset of the old one for every possible host and every possible attribute
state. There is no configuration in which the widened test examines fewer paths
than the narrow one. I verified this by reading the condition rather than by
enumeration, and state that explicitly: it is an argument from the boolean
structure, not an experiment over hosts.

Break 2C probed the adjacent worry — whether test 2's coverage depends on the
new catch-all. Removing `* text=auto eol=lf` from `.gitattributes` leaves the
count unchanged at 84/84, because every bash-shebang path is already reached by
`*.sh`, `*.bash`, `*.bats`, the three explicit SDD rules, or
`skills/superpowers/.gitattributes`. Test 2's coverage therefore does not
depend on the catch-all — and, as a corollary, test 2 would not notice the
catch-all being deleted either. That deletion is unasserted by any of the five
tests (see B1/B3 for the same pattern).

### FINDING C1 (LOW) — a false-positive path on a `windows-latest` runner

When `core.autocrlf=true` (the CI platform the spec's first scenario targets),
the first disjunct admits **every** bash-shebang path regardless of its `eol`
attribute, and any CR then counts as offending. If a bash-shebang file were
ever attributed `eol=crlf` or `-text`, its legitimate CRLF working-tree bytes
would be reported as a violation. No tracked file is in that state today (all
84 resolve to `eol=lf`), so this is latent, not live. The precise form would be
to skip paths whose resolved `eol` is `crlf`.

## d) gitattributes precedence, empirical

Run in the audited worktree, `git check-attr text eol diff -- <path>`. Nothing
below is reasoned; every row is command output.

| path | text | eol | diff | verdict |
|---|---|---|---|---|
| `env/tool-check.ps1` | set | **crlf** | unspecified | Windows carve-out beats the catch-all |
| `install.ps1` | set | **crlf** | unspecified | same |
| `launcher/build.ps1` | set | **crlf** | unspecified | same |
| `assets/foreman-banner.png` | **unset** | lf | **unset** | `binary` macro (= `-text -diff`) beats the catch-all |
| `skills/superpowers/assets/app-icon.png` | **unset** | lf | **unset** | nested `*.png binary` also applies |
| `…/subagent-driven-development/scripts/review-package` | set | **lf** | unspecified | extensionless SDD script forced LF |
| `…/scripts/sdd-workspace` | set | **lf** | unspecified | same |
| `…/scripts/task-brief` | set | **lf** | unspecified | same |
| `skills/foreman/scripts/gate-eval.sh` | set | **lf** | unspecified | `*.sh text eol=lf` |
| `skills/superpowers/scripts/lint-shell.sh` | set | **lf** | unspecified | nested `*.sh text eol=lf` |
| `skills/superpowers/hooks/run-hook.cmd` | set | **lf** | unspecified | **nested override wins over root `*.cmd eol=crlf`** |
| `skills/superpowers/hooks/session-start` | set | **lf** | unspecified | nested explicit rule |
| `README.md` | auto | lf | unspecified | catch-all |
| `launcher/src/launch.ts` | auto | lf | unspecified | catch-all (root; nested `*.ts` rule does not reach it) |
| `install.sh` | set | **lf** | unspecified | `*.sh text eol=lf` |

Reading of the ordering, now corroborated rather than assumed: in the root
`.gitattributes`, `* text=auto eol=lf` is line 10, `*.png binary` line 11,
`*.bat/*.cmd/*.ps1 text eol=crlf` lines 17-19, `*.sh/*.bash/*.bats` lines 20-22.
Later matches win, so every carve-out sits below the catch-all and takes effect.
The `run-hook.cmd` case is cross-file: `skills/superpowers/.gitattributes:12`
(`*.cmd text eol=lf`) is a deeper `.gitattributes` and beats the root
`*.cmd text eol=crlf` regardless of line order. Both facts are confirmed by
output, not inference.

**Totality of the catch-all: VERIFIED.**

```
$ git ls-files -z | xargs -0 git check-attr eol -- \
    | awk -F': ' '$NF!="lf" && $NF!="crlf"' | wc -l
0        (out of 623 tracked files)
```

Every tracked file resolves to a definite `eol`. The policy is total, as the
spec requires.

**Materialised bytes, fresh clone** (`git clone --no-hardlinks` of the audited
worktree at `bbb8ad8`, `/tmp/brk2`):

```
i/lf    w/crlf  attr/text eol=crlf     env/bootstrap-windows.ps1
i/lf    w/crlf  attr/text eol=crlf     env/tool-check.ps1
i/lf    w/crlf  attr/text eol=crlf     install.ps1
i/lf    w/crlf  attr/text eol=crlf     launcher/build.ps1
i/lf    w/lf    attr/text eol=lf       skills/superpowers/hooks/run-hook.cmd
i/-text w/-text attr/-text             assets/foreman-banner.png
i/-text w/-text attr/-text             skills/superpowers/assets/app-icon.png
```

So a fresh checkout on Linux does deliver CRLF `.ps1` files, LF `run-hook.cmd`,
and untouched PNGs. The spec's Windows-carve-out scenario is satisfied in fact.

### Observation D1 (LOW, pre-existing, not caused by this change)

In the **audited worktree itself** the four `.ps1` files are `w/lf`, not
`w/crlf`:

```
i/lf    w/lf    attr/text eol=crlf     env/tool-check.ps1     (worktree)
i/lf    w/crlf  attr/text eol=crlf     env/tool-check.ps1     (fresh clone)
```

The `eol=crlf` rules were added by `f02f207`; git does not re-smudge files
already on disk, so this checkout still holds the pre-change LF bytes. It is
benign (the index is LF either way, and `git status` stays clean because
check-in conversion is idempotent), and it disappears on any fresh clone. It is
worth recording because it is exactly the state test 4 would have to read if it
inspected the working tree instead of `checkout-index` — see finding B2.

### Observation D2 (LOW) — `eol` is reported even when `text` is unset

`check-attr eol` returns `lf` for the PNGs even though `text: unset` makes that
value inert. `path_eol_attr()` (`tests/line-endings.bats:48-50`) reads `eol`
alone and never consults `text`, so it cannot distinguish "LF is enforced" from
"eol is set but conversion is disabled". Break 4D exercised this
(`*.ps1 -text` → `text: unset  eol: crlf`); the test still failed loudly, so
there is no false pass today, but the helper is weaker than its name suggests.

## e) Spec completeness walk

Acceptance criteria:
`openspec/changes/crlf-extensionless-hardening/specs/line-endings/spec.md`.
Every row below is backed by a command run in this audit.

### Requirement 1 — bash-executed files are index-LF everywhere, worktree-LF on autocrlf=true

| Clause | Status | Evidence |
|---|---|---|
| SHALL be `i/lf` in the index on every platform | **implemented + tested** | test 1 (`:83`); 84 shebang files; break 1 (CRLF blob for `watch.sh`) → `not ok`, names it |
| SHALL be LF in the working tree on an `autocrlf=true` checkout | **implemented, tested only by proxy** | attributes force `eol=lf` for all 84; test 2 exercises the byte check via the `eol=lf` disjunct. I did **not** verify on a real `core.autocrlf=true` checkout — no such host was available to me. Stated gap. |
| SHALL be verified by a test, not by `.gitattributes` alone | **implemented** | 5 tests, all observed failing against known-bad inputs except where noted in (b) |
| Bullet: root `* text=auto eol=lf` catch-all | **implemented, not asserted** | `.gitattributes:10`; all 623 tracked files resolve to a definite `eol` (0 unspecified). No test asserts the rule's presence — see B1/B3 |
| Bullet: binary carve-out | **implemented, weakly asserted** | `.gitattributes:11-16`; test 5 vacuous on today's corpus (B3) |
| Bullet: explicit `eol=lf` for the three extensionless scripts | **implemented** | `.gitattributes:25-27`, mirrored at `skills/superpowers/.gitattributes:6-8`; `check-attr` → `text: set  eol: lf` for all three |
| Bullet: test asserts (a) index-LF and (b) no `\r`, for every `#!.../bash` file of any extension | **implemented** | `bash_shebang_files()` (`:16-25`) reads first line from disk, no extension filter; 84 files |
| **Scenario: CI catches a reintroduced CRLF shebang script on `windows-latest`** | **NOT implemented** | `.github/workflows/` contains only `maintenance.yml` (ubuntu, release/cron, runs `maintenance.sh`) and `windows-smoke.yml` (windows-latest but `paths: ["install.ps1", …]` and runs only `install.ps1` under pwsh). **No CI job runs `bats` at all**, on any platform. `tests/run.sh` does pick the file up (`exec bats .` from `tests/`), but nothing in CI runs `tests/run.sh`. The change's own `proposal.md` Impact section defers this: "Should land alongside/before wsl-launcher-shipped and wsl-ci-parity, since P5's CI job runs this bats file." So it is *knowingly* deferred — but the scenario as written in the spec delta under audit is not satisfied by this change. |
| Scenario: three known scripts are index-LF everywhere | **implemented + verified** | `git ls-files --eol` → `i/lf attr/text eol=lf` for all three |
| …and worktree-LF on a Git-Bash/autocrlf checkout | **untested (no such host)** | stated gap |
| …and run without `pipefail\r` on real WSL bash | **verified for direct exec** | on a fresh clone `/tmp/brk2`: `./scripts/review-package` → `usage: review-package BASE HEAD [OUTFILE]`, exit 0; `./scripts/sdd-workspace` → path printed, exit 0; `./scripts/task-brief` → usage, exit 0. No `Permission denied`, no `pipefail\r` |
| …and `git add --renormalize .` is a near-no-op | **verified — it is an exact no-op** | on a fresh clone, `GIT_INDEX_FILE=<copy> git add --renormalize .` then `git diff-index --cached --name-only HEAD` → **0 files**, across all 623 |

### Requirement 2 — binary files protected from `text=auto` mis-detection

| Clause | Status | Evidence |
|---|---|---|
| `.gitattributes` SHALL mark `*.png *.jpg *.jpeg *.ico *.pdf *.exe` as `binary` | **implemented** | `.gitattributes:11-16`, one pattern per line |
| Scenario: the rule is present | **not asserted by any test** | break 5A deleted `*.png binary` → suite still green (B3) |
| Scenario: a tracked binary's bytes are bit-identical after renormalize | **implemented + tested** | test 5 (`:208`); `check-attr` → `text: unset diff: unset`, `ls-files --eol` → `i/-text w/-text attr/-text`; break 5B fails and names, break 5C is the positive control |
| Coverage of `.jpg/.jpeg/.ico/.pdf/.exe` | **untested (latent)** | test 5 sweeps `*.png` only; no tracked files of the other types exist, so the gap cannot bite today |

### Requirement 3 — every directly executed Foreman script is executable in the index

| Clause | Status | Evidence |
|---|---|---|
| The 41-file inventory is `100755` in the index | **implemented + verified** | the three pathspecs return 41 paths; `git ls-files -s` → `41 × 100755`, zero exceptions |
| Set SHALL be derived by a mechanical sweep, not a literal number | **implemented** | `exec_bit_inventory()` (`:32-43`); zero literal paths; the test asserts the derived list and additionally guards `#inv == 0` |
| **IF a new directly executed script is added without the exec bit, THEN the test SHALL fail naming it** | **PARTIALLY implemented** | Holds for: `skills/foreman/scripts/**/*.sh` (break 3a → names `lib/common.sh`), the SDD directory including extensionless (break 3b → names `…/scripts/newthing`), `skills/superpowers/hooks/*`. Does **not** hold for an extensionless script under `skills/foreman/scripts/` (break 3c → **`ok`, silent pass**) or anywhere outside the three directories. See findings A1/A2 |
| Scenario: `git ls-files -s` reports `100755` for the three SDD scripts | **verified** | `100755` for `review-package`, `sdd-workspace`, `task-brief` |
| Scenario: a fresh ext4 clone can direct-exec them | **verified** | `/tmp/brk2`, `-rwxr-xr-x` on disk, all three ran, exit 0 |

### Requirement 4 — genuine Windows scripts remain CRLF

| Clause | Status | Evidence |
|---|---|---|
| `.bat/.cmd/.ps1` SHALL be CRLF and the catch-all SHALL NOT normalize them | **implemented** | `check-attr` → `eol: crlf` for all four tracked `.ps1`; fresh clone materialises `w/crlf` for all four |
| Scenario: a `*.bat *.cmd *.ps1 text eol=crlf` carve-out rule is present | **not asserted by any test** | `.gitattributes:17-19` present; break 4A deleted all three lines → suite still green (B1) |
| Scenario: working-tree endings remain CRLF after renormalize | **implemented; asserted against materialised bytes, not the working tree** | test 4 (`:161`); break 4B (worktree flattened to LF) → still `ok`. See B2. Renormalize itself is a proven no-op (0 of 623) |
| The deliberate `run-hook.cmd` LF exception is handled by attribute, not by name | **implemented + verified general** | no filename literal in the test; break 4E (CRLF blob for `run-hook.cmd`) → `not ok`, names it, driven by `eol=lf` from `skills/superpowers/.gitattributes:12` |

## f) Regression: the 41 mode changes and both .gitattributes

**`bbb8ad8` touched exactly one file.**

```
$ git diff --stat f02f207..bbb8ad8
 tests/line-endings.bats | 184 +++++++++++++++++++++++++++++++++++++++++-------
 1 file changed, 160 insertions(+), 24 deletions(-)
```

**Both `.gitattributes` blobs are byte-identical across the rework.**

```
.gitattributes                     f02f207=18127ee4…  bbb8ad8=18127ee4…  same=YES
skills/superpowers/.gitattributes  f02f207=02502a77…  bbb8ad8=02502a77…  same=YES
```

**No mode changed between `f02f207` and `bbb8ad8`.** Comparing
`git ls-tree -r <rev> | awk '{print $1,$4}'` for the two commits produces an
empty `diff` — every path carries the same mode in both trees.

**The 41 mode changes are intact in the full package.**

```
$ git diff --summary bfc8af4..bbb8ad8 | grep -c 'mode change 100644 => 100755'
41
$ { git ls-files -s 'skills/foreman/scripts/*.sh'
    git ls-files -s 'skills/superpowers/skills/subagent-driven-development/scripts/*'
    git ls-files -s 'skills/superpowers/hooks/*'; } | awk '{print $1}' | sort | uniq -c
     41 100755
```

The full `bfc8af4..bbb8ad8` diffstat is 44 entries: the 41 mode changes,
`.gitattributes` (+20), `skills/superpowers/.gitattributes` (+6), and the new
`tests/line-endings.bats` (+249, created `100755`). Nothing else. Nothing Sol
passed was disturbed.

### Worktree integrity (this audit made no product-code change)

```
BEFORE (first command of the session):
  git status --porcelain -uall | sha256sum
  e74f2170b534c69d1ff5182f54f9c850cfeef524a3dfe1b1e3b7ac81fee32d92

AFTER (post-experiments):
  e74f2170b534c69d1ff5182f54f9c850cfeef524a3dfe1b1e3b7ac81fee32d92
```

Digests are identical. Every destructive experiment ran either against a
`GIT_INDEX_FILE` copy or inside disposable clones at `/tmp/brk` and `/tmp/brk2`
(`git clone --no-hardlinks`), never against the audited worktree. The only
write into `/root/fm-wt/s1-crlf` was this report, which was already an
untracked file in the baseline digest.

Note on `-uall`: AGENT_TRAPS §2 warns that plain `--porcelain` collapses an
untracked directory to one line. `-uall` is used here as required; the baseline
enumerates six untracked files individually (`AGENT_TRAPS.md`, `AUDIT-opus.md`,
`AUDIT-sol.md`, `BRIEF.md`, `REPORT.md`, `REWORK.md`), so the digest is not
hiding directory contents. It is still blind to *content* edits inside those
untracked files; I made no edit to any of them except `AUDIT-opus.md`.

### Test-execution hygiene

`bats tests/line-endings.bats` in the audited worktree: `1..5`, all `ok`,
rc=0. Break runs were single-file, single-process, in disposable clones.
`tests/line-endings.bats` contains no load-sensitive assertion (no timing, no
concurrency), so the host-wide `gate` mutex (AGENT_TRAPS §5,
`orchestration-hardening.md:197`) is not load-relevant here; I did not hold it,
and I record that as a deviation rather than claim it did not matter.

## Findings

| # | Sev | Location | Finding |
|---|---|---|---|
| **A1** | **HIGH** | `tests/line-endings.bats:34-36` | The foreman family is still swept with a `*.sh` extension filter. An extensionless directly-executed script under `skills/foreman/scripts/` escapes the inventory and the test passes — the exact defect class that blocked round 1, surviving in the largest of the three families (34 of the 41 files). |
| **A2** | MEDIUM | `tests/line-endings.bats:32-43`; `install.sh`; `README.md:355` | A fourth directly-executed, Foreman-owned region — repo root, `env/`, `tests/probes/` — is covered by no sweep. `install.sh` is tracked, bash-shebang, Foreman-owned, index mode `100644`, and invoked as `./install.sh`; it meets every predicate in the spec's own definition of the inventory yet is in neither the 41 nor any pathspec. |
| **B1** | MEDIUM | `tests/line-endings.bats:161-206` | Test 4's expectation and its observation both come from the same `eol` attribute, so deleting the `*.bat/*.cmd/*.ps1 text eol=crlf` carve-out — the regression the requirement exists to prevent — leaves the suite green. |
| **B3** | MEDIUM | `tests/line-endings.bats:208-249` | Test 5 is vacuous on the current corpus: all three tracked PNGs carry NUL bytes, so `text=auto` protects them by heuristic whether or not `*.png binary` exists. Deleting the rule leaves the suite green. `*.jpg/.jpeg/.ico/.pdf/.exe` are in the rule and the spec but in no test. |
| **E1** | MEDIUM (deferred by design) | `.github/workflows/` | Requirement 1's first Scenario ("WHEN CI checks out on `windows-latest` … `tests/line-endings.bats` fails loudly") is not implemented: no CI job runs `bats` on any platform. `proposal.md` Impact explicitly defers this to `wsl-ci-parity`, so it is a known deferral rather than an oversight — but the spec delta under audit still carries the scenario. |
| **B2** | LOW | `tests/line-endings.bats:184-189` | Test 4 asserts `checkout-index`-materialised bytes, not working-tree bytes; the spec scenario is phrased about the working tree. A rewritten-to-LF `.ps1` in the worktree passes. Arguably a better predicate, but it is a substitution and should be recorded as one. |
| **C1** | LOW | `tests/line-endings.bats:112` | On a `core.autocrlf=true` runner the first disjunct admits every bash-shebang path regardless of its `eol`, so a hypothetical bash-shebang file attributed `eol=crlf`/`-text` would be reported as offending for legitimate CRLF bytes. Latent — no such file exists today. |
| **D2** | LOW | `tests/line-endings.bats:48-50` | `path_eol_attr()` reads `eol` without consulting `text`; `check-attr` reports `eol: lf` even for `text: unset` paths where the value is inert. No false pass today (break 4D still failed loudly). |
| **D1** | LOW (pre-existing) | worktree only | The four tracked `.ps1` files are `w/lf` in this checkout while their attribute is `eol=crlf`, because git does not re-smudge files already on disk when attributes change. Benign, index-clean, and absent from any fresh clone. Not caused by `bbb8ad8`. |
| — | INFO | `tests/line-endings.bats:40-41` | The hooks sweep places `hooks.json` and `hooks-cursor.json` at mode `100755`. Marking JSON data executable is a side effect of sweeping by directory rather than by property. Harmless, but it is the same modelling weakness that produces A1. |

### What Sol got right, independently confirmed

The four claimed fixes are real, and each was observed failing against a
known-bad input in this audit: test 1 (break 1), test 2 (breaks 2A/2B), test 3
on the SDD family including extensionless (break 3b), test 4 including the
`run-hook.cmd` exception handled generally by attribute (break 4E), test 5
(break 5B with a 5C positive control). The `.gitattributes` work and the 41
mode changes are untouched by `bbb8ad8` and verified sound in section (f).

### The A1 evidence, stated compactly

Two live `bats` runs on the same clone, differing only in which directory the
synthetic 100644 shebang script was added to:

```
BREAK 3b: new extensionless file in .../subagent-driven-development/scripts/
  not ok 1 derived exec-bit inventory is mode 100755 in the git index
  # offending: .../scripts/newthing (mode=100644)

BREAK 3c: new extensionless file in skills/foreman/scripts/
  index mode: 100644 6e877466… 0  skills/foreman/scripts/newthing
  ok 1 derived exec-bit inventory is mode 100755 in the git index
```

That is a controlled pair, not two agreeing observations: the only variable is
the family, and the outcome inverts.

### Note on the recommended repair

Dropping the `*.sh` filter is **not** a safe one-line fix: `git ls-files
'skills/foreman/scripts/*'` returns 35 paths, the extra one being
`skills/foreman/scripts/adapters/verdict.schema.json` at `100644`, which would
immediately make test 3 fail. The principled repair is to derive the inventory
by **property** rather than by directory — the repo already has the primitive
one function above, `bash_shebang_files()` (`:16-25`), which reads the first
line of every tracked file and needs no extension or directory knowledge. An
inventory of "tracked files under the Foreman-owned trees whose first line is a
shebang, plus the hooks directory" would cover A1 and A2 together and would
stop marking JSON data executable.

## Verdict

**BLOCKED** — on finding **A1** alone. Everything else in this audit is
WARNING-grade or informational, and I would approve the change with those
noted.

The reason A1 blocks rather than warns: Requirement 3 contains an unqualified
normative clause — "IF a new directly executed script is added without the exec
bit, THEN the test SHALL fail naming it" — and I have a controlled experiment
showing it does not hold for the largest of the three families. This is the
same defect class that returned BLOCKED in round 1; round 2 fixed the instance
it was pointed at and did not generalise. `REPORT.md` §1 presents a "Family
audit (hardcoding check)" table concluding all three families are clean; that
table answers the question "literal paths?" correctly and does not answer the
question the fix exists to settle, which is whether a new script can escape.
Under the repo's own standing rule that a checker must be demonstrated to fail
against a known-bad input, the foreman family's checker has now been observed
*not* firing on one.

Nothing is wrong in the repository today: the derived inventory is exactly the
41 files the spec measures, all at `100755`, and all five tests pass in the
audited worktree.

**What would change this verdict to APPROVED:**

1. `exec_bit_inventory()` derives the foreman family by a property that does
   not depend on the `.sh` extension, and a controlled pair is shown — a new
   extensionless 100644 shebang script under `skills/foreman/scripts/` and
   under `skills/foreman/scripts/lib/` each make test 3 fail **naming the
   file**, with the unmodified index green. Temporary-index or disposable-clone
   method, real index untouched.
2. `skills/foreman/scripts/adapters/verdict.schema.json` (and any other non-
   executable data file the widened sweep pulls in) is still handled correctly
   — i.e. the widening must not be achieved by simply demanding `100755` of
   every file in the directory.

**What would additionally move it from APPROVED to APPROVED-clean** (not
blocking, and each is defensible as follow-up work rather than rework):

3. A2 — either add `install.sh` to the inventory and set its index mode to
   `100755`, or record in the spec why repo-root installers are excluded
   despite matching the spec's own predicate. Today `README.md:355` tells a
   user to run `./install.sh` on a fresh clone, where it is not executable.
4. B1 and B3 — assert the *presence* of the `*.bat/*.cmd/*.ps1 text eol=crlf`
   and `*.png … binary` rules (or of their effect on a NUL-free probe file),
   so the two carve-outs cannot be deleted with the suite still green.
5. E1 — either land the CI job that runs this bats file, or amend the spec
   delta's first Scenario to record the deferral to `wsl-ci-parity` that
   `proposal.md` already states.

## Explicitly not verified

- **Behaviour on a real `core.autocrlf=true` checkout.** No Git-Bash or
  `/mnt/c` shared checkout was available to me. Requirement 1's working-tree
  clause and its first Scenario were verified only through the `eol=lf`
  attribute path on an ext4/tmpfs host. This is the one environment the
  original bug actually manifested in, and it remains unobserved in this audit.
- **The host-wide `gate` bats mutex was not held** for my runs (single-file,
  no load-sensitive assertions in this file). Recorded as a deviation.
- **Content edits inside the other untracked files** (`REPORT.md`, `BRIEF.md`,
  `REWORK.md`, `AGENT_TRAPS.md`, `AUDIT-sol.md`) are not covered by the
  `git status --porcelain -uall` digest. I made no edit to them, but the digest
  is not evidence of that.
- **`.jpg/.jpeg/.ico/.pdf/.exe`** binary protection is untested because no such
  file is tracked; I did not construct a probe for them.
