# Foreman Combined Skill — Design

**Date:** 2026-07-15  
**Status:** Approved for implementation (repo scaffold)  
**Repo:** `C:\Users\charl\foreman` (public-ready, MIT)

## Summary

Single portable skill `foreman` merging:

1. **Fable Advisor** soft orchestration (architect cost discipline, five-part specs, Grok/Codex implementer agents, Fable/Opus advisor).
2. **Original Foreman** hard harness (worktrees, evidence outside worktrees, independent checks, cold-diff audit, deterministic gate).

## Modes

| Mode | Default | Enforcement |
|---|---|---|
| soft | yes | Prompt + agent contracts + independent verification |
| hard | opt-in | Bash scripts + optional Docker |
| advisor-only | inverse soft | Cheap session + expensive advisor |

## Non-goals (this scaffold)

- Full Docker worker image production hardening (scripts stubs / partial)
- CI workflow templates
- Windows-native hard mode without WSL

## Success criteria

- [x] Repo + skill + agents + installers on disk
- [ ] Soft mode dogfood: documentation site in `site/`
- [ ] Hard mode: bats tests + full worker-run path
