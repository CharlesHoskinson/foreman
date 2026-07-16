# FOREMAN_REPORT

- run_id: v040
- role: misc
- slug: research
- branch: foreman/v040/misc/research
- worktree: C:/Users/charl/foreman-wt-v040-misc-research
- base_sha: 3eb9d05ce48fcd5a605dc18d71d9b9f71afbac53
- status: done

## Summary

External-facts research (2026-07-16) on cutting the 27-35 min Codex audit pass to <10 min. Full cited findings in RESEARCH.md (same directory). Bottom line: no single lever suffices; effort-tier reduction + parallel shard/consolidate together give a credible 4-6x, landing 5-9 min.

**Executive picture for the architect:**

1. **Reasoning effort is the biggest dial.** GPT-5.6 Sol (launched 2026-07-08/09) supports minimal→xhigh in Codex config (`-c model_reasoning_effort=…`; max/ultra exist in the ChatGPT product but are NOT in the Codex config reference yet). Measured: Sol-xhigh TTFT ~40s vs 2.6s tier median (Artificial Analysis); xhigh scores only ~2 intelligence-index points above high (58 vs 56). Reasoning tokens are output tokens, and OpenAI documents output-token count as ~linear with latency. Recommendation: audit at **high** (medium for triage lanes), xhigh only for final adjudication of contested findings. Pass effort explicitly per run — a live GitHub issue (#17436) reports config.toml effort being overridden by last-used TUI value.
2. **Shard + consolidate is proven practice.** Claude Code's own PR review, Greptile, and multiple 2026 writeups converge on: parallel agents per concern (or per directory for big diffs), then one consolidation pass that dedupes, ranks, and (for precision) requires multi-agent agreement on low-severity findings. Benchmarks show breadth raises recall but inflates false positives ~5x without a consolidation/verification stage (Tenki 2026-05 benchmark; Greptile noise reports).
3. **Kill agentic exploration.** Pre-package diff + spec + relevant excerpts so the auditor makes ~0 tool calls. UW TraceLab (253k Codex calls): ~19% of wall time is harness residual (avg 1.11s/call, approval-dominated tail to 10s+); the larger unquantified win is avoided model turns. Read-only sandbox + never-approve removes the approval residual entirely.
4. **Plumbing that helps:** `codex exec --output-schema` (verdict JSON, also on `resume`), `model_reasoning_summary="none"`, `--ephemeral`; `codex mcp-server` exposes `codex`/`codex-reply(threadId)` with disk-persisted threads for warm multi-step audits; GPT-5.6 guarantees ≥30-min prompt-prefix cache (≥1024 tokens, `prompt_cache_key`) so byte-stable audit preambles get cheap prefill even across separate exec runs — though OpenAI notes input-side cuts are only 1-5% of latency.
5. **Third vendors are viable but weaker on schema:** Grok Build headless (`grok -p --output-format json`, `--effort` flag as of 2026-07-07, grok-4.5) and Gemini CLI (`-p --output-format json`, gemini-3-pro/flash/3.1-pro-preview via `-m`) both lack Codex-style schema-forced final output; xAI's API (not CLI) does support `response_format: json_schema`. Gemini CLI has no documented thinking-level flag. Use them for independence/racing, not for speed.

## Findings

- Levers ranked (impact x confidence): (1) effort xhigh→high HIGH/HIGH; (2) parallel shard+consolidate HIGH/HIGH; (3) pre-packaged context, no tool loop HIGH/MED; (4) schema-constrained terse output MED/HIGH; (5) thread reuse + prompt-cache-stable prefix MED/MED; (6) Terra/Luna for triage lanes MED/LOW-MED; (7) third-vendor parallel lane LOW-MED/MED; (8) --ephemeral LOW/MED.
- Discrepancies flagged: max/ultra tiers unconfirmed in Codex CLI config; Grok flagship is 4.5 per xAI docs (a secondary source still says 4.3); Gemini CLI thinking control undocumented.
- See RESEARCH.md for every claim with [source URL, accessed date] and UNVERIFIED markers.

## Evidence

- C:/Users/charl/foreman-wt-v040-misc-research/RESEARCH.md (full citations)
- Key sources: learn.chatgpt.com/docs/config-file/config-reference; learn.chatgpt.com/docs/mcp-server; developers.openai.com/api/docs/guides/latency-optimization; developers.openai.com/api/docs/guides/prompt-caching; artificialanalysis.ai/models/gpt-5-6-sol-xhigh; tracelab.cs.washington.edu/exp/tool_calls/codex_wall_internal_gap/; tenki.cloud/benchmarks/code-reviewer; docs.x.ai/build/cli/headless-scripting; github.com/google-gemini/gemini-cli docs/cli/headless.md. All accessed 2026-07-16.

## Open questions

- Does Codex CLI expose max/ultra effort for Sol (config ceiling is xhigh as documented)?
- Measured cold-start time of `codex exec` vs warm `codex mcp-server` turn — nothing published; worth a 10-run local benchmark before committing to mcp-server plumbing.
- Terra "1/3 the time" claim unverified for audit-style tasks — cheap to A/B locally.
- Grok CLI exact effort tier names per model (menus are server-configurable, not documented).
