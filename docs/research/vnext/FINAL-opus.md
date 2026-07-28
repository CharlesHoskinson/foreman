# FINAL-opus.md — Foreman v0.2.9 final audit lane

**Opus 5, 2026-07-28.** Go/no-go on dispatching implementation. Read-only pass
over all 33 live packages under `openspec/changes/`, `LANDING-ORDER.md`, and
`formal/`. A parallel GPT-5.6 Sol lane audited the same scope independently; no
coordination took place.

---

## Decision

**DO NOT DISPATCH S1 — but the gap is one requirement wide, not a round of work.**

The blocker is in `lock-primitive-hardening`, and it is the same defect class the
round-2 fix was written to remove. That fix made the `mkdir` fallback reachable on
Git-Bash by adding a second trusted evidence class; in doing so it left the
primary mechanism, `flock`, with no evidence class it can satisfy. The spec
defines `syscall` evidence as *"a trace … observed the create issued to the kernel
and the kernel returning `EEXIST`"* — a definition that is `mkdir`-shaped and
that `flock`, which creates nothing and returns no `EEXIST`, can never meet. The
remaining classes are ruled out by the package's own taxonomy (`contention` may
license `non-atomic` only; `flavour` licenses nothing; the pinned register is
seeded with MSYS2 `mkdir.exe` alone). Yet the same spec requires *"WSL and Linux
hosts on host-produced `syscall` evidence for `flock`"*, and selects a mechanism
only on a trusted verdict. A faithful implementation therefore refuses every
acquisition on the reference host with `FM_LOCK_PROBE_UNTRUSTED`, and the
package's own Scenario *"WSL and Linux hosts take the flock path"* is unreachable.
This is not a wording gap — it is the security-critical predicate of the package,
and an implementer who hits it must invent the contract or ship a lock that never
locks. Two further items must also clear before any worker starts: the entire fix
round is uncommitted (53 files, 5,541 insertions) while Foreman dispatches into
worktrees cut from a committed ref, and S1's other package fails
`openspec validate --strict` under an S0 conformance decision that has not been
made. All three are hours of work, not a round.

The underlying problem is real and I reproduced it live. That is why this is a
hold, not a rejection.

---

## Per-stage dispatchability

| Stage | Packages | Verdict | Blocker |
|---|---|---|---|
| **S0** | archive `test-harness-fork-tax`, `el-emit-spawn-reduction`; OpenSpec conformance decision | **DISPATCH NOW** | None. Prerequisite for S1. The `test-harness` capability collision is real and verified. |
| **S1** | `crlf-extensionless-hardening`, `lock-primitive-hardening` | **DO NOT DISPATCH** | L1 (flock has no satisfiable evidence class), L2 (pinned-mechanism seed is circular), C1 (landing order and package disagree on scope), G1, G2. |
| **S2** | `test-infrastructure-hardening`, `formal-model-suite` | *pending lane* | — |
| **S3** | `wsl-launcher-shipped` → `wsl-tool-path-persistence` → `wsl-preflight` → `wsl-seam-doctrine` | *pending lane* | All four fail `openspec validate --strict` (G2). |
| **S4** | `decision-lineage-and-telemetry` → `three-outcome-verdicts` → `round-ownership-default` → `doctrine-reality-drift` | *pending lane* | Depends on S1 lock (declared correctly by `round-ownership-default`). |
| **S5** | `vendor-adapter-contract` → `agy-lane-activation` → `cross-vendor-audit-routing` → `vendor-concurrency-and-quota` | *pending lane* | — |
| **S6** | `evidence-contracts`, `regression-harness-tiers`, `release-metrics` | *pending lane* | — |
| **S7** | `knowledge-plane-refresh` → `work-dag-projection` → `audit-groundedness-gate` | *pending lane* | `knowledge-plane-refresh` consumes `lib/lock.sh`; inherits S1. |
| **S8** | `graph-context-builder` | *pending lane* | — |
| **S9** | `graph-store-port`, `terminusdb-schema` → `terminusdb-adapter` → `terminusdb-operations` | *pending lane* | — |
| **S10** | `graph-eval-falsification`, `wsl-ci-parity` | *pending lane* | `wsl-ci-parity` fails validation (G2). |
| **Deferred** | `hard-mode-launcher`, `v030-soft-mode-report` | Correctly deferred | Both non-validating and out of scope. |

---

## Findings — blocked vs fixable in flight

### Global

| # | Finding | Class | Verdict |
|---|---|---|---|
| **G1** | The entire fix round is uncommitted: 86 modified + 10 untracked files, 53 of them under `openspec/changes` / `docs/research`, 5,541 insertions and 1,006 deletions. `git show HEAD:…/lock-primitive-hardening/specs/locking/spec.md \| grep -c pinned-mechanism` returns **0**; the working tree returns 8. A commit (`750b8a6`) landed *during this audit* and did not include the fix round. Foreman cuts worker worktrees from a committed ref, so every worker would receive the pre-fix specs — including the version whose Git-Bash scenario the design itself calls unsatisfiable. | Structural (process) | **BLOCKED** — trivial to clear (commit the branch), but it must be cleared first. |
| **G2** | 10 of 33 live packages fail `openspec validate --strict` (openspec 1.6.0): `crlf-extensionless-hardening`, `el-emit-spawn-reduction`, `hard-mode-launcher`, `test-harness-fork-tax`, `v030-soft-mode-report`, `wsl-ci-parity`, `wsl-launcher-shipped`, `wsl-preflight`, `wsl-seam-doctrine`, `wsl-tool-path-persistence`. **Six of these are v0.2.9-authored WSL packages, not "pre-existing" ones** — the scoping language understates this. One of them is half of S1. The governing decision (`lock-primitive-hardening` T8) is an unchecked box and no decision record exists. | Incidental content, structural process | **BLOCKED for S1/S3/S10** — mechanical header transform, but it rewrites the spec a worker would be reading. |
| **G3** | `formal/specs/evidence_contract.qnt` and `formal/reports/M4-evidence-contract.md` are **untracked**, and `formal-model-suite` governs exactly three models (`lane_lifecycle`, `eventlog_concurrency`, `audit_gate`). The fourth model is in no expectation row, no typecheck job, no drift gate. The release scope names four. A package whose entire purpose is catching models that stop discriminating would ship with one model unwatched. | Structural | **FIXABLE IN FLIGHT** — additive; add rows and commit the artifacts. |

### S1 — `lock-primitive-hardening`

| # | Finding | Class | Verdict |
|---|---|---|---|
| **L1** | **`flock` can never earn a trusted verdict.** `spec.md:18-20` selects `flock` only WHERE "a trusted, current verdict covers both `flock` and the filesystem class"; `spec.md:248` states WSL/Linux availability rests on "host-produced `syscall` evidence for `flock`"; and the only definition of `syscall` evidence (`spec.md:~130`, echoed by the probe requirement at `:60-75`) is "the create issued to the kernel and the kernel returning `EEXIST`". `flock` issues no create and returns no `EEXIST`. `contention` "MAY license `non-atomic` only"; `flavour` "MAY license no verdict at all"; the pinned register is seeded only with MSYS2 `mkdir.exe` (T5). The literal implementation reports `unknown` for `flock`, treats it as untrusted, and refuses every acquisition — on the release's own reference host. Scenario "WSL and Linux hosts take the flock path" (`spec.md:32`) is unreachable. Sharpest form: `design.md:124-150` justifies choosing `flock` with an 8-racer **contention** table — evidence the same package says cannot license `atomic`. | **Structural** | **BLOCKED** |
| **L2** | **The `pinned-mechanism` seed is circular.** T14 and T5 require "run the tracing probe on a Foreman-controlled MSYS2 / Git-Bash host, commit the trace artifact". `design.md:288,299` states that host class "ships no tracer" — that absence is the entire reason `pinned-mechanism` exists. No Windows tracing method is named anywhere in the package (zero hits for Process Monitor, ETW, API Monitor), and T4 explicitly excuses the PS1 mirror from producing syscall evidence. T7's gate — "with the fallback actually taken … A run in which every acquisition refused does not satisfy this line" — therefore cannot be satisfied as written. | **Structural** | **BLOCKED** (the package cannot be marked done) |
| **L3** | `strace` appears **nowhere** in `env/reference-manifest.toml` and is not installed by `env/bootstrap-wsl.sh`, yet host-produced `syscall` evidence is the WSL/Linux trust path. Compounded by the currency rule's 24-hour bound: a host whose inventory record ages out and that has no tracer falls back to a local probe that cannot earn a trusted verdict, and loses durable lanes. `flock` itself is `required = true` only for `hard`/`full`; the `durable` profile is `must = ["git","jq","coreutils","bash"]`. | **Structural** | **FIXABLE IN FLIGHT** — add the tracer to the durable profile and to bootstrap; but it must be decided, not left to the worker. |
| **L4** | The proposal's "What changes" claims "a mkdir-atomicity probe added to the WSL preflight (the `wsl-preflight` package already specced for this release)". `wsl-preflight` contains **zero** mentions of `mkdir`, `atomic`, `uutils` or `coreutils`. Orphaned cross-package claim, plus a sequencing inversion — `wsl-preflight` lands at S3, two stages after S1. The functional need is covered by L-package T4 (`tool-check.sh`), so nothing is lost, but the bullet has no owner. | Incidental | **FIXABLE IN FLIGHT** |
| **L5** | T8 says "convert the **nine** live packages"; the count is now ten. | Incidental | **FIXABLE IN FLIGHT** |

### S1 — `crlf-extensionless-hardening`

| # | Finding | Class | Verdict |
|---|---|---|---|
| **C1** | **The landing order and the package disagree on S1's scope.** `LANDING-ORDER.md` (revision 2, edited this round) reads: "S1 — `crlf-extensionless-hardening` (**widen to 34 scripts + `nats/setup.sh`**)". The package contains zero mentions of "34" or "nats" and covers three SDD scripts plus `.gitattributes`. The widening describes a **real** defect I confirmed: all 35 tracked files under `skills/foreman/scripts/` are mode `100644` in the index, `install.sh:62-63` chmods `scripts/*.sh` and `scripts/lib/*.sh` to `100755` in the working tree — leaving **33 permanent mode-change deltas** dirtying every checkout — and `skills/foreman/scripts/nats/setup.sh` sits outside that glob as the 34th. LANDING-ORDER was rewritten this round; the package was not touched at all (it is absent from `git status`). A worker gets contradictory scope, and S1's stated rationale ("the exec-bit fix unblocks a clean tree") is **not delivered by S1's contents**. | **Structural** (orphaning) | **BLOCKED** — one architect sentence: widen the package, or delete the clause. |
| **C2** | Fails `openspec validate --strict` (see G2). | Incidental | **BLOCKED** pending S0 |

Everything else in this package checked out. See below.

---

## Finding-rate judgement

*(finding-rate lane pending — this section states what this pass observed directly)*

**Defects are relocating, not merely diminishing — but the relocation is now
tracking a narrowing target.**

The evidence is L1, and it is unusually clean. Round 1 wired the probe to the
mechanism by demanding `atomic` on `syscall` evidence. Round 2 correctly found
that this made Git-Bash unreachable — the design records it in exactly the right
words: *"A probe that requires evidence the host cannot produce is the same defect
as a checker that cannot fail, and it was introduced by the fix for a different
instance of it."* The round-2 fix then added `pinned-mechanism`, restoring
Git-Bash — and left `flock`, the mechanism 100% of Linux and WSL hosts actually
use, with no satisfiable evidence class at all. **The unsatisfiable-gate defect
moved from the fallback host to the primary host across the fix that was written
to remove it.** That is textbook relocation, in the release's precondition stage,
at the third iteration.

Against that: what remains is genuinely narrower. The relocated defect is now
confined to one requirement and one undefined predicate rather than distributed
across a package; every one of the thirteen code anchors the package cites is
exact; the contention derivation reproduces byte-for-byte; the underlying bug
reproduces live. The structural class is **not empty** — L1, L2, C1 and G3 are
all structural, and L1 is severe — but it is smaller and better localised than
the prior rounds' descriptions suggest. The honest reading is that this release is
converging *slowly*, one relocation per round, and that a third fix round on S1
alone is likely to close it. The failure mode to guard against is declaring
convergence from a falling count: the count is falling and the class is not yet
empty.

One structural observation that should temper optimism: three of the four
structural findings in this pass (L1, C1, G3) were **introduced by the fix
rounds themselves**, not survivors from round 1. Concentrated concurrent editing
is currently generating structural defects at roughly the rate it closes them.

---

## Cross-fix contradictions introduced by concurrent editing

1. **`LANDING-ORDER.md` S1 vs `crlf-extensionless-hardening` (C1).** The landing
   order absorbed a scope widening that the package never received. The two files
   were edited by different actors; the package was not edited at all this round.
2. **`lock-primitive-hardening` proposal vs `wsl-preflight` (L4).** The lock
   package asserts a sibling delivers the atomicity probe at Setup; the sibling
   has never heard of it, and lands two stages later.
3. **`formal-model-suite` vs `formal/` (G3).** A fourth Quint model and its report
   were produced by a concurrent lane and left untracked; the governing package
   still says three, so the drift gate it introduces has a hole on day one.
4. **The round-2 evidence-class fix vs the round-1 mechanism-selection rule (L1).**
   Two fixes to the same requirement, each correct in isolation, jointly
   unsatisfiable for the primary mechanism.
5. **`LANDING-ORDER.md`'s own S4 rationale** ("Round ownership needs the S1 lock")
   is sound and correctly declared inside `round-ownership-default`
   (`proposal.md:104`, `design.md:132`) — noted as a *non*-contradiction, because
   it is the shape the other four failed to take.

---

## What I verified and found correct

- **The problem S1 exists to solve is real, and I reproduced it live.**
  `/usr/bin/mkdir` on this box is **uutils coreutils 0.8.0**; `/usr/bin/gnumkdir`
  is **GNU 9.7** — the hybrid-coreutils premise holds exactly as described.
  `bats -f "el_attempt_new under concurrent contention" tests/eventlog.bats`
  **fails**, with the precise signature the proposal names:
  `mv: cannot stat '…/lane-a.attempt.tmp': No such file or directory`.
- **All thirteen code anchors cited by `lock-primitive-hardening` are exact** —
  `eventlog.sh:70` (the false "mkdir is atomic" comment), `:76`, `:221`, `:351`
  (the three `while ! mkdir` spin-loops), `:52`/`:57` (the `rmdir` reclamation),
  `:195`; `wt-new.sh:186`, `:192`, `:203` (the literal "proceeding
  unsynchronized" fail-open); `bootstrap-wsl.sh:411`; `worktree.sh:154`;
  `task-new.sh:26`. Not one had drifted. This is the strongest signal in the
  package.
- **Every factual claim in `crlf-extensionless-hardening` checks out.** The three
  SDD scripts are mode `100644` (exec-bit trap real); `git ls-files --eol` reports
  `i/lf  w/lf  attr/` for all three — index LF, working tree LF on this ext4
  clone, attribute unspecified — matching the proposal's careful, narrowed claim
  verbatim. `install.sh`'s chmod glob is exactly as described. This package
  corrected an earlier overstatement honestly and its evidence holds.
- **`LANDING-ORDER.md`'s contention table reproduces byte-for-byte.** Re-running
  `contention-derive.py` yields all thirteen rows with identical counts and
  identical claimant lists: peak 7 on `config/foreman.toml.example` and
  `lane-run.sh`, 6 on `env/tool-check.sh`. The `.example` suffix regex fix is
  present and correct, and the script stamps its derivation HEAD as claimed. The
  revision-2a self-correction is sound.
- **Stage coverage is complete and non-overlapping.** All 33 live packages appear
  in exactly one stage or in Deferred; none is missing.
- **The S0 collision is real.** `test-harness-fork-tax` and
  `test-infrastructure-hardening` both declare a `specs/test-harness/` capability
  — the only duplicate capability directory across all 33 packages.
- **The refusal-code work is genuinely good.** The six-code enum is total,
  ordered, and disjoint by code path; the round-2 additions
  (`FM_LOCK_FS_UNSUPPORTED` for *unsafe*, `FM_LOCK_UNAVAILABLE` as residual) close
  states round 1 had no code for, and the "one shape scoped to the refused
  acquisition" rewording correctly fixes an invariant that was unsatisfiable for
  `FM_LOCK_NESTED`. Independent of L1, this requirement is dispatch-ready.
- **The filesystem-class dimension is a real improvement**, not ceremony: a
  verdict earned wherever `tool-check.sh` happened to run was previously
  "trusted and current" for a lock taken on DrvFs, 9p, NFS or a UNC share.

---

## What I could not check

- **Git-Bash / Windows behaviour.** Every claim about MSYS2 `mkdir.exe`, the
  `autocrlf=true` working-tree CRLF reproduction, and the absence of a tracer on
  that host is taken on the package's word. The CRLF red-first proof (part b) can
  only run there, and I ran nothing on that host.
- **Apalache results.** `apalache-mc` is not on PATH here. Every VIOLATED/HOLDS
  figure quoted in `lock-primitive-hardening` T9-T12 (`index_fail_open_atomic` at
  8/12 steps, `nats_owner_token_sound` at 10 steps, `nested_atomic` deadlock at 5
  steps) is unverified by me. Quint 0.32.0 is present; I did not re-typecheck.
- **The uutils violation counts** (57 vs 0 over 15 rounds of 8 racers) and the
  `flock` filesystem table in `design.md:124-150`. I confirmed the mechanism and
  the flavour split, not the measured numbers.
- **Whether the parallel Sol lane reached the same S1 conclusion.** No
  coordination, by instruction.
- **Anything a running worker would surface.** This is a static read; several
  findings classified fixable-in-flight are judgements about implementer
  latitude, not proofs.

---

## Recommended order of operations before dispatch

1. Commit the fix round (**G1**). Nothing else is safe until worktrees see it.
2. Make the S0 conformance decision and execute it; archive the two merged
   packages (**G2**, S0).
3. Define `flock`'s trusted-evidence predicate, or drop `flock` from the
   verdict requirement and gate it on filesystem class alone (**L1**).
4. Name the Windows tracing method and add it to the manifest, or downgrade T7's
   Git-Bash line to "refusal path verified, pinned path deferred" (**L2**).
5. One sentence resolving S1's scope: widen the package to 34 scripts, or delete
   the clause from the landing order (**C1**).

Items 1, 2 and 5 are minutes. Items 3 and 4 are an architect decision each. Then
S1 dispatches, and it should — the bug is real, it reproduces, and the package
around the defect is the most carefully evidenced work in this release.
