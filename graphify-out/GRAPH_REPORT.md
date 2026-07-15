# Graph Report - .  (2026-07-15)

## Corpus Check
- 58 files · ~96,486 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 139 nodes · 179 edges · 21 communities (7 shown, 14 thin omitted)
- Extraction: 85% EXTRACTED · 14% INFERRED · 1% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.88)
- Token cost: 331,667 input · 0 output

## Community Hubs (Navigation)
- Agent Lane Contracts
- Doctrine & References
- Enhancement Plan Mechanisms
- Vendor CLI Research
- Common Script Library
- Frontier Agent Practices
- Worktree Library
- Bash Installer
- Worktree Cleanup
- Worktree Consolidate
- Research Fetch Rationale
- Advisor Boundaries
- Audit Runner
- Checks Runner
- Evidence Collector
- Merge Gate
- PR Opener
- Task Init
- Worker Runner
- Worktree Creator

## God Nodes (most connected - your core abstractions)
1. `Foreman QA + Feature Pass (2026-07-15)` - 13 edges
2. `Foreman Architect Doctrine` - 12 edges
3. `Codex Auditor (GPT-5.6 Sol)` - 11 edges
4. `Foreman skill (SKILL.md)` - 11 edges
5. `Grok Implementer` - 9 edges
6. `Fable Advisor (DannyMac180)` - 7 edges
7. `Foreman documentation site (single page)` - 7 edges
8. `Five-Part Spec` - 6 edges
9. `Foreman Project` - 5 edges
10. `Soft Mode` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Adversarial Review Step` --semantically_similar_to--> `Codex Auditor (GPT-5.6 Sol)`  [INFERRED] [semantically similar]
  docs/research/anthropic_best_practices.txt → agents/codex-auditor.md
- `Codex structured review output schema (findings + verdict + confidence)` --semantically_similar_to--> `Audit verdict schema (APPROVED | WARNING | BLOCKED)`  [INFERRED] [semantically similar]
  docs/research/openai_codex_review.txt → skills/foreman/references/audit-checklist.md
- `Fable Advisor (DannyMac180)` --semantically_similar_to--> `Foreman Advisor`  [INFERRED] [semantically similar]
  docs/research/fable_advisor.txt → agents/foreman-advisor.md
- `Codex SDK Code Review pattern (headless exec in CI)` --semantically_similar_to--> `Audit dimensions (acceptance, regressions, tampering, security, quality, prompt injection)`  [INFERRED] [semantically similar]
  docs/research/openai_codex_review.txt → skills/foreman/references/audit-checklist.md
- `Grok Build parallel subagents in worktrees` --semantically_similar_to--> `Parallelism via worktree fan-out`  [INFERRED] [semantically similar]
  docs/research/xai_grok_news.txt → skills/foreman/SKILL.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Default Soft Pipeline (architect -> grok -> verify -> codex audit -> advisor)** — claude_foreman_architect, agents_grok_implementer_grok_implementer, agents_codex_auditor_codex_auditor, agents_foreman_advisor_foreman_advisor [EXTRACTED 1.00]
- **Parallel Worktree Report Consolidation (wt-new -> FOREMAN_REPORT -> wt-consolidate)** — agents_foreman_search_foreman_search, agents_foreman_plan_foreman_plan, agents_foreman_audit_foreman_audit, agents_foreman_search_foreman_report [EXTRACTED 1.00]
- **No Silent Fallback (STATUS: unavailable, never silently become Claude)** — agents_grok_implementer_grok_implementer, agents_codex_implementer_codex_implementer, agents_codex_auditor_codex_auditor, agents_foreman_audit_foreman_audit [EXTRACTED 1.00]
- **Soft-mode delegation pipeline (spec, route, verify, audit, advise)** — skills_foreman_skill_soft_mode, skills_foreman_references_five_part_spec_spec_template, skills_foreman_references_lanes_lane_table, skills_foreman_references_audit_checklist_verdict_schema, skills_foreman_references_roles_advisor [EXTRACTED 1.00]
- **Foreman enhancement changesets CS1-CS4** — docs_superpowers_plans_2026_07_15_foreman_enhancement_evidence_contract, docs_superpowers_plans_2026_07_15_foreman_enhancement_git_write_ban, docs_superpowers_plans_2026_07_15_foreman_enhancement_bats_harness, docs_superpowers_plans_2026_07_15_foreman_enhancement_wt_merge, docs_superpowers_plans_2026_07_15_foreman_enhancement_docs_check, docs_superpowers_plans_2026_07_15_foreman_enhancement_vendored_skills [EXTRACTED 1.00]
- **Cross-vendor separation defense** — skills_foreman_skill_cross_vendor_invariant, skills_foreman_references_roles_worker, skills_foreman_references_roles_auditor, skills_foreman_references_security_model_threat_enforcement_map [EXTRACTED 1.00]

## Communities (21 total, 14 thin omitted)

### Community 0 - "Agent Lane Contracts"
Cohesion: 0.19
Nodes (23): Codex Auditor (GPT-5.6 Sol), Verdict Schema (verdict.schema.json), Codex Implementer, Codex Evidence Contract, Foreman Advisor, Foreman Audit (worktree), Foreman Plan (worktree), FOREMAN_REPORT Worktree Report (+15 more)

### Community 1 - "Doctrine & References"
Cohesion: 0.12
Nodes (22): Foreman Combined Skill Design (Fable Advisor + Original Foreman merge), Foreman documentation site (single page), Foreman docs site README, Audit verdict schema (APPROVED | WARNING | BLOCKED), Five-part spec template, .foreman/config.toml (mode, worker, audit, checks, limits, gate), foreman.worktree-report.v1 schema (FOREMAN_REPORT.md/.json), Reference environment (Windows host + WSL2 Ubuntu) (+14 more)

### Community 2 - "Enhancement Plan Mechanisms"
Cohesion: 0.14
Nodes (17): Introducing Grok Build (xAI announcement, 2026-05-25), Grok Build parallel subagents in worktrees, ARCHITECT_ACTIONS report field, bats-core test harness (tests/run.sh, setup_tmp_repo), Evidence contract (head SHA + status digests before/after), Git-write ban (standing rule for workers), Foreman Skill Enhancement Implementation Plan, Vendored reference skills (scrapling, graphify, superpowers) (+9 more)

### Community 3 - "Vendor CLI Research"
Cohesion: 0.15
Nodes (14): Codex CLI, codex exec (non-interactive mode), Codex sandbox policy (read-only | workspace-write | danger-full-access), Codex SDK Code Review pattern (headless exec in CI), Codex structured review output schema (findings + verdict + confidence), Codex Sandboxing doc capture (page not found), grok-4.5 model, Grok Build coding agent (+6 more)

### Community 4 - "Common Script Library"
Cohesion: 0.18
Nodes (10): die(), EXIT_CONFIG, EXIT_FAIL, EXIT_MISSING_CLI, EXIT_OK, git_nohooks(), hash_snapshot(), log() (+2 more)

### Community 5 - "Frontier Agent Practices"
Cohesion: 0.24
Nodes (11): Agent Skills Standard, agentskills/agentskills GitHub Repo, Progressive Disclosure, Claude Code Agent Teams, Adversarial Review Step, Claude Code Best Practices, Claude Code CLI Reference, Managed Agents Multiagent Orchestration (+3 more)

## Ambiguous Edges - Review These
- `Codex sandbox policy (read-only | workspace-write | danger-full-access)` → `Codex Sandboxing doc capture (page not found)`  [AMBIGUOUS]
  docs/research/openai_codex_sandbox.txt · relation: conceptually_related_to

## Knowledge Gaps
- **33 isolated node(s):** `audit-run.sh script`, `checks-run.sh script`, `evidence-collect.sh script`, `gate-eval.sh script`, `common.sh script` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Codex sandbox policy (read-only | workspace-write | danger-full-access)` and `Codex Sandboxing doc capture (page not found)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Foreman skill (SKILL.md)` connect `Doctrine & References` to `Enhancement Plan Mechanisms`, `Vendor CLI Research`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `Soft-mode lane routing table (Grok/Codex/advisor CLIs and flags)` connect `Vendor CLI Research` to `Doctrine & References`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `Foreman Skill Enhancement Implementation Plan` connect `Enhancement Plan Mechanisms` to `Doctrine & References`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Codex Auditor (GPT-5.6 Sol)` (e.g. with `Claude Code Custom Subagents` and `Adversarial Review Step`) actually correct?**
  _`Codex Auditor (GPT-5.6 Sol)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `audit-run.sh script`, `checks-run.sh script`, `evidence-collect.sh script` to the rest of the system?**
  _33 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Doctrine & References` be split into smaller, more focused modules?**
  _Cohesion score 0.11688311688311688 - nodes in this community are weakly interconnected._