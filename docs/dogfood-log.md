# Foreman Dogfood Acceptance Run — 2026-07-11

Task 14 of the implementation plan: run the harness against its own repo as the first
real target. Environment: WSL2 Ubuntu 26.04, Docker 29.6.1.

## What ran for real (validated end-to-end)

| Step | Mechanism exercised | Result |
|---|---|---|
| `install.sh --skip-tools` | skill copied to `~/.agents/skills/foreman`, symlinked into `~/.claude/skills`, `sandbox/` copied into the installed skill | PASS — all four artifacts present |
| `docker_run_wrapper` (installed layout) | 2-up path resolution from `scripts/lib` in the *installed* tree | PASS — resolved to the copied `sandbox/docker-run.sh` (previously only reasoned about, now executed) |
| `task-new.sh DOGFOOD-1` | serialized worktree creation, task envelope, hash snapshot, hooks disabled | PASS — worktree + `meta.json` + `task.md` + `hashes.txt` created |
| worker change → `evidence-collect.sh` | host-side evidence bundle from the worktree | PASS — `patch.diff`, `diff-stat.txt`, `git-status.txt`, `head-sha.txt`, `commits.txt` |
| `checks-run.sh` (host mode) | `bats tests/` against a pristine `git archive` of the worker's commit | Ran for real — **surfaced a real bug** (see below) |
| full suite from pristine archive of fixed HEAD | 54 bats tests incl. red-team | PASS — exit 0, scripts `-rwxr-xr-x` |
| `docker build` of `sandbox/Dockerfile.worker` | reference worker image | Built (2.56 GB) — **two incomplete-image findings** (see below) |

The task target was a genuine self-improvement: hardening `pr-open.sh`'s `jq` extractions
(`jq -er ... || die`) so corrupt JSON stays within the `{0,1,2,3}` exit-code contract —
the deferred Task 10 minor finding. The diff was orchestrator-authored (see Blocked
below), so this validates the harness *plumbing* end-to-end but not the cross-vendor
worker/audit decorrelation.

## Bug surfaced and fixed by the dogfood run

**Harness scripts lacked the git executable bit.** All 54 bats tests passed from the
working tree because Windows/DrvFS reports every file as executable (`core.filemode=false`
locally). But `checks-run.sh` extracts a pristine `git archive`, which uses the git *index*
modes — scripts came out `100644`, so tests invoking `task-new.sh` directly failed with
`Permission denied` (status 126), and 40/54 tests failed on the clean archive. This is the
one class of defect only a real pristine-checkout run could surface.

Fixed in `fix: set executable bit on all harness scripts for pristine-checkout execution`
(`git update-index --chmod=+x` on all eight directly-invoked scripts; `install.sh` was
fixed separately in Task 13). Verified: a fresh `git archive` of `HEAD` now checks out
scripts as `-rwxr-xr-x` and the full 54-test suite passes from the extracted tree.

## Reference-image findings

1. **grok CLI absent from the worker image — FIXED.** The Dockerfile's pinned
   `@xai-org/grok-build` npm package returned 404 (never existed), and the `|| ` fallback
   silently installed only `@anthropic-ai/claude-code` + `@openai/codex`, so a repo
   configured with `worker.vendor = "grok"` would have failed inside the container. The
   correct official package is `@xai-official/grok` (v0.2.93; provides the `grok` binary;
   alternative is `curl -fsSL https://x.ai/cli/install.sh | bash`). The Dockerfile now
   pins `@xai-official/grok` and installs all three CLIs in one command with **no silent
   fallback** — a future package-name move fails the build loudly instead of dropping a
   vendor. (spec §11 flags vendor names as moving targets; the dogfood confirmed it bites.)
2. **Scrapling — false alarm, no defect.** The original "not importable" note was a bug in
   the dogfood *diagnostic itself*: nested double-quotes in the `python3 -c "import
   scrapling; print("...")"` probe were mangled inside the docker `-lc` string, producing a
   Python syntax error that masked a working import. Re-checked cleanly: `scrapling`
   0.4.10 imports fine (`pip3 show scrapling` → installed; `import scrapling` → exit 0).
   Graphify (`/opt/graphify`) is present and correct. No Dockerfile change needed.

## Blocked — could not run the true cross-vendor loop here

The plan's headline acceptance criterion (Claude Code orchestrating a *different-vendor*
worker that implements a component, with an independent cross-vendor audit) could not
execute in this environment:

- No authenticated non-Claude worker CLI: `claude` and `grok` are not on the host PATH;
  `codex` is present only as a Windows npm shim and is unauthenticated.
- No API keys set (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY` all unset).
- Containerized `checks-run`/`audit-run`/`pr-open` therefore could not complete a real
  round (they depend on an authenticated worker + auditor and, for `pr-open`, `gh`).

### To finish the real dogfood

1. ~~Fix the Dockerfile grok install; rebuild.~~ Done — `@xai-official/grok` pinned; image
   rebuilds with claude + codex + grok all present. (Scrapling was a false alarm.)
2. Provide scoped API keys for two different vendors (one worker, one auditor).
3. Set `worker.vendor`/`audit.vendor` to two distinct installed+authenticated vendors in
   `.foreman/config.toml`.
4. Run the full loop: `task-new` → (plan) → `worker-run` (container) → `checks-run`
   (container, `--network none`) → `evidence-collect` → `audit-run` → `gate-eval` →
   `pr-open`, and confirm the PR carries a complete evidence bundle.

## Verdict

The harness plumbing is validated end-to-end on a real target and from a pristine
checkout, and the run paid for itself immediately by surfacing the executable-bit bug that
every in-tree test missed. The cross-vendor worker/audit round remains to be exercised
once two authenticated vendors and a corrected worker image are available.
