## Context

WP5a/WP5b delivered the Grok canary adapter, provider-health service, and Node
process runner. Claude Code 2.1.220 accepts structured-output canaries with
prompt on stdin and a private outer JSON shape whose successful schema-output
path reports `stop_reason=tool_use` without a pending executable tool call.

## Goals / Non-Goals

**Goals:**

- One bounded Claude provider canary adapter behind `ProviderCanaryAdapter`.
- Provider-neutral stdin transport on the process request.
- Fail-closed decoding of the private Claude wire with no promotion of `result`.
- Preserve all existing Grok tests and behavior.

**Non-Goals:**

- Live network calls in this package's unit tests.
- Codex, Gemini, durable runtime, MCP server, plugins.
- Logging raw prompt bytes, raw provider output, secrets, or home paths.

## Decisions

1. **Prompt transport union** — `ProviderCanaryPrompt` is
   `{ kind: "file"; path }` or `{ kind: "stdin"; bytes }`. Grok requires file;
   Claude requires stdin.
2. **Process request stdin** — `stdin: null` when unused; non-null opens a pipe,
   writes exact bytes, and ends the stream. `shell: false` remains mandatory.
3. **Claude argv** — fixed Claude Code 2.1.220 flags including empty `--tools`
   as a distinct argv element. Model id is caller-supplied; no prompt in argv.
4. **Wire normalization** — successful completed schema-output with
   `stop_reason=tool_use` maps to provider-neutral `stop` with
   `pendingToolCalls=0` and `failedToolCalls=0`. All failure observations use
   null tool counts because the provider did not supply trustworthy zero-count
   evidence.
5. **Authority** — `runProviderHealthCanary` remains terminal-first and
   nonce-binding authority; adapters only build requests and decode terminals.

## Risks / Trade-offs

- Stdin write races with early child exit: the runner settles success only after
  stdin write completion, and write failure reaps the child before a typed
  secret-safe error.
- Claude wire fields are private and may drift across CLI versions: pin 2.1.220
  and fail closed on type mismatches.

## Migration Plan

No migration. Callers that built canaries with `promptFile` must pass
`prompt: { kind: "file", path }`.
