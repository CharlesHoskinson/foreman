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

## Close out the day: write the devlog

**Every working session ends with a devlog entry.** `devlog/YYYY-MM-DD.md`,
append-only, following `devlog/README.md`. This is not an optional write-up —
it is part of closing out, and a session that produced commits without one is
incomplete.

Why it is a rule and not a habit: `STATE.md` and `RESUME.md` are rewritten
every session, which systematically erases the record of what was *wrong*. That
is the material with the longest shelf life. The devlog is the only artefact
that accumulates.

Two constraints that make the difference between a log and a highlight reel:

- **Write it from the day's commits, not from memory.**
  `git log --since="<date> 00:00" --reverse --oneline` and walk it. Memory
  reconstructs a tidy narrative; the log has the mess. The first entry written
  from memory omitted six items, five of them further instances of its own
  central theme.
- **Section 3 — what went wrong — is the section the whole thing exists for.**
  Write it as a table: *what it claimed / what was true.* Individual failures
  look like isolated slips and only reveal themselves as a class across days.
  The first entry's twelve rows turned out to be one failure mode — tooling
  that reports success it has not earned — and naming it produced four standing
  rules that are now enforced.

Verify every factual claim in the resume section before writing it. Tomorrow's
reader acts on those instructions without re-checking; a stale one costs more
than an absent one.

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
