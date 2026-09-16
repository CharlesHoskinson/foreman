# Native ChatGPT Authentication Implementation Plan

**Goal:** Reuse the selected Codex ChatGPT login without API keys or host-profile mounts.

**Architecture:** A host credential broker reads bounded private authentication state. Codex manages refresh through an account-only host process. The worker authenticates through external-token RPC.

**Tech Stack:** Node.js 24, TypeScript, Effect, existing Codex JSON-RPC transport and Bubblewrap boundary.

## Constraints

- Preserve the native filesystem boundary and exact model selection.
- Keep refresh tokens outside provider processes and persisted artifacts.
- Bind refresh to the initial account and original deadline.
- Keep legacy and API-key behavior unchanged.
- Scope native login support to Codex in this change.

## Steps

1. Add failing tests to `packages/providers/src/transports/codex-app-server.test.ts` for external login, refresh, account mismatch, and event redaction.
2. Add broker tests in `packages/orchestration/src/pel-codex-auth.test.ts` for secure reads, malformed files, bounded refresh, and changed accounts.
3. Extend `CredentialMaterialV1` with a redacted external-token callback. Add `pel-codex-auth.ts` and wire explicit native Codex references through it.
4. Change the transport to complete external login before `thread/start`. Handle bounded refresh requests without emitting credential events.
5. Accept the broker in `pel-native-qualification.ts`. Keep `pel-native-boundary.ts` profile mount refusals unchanged.
6. Run focused `node --import tsx --test` tests after package builds. Run `npm run typecheck` and `npm test`.
7. Run a bounded compiled Astra qualification with `native:codex:default`. Retain only sanitized observations.
8. Review the exact candidate. Build the package from a committed candidate and install it through the compiled installer.

The OpenSpec task list records execution status. The approved design permits implementation without another design round.
