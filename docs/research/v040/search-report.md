# FOREMAN_REPORT

- run_id: audit-pipeline-v040
- role: search
- status: complete
- worktree: /c/Users/charl/foreman-wt-v040-search-audit-path

## Summary

The Foreman audit pipeline end-to-end is controlled by audit-run.sh (hard mode) and codex-auditor agent (soft mode), with cold-diff review via GPT-5.6 Sol at high reasoning effort. Evidence is collected upfront (patch.diff, task.md, plan.md); the auditor receives a bounded context (400KB diff max) and returns a schema-forced verdict in 600s. Current latency is driven by serial prompt construction + single-shot audit (no incremental scoping), high reasoning effort on every audit round, and session startup overhead per invocation. The dev/foreman-v1 branch replaces subprocess spawns with MCP session continuity (threadId resume), enabling cheaper audit reruns and cross-round memory.

## Map

### Audit Pipeline Entry Points

| Component | File | Role |
|-----------|------|------|
| Soft auditor | agents/codex-auditor.md | Default lane; Claude routes cold diff to Codex Sol |
| Hard auditor | skills/foreman/scripts/audit-run.sh | Host-side invocation; orchestrates evidence + prompt + verdict |
| Coordinator | agents/foreman-audit.md | Worktree isolation wrapper |

### Evidence Collection

| Component | File | Purpose |
|-----------|------|---------|
| Collector | skills/foreman/scripts/evidence-collect.sh | Host-side git snapshot into $RD/evidence/ |
| Fallback | skills/foreman/scripts/audit-run.sh:21-24 | Fallback if evidence missing |

### Effort Pinning (Model Reasoning)

| Component | Model | Effort | Since |
|-----------|-------|--------|-------|
| Codex implementer | gpt-5.6-sol | medium | commit b2ec0ac (2026-07-15) |
| Codex auditor | gpt-5.6-sol | high | all versions |

## Findings

### F1: Cold-Context Only (No Repo Exploration)
- agents/codex-auditor.md:59 + lanes.md:50

### F2: Evidence Collected Once, Reused
- evidence-collect.sh:18-22 + audit-run.sh:21-24

### F3: Asymmetric Effort (Implementer Optimized, Auditor Not)
- agents/codex-implementer.md:91-98 + commit b2ec0ac

### F4: Single-Shot Audit on Full Diff (No Incremental Scoping)
- audit-checklist.md:33-40 + audit-run.sh:65-71

### F5: Prompt Construction Serial, No Batching
- audit-run.sh:52-73

### F6: Timeout 600s Ceiling
- agents/codex-auditor.md:149 + audit-run.sh:78

### F7: Session Startup Overhead Per Round (Fixed in dev-v1)
- dev-v1 commit 14dd40e (MCP session transport)

### F8: Event Log Unused for Audit
- skills/foreman/scripts/lib/eventlog.sh:1-96

### F9: Git Checkpoints Unused
- skills/foreman/scripts/lib/checkpoint.sh:6-32

### F10: Graphify Not Injected
- graphify-out/graph.json (141KB)

### F11: Dev-v1 MCP Transport
- dev-v1 audit-run redesign with adapter pattern

### F12: Model-Family Decorrelation in MCP
- dev-v1 lib/common.sh enforce_mcp_decorrelation

## Evidence

Files read: agents/codex-auditor.md, agents/foreman-audit.md, skills/foreman/scripts/audit-run.sh, lanes.md, audit-checklist.md, lib/eventlog.sh, lib/checkpoint.sh, verdict.schema.json, .foreman/config.toml

Git queries: commit b2ec0ac, commit 14dd40e, git show origin/dev/foreman-v1:audit-run.sh

## Open Questions

1. Baseline latency (27 min full) - typical diff size distribution?
2. Incremental audit design - scoped re-audit unimplemented?
3. Graphify context - should inject into audit prompt?
4. Parallel audit - can MCP sessions run in parallel with rework?
5. Resume on timeout (dev-v1) - checkpoint recovery on 600s timeout?

## Latency Hypotheses (Ranked)

### H1: Serial Single-Shot Audit on Full Diff (Highest)
Evidence: audit-run.sh:65-71, no incremental feature
Cost: O(diff_size + reasoning_depth) per round
Mitigation: Incremental audit (tag changed findings, replay only changed)

### H2: High Reasoning Effort Mandatory (High)
Evidence: codex-auditor.md:151, audit-run.sh:80, lanes.md:48-49
Impact: Auditor always uses full 600s timeout
Mitigation: Two-tier audit (medium for mechanical, escalate high for deep dives)

### H3: Session Startup Overhead Per Round (Medium, Shipped in dev-v1)
Evidence: dev-v1 commit 14dd40e
Impact: 10-30s per round times N audit rounds
Mitigation: Shipped in dev-v1 (MCP threadId persistence)

### H4: Evidence Re-Collection (Low, Mitigated)
Cost: 1-2s, already avoided

### H5: Diff Parsing (Low, Bounded)
Cost: 100-500ms for 400KB, already in place

### H6: No Pre-packaged Context (Low Latency, UX Impact)
Impact: Auditor re-derives architecture
Mitigation: Inject graphify summary (orthogonal to latency)
