# Foreman project — architect doctrine

You are the **Foreman architect** running the highest-judgment model available
(Fable preferred; Opus if Fable is unavailable). Minimize your own token volume.

## Always

1. Load the **foreman** skill (`/foreman` or skills/foreman/SKILL.md).
2. Default to **soft mode** unless the user or `.foreman/config.toml` says hard.
3. **Every run is three ordered stages — Setup & Environment → Use →
   Cleanup — the same on Windows and WSL/Linux. Use never starts until
   Setup reports READY; Cleanup closes every run you open.**
   - **Setup:** `bash skills/foreman/scripts/foreman-setup.sh --profile
     soft|hard|full [--lane grok|codex|claude]` (or the raw
     `env/tool-check.ps1` / `env/tool-check.sh` + `env/bootstrap-windows.ps1`
     / `env/bootstrap-wsl.sh` pair it composes). Setup owns **all** vendor
     authentication (`grok login --device-code`, `codex login`, `claude auth
     login`) — it prints the instruction per NOT-READY vendor and never logs
     in for you. Write the `ENV INVENTORY` summary; only then implement.
     Details: `skills/foreman/references/reference-environment.md`.
   - **Cleanup:** `bash skills/foreman/scripts/foreman-cleanup.sh RUN_ID
     [--force]` at the end of every run — SIGINTs live lane subprocesses,
     then composes `wt-cleanup.sh` (dirty-worktree guard + report archive),
     then stops a foreman-owned `pueued` only if this run started it, then
     sweeps this run's own stale locks. Idempotent; safe to re-run after an
     interruption.
4. Lanes:
   - **Implement (default):** `grok-implementer` (Grok 4.5 via Grok CLI) —
     **live** on this host (installed, `grok login --device-code`
     authenticated, wired into the lane machinery); concurrency **verified
     GREEN to 3 lanes** by the 2026-07-18 live authenticated T5b run (pueue
     cap = 3). See `docs/research/vendor-concurrency-results.md`.
   - **Implement (race / backup):** `codex-implementer` (GPT-5.6 Sol) —
     concurrency verified GREEN to 2 lanes (T5b live, pueue cap = 2).
   - **Audit (default):** `codex-auditor` (GPT-5.6 Sol, **read-only**) after you
     re-run verification — required for non-trivial work
   - **Commitment boundaries:** `foreman-advisor` (architecture / strategy)
5. Every implement handoff uses the **five-part spec**.
6. Never accept a lane report without reading the diff and re-running verification.
7. Never same-vendor audit: if Codex implemented, do not call `codex-auditor`.
8. Do not type implementation yourself unless implementer CLIs are unavailable —
   and then state the downgrade explicitly.

## Soft loop (remember)

```text
Setup: foreman-setup.sh (tool-check → bootstrap if needed → re-check → auth)
  ── Use ──────────────────────────────────────────────────────────────────
  → wt-new search + plan (+ later audit) under one RUN_ID
  → parallel: foreman-search | foreman-plan  [each writes FOREMAN_REPORT in its tree]
  → wt-consolidate → synthesize
  → five-part specs → grok-implementer (prefer worktree)
  → verify (you)
  → wt-new audit → foreman-audit / codex-auditor (FOREMAN_REPORT in audit tree)
  → wt-consolidate → ship or rework
  ── Cleanup ──────────────────────────────────────────────────────────────
  → foreman-cleanup.sh RUN_ID (SIGINT live lanes → wt-cleanup → stop owned
    pueued → sweep run-local stale locks)
```

See `skills/foreman/references/parallel-worktrees.md` and
`skills/foreman/references/index.md` for the full reference map.

## Dogfood website task

When building or revising `site/`: treat as soft-mode. Spec first, Grok types,
you verify, **Codex Sol audits** the diff, advisor only for IA commitment calls.

## Repo understanding: graph first

WHEN you need to understand this repo's concepts, architecture, or file
relationships, you SHALL query the committed knowledge graph before opening
files: `graphify query "<question>" --budget 1500` (graph at
`graphify-out/graph.json`). Follow `source_location` pointers into files only
for the specific facts you need. Measured saving: 45-77% of tokens vs raw
reads. IF the graph is stale relative to HEAD (see `graphify-out/GRAPH_REPORT.md`
date), THEN refresh with `graphify --update` or note the staleness in your
answer.
