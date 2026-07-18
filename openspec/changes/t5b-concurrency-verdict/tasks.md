# Tasks — t5b-concurrency-verdict

Implementer: Sonnet 5 · Audit: Opus 4.8. Destructive runs consume real vendor
quota — run deliberately, contained, never in the automatic suite.

- [ ] **1. Harness** — a scripted/bats matrix runner: spin N same-vendor
  lanes on throwaway repos with isolated config dirs (`GROK_HOME`/
  `CODEX_HOME`, separate `$HOME` for the Claude reference note), collect the
  signals (config validity, lock freeze, auth invalidation, 429 pattern),
  emit verdict rows. Depends on grok-lane-activation for the grok arm.
- [ ] **2. Codex arm** — N=2, N=3; watch the port-collision restart loop;
  record GREEN/RED per N + abort log.
- [ ] **3. Grok arm** — N=2, N=3; watch leader-election/session errors;
  record verdict.
- [ ] **4. Claude Code ruling** — record REQUIRES-SEPARATE-HOME from the
  public issue base (no local destruction); document the separate-`$HOME`
  requirement.
- [ ] **5. Results doc** — populate `docs/research/vendor-concurrency-
  results.md` (verdicts, signals, aborts, cap decisions).
- [ ] **6. Cap changes (gated)** — raise a `lane-queue.sh`/config cap ONLY
  for a green N, each change citing its verdict row; tests assert the new
  caps; UNVERIFIED vendors stay at 1.
- [ ] **7. Grok promotion (conditional)** — IF grok greens, one-line
  default-implementer doctrine flip in CLAUDE.md/SKILL.md citing the verdict.
- [ ] **8. Verify** — bats under the mutex; `tests/run.sh`; `docs-check.sh`.

Acceptance: matrix executed for grok+codex; results doc populated; any cap
raise justified by a green row; Claude Code ruling recorded; suite +
docs-check green. Archive on ship.
