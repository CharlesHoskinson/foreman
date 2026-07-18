# Design — t5b-concurrency-verdict

## Research basis (2026-07-18, cited)

- **Codex CLI:** `CODEX_HOME` isolates config/auth/logs/sessions/skills
  (docs: learn.chatgpt.com/docs/config-file/environment-variables); designed
  single-user-per-instance (openai/codex#14916); concurrent instances collide
  on ports 3000/8000/8080 with kill/restart loops (#16483); Computer Use
  degrades above ~4 parallel (#20852). Quota is a shared per-account pool
  (help.openai.com codex-with-chatgpt-plan). Confidence med-high.
- **Claude Code:** `CLAUDE_CONFIG_DIR` relocates `~/.claude` but NOT
  `~/.claude.json` (top-level OAuth/session/MCP) — a separate `$HOME` per
  instance is the real fix (#15334). Documented `.claude.json` write-race
  corruption under concurrency (#28847 partial-fix v2.1.61, #29003/#29004/
  #18998/#15608/#13499); per-version-dir lock freezes a 2nd instance (#13287,
  #46037). A 20-agent farm added a launch-serialization lock
  (Dicklesworthstone/claude_code_agent_farm). Confidence high → settle without
  local destruction.
- **Grok Build:** `GROK_HOME` documented (docs.x.ai/build/settings); isolation
  scope (session vs settings) undocumented; closed-source, changelog mentions
  a leader-election arch with past concurrent-writer bugs (since patched per
  changelog). Confidence low → this is exactly why it needs a real run.

## Approach

Run grok + codex destructively under containment; settle Claude Code from the
public record. The matrix, signals, and abort criteria are the researched
ones (see the spec). Cap changes are evidence-gated; the default on doubt is
1. Grok default-promotion rides on grok's own green verdict.

Test harness: a bats-driven or scripted launcher that spins N throwaway
lanes (isolated config dirs, throwaway repos), collects the signals, and
writes the verdict rows. Runs under the gate mutex like any other lane; the
destructive runs themselves are outside the normal suite (a documented,
manually-invoked protocol) since they consume real vendor quota.

## Execution

Implementer: **Sonnet 5**. Audit: **Opus 4.8**. The verdict doc and any cap
change are Opus-audited before merge. Cross-vendor invariant holds.
