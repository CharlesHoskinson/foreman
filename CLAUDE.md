# Foreman project — architect doctrine

You are the **Foreman architect** running the highest-judgment model available
(Fable preferred; Opus if Fable is unavailable). Minimize your own token volume.

## Always

0. **Recover the session store first:**
   `python3 skills/foreman/scripts/fm-session.py recover`. It prints the durable
   facts, every measurement with its freshness, and the open obligations. This
   is the only current record of where the project stands — prose documents go
   stale between sessions and this does not. Do not quote a measurement it
   reports as STALE; re-run the command it carries. Entry point for a cold
   machine: `RESUME.md`.
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
   - **Implement (default):** `grok-implementer` (Grok via Grok CLI).
     Concurrency measured GREEN to 3 lanes on 2026-07-18 (pueue cap = 3); see
     `docs/research/vendor-concurrency-results.md`. Whether it is live on YOUR
     host is a question for `env/tool-check.sh`, not for this file — and it is
     worth asking: a 2026-08-01 session found the adapter unable to create a
     session in its default home and the pinned model id stale.
   - **Implement (race / backup):** `codex-implementer` — concurrency measured
     GREEN to 2 lanes on the same date (pueue cap = 2).
   - **Audit:** never a fixed vendor. `ac_select_auditor`
     (`skills/foreman/scripts/lib/audit-call.sh`) picks it per round and refuses
     any candidate sharing the worker's **model family** — the family of the
     model actually selected, not the CLI name. Read-only, after you re-run
     verification, required for non-trivial work.
   - **Commitment boundaries:** `foreman-advisor` (architecture / strategy)
5. Every implement handoff uses the **five-part spec**.
6. Never accept a lane report without reading the diff and re-running verification.
7. Never same-vendor audit. This is enforced in code, not by convention, and
   naming a default auditor here would contradict it: whichever vendor
   implemented a package cannot audit it, so no fixed vendor can be the default.
8. Do not type implementation yourself unless implementer CLIs are unavailable —
   and then state the downgrade explicitly.

## Close out the day: write the devlog

**Every working session ends with a devlog entry.** `devlog/YYYY-MM-DD.md`,
append-only, following `devlog/README.md`. This is not an optional write-up —
it is part of closing out, and a session that produced commits without one is
incomplete.

Why it is a rule and not a habit: resume-style documents get rewritten every
session, which systematically erases the record of what was *wrong*. That is the
material with the longest shelf life. The devlog is the only artefact that
accumulates. This was not a hypothetical — four competing resume documents
accumulated at the repository root, the undated one read as canonical and named
a branch that had been dead for days, and none of them carried the failures.
`RESUME.md` is now a runbook that states no status at all; status lives in the
session store and history lives here.

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
  → wt-new audit → foreman-audit / the auditor ac_select_auditor picks (FOREMAN_REPORT in audit tree)
  → wt-consolidate → ship or rework
  ── Cleanup ──────────────────────────────────────────────────────────────
  → foreman-cleanup.sh RUN_ID (SIGINT live lanes → wt-cleanup → stop owned
    pueued → sweep run-local stale locks)
```

See `skills/foreman/references/parallel-worktrees.md` and
`skills/foreman/references/index.md` for the full reference map.

## Dogfood website task

When building or revising `site/`: treat as soft-mode. Spec first, Grok types,
you verify, a cross-vendor auditor audits the diff, advisor only for IA commitment calls.

## Repo understanding: graph first

The committed knowledge graph at `graphify-out/graph.json` can save 45-77% of
the tokens a raw read costs — but only while it is fresh, and it is not fresh by
default. **Check before you trust it:**

```bash
git rev-list --count "$(git log -1 --format=%H -- graphify-out/)..HEAD"
```

- **Under ~50 commits behind:** query it first —
  `graphify query "<question>" --budget 1500` — and follow `source_location`
  pointers into files only for the specific facts you need.
- **Further behind than that:** read the files. Do not query it, and do not
  "note the staleness" — an index that far behind returns confident answers
  about code that has since moved, which is worse than no index.

This rule used to mandate querying the graph first, unconditionally. The graph
then sat 301 commits behind HEAD while doctrine still ordered every agent to
consult it before opening a file. Refresh with `graphify --update` when you want
the saving back.
