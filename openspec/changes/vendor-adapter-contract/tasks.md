# Tasks — vendor-adapter-contract

Ordering: T1 lands first and alone (it is the contract). T2-T4 are serial on
T1. T5-T6 may run in parallel once T2 lands. T7 is the architect decision and
can start immediately. T8 gates.

## T1 — the adapter interface

- [ ] Create `skills/foreman/scripts/adapters/` with one file per vendor:
      `grok.sh`, `codex.sh`, `agy.sh`, `claude.sh`.
- [ ] Define the seven functions per adapter: `adapter_implement_argv`,
      `adapter_audit_argv`, `adapter_home_var`, `adapter_auth_probe`,
      `adapter_result_text`, `adapter_result_verdict`, `adapter_caps`.
- [ ] Output convention: fill the global `ADAPTER_ARGV` array; never emit a
      string that a caller must re-split.
- [ ] Adapters source nothing (same self-containment rule as
      `lib/worker-cmd.sh:9-14` and `lib/launch.sh`), so they can be sourced
      standalone by tests without a readonly double-source collision.
- [ ] shdoc headers on every function; shellcheck clean.
- [ ] `adapter_caps` publishes at minimum: `resume`, `schema`, `sandbox`,
      `cap_n`, `rc_unavailable`, `prompt_flag`, `prompt_flag_position`,
      `verified_cli_version`.

## T2 — migrate the implement verb

- [ ] Move the grok branch (`worker-cmd.sh:46-57`) into `adapters/grok.sh`
      unchanged, including the single-burst NOTE at `:47-51`.
- [ ] Move the codex branch (`worker-cmd.sh:58-66`) into `adapters/codex.sh`
      unchanged, including `WC_CODEX_MODEL` / `WC_CODEX_REASONING_EFFORT`.
- [ ] Add `-p/--profile` passthrough to the codex adapter so a repo can pin
      model, effort and sandbox in `$CODEX_HOME/<name>.config.toml` — this is
      what "broaden GPT" means in practice (R3 §2.4).
- [ ] `lib/worker-cmd.sh` becomes a shim delegating to the adapters, or is
      retired with its callers moved; either way `WC_ARGV`'s contract with
      `worker-run.sh:116-122,141-144,149` is preserved.
- [ ] Byte-for-byte argv equivalence test for grok and codex against the
      pre-change builder.

## T3 — introduce the audit verb

- [ ] Implement `adapter_audit_argv` for codex, reproducing
      `audit-run.sh:78-86` exactly, plus `--ephemeral` (audit lanes never
      resume, and it removes session-file contention entirely — R3 §2.1).
- [ ] Expose `codex exec review --base "$BASE"` as the hard-mode cold-diff
      form, matching Foreman's worktree-branch-vs-base model (R3 §2.3).
- [ ] Implement `adapter_audit_argv` for grok (`--permission-mode plan`,
      `--json-schema "$(cat SCHEMA)"`, `--no-leader`).
- [ ] Replace `audit-run.sh:78-86`'s inline invocation with the adapter call.
      Do NOT touch the post-audit tamper check at `:90-93` — it is strengthened
      by `cross-vendor-audit-routing`, and both packages must not rewrite it.
- [ ] Pass `--no-leader` on every grok invocation: `grok agent` defaults to a
      shared `~/.grok/leader.sock`, which is a latent cross-lane coupling point
      (R3 §3).

## T4 — result capture, verdict validation, version recording

- [ ] `adapter_result_text` / `adapter_result_verdict` capture stdout and
      stderr to separate files and parse whichever carries the payload.
- [ ] No adapter relies on a pipeline exit status.
- [ ] Where the vendor forces a schema, pass it through; where it cannot, or
      where enforcement covers only some output formats, validate the parsed
      object against `adapters/verdict.schema.json` in the adapter and fail the
      audit on non-conformance.
- [ ] Keep `lane-run.sh`'s merged `2>&1` transcript for human reading, and give
      the machine-readable capture its own un-merged stderr file.
- [ ] Record the vendor CLI version actually invoked in the round report, and
      compare it against `adapter_caps`' `verified_cli_version`; report a
      mismatch as an INFO finding rather than failing the round.

## T5 — generalize the write-evidence loop

- [ ] Promote `grok-multiround.sh:72`'s `snap()` into
      `skills/foreman/scripts/lib/evidence.sh`.
- [ ] Rename `grok-multiround.sh` → `vendor-multiround.sh`, taking a vendor id
      and routing each round's invocation through `adapter_implement_argv`.
- [ ] Preserve the non-git-work-tree hard failure (`:66-67`) and its stated
      reason; an always-empty digest must never be reportable as an empty
      burst.
- [ ] Preserve the round>1 preamble and the feed-forward of the prior round's
      captured output.
- [ ] Keep a `grok-multiround.sh` compatibility path or update every caller;
      state which, and do not leave a dangling reference in `lanes.md` or
      `agents/grok-implementer.md`.

## T6 — the contract tests

- [ ] `tests/adapters.bats`: for every vendor and both verbs, assert the built
      argv contains no bare `-` in a prompt-from-stdin position.
- [ ] Assert the prompt string appears exactly once and in the position
      `adapter_caps` declares, for every vendor and both verbs.
- [ ] Assert every adapter's documented invocation runs with stdin at the null
      device.
- [ ] Record in each adapter's header why the vendor's own documented
      stdin-piping idiom is refused, where one exists, and what a misordered
      invocation does (error or hang).

## T7 — resolve the claude half-wiring (architect decision)

- [ ] Decide: finish the claude lane, or remove the four sites that advertise
      it. Record the decision and its reason. Leaving it as-is is not an
      option this change permits.
- [ ] IF finishing: `adapters/claude.sh` with the `REQUIRES-SEPARATE-HOME`
      constraint honoured (a distinct `$HOME`, not only `CLAUDE_CONFIG_DIR` —
      T5b ruled the latter insufficient), plus a passing lane test.
- [ ] IF removing: delete the vendor-home provisioning (`wt-new.sh:106-109`),
      the vendor map entry (`lane-run.sh:210`), the pueue group
      (`lane-queue.sh:422`) and the readiness row, and state the absence in the
      inventory rather than implying support.
- [ ] Either way, update `lib/worker-cmd.sh:6-7`'s scope note so it stops
      describing a state that no longer exists.

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
- [ ] `shellcheck` clean on every adapter, `lib/evidence.sh` and
      `vendor-multiround.sh`.
- [ ] `bugeventlog.md` entry recording the half-wired-lane failure class
      (advertised at four sites, unimplementable at the fifth) and this
      enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate vendor-adapter-contract --strict` passes.
