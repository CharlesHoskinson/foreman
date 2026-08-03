## Context

WP5a–WP5c delivered Grok and Claude canary adapters, provider-health service,
and Node process runner with stdin support. Codex CLI 0.146.0 accepts
structured-output canaries with prompt on stdin, `--output-schema` pointing at a
materialized schema file, and a private four-event JSONL stream ending in
`item.completed` with `agent_message` text.

## Goals / Non-Goals

**Goals:**

- One bounded Codex provider canary adapter behind `ProviderCanaryAdapter`.
- Provider-neutral schema transport union (inline vs file).
- Scoped Node schema-file materializer owned by the host package.
- Fail-closed decoding of the private Codex JSONL stream with one-time
  `item.text` parse.
- Preserve all existing Grok and Claude tests and behavior.

**Non-Goals:**

- Live network calls in this package's unit tests.
- Gemini, durable runtime, MCP server, plugins.
- Logging raw prompt bytes, raw provider output, secrets, schema bodies, or
  temporary paths.

## Decisions

1. **Schema transport union** — `ProviderCanarySchema` is
   `{ kind: "inline"; json }` or `{ kind: "file"; path }`. Grok and Claude
   require inline; Codex requires file.
2. **Schema-file materializer** — On POSIX hosts including WSL, the Node host
   creates a private temporary directory and `.json` file, writes exact UTF-8
   bytes with restrictive owner-only modes, returns the path under an Effect
   scope, and deletes the directory on success, typed failure, or interruption.
   Post-`mkdtemp` acquisition failures clean up before returning a typed error.
   Cleanup uses bounded retries and never reports success when the directory can
   remain; cleanup failure is a static secret-safe typed error on acquisition
   paths and a static secret-safe defect on scope finalizer paths. Native
   Windows is refused before any filesystem mutation until an ACL-aware backend
   exists. Errors never include schema text, temporary paths, or home paths.
3. **Codex argv** — fixed Codex CLI 0.146.0 flags including
   `--output-schema <path>`, `--json`, `--color never`, trailing `-` for stdin,
   read-only sandbox, ephemeral session, and skip-git-repo-check. Model id and
   working directory are caller-supplied; no prompt or schema JSON in argv.
4. **Wire decoding** — accept exactly four non-empty JSONL events in order:
   `thread.started`, `turn.started`, one `item.completed` with
   `item.type=agent_message`, and `turn.completed` with numeric usage. Parse
   `item.text` exactly once. Failure observations use null tool counts.
5. **Authority** — `runProviderHealthCanary` remains terminal-first and
   nonce-binding authority; adapters only build requests and decode terminals.

## Risks / Trade-offs

- Codex wire fields are private and may drift across CLI versions: pin 0.146.0
  and fail closed on sequence, type, and field mismatches.
- Temporary schema files must never leak into error messages or durable state;
  scoped cleanup is mandatory.
- POSIX modes do not establish owner-only ACLs on native Windows; fail closed
  until an ACL-aware materializer backend exists. WSL remains supported.

## Migration Plan

No migration for Grok/Claude callers beyond replacing
`canaryResponseSchemaJson` with `schema: { kind: "inline", json }`. Codex
callers must materialize a schema file before building the adapter request.
