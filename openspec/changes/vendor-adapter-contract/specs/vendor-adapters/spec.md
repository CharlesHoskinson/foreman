# Spec delta — vendor adapter contract

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.
Header shape follows the OpenSpec CLI's parseable form (see
`lock-primitive-hardening/tasks.md` T8 for the repo-wide conformance debt).

## ADDED Requirements

### Requirement: every vendor invocation is built by a per-vendor adapter

Foreman SHALL build every vendor CLI invocation through a per-vendor adapter
exposing two verbs, `implement` and `audit`, and SHALL NOT construct a vendor
invocation at a call site.

The adapter set SHALL cover `grok`, `codex`, `agy` and `claude`, and each
adapter SHALL define `adapter_implement_argv`, `adapter_audit_argv`,
`adapter_home_var`, `adapter_auth_probe`, `adapter_result_text`,
`adapter_result_verdict` and `adapter_caps`.
Each argv builder SHALL emit a bash array (`ADAPTER_ARGV`) whose elements are
spawned directly, and SHALL NOT emit a string requiring shell re-interpretation.
WHEN a caller requests a verb for a vendor whose adapter does not implement it,
the adapter SHALL fail with a named error identifying the vendor and the verb.
IF a caller requests an unknown vendor, THEN the adapter layer SHALL fail with
a configuration error naming the vendor and the set of known vendors.
The grok and codex `implement` argv SHALL be byte-identical to the argv
`wc_build_argv` produces before this change.

#### Scenario: the audit verb exists for the first time

- WHEN `audit-run.sh` prepares a cold-diff audit
- THEN it obtains its invocation from `adapter_audit_argv` for the configured
  auditor vendor
- AND no vendor flags are written inline in `audit-run.sh`
- AND `agents/codex-auditor.md` cites the adapter rather than restating the
  invocation.

#### Scenario: the grok and codex implement argv are unchanged

- WHEN the adapter builds the implement argv for grok and for codex
- THEN each argv matches, element for element, the argv `wc_build_argv`
  produced before this change
- AND the test that asserts this compares elements, not a joined string.

#### Scenario: an unknown vendor fails at the adapter, not at the CLI

- WHEN a caller requests an implement argv for a vendor with no adapter
- THEN the call fails with a configuration error naming the vendor and the
  known vendor set
- AND no vendor binary is spawned.

### Requirement: the prompt is never delivered on stdin

An adapter SHALL deliver the task prompt as a file path argument or as an argv
value, and SHALL NOT deliver it on standard input.

WHILE a lane runs under `foreman-launch`, the child's stdin is the null device
and SHALL remain so.
WHERE a vendor CLI documents a stdin-piping idiom, the adapter SHALL NOT use
it, and SHALL record in its header why the documented idiom is refused.
IF an adapter's built argv contains a bare `-` in a position the vendor reads
as "prompt from stdin", THEN the adapter contract test SHALL fail.

#### Scenario: a vendor with no prompt-file flag still keeps stdin clear

- WHEN the adapter builds an implement argv for a vendor that offers no
  file-based prompt input
- THEN the prompt contents are passed as an argv value
- AND stdin remains attached to the null device for the invocation.

#### Scenario: the contract test catches a stdin regression

- WHEN an adapter is changed to read its prompt from stdin
- THEN the adapter contract test fails naming the adapter and the invariant.

### Requirement: order-sensitive vendor flags are placed by the adapter and tested

WHERE a vendor CLI has a flag whose position or value-attachment changes the
meaning of the invocation, the adapter SHALL declare that constraint in
`adapter_caps` and SHALL be the only component that satisfies it.

The adapter SHALL place the prompt-carrying flag so that the prompt is
unambiguously its value, and SHALL NOT emit the prompt as a positional argument
alongside a valueless prompt flag.
The contract test SHALL assert, for every vendor and both verbs, that the
prompt string appears exactly once in the built argv and in the position the
adapter declares.
IF a vendor's misordered invocation fails by hanging rather than by exiting
nonzero, THEN the adapter SHALL document that consequence in its header,
because a hang is indistinguishable from a slow model at every layer above it.

#### Scenario: the prompt flag is placed last with its value attached

- WHEN the adapter builds an invocation for a vendor whose prompt flag must be
  final
- THEN the built argv ends with that flag immediately followed by the prompt
  value
- AND no other argument follows it.

#### Scenario: a misordered invocation is caught by a test, not by a stalled lane

- WHEN a change places the prompt as a positional argument and leaves the
  prompt flag valueless
- THEN the adapter contract test fails naming the flag and the required
  position
- AND the defect is caught before a lane can hang until the stall watchdog
  fires.

### Requirement: adapters publish capabilities and unavailability signals

Each adapter SHALL publish a machine-readable capability set via
`adapter_caps`, including at minimum whether the vendor supports headless
resume, whether it can force a response schema, what sandbox or approval
mechanism it offers, its concurrency cap, its `rc_unavailable` exit-code set,
and the vendor CLI version the adapter was verified against.

WHEN a vendor invocation exits with a code in that vendor's `rc_unavailable`
set, the caller SHALL report `STATUS: unavailable` and SHALL treat the
condition as a Setup-stage finding.
IF a vendor invocation exits nonzero with a code outside `rc_unavailable`,
THEN the caller SHALL report `STATUS: fail` and SHALL treat the condition as a
round-stage failure.
IF a vendor has no exit code that uniquely means "not authenticated", THEN its
adapter SHALL declare that fact and SHALL require a positive authenticated
signal from its auth probe, never the absence of a negative string.
The caller SHALL make this distinction without vendor-specific code at the call
site.
The round report SHALL record the vendor CLI version actually invoked, so that
a self-updating vendor CLI drifting away from the version its adapter was
verified against is visible after the fact.

#### Scenario: an unauthenticated vendor is a Setup finding, not a failed round

- WHEN a lane invokes a vendor that is not authenticated and the vendor exits
  with a code its adapter lists in `rc_unavailable`
- THEN the lane reports `STATUS: unavailable` naming the vendor
- AND the round is not recorded as a model failure
- AND the operator-facing remediation is the vendor's Setup instruction.

#### Scenario: a vendor whose unauthenticated exit code is also its general error code

- WHEN a vendor returns the same nonzero code for "not signed in" and for any
  other error
- THEN its adapter declares no distinct `rc_unavailable` code
- AND its auth probe requires a positive authenticated signal to report
  authenticated
- AND an error banner that merely lacks a known negative phrase is never read
  as authenticated.

### Requirement: result capture separates stdout from stderr and never trusts a pipeline

An adapter SHALL capture a vendor invocation's stdout and stderr to distinct
files and SHALL parse whichever stream carries the machine-readable payload.

The adapter SHALL NOT infer success or failure from the exit status of a shell
pipeline.
WHERE a vendor writes its structured output to stdout on success and to stderr
on failure, `adapter_result_text` and `adapter_result_verdict` SHALL inspect
both files.
IF the invocation exits zero AND the expected payload is absent from both
streams, THEN the adapter SHALL report a failure naming the missing payload,
and SHALL NOT return an empty result as a successful one.
The lane transcript's existing merged `2>&1` capture SHALL be retained for
human reading and SHALL NOT be the source the adapter parses.

#### Scenario: a zero-exit empty result is a failure, not an empty answer

- WHEN a vendor invocation exits zero with empty stdout and an error object on
  stderr
- THEN the adapter reports a failure naming the stream the error was found on
- AND does not return an empty string as the result text.

### Requirement: a non-conforming verdict is a failure, not a verdict

An audit invocation SHALL yield an object conforming to
`skills/foreman/scripts/adapters/verdict.schema.json`, and the adapter SHALL be
responsible for guaranteeing that conformance.

WHERE a vendor can force a response schema natively, the adapter SHALL pass the
schema to the vendor.
WHERE a vendor cannot force a response schema, the adapter SHALL prompt for the
schema, parse the reply, and validate the parsed object against the schema
itself.
WHERE a vendor's schema enforcement applies only to a subset of its output
formats, the adapter SHALL select an output format the enforcement covers, and
SHALL record that choice and its reason.
IF the parsed object does not conform, THEN the adapter SHALL report the audit
as failed, SHALL name the conformance error, and SHALL NOT emit a verdict.
The verdict value SHALL be one of `APPROVED`, `WARNING` or `BLOCKED`, and any
other value SHALL be treated as non-conforming.

#### Scenario: a schema-less vendor is validated by the adapter

- WHEN an audit runs on a vendor whose CLI offers no schema-forcing flag
- THEN the adapter extracts the reply, validates it against
  `verdict.schema.json`, and emits the verdict only if it conforms
- AND a reply that does not conform is reported as a failed audit naming the
  validation error.

#### Scenario: schema forcing is not assumed to cover every output format

- WHEN an audit runs on a vendor whose schema enforcement is documented to
  apply only to the final result of a streaming format
- THEN the adapter selects an output format the enforcement covers, or
  validates the parsed object itself
- AND the choice is recorded in the adapter header with the documented caveat
  it answers.

### Requirement: write evidence is a git-status digest, never vendor narration

Foreman SHALL determine whether an implement round changed files by comparing a
digest of `git status --porcelain` in the target worktree before and after the
round.

The digest SHALL cover untracked and modified files alike.
The generalized helper SHALL live in `skills/foreman/scripts/lib/evidence.sh`
and SHALL be usable by every vendor's implement lane.
`vendor-multiround.sh` SHALL replace `grok-multiround.sh` and SHALL obtain each
round's invocation from `adapter_implement_argv` rather than appending a
grok-specific flag.
IF the target working directory is not a git work tree, THEN the helper SHALL
fail loudly before the first round, because an always-empty digest would report
a correct round as an empty burst.
WHEN a bounded round budget is exhausted with no digest change, the helper SHALL
exit nonzero naming the vendor and the round count, and SHALL NOT report
success on the strength of the vendor's own output.

#### Scenario: a vendor that narrates success but writes nothing is caught

- WHEN an implement round completes with exit code 0 and the model's output
  describes files it claims to have written
- AND the git-status digest is unchanged
- THEN the round is treated as having produced no file changes
- AND the helper re-prompts within its budget or fails naming the vendor.

#### Scenario: a non-git working directory fails before the first round

- WHEN `vendor-multiround.sh` is pointed at a directory that is not a git work
  tree
- THEN it fails immediately with a configuration error
- AND no vendor invocation is made.

## MODIFIED Requirements

### Requirement: a plumbed vendor lane is either functional or absent

`claude` is advertised as a lane at four sites — a per-worktree vendor home
(`wt-new.sh:106-109`), the vendor environment map (`lane-run.sh:210`), a pueue
group (`lane-queue.sh:422`) and an auth probe (`env/tool-check.sh:83`) — while
`lib/worker-cmd.sh:6-7` records it as out of scope and no `claude` branch
exists in `wc_build_argv`. A `LANE_VENDOR=claude` lane therefore passes every
gate and then dies at the argv builder with `unknown worker vendor`.

A vendor SHALL NOT be advertised as an available lane unless every site
required to run it is implemented.
IF a vendor appears in the vendor environment map, the pueue group topology,
the worktree vendor-home provisioning, or the readiness inventory, THEN it
SHALL have a working adapter for at least the `implement` verb.
IF a vendor has no working adapter, THEN all four advertising sites SHALL be
removed, and its absence SHALL be stated in the readiness inventory rather than
implied by a late failure.
WHEN this change lands, `claude` SHALL be in exactly one of those two states,
and the state chosen SHALL be recorded with its reason.

#### Scenario: an advertised vendor can actually be invoked

- WHEN a lane is started with a vendor that the vendor environment map accepts
- THEN an adapter exists that builds that vendor's implement argv
- AND the lane does not fail with `unknown worker vendor` after passing the
  readiness gate.

#### Scenario: an unsupported vendor is refused at the gate, not at the builder

- WHEN a lane is started with a vendor Foreman does not support
- THEN it is refused by the vendor map before a worktree lock is taken or an
  event is emitted
- AND the refusal names the supported vendor set.

### Requirement: audit invocations are not duplicated in prose

`agents/codex-auditor.md` restates the codex audit invocation that
`audit-run.sh:78-86` also hard-codes, giving soft mode and hard mode two
independently maintained copies of the same flags.

Agent definition files SHALL cite the adapter as the source of truth for vendor
invocation, and SHALL NOT restate vendor flags that determine sandbox mode,
schema forcing, model selection or result capture.
IF an agent definition file contains a raw vendor invocation, THEN the docs
check SHALL fail naming the file.

#### Scenario: soft mode and hard mode cannot drift apart

- WHEN the codex audit sandbox flag changes in the adapter
- THEN both the soft-mode agent lane and `audit-run.sh` pick up the change
- AND no agent file needs a matching edit to stay correct.
