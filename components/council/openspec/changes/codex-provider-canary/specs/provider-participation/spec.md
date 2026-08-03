## MODIFIED Requirements

### Requirement: Invocation is shell-free and reproducible

Adapters SHALL produce an executable plus argument array, explicit working
directory, environment allowlist, optional stdin bytes, stream mode, output
limits, and configuration inventory instead of a shell command string. When
stdin bytes are present, the process runner SHALL write those exact bytes and
complete the stream without shell evaluation. Grok-style file prompts SHALL set
stdin to null. Claude-style and Codex-style canaries SHALL put prompt bytes only
on stdin and SHALL NOT place prompt text in argv. When a provider requires a
schema file on a supported POSIX host (including WSL), the Node host SHALL
materialize exact UTF-8 schema bytes under a scoped temporary path with
owner-only directory and file modes, SHALL delete that temporary directory
after success, typed failure, or interruption, and SHALL surface a static
secret-safe cleanup failure when removal fails. On native Windows
(`process.platform === "win32"`), the host SHALL refuse schema-file
materialization before any temporary path, directory, or file mutation because
POSIX modes do not establish owner-only ACLs; native Windows remains
unsupported until an ACL-aware backend exists. Codex canaries SHALL pass the
materialized schema path through `--output-schema` and SHALL NOT place schema
JSON in argv.

#### Scenario: Prompt contains shell metacharacters

- **WHEN** user data includes shell operators or command substitutions
- **THEN** the data reaches the provider as an argument or stdin payload and is
  never evaluated by a shell

#### Scenario: Claude canary uses stdin transport

- **WHEN** the Claude adapter builds a canary request for family `anthropic`
- **THEN** the request contains stdin bytes, the Claude Code argv contract, an
  empty tools argument as a distinct argv element, and no prompt text in argv

#### Scenario: Codex canary uses stdin and schema-file transport

- **WHEN** the Codex adapter builds a canary request for family `openai` with a
  file schema path
- **THEN** the request contains stdin prompt bytes, the Codex 0.146.0 argv
  contract including `--output-schema` and trailing `-`, and neither prompt text
  nor schema JSON in argv

#### Scenario: Schema-file materialization is refused on native Windows

- **WHEN** the Node host is asked to materialize a canary schema file on
  `process.platform === "win32"`
- **THEN** it returns a typed unsupported-platform error with a static
  secret-safe reason and performs no temporary directory or file mutation

#### Scenario: Schema-file materialization cleans up acquisition failures

- **WHEN** temporary directory creation succeeds and a later permission or write
  step fails on a supported POSIX host
- **THEN** the host attempts recursive removal of the exact temporary directory
  with bounded retries and returns either the original static create/write
  failure after successful cleanup or a static cleanup failure when removal
  cannot complete

### Requirement: Terminal classification uses compound evidence

Council MUST classify an attempt from exit status, signal, terminal provider
event, parser completeness, cancellation state, usage, side-effect state, and
the designated structured-output channel rather than exit code or JSON-looking
text alone. Council MUST classify transport completion before it parses a
deliberation outcome. A Claude successful schema-output record with private
`stop_reason=tool_use` MUST normalize to provider-neutral `stop` with zero
pending tool calls and MUST NOT treat that stop as an executable tool call.
Adapters MUST NOT promote Claude `result` text or Grok `text` to structured
output. A Codex successful stream MUST contain exactly four non-empty JSONL
events in order (`thread.started`, `turn.started`, one `item.completed` with
`agent_message`, `turn.completed` with numeric usage) and MUST parse
`item.text` exactly once as designated structured output. A Codex failure
observation for sequence, type, transport, exit, signal, timeout, truncation,
UTF-8, or JSON violations SHALL report null tool counts and a static
secret-safe error. A failure observation SHALL use null tool counts when the
provider does not supply trustworthy tool-state evidence.

#### Scenario: Exit zero with truncated output

- **WHEN** a provider exits zero without a complete terminal record
- **THEN** Council returns a typed protocol failure and retains a bounded,
  sanitized diagnostic reference

#### Scenario: An interim abstention precedes cancellation

- **WHEN** a provider emits `insufficient_evidence` in ordinary text and then
  terminates as cancelled
- **THEN** Council returns a review-attempt infrastructure failure and records
  no abstention or verdict

#### Scenario: Claude schema output reports tool_use without tools

- **WHEN** Claude Code returns a completed success record with
  `stop_reason=tool_use`, designated `structured_output`, and no tools enabled
- **THEN** the adapter reports provider-neutral stop reason `stop` with zero
  pending and failed tool calls

#### Scenario: Codex four-event success stream

- **WHEN** Codex exits zero without truncation and emits exactly the four
  required JSONL events with a JSON `item.text` body
- **THEN** the adapter reports completed terminal state, stop reason `stop`,
  zero pending and failed tool calls, and the parsed `item.text` value as
  designated structured output

#### Scenario: Codex stream with an extra event fails closed

- **WHEN** Codex emits five JSONL events or reorders the required four events
- **THEN** the adapter returns no structured output, null tool counts, and a
  static secret-safe error
