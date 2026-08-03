# xAI live-smoke record — 2026-08-03

## Scope

This test exercised the production Council prompt compiler and one read-only
Grok schema handshake. Foreman owned the provider process. The test did not
claim to exercise a complete Council runtime.

The candidate was the Gobox installer change from base
`bf6c6ff6669dab051bb2efb6f35928d954c7a248` to worker commit
`b0519b25c1c8a5fe46fbd9de27df34775e98c0b0`.

## Compiler result

The TypeScript compiler completed for provider family `xai`.

- Contract hash: `sha256:5d7c895a8d431dc392378ecda1f0253e6e324cb637f32c102f5b382cd72cbb96`
- Prompt hash: `sha256:d1f61c27c8169df1d5456d37d1c8985ea7b6b4fa9e848c9539a7efac666acbae`
- Canonical schema hash: `sha256:ac147fd28c5eaff497a0e63143573ca684a81cf5ee1e520a504fa2e0d8af0f5e`
- xAI schema-variant hash: `sha256:ac147fd28c5eaff497a0e63143573ca684a81cf5ee1e520a504fa2e0d8af0f5e`
- Prompt size: 8,788 bytes
- Constraint-weakening receipts: zero

The prompt kept a hostile instruction inside the untrusted-evidence field. The
trusted ACE field stayed unchanged.

## Provider result

Foreman Setup reported `LANE_READY: grok=yes`. The live call used Grok CLI
`0.2.112` and one model turn. Foreman recorded an ownership event and zero
changed target files. The process returned exit code 0.

The provider terminal data was not a successful Council terminal:

- `stopReason` was `Cancelled`.
- `structuredOutput` was null.
- `structuredOutputError` was `model did not produce structured output`.

The provider placed schema-shaped JSON inside ordinary text. Council did not
promote that text into advice. The response is a `ReviewAttemptFailed`
infrastructure result, not approval, dissent, or abstention.

An earlier infrastructure attempt used a file named `prompt.json`. Grok treated
that file as ACP content blocks and rejected it because the object had no
top-level `type` field. Renaming the same hashed bytes to `prompt.txt` allowed
the model turn. The filename-dependent behavior is an adapter-compatibility
requirement.

## Release decision

Council is not stable for live release decisions. The next implementation
package must complete OpenSpec tasks 4.2 through 4.5: provider health, terminal
decoding, a Node TypeScript preflight CLI, and bounded spool evidence. It must
also issue and bind ready-review tokens before task 6.4 or 6.5 can complete.
