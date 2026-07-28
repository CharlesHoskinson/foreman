# Spec delta — audit routing

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.
Header shape follows the OpenSpec CLI's parseable form (see
`lock-primitive-hardening/tasks.md` T8 for the repo-wide conformance debt).

## ADDED Requirements

### Requirement: the auditor is selected from an ordered preference list

Foreman SHALL select the auditor from an ordered list of eligible vendors,
`[audit] vendors`, rather than from a single configured vendor.

The router SHALL remove from the candidate list every vendor that participated
as a worker in the round being audited, including every arm of a raced
implementation.
The router SHALL then select the first remaining candidate that is ready,
family-distinct from every worker, and has an audit adapter.
WHERE `[audit] vendor` is configured as a scalar, it SHALL be read as a
one-element list, so existing repository configurations continue to work.
IF no candidate remains, THEN Foreman SHALL refuse the audit with a reason
naming each rejected candidate and why it was rejected, and SHALL NOT fall back
to a same-family auditor.
Selection SHALL be deterministic: the same configuration, worker set and
readiness state SHALL always select the same auditor.

#### Scenario: a raced implementation gets a single non-participating auditor

- WHEN a round is implemented by two vendors racing and both arms are audited
- THEN the router filters both worker vendors out of the candidate list
- AND selects one auditor whose model family neither worker used
- AND the same auditor may review both diffs.

#### Scenario: codex-implemented work gets a cross-vendor auditor

- WHEN the worker vendor is codex and the audit preference list contains a
  ready, family-distinct alternative
- THEN that alternative is selected
- AND the round is audited automatically rather than deferred to architect
  review.

#### Scenario: no eligible auditor is a refusal, not a downgrade

- WHEN every configured auditor is either a worker in this round, not ready, or
  the same model family as a worker
- THEN the audit is refused with a reason naming each rejected candidate
- AND no same-family auditor is used.

### Requirement: the cross-vendor invariant is expressed over model family

The invariant SHALL compare the **model family** of the auditor against the
model family of every worker, and SHALL NOT be satisfied by a difference in CLI
name alone.

Each adapter SHALL publish the model family of a configured model.
WHERE a vendor CLI is a gateway that can serve models from more than one
family, the round's family SHALL be the family of the model actually selected,
not the family associated with the CLI.
IF the auditor's model family equals any worker's model family, THEN the audit
SHALL be refused, naming both the CLI names and the families, even WHILE the
CLI names differ.
IF a configured model cannot be classified into a family, THEN it SHALL NOT be
used as an auditor, and the refusal SHALL name the unclassified model — the
router fails closed rather than assuming distinctness.

#### Scenario: a gateway CLI serving the worker's own family is refused

- WHEN the worker's model family is Anthropic and the configured auditor is a
  different CLI pinned to an Anthropic-family model
- THEN the audit is refused naming both CLIs and the shared family
- AND the fact that the CLI names differ does not satisfy the invariant.

#### Scenario: an unclassifiable auditor model is refused, not assumed distinct

- WHEN an auditor is configured with a model Foreman cannot map to a family
- THEN the router refuses it naming the model
- AND selection continues with the next candidate.

### Requirement: the invariant is enforced at every tier, from one shared point

The invariant SHALL be implemented once, in a shared component, and SHALL be
applied in soft mode as well as in hard mode.

Hard mode SHALL refuse to invoke an auditor that violates the invariant, before
the invocation.
WHERE soft mode has no single spawn point, the round report SHALL record the
auditor's vendor, model and family, and the gate SHALL fail any audited round
whose recorded auditor family equals a worker family.
The invariant SHALL NOT be stated only in prose: every prose statement of it
SHALL cite the enforcing component.
IF the shared component is unavailable, THEN the audit SHALL be refused rather
than proceeding unchecked.

#### Scenario: a soft-mode same-family audit fails the gate

- WHEN a soft-mode round records an auditor whose model family equals the
  worker's
- THEN the gate fails naming both families
- AND the verdict from that audit is not accepted.

#### Scenario: hard mode refuses before invoking

- WHEN a hard-mode audit is configured with an auditor that violates the
  invariant
- THEN the audit is refused before the auditor process is spawned
- AND no partial audit artefacts are written.

### Requirement: auditor selection and substitution are always reported

Every audited round SHALL record `auditor_vendor`, `auditor_model`,
`auditor_family` and `auditor_selected_because`.

WHEN a higher-preference candidate is skipped, the record SHALL name that
candidate and the reason it was skipped.
IF a vendor is unavailable, THEN the substitution SHALL be reported and SHALL
NOT be silently absorbed.
The report SHALL be machine-readable so that auditor selection over a release
can be summarized without reading transcripts.

#### Scenario: a substitution names what was skipped and why

- WHEN the first-preference auditor is the worker vendor and the second is
  selected
- THEN the round report names the first candidate, the reason it was filtered,
  and the selected auditor with its family.

### Requirement: dual audit is available, opt-in, and escalates on disagreement

Foreman SHALL support running two family-distinct auditors in parallel on the
same cold diff.

Dual audit SHALL NOT be the default, because the measured marginal value of an
additional reviewer is small while its cost is not.
WHEN two auditors return different verdicts, Foreman SHALL escalate to
`foreman-advisor` for a deciding verdict.
Foreman SHALL NOT resolve a disagreement by defaulting to the strictest
verdict.
The escalation, both input verdicts, and the deciding verdict SHALL be recorded.

#### Scenario: two auditors disagree and the advisor decides

- WHEN one auditor returns APPROVED and the other returns BLOCKED on the same
  diff
- THEN Foreman escalates to `foreman-advisor`
- AND the recorded outcome is the advisor's verdict together with both inputs
- AND the outcome is not automatically BLOCKED.

## MODIFIED Requirements

### Requirement: any configured auditor vendor may be invoked

`audit-run.sh:35-37` refuses every auditor that is not codex:
`if [[ "$AUDIT_VENDOR" != "codex" ]]; then die "$EXIT_MISSING_CLI"
"audit-run currently only auto-invokes Codex…"`. This sits inside the
invocation path, so a correctly configured non-codex auditor is rejected after
selection rather than during it.

The codex-only refusal SHALL be removed.
`audit-run.sh` SHALL obtain its invocation from the selected vendor's
`adapter_audit_argv`.
IF the selected vendor has no audit adapter, THEN the router SHALL reject it at
selection time with a named reason and continue with the next candidate.
IF no vendor in the preference list has an audit adapter, THEN the audit SHALL
be refused with a reason naming the missing adapters.

#### Scenario: a non-codex auditor runs

- WHEN the router selects a ready, family-distinct vendor that is not codex
- THEN `audit-run.sh` invokes it through its audit adapter
- AND no refusal is raised on the grounds of the vendor's identity.

#### Scenario: a vendor with no audit adapter is skipped at selection

- WHEN the highest-preference candidate has no audit adapter
- THEN the router skips it, records the reason, and selects the next candidate
- AND the failure does not surface inside the invocation path.

### Requirement: every audit asserts the auditor did not mutate the worktree

`audit-run.sh:90-93` snapshots `git status --porcelain` before and after the
codex audit and refuses the audit if they differ. The check is correct and is
scoped to one vendor and one tier.

The assertion SHALL apply to every auditor vendor and to both tiers.
The assertion SHALL NOT be waived for a vendor whose read-only or plan mode is
documented, because a documented mode is a control and not a proof — one
vendor's plan mode is enforced by an in-process policy that still permits some
writes.
WHERE an auditor is expected to write a report artefact, the permitted path
SHALL be declared in advance and SHALL lie outside the reviewed worktree's
diff surface; any change outside that declared path SHALL invalidate the audit.
IF the assertion fails, THEN the audit SHALL be reported invalid naming the
changed paths, and the verdict SHALL NOT be consumed by the gate.

#### Scenario: a plan-mode auditor that writes into the tree invalidates its audit

- WHEN an auditor running in a documented read-only mode modifies a file in the
  reviewed worktree
- THEN the audit is reported invalid naming the changed paths
- AND the gate does not consume the verdict.

#### Scenario: a declared report path does not trip the assertion

- WHEN an auditor writes only to its declared report path outside the reviewed
  diff surface
- THEN the assertion passes
- AND the verdict is consumed normally.

### Requirement: prose statements of the invariant cite the enforcing component

The invariant is stated in six prose locations — `SKILL.md:113`,
`SKILL.md:320`, `README.md:44`, `README.md:165`,
`references/lanes.md:156,162` and `agents/codex-auditor.md` — and enforced in
one. `SKILL.md:113-115` additionally instructs the architect to fall back to
architect review when the worker was codex, which is no longer the best
available routing.

Each prose statement SHALL cite the component that enforces the invariant.
The codex-worker guidance SHALL be replaced by the ordered-preference routing
rule, so that codex-implemented work is audited by a family-distinct vendor
rather than deferred to architect review.
The prose SHALL state that the invariant is over model family, not CLI name.

#### Scenario: the documentation and the code agree

- WHEN a reader follows any prose statement of the invariant
- THEN it names the enforcing component and the family-based rule
- AND it does not instruct a fallback the router would not choose.
