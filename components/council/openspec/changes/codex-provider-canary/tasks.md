## 1. Contract

- [x] 1.1 Add `ProviderCanarySchema` discriminated union and replace
      `canaryResponseSchemaJson` on build input.
- [x] 1.2 Thread schema union through `runProviderHealthCanary` input.

## 2. Schema-file materializer

- [x] 2.1 Scoped Node materializer writes exact UTF-8 bytes with restrictive
      permissions and returns only the path while the scope is open.
- [x] 2.2 Delete the exact temporary directory on success, typed failure, or
      interruption; static secret-safe errors only.
- [x] 2.3 Clean up after post-`mkdtemp` acquisition failures; surface static
      cleanup failure when removal fails; finalizer cleanup failure dies as a
      static secret-safe defect.
- [x] 2.4 Refuse native Windows before any filesystem mutation; keep POSIX/WSL
      materialization supported pending an ACL-aware backend.
- [x] 2.5 Injectable operations seam with deterministic tests for permission,
      write, cleanup, finalizer, and Windows refusal paths.

## 3. Codex adapter

- [x] 3.1 Package `@council/adapter-codex` with pure TypeScript + Effect.
- [x] 3.2 Exact Codex CLI 0.146.0 argv and stdin-only prompt transport.
- [x] 3.3 Reject non-`openai` family, file prompt, and inline schema.
- [x] 3.4 Decode private four-event JSONL; parse `item.text` once.
- [x] 3.5 Fail closed on timeout, signal, null/nonzero exit, truncation,
      malformed UTF-8, U+FFFD, blank lines, extra/duplicate/reordered/missing
      events, wrong types, invalid `item.text`, and secret-safe null tool counts.

## 4. Grok and Claude preservation

- [x] 4.1 Grok and Claude accept only inline schema and preserve exact argv.

## 5. Workspace and verification

- [x] 5.1 Architecture rules, TypeScript project references, lockfile.
- [x] 5.2 Focused tests RED then GREEN; broader Council checks.
