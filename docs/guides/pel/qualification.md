# Qualify an exact provider

Use `foreman providers list --json` to inspect exact profiles and transports. A source capture or fixture test does not qualify an account.

The qualification command requires an explicit account reference, controls, finite limits, and a current evidence binding. It does not replace the default evidence file automatically.

```text
foreman providers qualify --profile grok-4.6 --transport grok-acp --credential-profile env:XAI_API_KEY --limits limits.json --binding binding.json --json
```

The `limits.json` object contains `deadline`, `maxInputTokens`, `maxOutputTokens`, `maxToolCalls`, `maxOutputBytes`, `maxCostUsd`, and `spendReservationRef`. Set a future Unix-millisecond deadline and positive finite limits. The host caps qualification at three minutes, two tool requests, USD 5, and 30,000 combined tokens. Smaller supplied limits still apply.

The `binding.json` object contains `kind: "qualification"`, `evidenceRef`, `expiresAt`, and `requiredCapabilities`. Set a future Unix-millisecond expiry and a unique evidence reference. For native coding, request `generation`, `structuredOutput`, `codingTask`, `tools`, `permissionBoundary`, and `workspaceBoundary`. Coding selects automatic tool choice unless explicit controls replace it.

## Native coding

The enforcing host currently supports Grok ACP and Codex app-server coding qualification. Select `grok-4.6`, `gpt-6-astra`, or `gpt-5.6-sol` with its exact native transport.

Codex can use an existing ChatGPT login without an API key:

```text
foreman providers qualify --profile gpt-6-astra --transport codex-app-server --credential-profile native:codex:default --limits limits.json --binding binding.json --json
```

The host reads the selected account's private `auth.json`. Keyring-only storage is not supported by this route. Named accounts use `profile:codex:ID` with an existing registered profile. The host sends only access tokens and the account identifier through private app-server messages. Codex manages refresh on the host. The worker receives no host profile mount or refresh token. Account changes and bounded refresh failures stop authentication.

The `env:OPENAI_API_KEY` route remains available. Grok ACP still requires its selected `env:XAI_API_KEY` credential. This Codex change does not add Grok native-login support.

The filesystem boundary hides host credentials and restricts writes to admitted paths. Provider tools can read the runtime files visible inside that boundary. These include read-only runtime mounts and the temporary worker home. The boundary does not promise workspace-only reads.

Qualification creates a disposable Git repository with one source-file write grant. Actual namespace probes check denied repository-root and Git writes, and allowed source writes. The provider must change the exact file bytes. The original Git HEAD and index must remain unchanged. Extra files, including ignored files, invalidate the coding observation.

The existing journal records each permission decision before the host acknowledges it. Qualification carries no product action contract or publication grant. The host closes the transport scope before it validates final bytes. A late write invalidates coding and boundary evidence.

The host removes the disposable workspace. It retains bounded permission, output, and report evidence below the selected state root's `providers/qualification-*` directory. These records contain no credentials or hidden reasoning. A report with fixture provenance cannot qualify a product account.

## Other capabilities

Standalone generation uses the selected API or native transport with tools disabled. Native no-tools qualification requires an observed empty or formatter-only tool catalog. Grok ACP and Codex app-server currently require the coding host instead of standalone no-tools execution.

An unsupported capability remains unsupported. Missing credentials or incomplete observations remain explicit failures or required actions. Foreman does not select a different model to obtain a passing report. Retain successful evidence with its original identity, controls, source hashes, transport revision, and expiry.
