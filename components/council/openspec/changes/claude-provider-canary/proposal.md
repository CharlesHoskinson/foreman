## Why

Council has a Grok canary adapter and a shell-free process runner, but Claude
Code structured-output canaries need stdin prompt transport and a private wire
decoder. Without that boundary, Claude cannot join provider-health preflight
under the same terminal-first rules as Grok.

## What Changes

- Add `@council/adapter-claude` for Claude Code 2.1.220 structured-output
  canaries on provider family `anthropic`.
- Add a provider-neutral prompt transport union: file path for Grok-style
  providers, stdin bytes for Claude-style providers.
- Add `stdin: Uint8Array | null` to `ProviderProcessRequest` and teach the Node
  process runner to write exact bytes, complete stdin, and reap on write
  failure, timeout, or interruption.
- Keep Claude outer wire types private. Normalize successful schema-output
  `tool_use` to provider-neutral `stop` with zero pending tool calls.
- Preserve Grok argv, decode, and `stdin: null` behavior.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `provider-participation`: stdin transport, Claude adapter, shell-free argv
  contract for Claude Code structured-output canaries.
- `prompt-preflight`: canary build input uses the prompt transport union;
  Claude canaries use stdin bytes only.

## Impact

- Adds `packages/adapter-claude` and focused tests.
- Updates application ports, provider-health input, Node process runner, Grok
  adapter stdin null, architecture rules, workspace references, and lockfile.
- Does not add durable runtime, MCP, plugins, Codex/Gemini adapters, or a
  review-dispatch loop.
