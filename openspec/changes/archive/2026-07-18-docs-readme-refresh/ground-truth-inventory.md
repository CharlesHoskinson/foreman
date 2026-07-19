# Ground-truth inventory (Task 1)

Working artifact for the docs-readme-refresh implementer. Every command,
flag, path, and env var the refreshed README/USAGE/CLAUDE.md/references show
is checked against one of: a script's own usage/header comment (read
directly), a `--help`/usage-line grep, or a real `bash
skills/foreman/scripts/docs-check.sh` run on this tree. Anything not
independently confirmed is marked so below rather than shown as fact.

## Lifecycle wrapper scripts (v0.2.7.5 lifecycle-three-stage)

- `skills/foreman/scripts/foreman-setup.sh [--profile soft|hard|full] [--lane grok|codex|claude]`
  — read in full. Composes `env/tool-check.sh`; never authenticates; prints
  `<vendor>: NOT-READY -- run <instruction>` per unauthenticated vendor
  (`grok login --device-code`, `codex login`, `claude auth login`). Exit `0`
  READY, `1` NOT-READY. Bash-only (no `.ps1` sibling) — Windows readers need
  Git Bash to run it, same convention as `wt-new.sh`/`wt-cleanup.sh`.
- `skills/foreman/scripts/foreman-cleanup.sh RUN_ID [--force]` — read in full.
  Order confirmed: (a) best-effort SIGINT of any lane subprocess still alive
  per the event log, (b) delegate to `wt-cleanup.sh` (porcelain guard +
  report archive), (c) stop a foreman-owned `pueued` only if `.pueued-owned`
  marker present for this run, (d) sweep this run's own stale
  `.seq.lock`/`.attempt.lock`/`.supervise.lock` dirs — never the host-wide
  `~/.foreman/gate.lock`. Exit `0` done, `2` usage error.

## Setup & Environment (Windows + WSL)

- `env/tool-check.ps1 -Profile soft|hard|full -Json -Out <path>` — matches
  existing README/USAGE usage; not re-verified via `--help` this pass (no
  Windows PowerShell runtime in this Git-Bash session) but unchanged since
  last verified pass and cross-checked against `env/tool-check.sh`'s
  equivalent flag set.
- `env/tool-check.sh [--profile soft|hard|full|durable] [--json] [--out FILE] [--lane grok|codex|claude]`
  — confirmed via the script's own usage line and `-h`/`--help` branch.
  **Note:** `durable` is a valid `--profile` value not previously documented
  in README/USAGE (both only showed `soft|hard|full`) — added.
- `env/bootstrap-wsl.sh [--profile soft|hard|full|durable] [--yes|-y]` —
  confirmed via usage line + arg-parse block. Installs (per
  `wsl-reliability-env-refresh`, already-merged v0.2.7.5 package 3):
  WSL-native bats-core, shellcheck, bun (pinned 1.3.14), pueue (GitHub
  release binary), codex/grok (npm, forced `@latest`), jq, node/npm (fnm),
  `hwclock` (util-linux-extra); sets `/etc/wsl.conf`
  `[interop] appendWindowsPath=false`; symlinks every WSL-native binary into
  `/usr/local/bin`.
- `env/bootstrap-windows.ps1 -Profile soft|hard|full -Yes` — unchanged from
  prior verified pass.
- `install.sh` / `install.ps1` — read in full. Both: link every `skills/*`
  dir into `~/.claude/skills`, `~/.agents/skills`, `~/.grok/skills`; copy
  `agents/*.md` into `~/.claude/agents`; create `~/.foreman/runs`.
  Skip-with-warning when a destination is a real (non-link) directory.
  `install.sh` additionally `chmod +x`'s `skills/foreman/scripts/*.sh` and
  `lib/*.sh` — Windows has no equivalent step (NTFS has no exec bit).

## Lanes (soft mode)

- `grok-implementer` (`agents/grok-implementer.md`) and
  `skills/foreman/references/lanes.md` — Grok Build (0.2.103) is installed,
  authenticated (`grok login --device-code`), and wired into
  `lane-run.sh`'s `LANE_VENDOR=grok → GROK_HOME` mapping
  (`grok-lane-activation`, merged). **This is "live," not "default":**
  `docs/research/vendor-concurrency-results.md` and the
  `grok-lane-activation` proposal both state grok's default-implementer
  status is unchanged pending a green T5b row. Docs must say "live and
  wired in" without claiming T5b promoted it.
- Grok headless flags confirmed against `agents/grok-implementer.md` and
  `lanes.md`: `--prompt-file`, `-m grok-4.5`, `--allow "Write" --allow "Edit"`,
  `--output-format plain`, `--cwd`. `--permission-mode acceptEdits` is
  accepted but silently ignored — confirmed in three independent places
  (SKILL.md, agents/grok-implementer.md, lanes.md); never document that flag
  as a fix.
- `codex exec --model gpt-5.6-sol -c model_reasoning_effort=medium|high --sandbox workspace-write|read-only`
  — confirmed in `lanes.md`.
- Durable-lane grok recipe: `grok -p "<spec>" --cwd <wt> --output-format json --always-approve --session-id <uuid> --no-auto-update`
  and resume form `grok -r <session-id> ...` — confirmed in `lanes.md`.

## T5b vendor concurrency (honest cap)

- `docs/research/vendor-concurrency-results.md` — read in full. Verdict:
  **NO GREEN** for codex or grok (authenticated N=2/N=3 matrix blocked by a
  credential-staging refusal, not a negative result). Claude Code ruled
  `REQUIRES-SEPARATE-HOME` from the public issue record (no local run
  needed). `grok`/`codex` pueue groups stay `parallel=1`
  (`skills/foreman/references/orchestration-hardening.md` §3 table).
  Docs must say **UNVERIFIED**, not "unsafe" or "safe" — neither is proven.

## POSIX launcher cascade (pidns)

- `launcher/README.md` "POSIX asymmetry — closed via pidns-init" and
  `orchestration-hardening.md` §1 — confirmed. Mechanism: self-re-exec under
  `unshare --pid --mount-proc --fork --kill-child`; becomes PID 1 of a fresh
  namespace; `prctl(PR_SET_CHILD_SUBREAPER)` additive safety net; falls back
  to `setsid` + `kill(-pgid)` with a logged DEGRADED marker when `unshare`
  is unavailable/fails (probed via a disposable fork before the irreversible
  self-replacement).

## wt-cleanup MSYS grandchild-orphan limit

- `skills/foreman/scripts/wt-cleanup.sh` (read directly, lines ~80-160) —
  confirmed: `wtc_sigint_worktree` signals only the single recorded
  `launcher_pid`/`pid`; a grandchild (e.g. a git subprocess) it spawned is
  reparented and survives that alone. Rework Round 1 (Risk 3) added a
  whole-subtree sweep AFTER the single-pid signal: Windows —
  `taskkill //T` against the real Windows PID via
  `${WT_CLEANUP_PROC_ROOT:-/proc}/<pid>/winpid`; POSIX — signals the
  process group (`kill -- -PID`). Best-effort, never a hard gate on removal.

## Hard mode — shipped vs. approved-spec upgrade path

- `skills/foreman/scripts/worker-run.sh` (13 lines, read in full) — still a
  stub: prints that containerized workers are not implemented, exits
  `EXIT_MISSING_CLI`, points at soft-mode agents. **Confirmed unchanged in
  this tree** — no P1-P6 package touched it.
- `openspec/changes/hard-mode-launcher/` (proposal.md, design.md,
  specs/hard-mode/spec.md — all read in full) — disposition line reads
  verbatim: **"APPROVED SPEC (executed next release, not in v0.2.7.5)."**
  Design: `worker-run.sh` will supervise the worker under `foreman-launch`
  against a per-lane worktree COPY, network default none; two profiles,
  **launcher-only (default, no Docker)** and **container (opt-in,
  devcontainer + egress-firewall allowlist)**. `pr-open.sh` will push/PR
  host-side only after `gate-decision.json.pass`, using a fine-grained,
  single-repo, expiring PAT; worker never holds push credentials.
  **Docs must present this as NOT YET SHIPPED** — an approved design for the
  next release, replacing the older, vaguer "containerized Docker worker"
  stub framing with the actual forward plan, but not claimed as present
  functionality.

## docs-check.sh — confirmed tool set (no AI-slop detector)

- `skills/foreman/scripts/docs-check.sh` (138 lines, read in full):
  markdownlint-cli2 (`**/*.md`), codespell (`.codespellrc`), lychee
  (offline unless `--online`, skip list `VENDORED` array), and a
  comment-coverage check (purpose header in first 6 lines + `@description`
  before each bash function). **There is no slop/naturalness/AI-detection
  tool anywhere in this script.** Exit `0` pass, `1` findings, `2` missing
  tool (fail closed). Usage: `docs-check.sh [--online] [--json PATH]`
  (confirmed against the arg-parse block, not just the header comment).
  Baseline run on this tree before any edit: `docs-check: markdownlint=pass
  codespell=pass lychee=pass comments=pass` (exit 0).

## Config keys

- `config/foreman.toml.example` (read in full) — `mode`, `[worker]
  vendor/model`, `[audit] vendor/model`, `[checks] command`, `[limits]
  max_rework_rounds/round_timeout_min/max_tokens_per_round`, `[gate]
  forbidden_paths/hash_paths`, `[durable]` block (incl. commented
  `starting_stale`/`impl_stale`/`verify_stale`/`grace`/
  `merge_base_max_commits`/`queue_timeout`/`resume_max_attempts`),
  `[nats]` block, commented `[audit.policy]` block
  (`warning_low_resolved`/`warning_medium`/`blocked`). Cross-checked against
  the live `.foreman/config.toml` in this worktree — same shape, a subset
  of keys set.

## Result

No invented flags were needed; every command shown in the refreshed docs
traces to one of the citations above. Two small gaps were found and are
fixed in this pass:

1. README/USAGE never mentioned the `durable` tool-check profile value.
2. README/USAGE had zero mentions of `foreman-setup.sh`, `foreman-cleanup.sh`,
   `git-guards.sh`, grok's live status, T5b, the pidns cascade, or the
   hard-mode-launcher approved spec — confirmed via grep against both files
   before writing (all zero hits pre-change).
