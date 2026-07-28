# Tasks — cross-vendor-audit-routing

Ordering: T1 and T2 are serial and land first (the shared component and the
family mapping). T3-T4 depend on both. T5 is opt-in and may land last. T6
gates.

Depends on `vendor-adapter-contract` for `adapter_audit_argv` and
`adapter_caps`. Coordinates with `agy-lane-activation` for the fourth vendor's
family reporting.

## T1 — the shared enforcement and selection point

- [ ] Create `skills/foreman/scripts/lib/audit-call.sh` — the single place the
      invariant is implemented, as `ROADMAP.md:238-239` already describes.
- [ ] Implement candidate filtering: remove every worker vendor in the round,
      including every arm of a race.
- [ ] Implement selection: first remaining candidate that is ready,
      family-distinct, and has an audit adapter.
- [ ] Deterministic selection — same config, worker set and readiness state
      always yields the same auditor.
- [ ] Refuse with a reason naming every rejected candidate when none remains.
- [ ] shdoc headers; shellcheck clean.

## T2 — model family classification

- [ ] Each adapter publishes the model family for a configured model.
- [ ] Handle gateway CLIs: the family is the family of the model actually
      selected, never the family associated with the CLI. `agy`'s live model
      list on the reference box spans Gemini, Anthropic and OpenAI-lineage
      models, so this is not hypothetical.
- [ ] Fail closed on an unclassifiable model: refuse it as an auditor and name
      it. Do not assume distinctness.
- [ ] Test the specific trap: worker `claude`, auditor `agy` pinned to an
      Anthropic-family model, must be refused.

## T3 — config and migration

- [ ] Replace scalar `[audit] vendor` with `[audit] vendors = [...]` in
      `lib/config.sh` and `config/foreman.toml.example`.
- [ ] Read a scalar `[audit] vendor` as a one-element list so existing repos
      keep working.
- [ ] Add per-vendor auditor model keys and state that each must be pinned.
- [ ] Document the behaviour change: a repo whose worker equals its only
      configured auditor now fails at selection with a named reason, where soft
      mode previously did not fail at all.

## T4 — wire both tiers

- [ ] `audit-run.sh:27-29` reads the preference list through the shared
      component.
- [ ] `audit-run.sh:31-33`'s inline equality check is replaced by the shared
      component's family-based check.
- [ ] `audit-run.sh:35-37`'s codex-only refusal is removed.
- [ ] `audit-run.sh:78-86` dispatches through `adapter_audit_argv`.
- [ ] `audit-run.sh:90-93`'s tamper assertion is generalized to every vendor
      and both tiers, with the declared-report-path exception. **This package
      owns this line**; `vendor-adapter-contract` must not touch it.
- [ ] Soft mode records `auditor_vendor`, `auditor_model`, `auditor_family`
      and `auditor_selected_because` in the round report.
- [ ] `gate-eval.sh` fails any audited round whose recorded auditor family
      equals a worker family.

## T5 — dual audit and tiebreak (opt-in)

- [ ] Support two family-distinct auditors in parallel audit worktrees on the
      same cold diff.
- [ ] Off by default; the configuration key states why (measured marginal value
      of an extra reviewer is small, cost is not).
- [ ] On disagreement, escalate to `foreman-advisor`; never resolve by taking
      the strictest verdict.
- [ ] Record both input verdicts, the escalation, and the deciding verdict.

## T6 — docs, tests, gate

- [ ] Update all six prose statements (`SKILL.md:113`, `SKILL.md:320`,
      `README.md:44`, `README.md:165`, `references/lanes.md:156,162`,
      `agents/codex-auditor.md`) to cite the enforcing component and state that
      the invariant is over model family.
- [ ] Replace `SKILL.md:113-115`'s "if Codex implemented, use architect review"
      guidance with the ordered-preference routing rule.
- [ ] `tests/audit-routing.bats`: filtering, determinism, the gateway
      same-family trap, unclassifiable-model refusal, no-eligible-candidate
      refusal, scalar-config compatibility, substitution reporting, soft-mode
      gate failure, tamper assertion for a non-codex auditor.
- [ ] Full suite green on WSL/Ubuntu 26.04.
- [ ] `shellcheck` clean on `lib/audit-call.sh` and `audit-run.sh`.
- [ ] `bugeventlog.md` entry recording the enforcement-asymmetry failure class:
      an invariant stated in six prose locations and enforced in one line of
      one hard-mode script, with soft mode — the default — unenforced.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate cross-vendor-audit-routing --strict` passes.
