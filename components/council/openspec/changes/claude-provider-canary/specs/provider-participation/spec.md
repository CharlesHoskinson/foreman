## MODIFIED Requirements

### Requirement: Invocation is shell-free and reproducible

Adapters SHALL produce an executable plus argument array, explicit working
directory, environment allowlist, optional stdin bytes, stream mode, output
limits, and configuration inventory instead of a shell command string. When
stdin bytes are present, the process runner SHALL write those exact bytes and
complete the stream without shell evaluation. Grok-style file prompts SHALL set
stdin to null. Claude-style canaries SHALL put prompt bytes only on stdin and
SHALL NOT place prompt text in argv.

#### Scenario: Prompt contains shell metacharacters

- **WHEN** user data includes shell operators or command substitutions
- **THEN** the data reaches the provider as an argument or stdin payload and is
  never evaluated by a shell

#### Scenario: Claude canary uses stdin transport

- **WHEN** the Claude adapter builds a canary request for family `anthropic`
- **THEN** the request contains stdin bytes, the Claude Code argv contract, an
  empty tools argument as a distinct argv element, and no prompt text in argv

### Requirement: Terminal classification uses compound evidence

Council MUST classify an attempt from exit status, signal, terminal provider
event, parser completeness, cancellation state, usage, side-effect state, and
the designated structured-output channel rather than exit code or JSON-looking
text alone. Council MUST classify transport completion before it parses a
deliberation outcome. A Claude successful schema-output record with private
`stop_reason=tool_use` MUST normalize to provider-neutral `stop` with zero
pending tool calls and MUST NOT treat that stop as an executable tool call.
Adapters MUST NOT promote Claude `result` text or Grok `text` to structured
output. A failure observation SHALL use null tool counts when the provider does
not supply trustworthy tool-state evidence.

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
