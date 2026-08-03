# v0.2.9.0 Council live-canary evidence

## Scope

These canaries exercised the bundled `council-preflight` executable on WSL.
They did not execute a Council review or produce release advice.

The implementation commit was `04e42bedce72d52ecd0c78d1e70cd18993c14c0e`.
The executable SHA-256 was
`cc84786aee7b215203c58fa092ec7b566b9c0995d7c9e6ecc39e8911f516292d`.

The fixture used the accepted ACE contract and artifact bytes from the Council
TypeScript test package. Each provider received the same fixed canary challenge.

## Results

| Provider family | Model | CLI version | Result | Staged receipt file SHA-256 |
|---|---|---|---|---|
| xAI | `grok-4.5` | `grok 0.2.118` | `ready`, terminal completed | `d960308eebb440f7dd754be88e15e0ef45c80ef3fd396c9efafe255a48ddb7d8` |
| Anthropic | `claude-sonnet-5` | Claude Code `2.1.220` | `ready`, terminal completed | `94950f6c3a8cd9ada6f8008a40e79639341a06e02fb9f5a92b3530707388e28b` |
| OpenAI | `gpt-5.4` | Codex CLI `0.146.0` | `ready`, terminal completed | `c51182ed4fcd98ba2d68986241052e21edaffbb132a5e96b2fcbc2704e82223e` |

Each invocation returned exit code `0`. Each diagnostic file contained zero
bytes. The secret-marker scan found no home path, user identifier, credential
marker, API-key marker, bearer marker, or provider output.

## Receipt contract

The JSON files contain `PromptPreflightResultV1` values. They contain hashes,
provider-neutral terminal observations, and ready-token identities.

The receipts do not contain prompts, schemas, artifact contents, provider
stdout, provider stderr, environment values, or filesystem paths.
