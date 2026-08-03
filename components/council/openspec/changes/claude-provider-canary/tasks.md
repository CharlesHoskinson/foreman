## 1. Contract

- [x] 1.1 Add `ProviderCanaryPrompt` discriminated union and
      `ProviderProcessRequest.stdin`.
- [x] 1.2 Thread prompt union through `runProviderHealthCanary` input.

## 2. Process runner

- [x] 2.1 Open stdin only when request bytes exist; write exact bytes; complete
      stdin; `shell: false`.
- [x] 2.2 Typed secret-safe stdin write failure after child terminate and close.
- [x] 2.3 Timeout and interruption close stdin, terminate, escalate, await close.

## 3. Claude adapter

- [x] 3.1 Package `@council/adapter-claude` with pure TypeScript + Effect.
- [x] 3.2 Exact Claude Code 2.1.220 argv and stdin-only prompt transport.
- [x] 3.3 Reject non-`anthropic` family and file prompt variant.
- [x] 3.4 Decode private wire; normalize schema-output `tool_use` to `stop`.
- [x] 3.5 Fail closed on timeout, signal, nonzero exit, malformed JSON/types,
      `is_error`, api error status, non-success subtype, non-completed terminal
      reason, missing `structured_output`, and `result` promotion.

## 4. Grok preservation

- [x] 4.1 Grok sets `stdin: null` and still requires file prompt.

## 5. Workspace and verification

- [x] 5.1 Architecture rules, TypeScript project references, lockfile.
- [x] 5.2 Focused tests RED then GREEN; broader Council checks.
