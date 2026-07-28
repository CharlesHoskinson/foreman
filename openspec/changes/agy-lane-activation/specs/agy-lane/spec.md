# Spec delta — agy lane

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.
Header shape follows the OpenSpec CLI's parseable form (see
`lock-primitive-hardening/tasks.md` T8 for the repo-wide conformance debt).

All vendor behaviour asserted here was probed live, read-only, on the reference
box on 2026-07-28 against Antigravity CLI 1.1.8, except where a requirement
explicitly defers to a verification task.

## ADDED Requirements

### Requirement: the agy lane is isolated by its own HOME, not by GEMINI_CLI_HOME

Foreman SHALL isolate an `agy` lane's mutable state by giving the lane its own
`$HOME`, and SHALL NOT rely on `GEMINI_CLI_HOME`.

`adapter_home_var agy` SHALL resolve to `HOME`.
`GEMINI_CLI_HOME` SHALL NOT be used as the agy isolation lever, because it has
no effect on this CLI: a run with `GEMINI_CLI_HOME` pointed at an empty
directory leaves that directory empty and still resolves state from the real
home.
WHEN a worktree is provisioned, Foreman SHALL create the lane's agy home
alongside the other vendor homes.
WHILE an agy lane runs, every file it creates under its home SHALL be confined
to that home, and the lane SHALL NOT write to the operator's real
`~/.gemini` tree.
Anything Foreman writes or removes for this vendor SHALL be confined to the
`antigravity-cli` subtree, because `~/.gemini` is a root shared with an
unrelated CLI that stores `config/`, `tmp/`, `history/` and `projects.json` in
the same tree.

#### Scenario: state moves with the lane home

- WHEN an agy lane runs with its own `$HOME` under the worktree
- THEN the CLI's settings, conversation database and cache are created under
  that home
- AND the operator's real `~/.gemini/antigravity-cli` is unmodified.

#### Scenario: cleanup does not destroy a sibling CLI's state

- WHEN a worktree is cleaned up
- THEN only the lane home's `antigravity-cli` subtree is removed
- AND no path belonging to the other CLI sharing the `~/.gemini` root is
  touched.

### Requirement: an isolated agy home is credential-less until Setup seeds it

An isolated `$HOME` does not carry the agy credential: the OAuth token lives
under the home being replaced, and a fresh home therefore has no credential.

WHEN Setup provisions an agy lane home, it SHALL place the credential material
the lane requires into that home.
IF an agy lane's home holds no usable credential, THEN the lane SHALL be
refused before a worktree lock is taken and before any event is emitted, and
the refusal SHALL name the Setup action that fixes it.
A worker SHALL NEVER perform credential provisioning.
WHEN a worktree is cleaned up, any seeded credential material SHALL be removed
with it.
IF credential seeding cannot be performed cleanly on a host, THEN Foreman SHALL
fall back to a shared home at a concurrency cap of 1, and SHALL report that it
has done so, rather than leaving credential material outside the lane's own
lifecycle.

#### Scenario: a credential-less lane is refused at the gate, not mid-round

- WHEN an agy lane is started against a home with no credential
- THEN the lane is refused before the worktree lock and before any event is
  emitted
- AND the refusal names the Setup action
- AND no round is recorded as a model failure.

### Requirement: agy readiness is probed at zero model cost and fails closed

The agy readiness probe SHALL be `agy models` run under a bounded timeout, and
SHALL NOT run a billed inference.

The probe SHALL require a positive authenticated signal — a model list — to
report authenticated.
IF the probe times out, THEN the vendor SHALL be reported not authenticated.
`agy` has no exit code that uniquely means "not authenticated": it returns rc 0
when authenticated and rc 1 when the home holds no credential, and rc 1 is also
its general error code. Therefore a nonzero exit alone SHALL NOT be reported as
"not authenticated", and the absence of a known error phrase SHALL NOT be
reported as "authenticated".
The readiness inventory SHALL carry an agy row with its version string and,
when not authenticated, the operator instruction that fixes it.
WHERE `agy` is not present on a host, the row SHALL report it missing rather
than not authenticated.

#### Scenario: an unauthenticated agy is reported as a Setup finding

- WHEN the readiness inventory runs on a host whose agy home holds no
  credential
- THEN the agy row reports not authenticated with the operator instruction
- AND the run consumes no model quota
- AND `LANE_READY: agy=no` is emitted.

#### Scenario: an ambiguous nonzero exit is never read as a verdict either way

- WHEN `agy models` exits nonzero with an unrecognised message
- THEN the probe reports not authenticated
- AND it does so because no positive signal was seen, not because the exit code
  was interpreted.

### Requirement: the agy prompt is the value of a trailing print flag

The agy adapter SHALL deliver the prompt as the value of `--print`, placed last
in the argv.

The adapter SHALL NOT pass the prompt as a positional argument.
The adapter SHALL NOT emit a valueless `--print`.
The prompt SHALL NOT arrive on stdin.
IF the prompt is supplied as a positional argument with a valueless trailing
`--print`, THEN the CLI does not error — it hangs indefinitely, which every
layer above reads as a slow model — so the adapter contract test SHALL assert
the correct form rather than relying on a runtime failure.

#### Scenario: the built argv ends with the prompt flag and its value

- WHEN the adapter builds an agy implement or audit invocation
- THEN the final two argv elements are `--print` and the prompt value
- AND the prompt value appears exactly once in the argv.

#### Scenario: the misordered form is caught by a test, not by a stalled lane

- WHEN a change emits the prompt as a positional argument with a trailing bare
  `--print`
- THEN the adapter contract test fails naming the required order
- AND no lane is allowed to reach the hanging invocation.

### Requirement: agy implement lanes run in accept-edits mode with write evidence

An agy implement lane SHALL run with `--mode accept-edits`.

The lane SHALL NOT use `--dangerously-skip-permissions` outside a containerized
hard-mode run, and WHERE it is used, the containment SHALL be stated.
WHEN an implement round completes, Foreman SHALL determine whether files
changed from the git-status digest defined by the vendor adapter contract, and
SHALL NOT accept the model's own narration as evidence.
IF a round completes with no digest change, THEN the round SHALL be re-prompted
within its bounded budget or reported as having produced no file changes,
naming agy.
Whether agy exhibits a silent zero-write failure mode in headless — writes
denied while the model narrates success, the class already recorded for grok
and for the other Google CLI — is UNVERIFIED, and SHALL be established
empirically before the lane is declared ready.

#### Scenario: a zero-write round is detected regardless of narration

- WHEN an agy implement round exits 0 and describes files it claims to have
  written
- AND the git-status digest of the worktree is unchanged
- THEN the round is treated as having produced no file changes
- AND the lane re-prompts within budget or fails naming agy.

### Requirement: agy audit lanes run in plan mode and are asserted not to have mutated the tree

An agy audit lane SHALL run with `--mode plan`.

WHEN an audit completes, Foreman SHALL compare `git status --porcelain` in the
target worktree against the snapshot taken immediately before the audit
started.
IF the two differ, THEN the audit SHALL be reported invalid and the difference
SHALL be named.
A documented read-only mode SHALL NOT be accepted as proof that the tree was
untouched; the assertion is mandatory regardless of mode.
The audit verb SHALL pass the verdict schema via `--json-schema` and SHALL
select an output format the schema enforcement covers, because for streaming
output the enforcement is documented to apply only to the final result.

#### Scenario: an auditor that touches the tree invalidates its own audit

- WHEN an agy audit runs in plan mode and any file in the worktree differs
  afterwards
- THEN the audit is reported invalid naming the changed paths
- AND no verdict is emitted for that run.

### Requirement: the agy model is pinned and the reasoning-effort mechanism is authoritative

An agy lane SHALL pin its model explicitly and SHALL NOT rely on a CLI default.

The round report SHALL record the model actually used.
Reasoning effort is expressible twice for this vendor — as `--effort
low|medium|high` and as a suffix in the model name — and the precedence between
them is UNVERIFIED.
WHEN the precedence has been established, Foreman SHALL adopt exactly one
authoritative mechanism, SHALL use it consistently for implement and audit
lanes, and SHALL assert that the non-authoritative mechanism does not
contradict it.
IF a lane's configured effort and its pinned model's encoded effort disagree,
THEN the lane SHALL refuse to start and SHALL name the contradiction, rather
than proceeding at an unknown effort.
WHILE the precedence remains unverified, an agy auditor SHALL NOT be described
as running at the highest reasoning level.

#### Scenario: a contradictory effort configuration is refused

- WHEN a lane is configured with an effort flag that disagrees with the effort
  encoded in its pinned model name
- THEN the lane refuses to start naming both values
- AND no round is started at an unknown effort.

### Requirement: Foreman's round timeout is authoritative over the vendor print timeout

The agy adapter SHALL derive `--print-timeout` from Foreman's configured round
timeout, and SHALL NOT leave it at the CLI default.

The CLI default is five minutes; `limits.round_timeout_min` defaults to thirty,
so an unmanaged default truncates a long round from inside while Foreman still
believes the lane is running.
IF the derived timeout cannot be applied, THEN the lane SHALL refuse to start
rather than run under an unknown truncation bound.
WHEN a round is truncated by the vendor timeout, the round report SHALL
distinguish that outcome from a model failure.

#### Scenario: a long round is not silently truncated at five minutes

- WHEN a lane is configured with a thirty-minute round timeout and starts an
  agy round
- THEN the invocation carries a print timeout derived from that configuration
- AND a round still running at six minutes has not been terminated by the
  vendor default.

### Requirement: workspace trust is established before the lane is declared ready

`agy` maintains a `trustedWorkspaces` list in its settings, and Foreman lanes
run in freshly created worktrees that are not on it. The CLI exposes no
skip-trust flag.

The behaviour of a headless agy run in an untrusted workspace SHALL be
established empirically before the lane is declared ready.
IF an untrusted workspace causes writes to fail silently or causes the run to
block, THEN Foreman SHALL provision the lane's own home with the worktree path
marked trusted at provisioning time.
A trust entry SHALL be written only into the lane's own home, and SHALL NEVER
be written into the operator's real settings.
The write-evidence digest SHALL remain mandatory whatever the trust probe
finds.

#### Scenario: an untrusted worktree does not produce a silent no-op round

- WHEN an agy implement lane runs in a freshly created worktree
- THEN either the run writes files and the digest changes, or the round is
  reported as having produced no file changes
- AND a restricted-mode run is never reported as a successful round.

### Requirement: the agy CLI version is recorded because the binary self-updates

Foreman SHALL record the agy CLI version actually invoked in each round report.

The CLI carries an updater and a last-check timestamp and updates itself
without operator action; it moved from 1.1.7 to 1.1.8 during the session in
which this change was written.
WHEN the invoked version differs from the version the adapter declares it was
verified against, Foreman SHALL report the mismatch as an INFO finding naming
both versions.
IF a self-update changes the prompt-delivery flag, the mode names, the schema
flag or the exit-code contract, THEN the adapter's verification tasks SHALL be
re-run before the lane is used again.

#### Scenario: a silent vendor update is visible after the fact

- WHEN a round runs against a CLI version newer than the adapter's verified
  version
- THEN the round report names both versions
- AND the mismatch is reported as INFO, not as a round failure.

### Requirement: the lane's justification is recorded, and it is not independence

The reason for adding this vendor lane SHALL be recorded, and SHALL be
supported by the evidence available.

Foreman SHALL NOT claim that adding a fourth vendor increases reviewer
independence: the measured evidence is that frontier models across seven
families behave as approximately two effective independent votes, and that
Foreman's real decorrelation mechanism is the cold-diff audit's different
evidence set and role, which two vendors already provide.
WHERE the lane is justified on quality grounds, its unique-catch rate over the
existing vendor pair SHALL be measured before that justification is recorded.
IF the measured unique-catch rate is below the threshold recorded with the
measurement, THEN the lane SHALL be documented as a
cost, capability or availability lane, and SHALL NOT be documented as a quality
lane.

#### Scenario: an unmeasured lane is not described as a quality improvement

- WHEN the agy lane ships without a unique-catch measurement
- THEN its recorded justification names cost, capability or availability
- AND no document claims it improves review independence.

## MODIFIED Requirements

### Requirement: the readiness inventory names the binary the lanes invoke

The readiness inventory reports per-vendor rows by tool id. A host with a
Google CLI installed that no lane invokes can therefore contribute to a READY
verdict for a lane that uses a different binary — which is exactly the
mis-detection that caused this change to be first drafted against
`@google/gemini-cli` rather than `agy`.

Each vendor row SHALL name the binary the lanes actually invoke and the
resolved path at which it was found.
IF a CLI is installed but no lane invokes it, THEN it SHALL NOT contribute to
any lane's READY verdict, and it SHALL be reported as installed-but-unused
rather than omitted.
WHEN two CLIs from the same vendor family are present, the inventory SHALL
distinguish them by id, binary name and path, and SHALL NOT report one on the
strength of the other.
The lane readiness emitter SHALL continue to key off the row id, so that a
lane's `LANE_READY` verdict derives from the row for the binary that lane runs.

#### Scenario: an installed-but-unused CLI does not make a lane READY

- WHEN a host has `@google/gemini-cli` installed and unauthenticated, and `agy`
  installed and authenticated
- THEN the inventory shows both, distinguished by id, binary and path
- AND `LANE_READY: agy=yes` derives only from the agy row
- AND the unused CLI is reported as installed-but-unused.

#### Scenario: a missing lane binary is not masked by a sibling CLI

- WHEN a host has a same-family CLI installed but not the binary the lane
  invokes
- THEN the lane's row reports the binary missing
- AND the lane is NOT-READY.

### Requirement: the vendor map, group topology and hard-mode allow-list accept agy

`lane-run.sh:206-213` maps vendors to their config-home env var and
`lane-run.sh:305-307` rejects any unknown `LANE_VENDOR` with a message naming
`grok|codex|claude`. `wt-new.sh:106-109` provisions vendor homes for those
three, `lane-queue.sh:422` defines the group topology, and
`worker-run.sh:116-122,141-144,149` gates the hard-mode environment allow-list.

The vendor map SHALL accept `agy` and SHALL resolve its home variable.
The rejection message for an unknown vendor SHALL name the full supported
vendor set, including `agy`, and SHALL be kept in step with the map.
Worktree provisioning SHALL create an agy vendor home and SHALL report it in
the worktree's provisioning log alongside the others.
The hard-mode environment allow-list SHALL carry agy's home variable.
The readiness gate SHALL apply to agy exactly as it applies to the existing
vendors, refusing the lane before the worktree lock when the vendor is
NOT-READY.
No site listed here SHALL be wired for agy unless every site is, because a
vendor advertised at some sites and unimplemented at others fails after
consuming a worktree and a queue slot.

#### Scenario: an agy lane passes every gate it is advertised at

- WHEN a lane is started with `LANE_VENDOR=agy` on a ready host
- THEN the vendor map resolves its home variable
- AND a vendor home exists in the worktree
- AND the lane reaches its adapter-built invocation without an unknown-vendor
  error.

#### Scenario: the unknown-vendor message stays in step with the map

- WHEN a lane is started with a vendor that is not supported
- THEN the rejection names the full supported set as implemented in the map
- AND the message does not omit a vendor the map accepts.
