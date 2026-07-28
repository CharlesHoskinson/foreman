# Spec delta — doctrine integrity

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

## ADDED Requirements

### Requirement: load-bearing documentation claims are registered against a deterministic probe

The repository SHALL maintain a claim registry binding documentation claims to
probes over the repository.

Each registry entry SHALL carry a claim identifier, the document location that
makes the claim, the claim in one line, a probe, the expected result, the result
observed when the entry was registered, and the owner responsible for the claim.
A probe SHALL be deterministic and SHALL be expressible as a text search, a
JSON query, a configuration lookup, or a version-control query.
A probe SHALL NOT invoke a language model, perform a network request, or run a
build.
The registry SHALL cover claims about pinned facts — a number, a path, a
default, a supported value, or the existence of a capability — and the scope
limit SHALL be stated in the reference documentation alongside the checker.

#### Scenario: a documented cap is bound to the shipped cap

- WHEN the concurrency caps stated in the roadmap are registered as a claim
- THEN the probe reads the caps the queue script actually configures
- AND the entry names the document location that states them.

#### Scenario: a probe requiring a model call is rejected

- WHEN a proposed registry entry's probe requires a language-model call
- THEN the entry is not admitted to the registry.

### Requirement: a deterministic checker fails on any claim the code contradicts

A checker SHALL run every registry probe and SHALL fail IF any probe's result
differs from its expected value.

The failure message SHALL name the claim identifier, the document location, the
expected value, and the observed value.
The checker SHALL be runnable offline and SHALL complete without building the
project.
The checker SHALL report the count of registered claims and their pass or fail
state, and SHALL NOT report a coverage percentage or any figure that could be
read as one.

#### Scenario: a drifted claim fails the check with an actionable message

- WHEN a configuration default changes in the code but not in the document that
  states it
- THEN the checker fails
- AND the message names the claim, the document location, the expected value
  and the observed value
- AND no further investigation is needed to decide whether to fix the code, fix
  the document, or repoint the probe.

#### Scenario: the checker does not claim coverage

- WHEN the checker passes
- THEN its output states that every registered claim still holds
- AND it reports no percentage.

### Requirement: a probe that matches nothing is a failure

IF a probe returns an empty result, THEN the checker SHALL fail with a reason
distinct from a value mismatch, naming the claim whose probe has gone stale.

The checker SHALL compare an empty result against the value recorded when the
entry was registered, so that a moved or renamed probe target is diagnosable as
such rather than reported as a plain mismatch.
A probe SHALL NOT be able to pass by matching nothing under any condition.

#### Scenario: a renamed target is reported as a stale probe, not a broken claim

- WHEN the file or symbol a probe targets is renamed
- THEN the checker fails with the stale-probe reason
- AND the message distinguishes this from the claim itself having become false.

### Requirement: the checker's own probes are proven able to fail

The checker SHALL be verified by mutation: for each probe class, a deliberate
change to the repository fixture SHALL make the corresponding probe fail.

IF a probe cannot be made to fail by any mutation, THEN it SHALL be reported as
an unprotected claim and SHALL NOT be counted as a passing claim.
This requirement adopts the regression-injection discipline owned by
`test-infrastructure-hardening` and SHALL NOT introduce a second mechanism for
it.

#### Scenario: an always-green probe is reported, not counted

- WHEN a probe passes under every mutation of its target
- THEN it is reported as unprotected
- AND it does not contribute to the count of passing claims.

### Requirement: the doctrine check runs in the documentation gate

The checker SHALL run as part of the existing documentation gate, recording its
result in the same structure as the gate's other checks.

WHEN the documentation gate runs, the doctrine check SHALL run with it.
IF the doctrine check fails, THEN the documentation gate SHALL fail.
The checker SHALL NOT require any tool the documentation gate does not already
require, beyond a shell, a JSON processor, and version control.

#### Scenario: a false claim blocks the gate

- WHEN a registered claim is contradicted by the code at gate time
- THEN the documentation gate fails
- AND the merge gate that consumes the documentation gate's result fails
  closed.

### Requirement: every change registers the claims its documentation makes

WHEN a change package adds or modifies a documentation claim about a pinned
fact, it SHALL add or update the corresponding registry entry as part of that
change.

The registry SHALL grow by construction with each change, and SHALL NOT depend
on a periodic audit sweep to stay current.
The known contradictions identified in the internal attachment map SHALL be
seeded into the registry, and each SHALL be either resolved by its owning
package before release or registered as knowingly false with the package that
will close it named.
A knowingly-false claim SHALL fail the check unless the document has been
corrected to state the reality.

#### Scenario: a new claim arrives with its probe

- WHEN a change package documents a new configuration default
- THEN the change adds a registry entry binding that default to a probe
- AND the doctrine check covers it from that change onward.

#### Scenario: a seeded contradiction cannot survive the release

- WHEN a seeded contradiction is still present at the release gate
- THEN the doctrine check fails
- AND the failure names the package that owns the fix.

### Requirement: a package's stated progress may not contradict the roadmap

The checker SHALL report any change package whose task list shows no completed
work while the roadmap records that work as shipped.

Each such contradiction SHALL be resolved by archiving the package, correcting
the roadmap, or correcting the task list, and SHALL NOT be left standing.

#### Scenario: a stale change folder is reported

- WHEN a change package's task list has zero completed items and the roadmap
  records its work as merged in a prior release
- THEN the checker reports the contradiction naming both locations.

### Requirement: workarounds carry the model and date they were added for

A workaround introduced for a specific model's or tool's behaviour SHALL carry
the model or tool identity it was added for and the date it was added.

The checker SHALL report workarounds carrying neither, and workarounds whose
stamp is older than one release without a recorded re-test.
This SHALL be reported as a count in the first release that introduces it, and
SHALL NOT fail the gate until a threshold has been set from the measured count.

#### Scenario: an unstamped workaround is counted

- WHEN a workaround comment names no model, tool or date
- THEN the checker reports it
- AND the documentation gate does not fail on that basis in the release that
  introduces this check.
