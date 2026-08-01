# Tasks — vendor-adapter-contract

Ordering: T1 lands first and alone (it is the contract). T2-T4 are serial on
T1. T5-T6 may run in parallel once T2 lands. T7 is the architect decision and
can start immediately. T8 gates.

## T1 — the adapter interface

- [x] Create `skills/foreman/scripts/adapters/` with one file per vendor:
      `grok.sh`, `codex.sh`, `agy.sh`, `claude.sh`.
- [x] Define the seven functions per adapter: `adapter_implement_argv`,
      `adapter_audit_argv`, `adapter_home_var`, `adapter_auth_probe`,
      `adapter_result_text`, `adapter_result_verdict`, `adapter_caps`.
- [x] Output convention: fill the global `ADAPTER_ARGV` array; never emit a
      string that a caller must re-split.
- [x] Adapters source nothing (same self-containment rule as
      `lib/worker-cmd.sh:9-14` and `lib/launch.sh`), so they can be sourced
      standalone by tests without a readonly double-source collision.
- [x] shdoc headers on every function; shellcheck clean.
- [x] `adapter_caps` publishes at minimum: `resume`, `schema`, `sandbox`,
      `cap_n`, `rc_unavailable`, `prompt_flag`, `prompt_flag_position`,
      `verified_cli_version`.

## T2 — migrate the implement verb

- [x] Move the grok branch (`worker-cmd.sh:46-57`) into `adapters/grok.sh`
      unchanged, including the single-burst NOTE at `:47-51`.
- [x] Move the codex branch (`worker-cmd.sh:58-66`) into `adapters/codex.sh`
      unchanged, including `WC_CODEX_MODEL` / `WC_CODEX_REASONING_EFFORT`.
- [x] Add `-p/--profile` passthrough to the codex adapter so a repo can pin
      model, effort and sandbox in `$CODEX_HOME/<name>.config.toml` — this is
      what "broaden GPT" means in practice (R3 §2.4).
- [x] `lib/worker-cmd.sh` becomes a shim delegating to the adapters, or is
      retired with its callers moved; either way `WC_ARGV`'s contract with
      `worker-run.sh:116-122,141-144,149` is preserved.
- [x] Byte-for-byte argv equivalence test for grok and codex against the
      pre-change builder.

## T3 — introduce the audit verb

- [x] Implement `adapter_audit_argv` for codex, reproducing
      `audit-run.sh:379-387` exactly, plus `--ephemeral` (audit lanes never
      resume, and it removes session-file contention entirely — R3 §2.1).
- [x] Expose `codex exec review --base "$BASE"` as the hard-mode cold-diff
      form, matching Foreman's worktree-branch-vs-base model (R3 §2.3).
- [x] Implement `adapter_audit_argv` for grok (`--permission-mode plan`,
      `--json-schema "$(cat SCHEMA)"`, `--no-leader`).
- [x] Replace `audit-run.sh:379-387`'s inline invocation with the adapter call.
      Do NOT touch the post-audit tamper check at `:90-93` — it is strengthened
      by `cross-vendor-audit-routing`, and both packages must not rewrite it.
- [x] Pass `--no-leader` on every grok invocation: `grok agent` defaults to a
      shared `~/.grok/leader.sock`, which is a latent cross-lane coupling point
      (R3 §3).

## T4 — result capture, verdict validation, version recording

- [x] `adapter_result_text` / `adapter_result_verdict` capture stdout and
      stderr to separate files and parse whichever carries the payload.
- [x] No adapter relies on a pipeline exit status.
- [x] Where the vendor forces a schema, pass it through; where it cannot, or
      where enforcement covers only some output formats, validate the parsed
      object against `adapters/verdict.schema.json` in the adapter and fail the
      audit on non-conformance.
- [x] Keep `lane-run.sh`'s merged `2>&1` transcript for human reading, and give
      the machine-readable capture its own un-merged stderr file.
- [x] Record the vendor CLI version actually invoked in the round report, and
      compare it against `adapter_caps`' `verified_cli_version`; report a
      mismatch as an INFO finding rather than failing the round.

## T5 — consume the write-evidence loop (owned by `evidence-contracts`)

`evidence-contracts` is the sole implementation owner of `lib/evidence.sh` and
`vendor-multiround.sh`. Do not implement either here, and do not restate their
predicates. `snap()` is NOT promoted: its `git status --porcelain` digest was
shown on 2026-07-28 to be blind to files 2..N inside an untracked directory and
to content changes within an unchanged status string.

- [ ] Provide `adapter_implement_argv` and `adapter_caps` in a shape
      `vendor-multiround.sh` can call per round with a vendor id, and record
      that call contract in each adapter header.
- [ ] Coordinate the `grok-multiround.sh` → `vendor-multiround.sh` rename with
      `evidence-contracts`: that package performs the rename and owns the loop;
      this package updates the callers it owns and removes the grok-specific
      `--prompt-file`-appending line in favour of `adapter_implement_argv`.
- [ ] Assert in `tests/adapters.bats` that no adapter and no file owned by this
      package computes an acceptance verdict from a `git status --porcelain`
      digest.
- [ ] Assert that any `git status` invocation remaining in this package's code
      passes `--untracked-files=all`.
- [ ] Do not leave a dangling reference: update `lanes.md` and
      `agents/grok-implementer.md` for the rename, and state that the evidence
      predicate lives in `evidence-contracts`.

## T6 — the contract tests

- [x] `tests/adapters.bats`: for every vendor and both verbs, assert the built
      argv contains no bare `-` in a prompt-from-stdin position.
- [x] Assert the prompt string appears exactly once and in the position
      `adapter_caps` declares, for every vendor and both verbs.
- [x] Assert every adapter's documented invocation runs with stdin at the null
      device.
- [x] Record in each adapter's header why the vendor's own documented
      stdin-piping idiom is refused, where one exists, and what a misordered
      invocation does (error or hang).

## T7 — resolve the claude half-wiring (architect decision)

- [x] Remove the sites that advertise a runnable claude lane, retain the
      adapter's explicit unsupported refusal, and update `lib/worker-cmd.sh`'s
      scope note.

Decision: remove the advertising. T5b established that `CLAUDE_CONFIG_DIR` is
insufficient and a distinct `$HOME` is required; without a live authenticated
Claude and destructive concurrency test, that isolation claim cannot be
verified, so the existing adapter refusal remains the honest end state.

## T8 — docs, agents, and gate

- [ ] `agents/codex-auditor.md`, `agents/codex-implementer.md`,
      `agents/grok-implementer.md`: cite the adapter, remove restated vendor
      flags.
- [ ] Add a docs check asserting no agent file contains a raw vendor
      invocation.
- [ ] `skills/foreman/references/lanes.md` updated for the adapter layer and
      the `vendor-multiround.sh` rename.
- [ ] Full suite green on WSL/Ubuntu 26.04, including the argv-equivalence,
      never-stdin and argument-order tests.
- [x] `shellcheck` clean on every adapter owned by this package.
      `lib/evidence.sh` and `vendor-multiround.sh` are `evidence-contracts`'
      files and are gated there, not here.
- [ ] `bugeventlog.md` entry recording the half-wired-lane failure class
      (advertised at four sites, unimplementable at the fifth) and this
      enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [x] `openspec validate vendor-adapter-contract --strict` passes.
