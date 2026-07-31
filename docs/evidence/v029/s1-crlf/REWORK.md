# REWORK — crlf-extensionless-hardening, round 7

**MANDATORY FIRST ACTION:** create/overwrite `REPORT.md` with a heading per item
below, each PENDING, then fill in place. Read `AGENT_TRAPS.md` IN FULL. Only
`tests/line-endings.bats` and file modes. No `git commit`. No graphify.

Round 6 was audited **BLOCKED** — the sixth block on this package. The cause is
an architect ruling (D11), not your work. It is corrected below and in
`docs/research/vnext/DECISIONS-resolved.md` on `origin/main` under
"D11 correction".

## F1 — BLOCKING. An exclusion wildcard swallowed the founding case

D11 gave the exclusion pattern `skills/superpowers/skills/*/scripts/**`, written
to exclude `brainstorming/scripts/{start,stop}-server.sh`, whose `sh …`
invocation was verified.

**That wildcard also matches
`skills/superpowers/skills/subagent-driven-development/scripts/` — the three
directly-executed SDD scripts this entire package exists to protect.** Their
committed modes are correct, so nothing is broken today, but the regression test
no longer covers them: a fourth SDD script would escape exactly as the first
three did in round 1.

**Fix:** narrow it to the directory whose reason was actually verified:

```
skills/superpowers/skills/brainstorming/scripts/**   — documented sh invocations
```

**Then apply the corrected rule to EVERY exclusion entry.** For each pattern in
your list, enumerate its **current matches** with `git ls-files`, and confirm the
stated reason is true of every one. A wildcard asserts the reason holds for every
sibling it captures; that assertion must be checked. Report the enumeration per
entry in `REPORT.md` — that table is the deliverable, not the diff.

The asymmetry to keep in mind: a wildcard is safe for *inclusions* because it
covers files that do not exist yet. For *exclusions* the same property is a
hazard — it silently excludes directories nobody checked, including future ones.
Inclusion wildcards fail safe; exclusion wildcards fail silent.

## F2 — BLOCKING. Round 6 dropped the non-bash hooks sweep

D1 requires `skills/superpowers/hooks/*` be swept as a directory, deliberately
**not** by the shebang property, because the hook installers package the whole
directory and `run-hook.cmd` is a polyglot with no bash shebang. Round 6 removed
it. Restore it, with the reason inline.

## F3 — the regression that would have caught F1

Nothing asserted the three founding SDD scripts remain **inside** the derived
inventory. The suite proved it detects *additions* and never proved it still
covers its *founding case*. That is half a checker, and it is the second time on
this package that a test passed while the thing it protects had quietly left
scope.

Add an assertion that the inventory **contains**
`skills/superpowers/skills/subagent-driven-development/scripts/{review-package,sdd-workspace,task-brief}`
and the four `skills/superpowers/hooks/*` entries. Derive them from D1 rather
than hardcoding if you can; if you must name them, say why inline — a
regression pinning the founding case is the one place a literal is defensible,
and that reason has to be written down.

## Verification

1. The exclusion enumeration table: every pattern, its current matches, and the
   verified reason per match.
2. Synthetic `100644` bash-shebang files — temporary index only — caught and
   NAMED at: repo root (extensionless and `.sh`), a nested depth in each swept
   region, **and a fourth file in the SDD scripts directory**. That last one is
   the case F1 broke; it must fail loudly.
3. A synthetic file under a legitimately excluded pattern is still excluded.
4. Full suite green; `git status --porcelain -uall` byte-identical before and
   after, including across an induced mid-run failure.
5. Exec bits `100755` **at the commit**, not merely in the index — use
   `git add --chmod=+x`, never `update-index` followed by a later `add` of the
   same path.
