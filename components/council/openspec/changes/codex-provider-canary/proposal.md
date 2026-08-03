## Why

Council has Grok and Claude canary adapters and a shell-free process runner, but
Codex CLI structured-output canaries need a schema-file path, stdin prompt
transport, and a private four-event JSONL decoder. Without that boundary, Codex
cannot join provider-health preflight under the same terminal-first rules.

## What Changes

- Add `@council/adapter-codex` for Codex CLI 0.146.0 structured-output canaries
  on provider family `openai`.
- Add a provider-neutral schema transport union: inline JSON for Grok and Claude,
  file path for Codex.
- Add a scoped Node host schema-file materializer that writes exact UTF-8 bytes
  with restrictive permissions on POSIX/WSL, deletes the temporary directory on
  scope close with bounded cleanup retries, and refuses native Windows until an
  ACL-aware backend exists.
- Keep Codex wire types private. Accept exactly four JSONL events and parse
  `item.text` once as designated structured output.
- Preserve Grok and Claude argv, decode, and inline-schema behavior.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `provider-participation`: schema-file transport, Codex adapter, shell-free
  argv contract for Codex structured-output canaries.
- `prompt-preflight`: canary build input uses the schema transport union; Codex
  canaries use a materialized schema file and stdin prompt bytes.

## Impact

- Adds `packages/adapter-codex`, schema-file materializer, and focused tests.
- Updates application ports, provider-health input, Grok and Claude schema
  transport acceptance, architecture rules, workspace references, and lockfile.
- Does not add durable runtime, MCP, plugins, Gemini adapters, or a
  review-dispatch loop.
