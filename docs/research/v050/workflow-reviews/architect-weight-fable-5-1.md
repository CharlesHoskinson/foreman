# Architect weight review (Claude Fable 5.1)

Scope: what the architect must read and do per change. Measured read-only on
the reference WSL2 host at commit `07f4569` on 2026-09-05. Token figures use
two estimators, `bytes/4` (upper) and `words*1.33` (lower); the table quotes
`bytes/4` unless marked.

## Where the weight is

| Step or artifact | Evidence (file:line or measurement) | Cost class | Why it exists (safety property it buys) |
|---|---|---|---|
| The mandated read set: `SKILL.md` + 14 references + `CLAUDE.md` + `AGENTS.md` + `AGENT_TRAPS.md` + foreman-qa plugin (5 skills, 7 references, 2 commands, 1 agent) + `agents/*.md` | 334,618 bytes = 83.7k tokens (`bytes/4`) or 63.8k (`words*1.33`). Breakdown: SKILL 7.2k, references 34.6k, CLAUDE 2.6k, AGENTS 0.4k, TRAPS 10.1k, plugin 20.5k, agents 6.3k, `devlog/README.md` 0.8k, `RESUME.md` 1.2k | Tokens, every cold session | One doctrine for every architect model; incident-derived rules survive session loss |
| The practical floor a session actually loads before working: `CLAUDE.md`, `SKILL.md`, `AGENT_TRAPS.md` (ordered "in full"), `foreman-qa` + `foreman-code-quality` + preflight, two agent definitions | 26.4k tokens | Tokens, every cold session | Same as above |
| `SKILL.md` Endstop CLI grammar | `skills/foreman/SKILL.md:242-328`: 86 of 513 lines (17%) are flag syntax for `execution-guard.js`, `release-authority.js`, `lane-queue.sh`; the same grammar is owned by `packages/orchestration/src/execution-guard-cli.ts`, `queue-cli.ts`, `release-authority-cli.ts` (15 distinct `--endstop-*`/`--release-*` flags) | Tokens per session; human steps per round (25 hand-copied values in the V2 block) | Contract-bound dispatch; no uncontracted queue request |
| The soft loop restated | `wt-consolidate` appears in `CLAUDE.md` (2), `SKILL.md` (4: "Parallelism", "Session startup checklist"), `references/parallel-worktrees.md` (4), `README.md` (3), `docs/USAGE.md` (4). The same loop is written out in prose three times in `SKILL.md`+`CLAUDE.md` alone | Tokens | None beyond the first statement |
| Release-history references read as doctrine | `orchestration-hardening.md` 9.7k tokens, 30 version/task tags (`v0.2.5 T4b`, `Rework round 1`, `package 4`); `release-metrics.md` 4.8k tokens, 20 tags; `reference-environment.md` 4.0k, 12 tags. These three are 18.5k of the 34.6k reference tokens | Tokens | Launcher contract, merge-freshness verdicts, metric definitions; the operational part of each is under a quarter of its length |
| References nobody consults | Citation count (SKILL.md / scripts+agents+plugins+packages / other references): `captured-facts.md` 0/0/0; `regression-tier-budgets.md` 0/0/1; `index.md` 0/0/0 (root docs 1); `audit-checklist.md` 1/0/1; `release-metrics.md` 2/0/1; `model-routing-evidence.md` 2/0/0. Only `durable-lanes.md`, `lanes.md`, `orchestration-hardening.md`, `parallel-worktrees.md` are cited from code (`lib/config.sh`, `lib/telemetry.sh`, `git-guards.sh`, `wt-new.sh`, `nats/setup.sh`). `agents/*.md` cite no reference at all | Tokens | None measurable |
| `AGENT_TRAPS.md` "read this in full before doing anything" | `AGENT_TRAPS.md:1,5`: 578 lines, 10.1k tokens, 24 sections, 16 commits, last change 2026-08-13. No script or agent definition enforces or even names the read; only `plugins/foreman-qa/commands/foreman-qa-preflight.md:14` cites section 1. Several rows are already enforced in code (secrets scan `lane-run.sh:377-423`; containment probe; `lane-complete-check.sh`) or describe a retired state (`npx openspec`, `/root` cwd, the 33/41 filemode rows) | Tokens per session and per dispatched lane | Twelve wrong checkers in one day (section 2); eight standing rules (section 3) |
| Session store step 0 | `CLAUDE.md:59` and `RESUME.md:21,74,75,104` order `python3 skills/foreman/scripts/fm-session.py recover`; `find . -name "fm-session*"` finds no such file. The entry point is `skills/foreman/runtime/dist/fm-session.js`. `AGENT_TRAPS.md:33`: even `--help` bootstraps a store migration. `openspec/changes/session-store-recovery/proposal.md` records that on 2026-09-05 `recover` refused to open the store | Human steps: one dead command plus a diagnosis per cold session | The only durable record of facts, measurements, obligations |
| Setup stage | `foreman-setup.sh --profile soft` (vendor `--version` probes, `tool-check-run.ts:285-341`), `verify-install` (measured 0.10 s), Fable canary (vendor CLI), graphify freshness gate (`SKILL.md:110-114`): measured `_tag: "Stale"` at `07f4569` with eight missing source paths, so the graph step is always "read source directly" | Seconds of machine time; three to five human steps | Use never starts on an unauthenticated or wrong-model lane |
| Endstop contract creation | Contract JSON (`~/.foreman/runs/council-binding-20260905/execution-contract.json`): four SHA-256 fields (objective, acceptance, allowed paths, authorization), ten limits, four milestones; the architect hashes three inputs by hand, runs `create`, keeps id and sha, then repeats six (V1) or fifteen (V2) flags on every `lane-queue.sh add` | Human steps: about five commands and 25 values per round | Terminal-condition control: no unbounded retry, no new contract for terminal work |
| Worktree fan-out for search, plan, audit | `CLAUDE.md` soft loop and `SKILL.md` startup checklist mandate `wt-new` for search + plan (+ audit) before implement. `wt-new.sh` installs no dependencies (no `npm ci` in `wt-new.sh` or `lib/worktree.sh`); `node_modules` is 799 MB, 162 lock packages. `devlog/2026-09-05.md`: "The worktree had no `node_modules`. After `npm ci` every step passed" (one failed verification round). `foreman-search` runs `model: haiku`, `effort: low` | Minutes per worktree, plus one lost round per fresh tree | Isolation: one report per role, main checkout never an implementer target |
| Consolidation | `pidns-remedy-20260905`: three reports of 821, 879, 1,387 words produce a 2,145-word `CONSOLIDATED.md` (about 2.9k tokens) which the architect reads in addition to the diffs | Tokens | Never merge on a partial report |
| Docs gate | `docs-check.sh` measured 4.6 s, and red on a clean checkout: markdownlint fails on `docs/reference/models/raw/grok-4.5--docs-x-ai-docs-overview.md` (tracked since 2026-08-30, not in `.markdownlint-cli2.jsonc` ignores) and codespell fails on `formal/specs/foreman_lifecycle.qnt` (`allReady`). `foreman-qa-preflight.md` step 4 orders the gate before every commit, so every "done" claim starts with diagnosing a pre-existing red | Human steps per change; a gate that cannot pass (`brokenwindows.md` rule 3) | Markdown, spelling, links, shdoc coverage, no raw vendor argv in agent prose |
| Per-round independent check | `.foreman/config.toml [checks] command`: `git init && commit && npm ci --ignore-scripts && npm run verify`; `verify` = typecheck (measured 6.2 s) + 2,064 TS tests + `verify-runtime` (27 bundles built twice, 17.8 MB) + appliance-lock + register-doc + smoke. Runs per round, per worktree | Minutes per round | Independent verification from a pristine commit, never the dirty tree |
| The round itself | `council-binding-20260905*/events.jsonl`: `prompt` to `ownership` 1 s; `verifying` to `round_done` 3-26 s; model time 5-31 min per round; gaps between rounds (architect ceremony) 2-15 min. The three Codex rounds in `pidns-remedy-20260905` ran without `lane-run` (no `events.jsonl` in the run dir) and still took 21:08 to 23:10 from base commit to PR merge for 1,661 lane lines (`git log 2026-09-04`) | Minutes: lane-run overhead is small; the weight sits between rounds | Round ownership, heartbeat, attempt-fresh report |
| Merge and policy | `merge-gate.sh check` + `wt-merge.sh` + `policy-check` (plain `npm run policy-check` returns `schema_mismatch`; `--base` needed, measured 0.6 s) + bundle regeneration + `verify-runtime` when `packages/orchestration` changed (`AGENT_TRAPS.md:34`) | Minutes; four to six human steps per lane | Stale-branch refusal, architecture policy, deterministic bundles |
| Close-out | `CLAUDE.md` "Close out the day": six-section devlog written from `git log` (entries 65-250 lines; 7 entries, 942 lines), plus `plugin-lessons.sh candidates`, session store record, `AGENT_TRAPS.md` addition on any new trap | 10-15 min and about 2k tokens per session, independent of change size | The only append-only record of what went wrong |

### Estimate: one-file change (soft mode, doctrine as written)

| Quantity | Value | Basis |
|---|---|---|
| Architect steps | 28 top-level (34 with preflight sub-steps): recover, read set, setup, verify-install, graph check, wt-new x2, spawn x2, consolidate, spec, contract file, create, wt-new implement, queue add, watch, read diff, `npm ci`, verify, docs-check, wt-new audit, auditor, consolidate, merge-gate, wt-merge, policy-check, preflight (6), cleanup, devlog + lessons + store | `CLAUDE.md` "Always" and "Soft loop"; `SKILL.md` "Session startup checklist", "Soft verification + audit"; `foreman-qa-preflight.md` |
| Architect tokens | 26.4k read floor + 10-13k working (spec 0.8k, consolidated 1.5k, diff 1-2k, verification output 2-4k, verdict 1-2k, gate output 1k, devlog 1.5k, cleanup 0.5k) = 37-40k | Measured file sizes; report sizes in `~/.foreman/runs` |
| Wall clock | 45-60 min: setup 5, fan-out 10, spec 5, contract + queue 5, round 5-15, `npm ci` + verify 5-10, audit 10-15, merge + gates 5, devlog 10 | Round and gap timings from `events.jsonl`; devlog addendum |

### Estimate: three-package change (like `pidns-remedy-20260905`)

| Quantity | Value | Basis |
|---|---|---|
| Architect steps | About 3x the per-lane steps: 60-70 | Three worktrees, three specs, three `npm ci`, three verify runs, three merges, one policy-check, bundle regeneration, one devlog |
| Architect tokens | 26.4k floor + 3 x (spec 1k + report 1.2k + diff 3k + verify 2k + rework 2k) + consolidated 2.9k + audits 4k + merge/policy 2k + devlog 2.5k = about 65k | Same sources |
| Wall clock | Measured 2 h 02 min from base `d85b895` (21:08) to PR #55 merge (23:10) for 1,661 lane lines; about 3 h with the diagnosis that preceded it | `git log --since="2026-09-04"` |

## Ranked proposals

### 1. Small-change mode: a tiered fast path with mechanical entry criteria

What changes. Add a change tier, `small` or `full`, declared in the five-part
spec and re-derived from the diff after the round. Entry criteria for `small`,
all required: at most 3 files and 150 changed lines in one package or script
directory; no path under `[gate] forbidden_paths` or `hash_paths`; no
security-sensitive path (`launcher/`, `scripts/adapters/`, `lib/audit-call.sh`,
credential, secret-scan, containment code); spec `determinability: determined`;
a Verification command that finishes inside the Tier 1 budget (30 s,
`references/regression-tier-budgets.md`); no runtime bundle change unless the
regenerated bundle is part of the diff. `small` skips: search and plan
worktrees (the architect reads the files directly); the V2 release block (a
single-action contract from proposal 7 with tier default limits); the
cross-vendor audit round (the architect's diff read plus the independent check
stands, which `SKILL.md:137` and `audit-checklist.md:23` already permit but
without criteria); the full `npm run verify` per round (proposal 9); the
six-section devlog (proposal 10). `small` keeps: an implement worktree, host
commits, containment probe, read-the-diff, re-run verification, `merge-gate.sh
check`, `policy-check --base`, forbidden-path gate. The tier is enforced twice:
the queue refuses a `small` request whose spec names more files than allowed,
and the round gate refuses a `small` verdict when `lane_files_changed`
(`lane-run.sh:1407`) or the line count exceeds the tier, which upgrades the
change to `full` and does not merge it.

Expected speedup. One-file change from 45-60 min and 37-40k tokens to about
15 min and 12-15k tokens: removes two worktree provisions (proposal 5 makes the
remaining one cheap), one audit round (10-15 min measured today), the full
verify (minutes), and the devlog essay (10 min). Steps from 28 to about 12.

Safety property touched. Cross-vendor audit and fan-out are narrowed, not
removed; every enforcement that lives in scripts stays. The post-diff re-check
makes misclassification fail closed.

Effort M. Risk: medium (a change that looks small but touches shared
behavior); mitigated by the security-path list and the mechanical upgrade.

Files: `skills/foreman/SKILL.md` (new "Change tiers" section),
`skills/foreman/references/five-part-spec.md` (tier field),
`packages/orchestration/src/queue-admission.ts`, `round-contract.ts`,
`round-reducer.ts`, `.foreman/config.toml` (`[tiers]`),
`agents/grok-implementer.md`, `agents/codex-implementer.md`,
`plugins/foreman-qa/commands/foreman-qa-preflight.md`.

### 2. Doctrine compression: a 150-line operating core, one statement per rule, grammar owned by `--help`

What changes. `SKILL.md` becomes an operating core: mode selection, lanes
table, the deciding rules, the five-part contract, the tier rules, the "never"
list, and one statement of the loop. Every standing rule survives as one line
with an id and a pointer. The Endstop CLI grammar (`SKILL.md:242-328`) moves
out of prose; `execution-guard.js --help`, `lane-queue.js --help`, and
`release-authority.js --help` become the documented source, and
`references/durable-lanes.md` keeps one worked example. `CLAUDE.md` drops the
duplicated loop, the devlog essay, and the graph essay (they become one rule
each). The three history-heavy references (`orchestration-hardening.md`,
`release-metrics.md`, `reference-environment.md`) split into a short
operational section at the top and a "history" section below a marker that no
doctrine orders anyone to read. `captured-facts.md`, `regression-tier-budgets.md`
and `index.md` are either cited from the core or moved under `docs/`.

Expected speedup. `SKILL.md` 7.2k to about 2.5k tokens; `CLAUDE.md` 2.6k to
about 1.2k; read floor 26.4k to about 12k per cold session (a 55% cut) before
`AGENT_TRAPS.md` (proposal 3). At the measured churn (`SKILL.md` 27 commits,
`CLAUDE.md` 14) the compressed text is also cheaper to keep true.

Safety property touched. None of the rules change. The
`doctrine-reality-drift` claim registry (`doctrine-check.js`, fourteen claim
ids in the v0.5 plan P11) guards that the compressed text still carries every
load-bearing claim; add a rule inventory: every numbered or bold rule in the
old text maps to an id in the new, and the diff of ids is empty.

Effort M. Risk: low if the rule inventory is built before the rewrite.

Files: `skills/foreman/SKILL.md`, `CLAUDE.md`,
`skills/foreman/references/index.md`, `orchestration-hardening.md`,
`release-metrics.md`, `reference-environment.md`, `README.md`,
`docs/USAGE.md`, `docs/doctrine-claims.tsv` (owned by
`openspec/changes/doctrine-reality-drift`).

### 3. Retire "read `AGENT_TRAPS.md` in full": classify every trap as enforced, checkable, or manual

What changes. Each row and section gets one status. `enforced-by:<script>`
rows (secrets refusal, containment, attempt-fresh report, lane-complete-check,
policy filemode check) leave the must-read and stay as history.
`checkable` rows become probes in `doctrine-check` or the preflight
(`npx openspec` resolution, `/root` cwd, `FORCE_COLOR`/`NO_COLOR` in the test
harness, rebuilt-bundle drift). `manual` rows and the eight standing rules of
section 3 form a symptom-indexed table of about 80 lines that the preflight
cites by symptom. Dispatched lanes receive the manual table inline in the
spec's Constraints (which `five-part-spec.md` already requires for facts), not
a pointer to a 578-line file.

Expected speedup. 10.1k to about 2k tokens per session, and the same per
dispatched lane that is told to read it. The `foreman-qa-preflight` step 1
consult becomes a table lookup.

Safety property touched. Incident-derived rules; preserved by making the
enforceable ones executable and the rest shorter, not absent.

Effort M. Risk: low; the probes are positive-control tested like every other
checker (`foreman-qa` discrimination rule).

Files: `AGENT_TRAPS.md`, `plugins/foreman-qa/commands/foreman-qa-preflight.md`,
`plugins/foreman-qa/skills/foreman-qa/references/failure-catalogue.md`,
`packages/policy/src/` (doctrine-check probes), `tests/`.

### 4. Right-size the per-round check to the tier; run the full verify once at merge

What changes. The round gate for a `small` or single-package round is the
spec's Verification command plus `npm run typecheck` (6.2 s) plus
`policy-check --base` (0.6 s). The full `npm run verify` (2,064 tests,
`verify-runtime` double build, appliance lock, register doc, smoke) runs once
per branch at `merge-gate.sh check`, and `tools/ci-local.sh` stays the release
authority. `checks-run.sh` keeps the pristine-commit archive for both.

Expected speedup. Per-round gate from minutes to under 30 s (Tier 1 budget);
with three rounds per package this is the largest wall-clock cut after
proposal 1, and it also stops the gate from starving lanes that share the host.

Safety property touched. Independent verification from a pristine commit is
kept; full verification still precedes every merge.

Effort S. Risk: low.

Files: `.foreman/config.toml` (`[checks]` per tier),
`skills/foreman/scripts/checks-run.sh`, `skills/foreman/scripts/merge-gate.sh`,
`skills/foreman/references/regression-tier-budgets.md`.

### 5. Provision worktree dependencies at `wt-new`, from a per-lockfile store

What changes. `wt-new.sh` (and the TypeScript worktree service that replaces
it) populates `node_modules` from `~/.foreman/deps/<sha256(package-lock.json)>/`
using a hardlink copy (`cp -al`), never a symlink, because `verify-runtime`
refuses a symlinked `node_modules` (v0.5 predicate 6). A cache miss runs
`npm ci --ignore-scripts` once into the store.

Expected speedup. Removes the lost first round per fresh worktree recorded in
`devlog/2026-09-05.md` (10-20 min each) and reduces a 799 MB install to
seconds. Makes proposal 1's single worktree nearly free.

Safety property touched. "A worktree verification result is invalid until the
worktree has its own installed dependencies" (devlog standing rule) is made
true by construction.

Effort S-M. Risk: low; the store is keyed by lockfile hash.

Files: `skills/foreman/scripts/wt-new.sh`, `skills/foreman/scripts/lib/worktree.sh`,
`packages/orchestration/src/resume-worktree-restore.ts`,
`scripts/verify-runtime.ts` (recognize the store).

### 6. Make the docs gate green on a clean tree and scoped to changed files

What changes. Add `docs/reference/models/raw/**` to the markdownlint ignores
(it is a raw vendor-docs archive, the same class as `docs/research/**`) and
`allReady` to the codespell list, so the gate passes at HEAD. Add
`docs-check.sh --changed [BASE]` that lints only `git diff --name-only BASE`
files for the per-change run; the full run stays in `tools/ci-local.sh`.
Record the current red as a `brokenwindows.md` row until fixed.

Expected speedup. Per-change docs gate from "diagnose a pre-existing red"
(minutes of attention per commit) to under one second with attributable
findings.

Safety property touched. None; a gate that is red on a clean tree enforces
nothing.

Effort S. Risk: none.

Files: `skills/foreman/scripts/docs-check.sh`, `.markdownlint-cli2.jsonc`,
`.codespellrc`, `plugins/foreman-qa/commands/foreman-qa-preflight.md`,
`brokenwindows.md`.

### 7. Derive the Endstop contract and the queue block from the spec

What changes. `execution-guard.js create --from-spec SPEC.md --tier small|full`
hashes the Objective, Verification (acceptance) and Files (allowed paths)
sections, applies tier default limits from config, writes the contract, and
emits a `RELEASE_BLOCK` file. `lane-queue.sh add GROUP --release-block-file
ABS -- CMD` replaces the fifteen-flag block; the queue still validates every
field exactly as today.

Expected speedup. Contract plus queue from about five commands and 25
hand-copied values to two commands; removes the hand-copy error class.

Safety property touched. Contract immutability, digest binding, terminal
state, and refusal of uncontracted requests are unchanged; the helper only
produces inputs the existing validators check.

Effort M. Risk: low.

Files: `packages/orchestration/src/execution-guard-cli.ts`,
`execution-contract.ts`, `queue-cli.ts`, `queue-admission.ts`,
`skills/foreman/SKILL.md`, `skills/foreman/references/durable-lanes.md`.

### 8. Make search/plan fan-out opt-in above a size threshold

What changes. Fan-out is required only when the write set is unknown or the
change spans more than three packages; otherwise the architect reads the files
directly. `pidns-remedy-20260905` shipped with three implement worktrees and no
search or plan tree, which shows the mandate is already ignored when it does
not pay.

Expected speedup. Two worktrees, two agent spawns, one consolidate, and about
3k tokens per medium change; about 5-10 min.

Safety property touched. None; search and plan are advisory.

Effort S. Risk: none.

Files: `CLAUDE.md`, `skills/foreman/SKILL.md`,
`skills/foreman/references/parallel-worktrees.md`.

### 9. One true session preamble: fix the `fm-session` path and add `recover --brief`

What changes. Replace every `fm-session.py` reference with the compiled entry
point, and add `--brief` (about 40 lines: head, fresh measurements, open
obligations, doctrine version) that becomes the whole warm-session preamble,
so a warm session does not re-read the doctrine set. The
`session-store-recovery` package already owns recover-on-fresh-clone.

Expected speedup. One dead command and its diagnosis removed per cold
session; warm sessions start in under a minute.

Safety property touched. The durable record stays the first thing read.

Effort S. Risk: none.

Files: `CLAUDE.md:59`, `RESUME.md:21,74,75,104`,
`packages/orchestration/src/fm-session-main.ts`.

### 10. Close-out proportional to the session

What changes. `fm-session close` writes a ledger row (commits, measurements,
obligations) automatically; the six-section devlog is required only when the
session had a failed round, which `events.jsonl` shows mechanically
(`round_incomplete`, `AGENT_ABANDONED`, `containment_refused`, gate rc != 0)
or when the architect records a wrong claim. `plugin-lessons.sh candidates`
runs per release, as `CLAUDE.md` already states, not per session.

Expected speedup. 10-15 min and about 2k tokens per small session.

Safety property touched. The append-only failure record stays mandatory for
every session that had a failure; the rule fires on evidence, not on habit.

Effort S. Risk: low.

Files: `CLAUDE.md`, `devlog/README.md`,
`packages/orchestration/src/fm-session-main.ts`.

## What must not be cut

- Read the diff and re-run the verification yourself. `AGENT_TRAPS.md` section
  2: twelve checkers returned a confident wrong answer in one day.
  `devlog/2026-09-05.md`: Codex reported clean runs its sandbox could not have
  made; the architect's re-run found the difference.
- Cross-vendor audit for multi-file or security-sensitive work, with family
  refusal in `lib/audit-call.sh`. Small mode narrows the trigger; it never
  lets an implementer vendor audit itself.
- The host commits; the worker never commits; forbidden paths and hash drift
  gate (`references/security-model.md`, `.foreman/config.toml [gate]`).
- Round ownership at the `lane-run` boundary and the containment probe.
  `devlog/2026-09-05.md`: a strong round left zero survivors under SIGTERM; a
  degraded round left a `setsid` survivor.
- Bats only under the host-wide mutex (`AGENT_TRAPS.md` section 5 and trap 10:
  the suite's verdict depends on how it was launched).
- Endstop terminal state: no new contract to continue terminal work, no
  uncontracted queue request (`SKILL.md` Endstop section). Proposal 7 changes
  how the contract is produced, not what it binds.
- Attempt-fresh report assertion. `council-binding-20260905/events.jsonl`
  seq 37-38: `report_fresh: false` caught a round that had exited "done".
- Pristine-commit checks (`checks-run.sh:2,86`), kept for both tiers.
- Rebuild the bundle and run `verify-runtime` on any change under
  `packages/orchestration/src` (`AGENT_TRAPS.md:34`: two tasks shipped against
  a stale bundle).
- The append-only failure record. `devlog/README.md`: four competing resume
  documents accumulated and none carried the failures. Proposal 10 keeps the
  six-section entry mandatory whenever a failure occurred.
- The dependency rule for worktrees (proposal 5 makes it automatic, not
  optional).

## Measure first

Proposal 1 (small-change mode): what fraction of real changes would qualify,
and what the ceremony between rounds costs today.

```bash
cd /home/charl/foreman
# Share of non-merge commits in the last 90 days within the small tier (<=3 files, <=150 lines)
git log --since=90.days --no-merges --format=%h | while read h; do
  git show --shortstat --format= "$h" | awk -v h="$h" '/files? changed/ {f=$1; l=$4+$6; print h, f, l, (f<=3 && l<=150) ? "small" : "full"}'
done | awk '{n[$4]++} END {for (k in n) print k, n[k]}'
# Ceremony between rounds: gap from one round_done to the next prompt, per run
python3 - <<'PY'
import json,glob,datetime as d
for f in sorted(glob.glob('/home/charl/.foreman/runs/*/events.jsonl')):
    ev=[json.loads(l) for l in open(f) if l.strip()]
    last=None
    for e in ev:
        t=d.datetime.fromisoformat(e['ts'].replace('Z','+00:00'))
        if e['type']=='prompt' and last: print(f.split('/')[-2], 'gap_min', round((t-last).total_seconds()/60,1))
        if e['type']=='round_done': last=t
PY
```

Proposal 2 (doctrine compression): the read floor and the rule inventory
before any rewrite.

```bash
cd /home/charl/foreman
# Token estimate of the read floor, both estimators
for f in CLAUDE.md skills/foreman/SKILL.md AGENT_TRAPS.md plugins/foreman-qa/skills/foreman-qa/SKILL.md \
         plugins/foreman-qa/skills/foreman-code-quality/SKILL.md plugins/foreman-qa/commands/foreman-qa-preflight.md \
         agents/grok-implementer.md agents/codex-auditor.md; do
  printf '%6d %6d %s\n' $(( $(wc -c <"$f") / 4 )) $(( $(wc -w <"$f") * 133 / 100 )) "$f"; done
# Rule inventory: every numbered, bold, SHALL, or never/must line becomes an id before the rewrite
grep -nE '^\s*[0-9]+\.|^- \*\*|SHALL|\bnever\b|\bNever\b|\bmust\b' CLAUDE.md skills/foreman/SKILL.md AGENT_TRAPS.md | wc -l
# Which references any script, agent, or plugin cites (zero-citation files are the first to move)
for f in skills/foreman/references/*.md; do b=$(basename "$f"); \
  echo "$(grep -rl "$b" skills/foreman/scripts agents plugins packages/*/src skills/foreman/SKILL.md 2>/dev/null | wc -l) $b"; done | sort -n
```

Proposal 4 (per-round check right-sized): the current cost of the round gate
against the Tier 1 budget, and the targeted alternative.

```bash
cd /home/charl/foreman
time npm run typecheck                         # measured 6.2 s
time npm test                                  # full TS suite, the per-round cost today
time npm run verify-runtime                    # double build of 27 bundles; writes tracked output, run on a scratch clone
time npx tsx scripts/run-tests.ts "packages/launcher/src/**/*.test.ts"   # one package, the targeted gate
time node skills/foreman/runtime/dist/architecture-policy.js check --base HEAD~1   # measured 0.6 s
# npm ci cost that every fresh worktree pays today (scratch clone, not the checkout)
git clone -q --shared /home/charl/foreman "$SCRATCH/wt" && cd "$SCRATCH/wt" && time npm ci --ignore-scripts
```

## Model self-identification

Running as Claude Fable 5.1 (`claude-fable-5-1`). This is a self-report; no
canary was run for this review.
