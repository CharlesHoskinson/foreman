# SPEC — readme-refresh, round 1

Read `AGENT_TRAPS.md` IN FULL first. No `git commit`. No graphify.

## Scope

62 checkboxes. **Implement the structural and factual work on `README.md`
only.** Defer the extended editorial passes; report what you deferred.

## Why

Three editorial passes were run over `README.md` — structural, line, and
fact-check — and all three delivered findings
(`docs/research/vnext/EDIT-readme-*.md`, read them). None owns any work. The
release meanwhile ships a fourth vendor lane, a two-plane graph architecture and
a checker-soundness doctrine into a document with no place to put them.

## Deliverables

1. Apply the three editorial reports' findings. Where two disagree, say which
   you took and why.
2. **Fix every factual claim the fact-check pass flagged.** A README that
   describes behaviour the code does not have is the same defect class as a
   checker that reports a pass it has not earned — and this repo has an entire
   package (`doctrine-reality-drift`) about eleven such claims.
3. Add `tests/readme-structure.bats` asserting the structural invariants you
   rely on, so the next edit cannot silently break them.
4. **Verify every command in the README actually runs.** Not that it looks
   right — run it. Note that `install.sh` was found shipping mode `100644`
   while `README.md:355` instructs `./install.sh`, which failed
   `Permission denied` on a fresh clone; that is now fixed on another branch,
   but treat every other command with the same suspicion.
5. Any claim you cannot verify: mark it and report it rather than leaving it
   asserted.

## Verification

`tests/readme-structure.bats` observed failing against a known-bad input
(reorder or delete a required section) and naming what is wrong. Every runnable
command executed, with its real output quoted. Docs gate clean:
`markdownlint-cli2`, `codespell`, `lychee`.
