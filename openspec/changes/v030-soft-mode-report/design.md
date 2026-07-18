# Design — v030-soft-mode-report (approved spec)

## Research basis (2026-07-18, cited)

- **Re-port strategy:** per-commit `git format-patch | git am -3` is the right
  primitive — format-patch embeds pre-image blob SHAs; `am --3way` looks them
  up in the local object DB (present, branch fetched) and 3-way merges against
  main's current files WITHOUT needing a common ancestor. Keeps provenance,
  lands commits individually (bisectable). AVOID `git replace`/graft
  (fabricates ancestry; disables commit-graph; misrepresents provenance) and
  subtree (opaque per-file history). Refs: git-scm.com/docs/git-replace,
  GitHub subtree docs.
- **MCP invocations (verified against primary docs):** codex =
  `codex mcp-server` (stdio JSON-RPC); tools `codex` (start, returns
  `threadId`) + `codex-reply` (continue, `threadId` + prompt) — hyphenated
  per openai/codex codex_mcp_interface.md (DeepWiki's underscore form is
  wrong). claude = `claude -p` + `--resume <session_id>` (captured via
  `--output-format json .session_id`) / `--continue` / `--fork-session`
  (code.claude.com/docs/headless, /sessions). grok headless resume on the
  branch = unverified vs xAI docs → gate the merge.
- **Surface sizing (read off origin/dev/foreman-v1, no shared merge-base):**
  46 branch files vs main's 362; ONLY 1 path on both sides — `lib/common.sh`
  (branch 165 lines vs main 99, +66%, adds group_timeout/watchdog-reap) →
  real semantic 3-way. New subtrees: `adapters/` (4 + verdict.schema.json),
  `mcp/mcp-session.py`, `sandbox/`. `install.sh` diverged both sides → likely
  2nd conflict. 11 new .bats (additive). Concentrated risk in 2 files +
  live-untested adapters/mcp integration into main's dispatch.

## Approach

Port commit-by-commit (or small per-adapter squashes) with `am -3`, stamping
provenance; resolve common.sh/install.sh as 3-way against main's current
shape; wire adapters through the launcher + `lane-run --round`; run the
branch's never-executed live-acceptance against a real `codex mcp-server`
before merge. Target shape is soft-mode (architect decision), so the branch's
hard-mode assumptions are reconciled to main's soft-mode + launcher reality,
not revived.

Why approved-spec, not v0.2.7.5: it depends on posix-cascade-parity (sessions
run on WSL through the POSIX launcher) and wsl-reliability-env-refresh (WSL is
the session host), and the live-acceptance + 2-file 3-way merge is a
substantial, risk-concentrated pass best sequenced after this release's
foundation lands.

## Execution (next release)

Implementer: Sonnet 5 · Audit: Opus 4.8. The live-acceptance run is the
merge gate; the 2 conflict files get their own focused Opus audit.
