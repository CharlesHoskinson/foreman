# Tasks — agy-lane-activation

Ordering: T1 is the verification block and blocks the READY verdict, not the
code — it can run in parallel with T2-T4. T2-T4 are the plumbing. T5 depends on
T1's answers. T6 gates and cannot pass until every T1 item has a recorded
answer.

Depends on `vendor-adapter-contract` for the adapter interface.

## T1 — verify what is currently UNVERIFIED (blocks the READY verdict)

Each item names the probe and the artefact it must produce. An item with no
recorded answer is not done, and "it worked when I tried it" is not an answer —
record the command and its output.

- [ ] **Success-path structured output.** Run one minimal `agy --output-format
      json --print "…"` and one with `--json-schema`, and record the exact
      shape: which stream carries the payload, what the object looks like, and
      whether the schema is enforced. `adapter_result_verdict` is written
      against this, not against inference.
- [ ] **Silent zero-write.** Run an exploratory spec under `--mode plan`
      (expect zero writes) and under `--mode accept-edits` (expect writes) in a
      throwaway git worktree, and record the git-status digest each time.
      Establish empirically whether agy can narrate a completed edit while
      writing nothing.
- [ ] **Untrusted workspace.** Run a headless implement round in a freshly
      created worktree whose path is not in `trustedWorkspaces`. Record whether
      it proceeds, restricts writes silently, or blocks. If it blocks or
      restricts, design the per-lane-home trust seeding and record it.
- [ ] **Effort precedence.** Run with `--effort high` against a model whose
      name encodes `-low`, and vice versa, and determine which governs. Record
      the authoritative mechanism.
- [ ] **Timeout interaction.** Confirm `--print-timeout` accepts a
      Foreman-derived value and that exceeding it is distinguishable in the
      output from a model failure.
- [ ] **Unauthenticated exit contract.** Re-confirm `agy models` rc 1 with
      `Error: Please sign in…` under a credential-less home, and record whether
      any other command yields a distinct unauthenticated code.
- [ ] Record every answer, with its command and output, in
      `docs/research/vnext/` and cite the CLI version each was taken against.

## T2 — the adapter

- [ ] `skills/foreman/scripts/adapters/agy.sh` implementing the seven contract
      functions.
- [ ] `adapter_implement_argv`: `--mode accept-edits`, pinned `--model`,
      authoritative effort mechanism, derived `--print-timeout`, `--add-dir` /
      working-root handling for the worktree, and `--print "$PROMPT"` **last**.
- [ ] `adapter_audit_argv`: `--mode plan`, pinned `--model`, `--json-schema`
      pointing at `adapters/verdict.schema.json`, an output format the schema
      enforcement covers, and `--print "$PROMPT"` last.
- [ ] `adapter_home_var` → `HOME`. Record in the header that `GEMINI_CLI_HOME`
      was probed and has no effect on this CLI.
- [ ] `adapter_auth_probe` → bounded `agy models`, positive-signal required,
      fail closed.
- [ ] `adapter_caps` → resume via `--continue` / `--conversation`, schema
      forced (with the streaming caveat), sandbox via `--sandbox`, `cap_n=1`,
      no distinct `rc_unavailable` code, `prompt_flag=--print`,
      `prompt_flag_position=last`, `verified_cli_version=1.1.8`.
- [ ] Header records the hang-on-misordered-prompt behaviour and the version it
      was verified against.

## T3 — plumbing (all sites, or none)

- [ ] `lane-run.sh:206-213` — add `agy) echo HOME`.
- [ ] `lane-run.sh:305-307` — update the unknown-vendor message to name the
      full supported set.
- [ ] `wt-new.sh:106-109` — provision `"$VENDOR_HOME/agy"`.
- [ ] `wt-new.sh:256-258` — add the provisioning report line.
- [ ] `worker-run.sh:116-122,141-144,149` — add the agy branches and the
      environment allow-list entry.
- [ ] `env/tool-check.sh:56-83` — add the `agy)` branch to `vendor_authed`,
      modelled on the grok branch's bounded, fail-closed, positive-signal
      shape.
- [ ] `env/tool-check.sh:134-153` — add the agy inventory row with version and
      remediation.
- [ ] `env/tool-check.sh:3,15,17` and `:403-416` — usage text for `--lane agy`.
- [ ] `env/tool-check.sh:273-279` — decide `must` versus `should` membership
      per profile, and state the reason. Making agy a `must` breaks every
      existing host's READY verdict; that is a decision, not an oversight.
- [ ] `config/foreman.toml.example` — a `[vendor.agy]` block with `model`,
      `effort`, `cap` and `auth`, and a comment stating the cap's evidence
      basis.

## T4 — credential provisioning and cleanup

- [ ] A Setup-stage path that seeds an agy lane home with the credential
      material a lane needs, owned by Setup and never by a worker.
- [ ] `wt-cleanup` removes seeded credential material with the worktree.
- [ ] Confirm the seeded material does not trip `lane-run.sh`'s
      secrets-refusal preflight, or make the preflight aware of it explicitly —
      do not disable the preflight.
- [ ] Confine every write and removal to the lane home's `antigravity-cli`
      subtree; never touch the sibling CLI's paths under the same root.
- [ ] IF clean seeding proves impossible on this host, implement the shared-home
      fallback at cap 1 and report that it is in effect.

## T5 — inventory honesty

- [ ] Each vendor row names the binary invoked and its resolved path.
- [ ] An installed CLI that no lane invokes is reported installed-but-unused
      and contributes to no lane's READY verdict.
- [ ] `@google/gemini-cli`, if present, is reported under its own id and never
      satisfies the agy lane's readiness.
- [ ] A test asserting that a host with only the unused CLI reports
      `LANE_READY: agy=no`.

## T6 — agents, docs, and gate

- [ ] `agents/agy-implementer.md` and `agents/agy-auditor.md`, citing the
      adapter rather than restating flags, and stating `STATUS: unavailable`
      behaviour when the vendor is not ready.
- [ ] `skills/foreman/SKILL.md` and `references/lanes.md` updated for the
      fourth lane, including the recorded justification and the explicit
      statement that the lane is not justified by reviewer independence.
- [ ] `tests/agy-lane.bats`: argv order, prompt-not-on-stdin, home-var
      resolution, auth-probe fail-closed behaviour, credential-less refusal,
      and the readiness-row identity test.
- [ ] Every T1 item has a recorded answer with its command and output.
- [ ] Full suite green on WSL/Ubuntu 26.04.
- [ ] `shellcheck` clean on `adapters/agy.sh` and every modified script.
- [ ] `bugeventlog.md` entry recording the wrong-binary failure class — a
      readiness inventory that reported a vendor on the strength of a CLI no
      lane invokes, which sent a research lane and a spec package down the
      wrong tool for a day — with its evidence, root cause, impact and this
      enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate agy-lane-activation --strict` passes.
