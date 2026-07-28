# Change: cross-vendor-audit-routing

## Why

Foreman's central quality claim is that the auditor's vendor differs from the
worker's. That claim is stated in prose in six places — `SKILL.md:113`,
`SKILL.md:320`, `README.md:44`, `README.md:165`,
`references/lanes.md:156,162`, and `agents/codex-auditor.md` — and enforced in
code in **exactly one**: `audit-run.sh:31-33`, a single `if` comparing two
strings read from `.foreman/config.toml`, in a hard-mode-only script.

**Soft mode has no code enforcement of the invariant at all.** It is doctrine
the architect model is trusted to follow. R5 §5.4 calls this the most important
finding in its vendor section, and the arithmetic is the argument: adding a
fourth vendor takes the routing matrix from 3×2 to 4×3 while enforcement
remains one `if` in a script most rounds never reach. `ROADMAP.md:238-239`
already schedules the fix — *"The vendor≠worker invariant is centralized in one
shared `lib/audit-call.sh` and enforced at every tier"* — for **v0.4.0**. The
fourth vendor arrives in v0.2.9.

**The invariant also has a documented hole that costs Foreman its best lane.**
`SKILL.md:113-115` instructs: if Codex implemented, do not use `codex-auditor`;
use architect review or a non-OpenAI auditor and say so. With two vendors and a
codex-only auditor, racing Grok and Codex as cross-vendor implementers means
one of the two diffs has no automated auditor. R3's routing table closes this:
a fourth vendor can audit codex-implemented work, and a single non-participating
vendor can audit both arms of a race.

**And there is a second `if` that refuses to let any of that happen.**
`audit-run.sh:35-37`: `if [[ "$AUDIT_VENDOR" != "codex" ]]; then die
"$EXIT_MISSING_CLI" "audit-run currently only auto-invokes Codex…"`. Any
non-codex auditor is refused outright, in the middle of what is nominally an
invocation builder.

**The invariant as written can now be satisfied while being violated.** The
fourth vendor's CLI, `agy`, is a **gateway, not a single-family model
endpoint**. Its live model list on the reference box (2026-07-28) is:

```
gemini-3.6-flash-{high,medium,low}   gemini-3.5-flash-{high,medium,low}
gemini-3.1-pro-{high,low}            claude-sonnet-4-6
claude-opus-4-6-thinking             gpt-oss-120b-medium
```

A string comparison of CLI names passes `worker=claude, auditor=agy` even when
the agy lane is configured to `claude-opus-4-6-thinking` — same model family,
same training lineage, and precisely the correlated-failure case the invariant
exists to prevent. R6 §6.1's measured finding is that nine frontier models
across seven families already behave as about two effective independent votes;
routing that silently collapses two lanes into one family does not merely fail
to add independence, it removes the little that was there.

The routing decision itself is also, today, an architect judgement call made
fresh each time — which is neither deterministic nor reportable. R3's
recommendation is a config change: replace the scalar `[audit] vendor` with an
ordered preference list that the router filters the worker vendor out of.

## What changes

- **`[audit] vendors = [...]`, an ordered preference list**, replacing the
  scalar `[audit] vendor`. The router filters out any vendor that participated
  as a worker and selects the first remaining eligible entry, so the choice is
  deterministic and reproducible rather than a judgement made per round.
- **The invariant moves to model family, not CLI name.** Each adapter publishes
  the model family a configured model belongs to; the router compares families.
  A gateway CLI serving another vendor's family is treated as that family for
  invariant purposes.
- **One shared enforcement point, applied at every tier.** The invariant is
  centralized (the `lib/audit-call.sh` shape `ROADMAP.md:238-239` already
  names) and enforced in soft mode as well as hard mode, rather than living as
  one `if` in a script most rounds never reach.
- **`audit-run.sh:35-37`'s codex-only refusal is removed**, replaced by
  dispatch through `adapter_audit_argv` for whichever vendor the router
  selected. A vendor with no audit adapter is refused by the router at
  selection time, with a named reason — not by a `die` in the middle of an
  invocation.
- **Selection and substitution are reported, never absorbed.** Every audited
  round records `auditor_vendor`, `auditor_model`, `auditor_family` and
  `auditor_selected_because`, including the reason any higher-preference vendor
  was skipped.
- **The post-audit tamper assertion is generalized and strengthened.** It
  applies to every auditor vendor, not just codex, and it is not waived for a
  vendor whose read-only mode is documented — a documented mode is a control,
  not a proof.
- **Dual audit with a tiebreak is defined but not made the default.** Two
  family-distinct auditors may run in parallel on the same cold diff; on
  disagreement, Foreman escalates to `foreman-advisor` rather than defaulting
  to the strictest verdict. It is opt-in, because the evidence for a second
  auditor's marginal value is weak (see `design.md`).

## Impact

- Affected: `skills/foreman/scripts/audit-run.sh` (`:27-29`, `:31-33`,
  `:35-37`, `:78-86`, `:90-93`), `skills/foreman/scripts/lib/config.sh`,
  `config/foreman.toml.example` (`[audit]`), `skills/foreman/SKILL.md`
  (`:113-115`, `:320`), `README.md` (`:44`, `:165`),
  `skills/foreman/references/lanes.md` (`:156,162`),
  `agents/codex-auditor.md`, `agents/foreman-audit.md`.
- New: `skills/foreman/scripts/lib/audit-call.sh` (the shared enforcement and
  selection point), `tests/audit-routing.bats`.
- Depends on `vendor-adapter-contract` (the `audit` verb and `adapter_caps`).
  Coordinates with `agy-lane-activation`, which supplies the fourth vendor and
  makes its model family observable.
- **Ownership boundary:** this package owns the post-audit tamper assertion at
  `audit-run.sh:90-93`. `vendor-adapter-contract` explicitly does not touch it.
- Behaviour change: a repo with a scalar `[audit] vendor` continues to work —
  the scalar is read as a one-element list — but a repo whose worker vendor
  equals its sole configured auditor now fails at selection with a named
  reason, where hard mode previously failed at `audit-run.sh:31-33` and soft
  mode previously did not fail at all.
