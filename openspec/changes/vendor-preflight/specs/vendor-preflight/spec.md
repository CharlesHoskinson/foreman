# Spec delta — vendor preflight

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: vendor readiness is three independent facts, never one boolean

The preflight SHALL report, for every configured vendor lane, three facts
independently: **discoverable** (the CLI resolves on `PATH`), **authenticated**
(the vendor will accept work), and **current** (the resolved version is at or
above the floor pinned in `env/reference-manifest.toml`). Each fact SHALL carry
its own value and its own evidence class, and the preflight SHALL NOT collapse
them into a single ready/not-ready boolean before reporting them.

A vendor that is discoverable and authenticated but behind its pinned floor
SHALL be reported as such, and SHALL NOT be reported as unauthenticated.

#### Scenario: an outdated but authenticated vendor is not reported as signed out

- WHEN the preflight inspects a vendor whose CLI resolves, whose auth check
  returns `authenticated`, and whose version is below the pinned floor
- THEN the vendor's authenticated fact is `authenticated`
- AND its current fact is `outdated`, naming the resolved and floor versions
- AND the emitted remediation instruction is an update instruction, never
  `login`.

### Requirement: the auth result is three-state and an unknown is never rendered as a login instruction

The auth fact SHALL take exactly one of three values: `authenticated`,
`not-authenticated`, or `unknown`. `not-authenticated` SHALL be reported only
on a **positive** signal that the vendor is signed out. `unknown` SHALL be
reported whenever the probe could not reach a determination — including a
bound expiring, a non-zero exit carrying no recognised signed-out signal, an
empty response, a transport or socket failure, or an unparsable response.

WHEN the auth fact is `unknown`, THEN the preflight SHALL NOT emit a login
instruction, SHALL name the probe that failed and why, and SHALL fail the gate
closed. Failing closed and diagnosing correctly are separate obligations and
the preflight SHALL satisfy both: a gate may refuse on `unknown`, but it SHALL
NOT assert the vendor is signed out in order to do so.

The current implementation folds a `timeout` exit (124) into
`not-authenticated`; this requirement forbids that.

#### Scenario: a bounded probe that expires reports unknown, not signed out

- WHEN the grok auth probe's bounded wait expires before the CLI responds
- THEN the auth fact is `unknown` with an evidence detail naming the timeout
  and the bound
- AND the operator instruction is not `grok login --device-code`
- AND the gate does not pass.

#### Scenario: a genuinely signed-out CLI is reported as signed out

- WHEN the vendor CLI responds within its bound with a recognised signed-out
  signal
- THEN the auth fact is `not-authenticated`
- AND the emitted instruction is that vendor's documented login command.

### Requirement: each vendor's auth evidence class is declared, and no vendor is trusted on an absence of evidence

Each vendor adapter SHALL declare its evidence class. `declared` means the
vendor ships a non-interactive status verb whose contract distinguishes signed
in from signed out — `claude auth status` (JSON, carrying `loggedIn`) and
`codex login status`. `probed` means it does not, and readiness is inferred
from a bounded minimal call — `grok` and `agy`, neither of which exposes a
status verb.

A `probed` adapter SHALL require a **positive** signal of being signed in and
SHALL NOT infer authentication from the absence of a signed-out string. WHERE a
vendor's positive signal is a human-readable banner, the adapter SHALL treat a
change in that banner as producing `unknown`, never `authenticated` and never
`not-authenticated`, because a banner is a vendor presentation detail and not a
contract.

#### Scenario: a changed banner degrades to unknown rather than flipping the verdict

- WHEN a `probed` vendor exits zero but its output matches neither the positive
  signed-in signal nor a recognised signed-out signal
- THEN the auth fact is `unknown`
- AND the report names the unmatched output as the reason
- AND the verdict is not inferred from the absence of the negative string.

### Requirement: the preflight never mutates the toolchain it is inspecting

The preflight SHALL determine currency by comparing the vendor's reported
version against a floor pinned in `env/reference-manifest.toml`. It SHALL NOT
invoke any vendor's `update` verb, WHERE that verb installs.

`claude update` is documented as "check for updates and install if available".
`codex update` exposes no dry-run flag. Only `grok update --check` is
non-mutating and MAY be called, and only with `--check`.

#### Scenario: currency is decided without installing anything

- WHEN the preflight evaluates the current fact for `claude`, `codex` or `agy`
- THEN it reads the version via that CLI's version flag and compares it to the
  pinned floor
- AND no `update` subcommand is invoked
- AND the resolved version, the floor, and the comparison result are all
  recorded.

### Requirement: every preflight state is demonstrated reachable before the checker is trusted

Each adapter's every reportable state — `authenticated`, `not-authenticated`,
`unknown`, `missing`, `outdated` — SHALL be demonstrated to be produced by the
checker against a known input that induces it, and that demonstration SHALL be
committed as a test. A state that has never been observed being produced SHALL
NOT be relied on by the gate.

This requirement exists because the defect that motivated this change was a
checker no one had watched fail correctly.

#### Scenario: the unknown state is proven reachable

- WHEN the test suite forces a vendor probe to exceed its bound
- THEN the checker reports `unknown` for that vendor
- AND the test asserts the reported reason names the timeout
- AND the test asserts no login instruction was emitted.

#### Scenario: the not-authenticated state is proven reachable

- WHEN the test suite runs an adapter against a stub CLI that emits that
  vendor's documented signed-out response
- THEN the checker reports `not-authenticated`
- AND the test asserts the emitted instruction is that vendor's login command.

### Requirement: the preflight result is machine-readable and carries a timestamp

The preflight SHALL write a JSON record containing, per vendor: the resolved
absolute path, the reported version, the pinned floor, the three facts with
their evidence classes, the probe actually executed, and a UTC timestamp.
Callers SHALL read that record rather than re-deriving readiness by parsing
human-readable output.

#### Scenario: a lane gate reads the record instead of re-probing

- WHEN `lane-run.sh` evaluates readiness for a vendor before spawning its lane
- THEN it reads the preflight JSON record
- AND it refuses to spawn WHERE that vendor's auth fact is not `authenticated`
- AND its refusal message reproduces the recorded reason verbatim rather than
  restating it.

### Requirement: Setup persists one bounded record for each supported lane

Setup SHALL persist the validated canonical JSON record for each requested
vendor lane. The default path SHALL be
`$FOREMAN_HOME/preflight/<vendor>.json`. The default `FOREMAN_HOME` value SHALL
be `$HOME/.foreman`.

The writer SHALL create the parent directory with owner-only permissions. The
writer SHALL write a temporary file in the same directory. The writer SHALL
set owner-only permissions on the record. The writer SHALL replace the target
only after the complete record is durable.

The writer SHALL reject a record larger than 1,048,576 bytes. The writer SHALL
remove its temporary file after a failed write. This requirement does not set
a record age limit. A later credential-profile change owns record freshness.

#### Scenario: Setup replaces a complete vendor record

- WHEN Setup inspects the `grok` lane
- THEN it writes one validated canonical JSON record to the `grok` store path
- AND an interrupted write does not replace the previous complete record
- AND the record mode permits access by the owner only.

### Requirement: lane admission uses only the persisted record

The Node.js `lane-gate` command SHALL read one persisted record. It SHALL NOT
resolve a CLI. It SHALL NOT start a vendor process. It SHALL NOT run an auth or
version probe.

The command SHALL require a closed vendor identifier and an absolute record
path. It SHALL bound the input before JSON parsing. It SHALL use the public
`VendorPreflightRecordV1` decoder. It SHALL reject a record for a different
vendor.

The command SHALL pass only when all three recorded facts are ready. It SHALL
fail closed when the file is missing, unreadable, oversized, malformed, or
vendor-mismatched. For a valid not-ready record, it SHALL emit the selected
recorded reason without rewriting that reason.

`lane-run.sh` SHALL call the tracked Node.js runtime before it touches the lane
lock. A missing runtime, a missing record, or an invalid record SHALL stop the
lane. `lane-run.sh` SHALL NOT continue with an unverified vendor lane.

#### Scenario: a missing record stops the lane without a live probe

- WHEN `lane-run.sh` starts a configured vendor lane without its record
- THEN the Node.js lane gate returns a boundary failure
- AND `lane-run.sh` does not start the vendor command
- AND no vendor preflight process runs.

#### Scenario: a valid refusal preserves the recorded diagnosis

- WHEN the stored auth fact is `unknown` with reason `auth probe timed out`
- THEN the lane gate refuses the lane
- AND its diagnostic contains `auth probe timed out` unchanged
- AND its diagnostic does not contain a login instruction.
