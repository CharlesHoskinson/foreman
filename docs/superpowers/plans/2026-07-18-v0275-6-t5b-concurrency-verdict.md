# t5b-concurrency-verdict Implementation Plan (v0.2.7.5 · package 6/7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> EARS: `openspec/changes/t5b-concurrency-verdict/specs/vendor-concurrency/spec.md`.
> Depends on package 2 (grok lane active) for the grok arm.

**Goal:** Run the destructive N=2/3 concurrency matrix for grok + codex under
containment, settle Claude Code from the public record, record verdicts, and
raise pueue caps ONLY on green evidence.

**Architecture:** A scripted matrix runner spins N same-vendor lanes on
throwaway repos with isolated config dirs, collects the researched signals,
and writes verdict rows to `docs/research/vendor-concurrency-results.md` (the
T5a stub). The destructive runs consume real vendor quota — they are a
documented, manually-invoked protocol, NOT part of the automatic suite. Cap
changes in `lane-queue.sh` are gated on a green row; grok default-promotion
rides on grok's green verdict.

**Tech Stack:** bash, bats-core (for the harness LOGIC, shim-driven), the real
grok/codex CLIs (for the destructive runs), `lane-queue.sh`.

## Global constraints

Strict mode + gate mutex. The harness LOGIC (verdict computation, row writing,
abort detection) is bats-tested with SHIMS; the real destructive runs are
manual + contained (throwaway repos, isolated config dirs, lowest-tier auth,
never production auth across simultaneous lanes). No cap raised without a
recorded green row; default-on-doubt is 1.

## File structure

- Create `skills/foreman/scripts/vendor-concurrency-test.sh` — the matrix
  runner (isolate config dirs, spin N, collect signals, emit verdict).
- Create `tests/vendor-concurrency-test.bats` — shim-driven harness-logic tests.
- Modify `docs/research/vendor-concurrency-results.md` — verdict rows.
- Modify `skills/foreman/scripts/lane-queue.sh` (+ config) — cap defaults ONLY
  on green.
- Conditionally modify `CLAUDE.md`/`SKILL.md` — grok default IF grok greens.

---

### Task 1: matrix-runner harness logic (shim-driven)

- [ ] **Step 1: Write the failing tests** — with a fake vendor CLI shim, the
  runner (a) spins N isolated lanes (each with its own config dir), (b)
  detects an injected abort signal (a shim that corrupts a file outside its
  config dir), (c) emits a GREEN row when all assertions hold and a RED row +
  abort log when one trips. Deterministic via the shim; no real quota.

```bash
@test "runner emits GREEN when N isolated shim-lanes all pass" { : ; }
@test "runner emits RED + abort log when a shim writes outside its config dir" { : ; }
```

- [ ] **Step 2: Run to verify it fails** (runner absent).
- [ ] **Step 3: Implement `vendor-concurrency-test.sh VENDOR N`** — provision N
  isolated config dirs (`GROK_HOME`/`CODEX_HOME`; separate `$HOME` note for the
  Claude reference), throwaway repos; spin N lanes; collect signals (config
  JSON validity post-run, lock-freeze watch, auth-invalidation check, 429
  pattern); apply the abort criteria; emit a verdict row + abort log.
- [ ] **Step 4: Run to verify it passes** (shims).
- [ ] **Step 5: Commit** `git commit -m "feat(t5b): shim-tested vendor-concurrency matrix runner"`.

---

### Task 2: codex + grok destructive runs (manual, contained)

- [ ] **Step 1** — Run `vendor-concurrency-test.sh codex 2` then `3`; watch the
  documented port-collision restart loop; record GREEN/RED per N + abort log.
- [ ] **Step 2** — Run `vendor-concurrency-test.sh grok 2` then `3`; watch
  leader-election/session errors; record verdict. (grok is signed in on this
  host.)
- [ ] **Step 3** — Paste both transcripts into the FOREMAN_REPORT (real-quota
  runs; not in the auto suite).

---

### Task 3: Claude Code ruling + results doc

- [ ] **Step 1** — Record Claude Code's verdict as REQUIRES-SEPARATE-HOME from
  the public issue base (`.claude.json` write races; `CLAUDE_CONFIG_DIR` does
  not cover top-level session state) — no local destruction.
- [ ] **Step 2** — Populate `docs/research/vendor-concurrency-results.md`:
  per-vendor verdict @N=2/N=3, signals, abort log, cap decision.
- [ ] **Step 3: docs-check + Commit** `git commit -m "docs(t5b): vendor-concurrency verdicts recorded"`.

---

### Task 4: gated cap changes + conditional grok promotion

- [ ] **Step 1: Write the failing test** — a vendor with a GREEN@2 row gets
  cap 2 in `lane-queue.sh`; a RED@3 keeps it at 2 (assert the ensure topology
  reflects the proven N, each cite-able to a verdict row).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the cap changes ONLY where a green row justifies
  them (UNVERIFIED vendors stay at 1). IF grok greens: one-line
  default-implementer doctrine flip in `CLAUDE.md`/`SKILL.md` citing the
  verdict; ELSE grok stays optional, doctrine unchanged.
- [ ] **Step 4: Run to verify it passes;** full gate + docs-check.
- [ ] **Step 5: Commit** `git commit -m "feat(t5b): raise pueue caps on green verdicts (+ grok promotion if green)"`.

## Self-review

- Coverage: R(containment)→T1-2; R(green requires all)→T1,T4; R(Claude
  ruling)→T3; R(results recorded)→T3; R(grok promotion gated)→T4. All covered.
- Destructive-vs-shim split stated up front (harness logic is shim-tested;
  quota runs are manual).
- Default-on-doubt = 1 enforced in T4.

## Acceptance

Matrix executed for grok+codex; results doc populated; any cap raise cites a
green row; Claude ruling recorded; suite + docs-check green. Archive on ship.
