# foreman v0.2.8.1 — field-failure fixes (design)

**Status:** approved (brainstorming, 2026-07-19). **Source:** four field failures
from the first real external run (Midnight target), logged in `bugeventlog.md`
(commit `d359b49`) and independently deep-debugged/verified before this design.

**Goal:** close the four v0.2.8 field failures so a fresh operator can install
the skill on Windows, run a grok lane that actually writes, authenticate codex
headlessly, and orchestrate against a stateful/live target — packaged as a
**v0.2.8.1** patch. Execution: Sonnet 5 implements, Opus 4.8 audits; each change
gated on a quiet host before merge.

**Non-goals:** a full grok stdio-protocol driver (documented future option, not
built here); reworking the durable-lane machinery; any change to the hard-mode
container work shipped in v0.2.8.

---

## Issue 1 — install.ps1 Windows link is fragile (cmd-shelling)

**Problem / root cause.** `install.ps1:48` links skills via
`cmd /c mklink /J "$Link" "$Target" | Out-Null`. A real operator hit a
PowerShell `ParserError` at char 26 on this line; the run aborted and the
Windows skill never became invocable (WSL `install.sh` was unaffected). Deep
debug could **not** reproduce the exact parse error on this host (PS 5.1 and
7.6.2 both parse and run the line), so it is version/context-specific — but
shelling to `cmd` with interpolated quoted paths is an inherently fragile class.

**Fix.** Replace the line with the native, parser-safe
`New-Item -ItemType Junction -Path $Link -Target $Target | Out-Null`
(available PS 5.0+; verified working here, produces `LinkType=Junction`). No
`cmd`, no quoting hazard. Behavior is identical (a directory junction).

**Testing.** (a) A new CI workflow `.github/workflows/windows-smoke.yml` runs on
`windows-latest`: check out the repo, run `install.ps1` with `HOME`/skills root
pointed at a temp dir, assert each expected junction exists and its `.Target`
resolves back into the repo `skills/`. (b) Local verification: run install.ps1
on this host, assert `/foreman` (and sibling skills) link + are invocable.
Current CI is only `maintenance.yml`; this is a new, independent job.

---

## Issue 2 — grok `--prompt-file` single-burst writes NOTHING on exploration-heavy specs

**Problem / root cause.** `grok --prompt-file SPEC …` (the invocation in
`agents/grok-implementer.md:97`) is a **single agentic burst**: grok runs one
bounded turn-set and exits. On any spec that asks grok to read/introspect before
writing, the whole burst is spent orienting and **zero files are written** —
even with `--allow Write --allow Edit`. This is a **distinct** failure from the
"cancelled-writes" case the current doctrine warns about (there the writes are
attempted-then-denied; here they are never reached). `--max-turns` on the
top-level `grok` did not visibly extend the burst. grok's genuine multi-turn
lives in `grok agent stdio` (a JSON turn protocol) and `grok agent headless`
(needs the xAI **WebSocket relay** — a network service); neither is a drop-in
for `--prompt-file`.

**Fix — three parts.**

1. **Write-first doctrine** (`agents/grok-implementer.md`, `references/lanes.md`):
   state that `--prompt-file`/`-p` are single-burst; the five-part spec's FIRST
   instruction handed to grok MUST be a concrete Write with every needed API
   fact **inlined** (zero required reads before the first Write). Add an explicit
   "empty-burst" failure mode, separate from "cancelled-writes", each with its
   own diagnostic hint.

2. **Evidence gate (coded).** A shared helper computes `files_changed` across the
   grok invocation (reusing the existing before/after `git status --porcelain`
   digest contract) and treats `files_changed == 0` on a STATUS-complete run as a
   **FAILED round**, emitting a distinct empty-burst hint ("grok exited mid-orient
   before any Write — re-issue a write-first spec, or use grok-multiround").

3. **Multi-turn routing (coded, mechanism B — bounded re-prompt loop).** A new
   `skills/foreman/scripts/grok-multiround.sh SPEC [--max-rounds N] -- <grok args>`:
   invokes `grok --prompt-file` up to N rounds (default 3); after each round it
   measures `files_changed`; on `>0` it returns success with the round count; on
   `0` it re-invokes with the SAME spec **plus a fed-forward preamble** ("Prior
   round produced no file changes and only orientation narration; do NOT read
   first — Write the deliverable now. Prior narration: <captured>"). If all N
   rounds yield 0 changes, it returns the FAILED-round empty-burst signal. This
   gives explore-then-implement resilience without grok's fragile stdio protocol
   (which remains a documented future option). The `grok-implementer` agent and
   the hard-mode `worker-run.sh` grok path both route through this helper.

**Components.** `grok-multiround.sh` (new, self-contained; takes a real-or-shim
`grok` on PATH). Doctrine edits to `grok-implementer.md` + `lanes.md`.

**Testing.** `tests/grok-multiround.bats` with a fake `grok` shim: (a) round-1
writes nothing, round-2 writes a file → helper returns success, `rounds=2`;
(b) all rounds write nothing → helper returns the empty-burst FAILED signal,
non-zero; (c) round-1 writes immediately → `rounds=1`, no re-prompt; (d) the
fed-forward preamble is present on round 2 (assert via the shim recording its
prompt-file contents). No live grok in CI.

---

## Issue 3 — codex `login --device-auth` has no working headless flow

**Problem / root cause.** On codex-cli 0.144.x, `codex login --device-auth`
prints the SAME localhost:1455 browser-callback flow as plain `codex login`
(and the login server dies on detach without a keepalive). `codex login --help`
lists `--device-auth` but the only genuinely headless option is
**`--with-api-key`** (reads `OPENAI_API_KEY` from stdin:
`printenv OPENAI_API_KEY | codex login --with-api-key`). The run fell back to
Opus-in-session as auditor because codex could not be authenticated
headless/orchestrator-driven.

**Fix (doctrine only).** Update `foreman-setup.sh` (the Setup-stage auth guidance
it prints), `references/reference-environment.md`, and `references/lanes.md`:

- The **headless codex auth path is `--with-api-key`** (OPENAI_API_KEY), NOT
  `--device-auth`.
- Interactive `codex login` (browser/localhost flow) MUST be **operator-run in a
  persistent foreground shell** (`! codex login`), never launched-and-detached by
  the orchestrator (the login server does not survive SIGTERM/detach).
- Note the codex-cli version this was observed on (0.144.x) and that a future
  version with a real user-code `--device-auth` may supersede this.

**Testing.** Doc-only: `docs-check.sh` green; a grep-assert that the reference
set no longer presents `codex login --device-auth` as the headless path. (No
live codex auth in CI.)

---

## Issue 4 — worktree fan-out unfit for a stateful/live target

**Problem / root cause.** The Midnight target needed the full runtime — a wallet
SDK vendored under a pinned sub-repo's `node_modules`, a running proof-server
container (:6300), and live testnet endpoints. A foreman git worktree carries
none of that installed/running state, so `wt-new`/durable-lane isolation breaks
the very environment verification needs. foreman's parallel-worktrees doctrine
assumes buildable/verifiable-unit == git worktree; it does not model a target
whose runtime state is external to the checkout.

**Fix (coded profile + preflight + doctrine).**

1. **Config key** `soft_mode.target = worktree | live` (default `worktree`), read
   via `toml_get` from `.foreman/config.toml` — mirrors the shipped
   `hard_mode.profile` precedent. `live` = run grok in the **working checkout**,
   no worktree, durable-lane/wt-new isolation intentionally bypassed; the
   architect verifies against the live services.

2. **Preflight guard (coded).** `wt-new.sh` (and any worktree-creating entry)
   reads `soft_mode.target`; if `live`, it **refuses** to create a worktree with a
   clear message ("live-target profile selected — run soft-mode in the working
   checkout; see references/parallel-worktrees.md"). Additionally, an optional
   `.foreman/live-target.toml` marker (declaring external deps/services) lets a
   preflight WARN when `worktree` is selected but external runtime state is
   present, so an operator is nudged to `live` before a broken worktree is cut.

3. **Doctrine.** `references/parallel-worktrees.md` + `roles.md`: a
   "stateful/live-target" section — what it is, when worktree fan-out is
   inapplicable, the no-worktree soft-mode recipe (grok in the working checkout,
   architect-verified against live services), and the trade-off (no parallel-lane
   isolation).

**Components.** `soft_mode.target` config key; `wt-new.sh` guard; optional
`.foreman/live-target.toml` schema; doctrine edits.

**Testing.** `tests/soft-mode-target.bats`: (a) `soft_mode.target=live` → `wt-new`
refuses (non-zero, clear message), touches no worktree; (b) default/`worktree` →
`wt-new` behaves exactly as today (regression); (c) `live-target.toml` present +
`worktree` selected → preflight WARNs (assert the warning) but does not hard-fail.

---

## Cross-cutting — release

- All four land on branch `fix/v0281-field-fixes`, sequenced: 1 (install/CI),
  2 (grok), 3 (codex docs), 4 (live-target). Docs-only issue 3 can ride with any.
- Each substantive change: Sonnet implements, Opus audits, architect verifies
  (live where it matters — grok-multiround against a shim; install.ps1 on
  Windows; wt-new guard).
- **Full gate on a quiet host with grok on PATH** (`export PATH="/c/root/.local:$PATH"`)
  — the v0.2.8 gate taught us the grok Use-path tests need grok reachable + a
  quiet host. docs-check green. shellcheck clean on new scripts.
- Merge → ROADMAP `v0.2.8.1` entry → tag `v0.2.8.1` → GitHub release.

## Acceptance

Windows `install.ps1` links via `New-Item Junction` and is smoke-tested on
`windows-latest`; a grok lane on an exploration-heavy spec either writes (via
grok-multiround) or fails loudly as an empty-burst round; codex headless auth is
documented as `--with-api-key` with operator-run interactive login; a
`soft_mode.target=live` profile exists, is enforced by a wt-new guard, and is
documented; suite + docs-check + shellcheck green with grok on PATH; tagged
v0.2.8.1 and released.
