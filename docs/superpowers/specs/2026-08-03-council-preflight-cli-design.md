# Council Preflight CLI Design

## Status and scope

This design implements OpenSpec task 4.4 for Foreman v0.2.9.0.
The Gobox pilot already satisfied the external-use prerequisite for this version.

The change adds one Node.js 24 TypeScript composition root.
The composition root uses the existing ACE compiler, provider adapters, process runner, and ready-token service.

The change does not add durable orchestration, retries, quorum, Gemini support, provider selection, or release authority.
Foreman retains those responsibilities.

## Selected approach

Create `@council/runtime-node` under `components/council/packages/runtime-node`.
Expose one compiled executable named `council-preflight`.

The executable accepts no prompt, schema, credential, or environment argument.
The executable reads one JSON request from stdin with a fixed 1 MiB limit.
The executable enforces the limit before JSON parsing.

The runtime writes exactly one `PromptPreflightResultV1` JSON value to stdout.
The runtime writes bounded secret-safe diagnostics to stderr.
The runtime does not write provider output, environment values, prompt bytes, schema bytes, or filesystem paths to diagnostics.

## Request contract

The request has these fields:

```typescript
type PreflightCliRequestV1 = {
  readonly schemaVersion: 1;
  readonly contract: CouncilPromptContractV1;
  readonly provider: {
    readonly family: "anthropic" | "xai" | "openai";
    readonly executable: string;
    readonly model: string;
  };
  readonly observedBundle: {
    readonly baseSha: string;
    readonly headSha: string;
    readonly diffPath: string;
  };
  readonly artifacts: ReadonlyArray<{
    readonly artifactId: string;
    readonly path: string;
  }>;
  readonly cwd: string;
};
```

The decoder rejects unknown fields, duplicate artifact identifiers, empty strings, and unsupported provider families.
The decoder rejects Google until a Gemini adapter exists.

The runtime probes the selected executable for its CLI version.
The runtime does not trust a caller-supplied version.

The runtime builds one allowlisted child environment for provider authentication.
The runtime never serializes environment values.

## Processing sequence

1. Read and strictly decode the bounded request.
2. Read the declared diff with the contract artifact limit.
3. Probe the selected executable and resolve its CLI version.
4. Compile the ACE review contract with existing Node layers.
5. Create a cryptographic nonce with `node:crypto`.
6. Build the fixed Profile 1 canary challenge for `1+1` and `2`.
7. Build one canonical canary prompt and one closed canary response schema.
8. Materialize private temporary files only when the selected adapter requires them.
9. Run one bounded canary with the selected existing adapter.
10. Issue one ready-review token after the canary completes.
11. Strictly decode the final `PromptPreflightResultV1` before output.

The runtime uses `Effect.acquireRelease` for every temporary file.
The runtime uses the existing scoped process runner for timeout, interruption, and process cleanup.

## Provider routing

The Anthropic route uses stdin prompt bytes and an inline schema.
The xAI route uses a private `.txt` prompt file and an inline schema.
The OpenAI route uses stdin prompt bytes and a private schema file.

The runtime selects the adapter only from the closed provider-family field.
The runtime does not infer a provider from an executable name.

## Failure behavior

All expected failures produce `_tag: "failure"` with `schemaVersion: 1`.
Prompt compilation failures use stage `prompt`.
Process-start failures use stage `dispatch`.
Provider and terminal failures use stage `provider` or `transport`.
Strict result-decoding failures use stage `parse`.

Every failure includes typed retry advice.
The runtime does not retry.
Foreman owns retry count and replacement decisions.

The executable returns exit code `0` after it emits a valid ready result.
The executable returns exit code `1` after it emits a valid failure result.
The executable returns exit code `64` only when the invocation includes arguments.

Callers must decode stdout.
An exit code alone does not prove provider readiness.

## Test strategy

Tests follow red-green-refactor.
Pure tests cover request decoding, canonical canary material, provider routing, and failure mapping.
Runtime tests inject clocks, nonces, file readers, and preflight programs.
No unit test calls a hosted model.

One integration test executes the compiled CLI with a temporary request file.
The test verifies one stdout JSON value, bounded stderr, and exact exit codes.
The test uses TypeScript fixtures only.

The complete Council gate remains `corepack pnpm check`.
Strict OpenSpec validation remains mandatory.

## Acceptance

The package is complete when all conditions hold:

- The compiled executable runs with Node.js 24.
- The executable emits one strict provider-neutral result.
- The executable starts no provider after request or ACE failure.
- The executable preserves terminal-first classification.
- The executable supports Anthropic, xAI, and OpenAI through existing adapters.
- The executable fails closed for Google.
- The executable derives the selected CLI version before token issuance.
- The complete Council gate passes.
- Strict OpenSpec validation passes.
