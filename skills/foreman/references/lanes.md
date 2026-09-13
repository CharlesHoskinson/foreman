# Exact provider roles

Use `foreman providers list --json` to inspect exact profile/transport cells. Current qualification, credential access, and enforced tool policy are admission requirements. A fixture result is not native transport qualification.

| Role | Default profile | Transport |
| --- | --- | --- |
| Implementation | `grok-4.6` | `grok-acp` |
| Independent review | `gpt-5.6-sol` | `codex-app-server` |

Bind `role:implementer` and `role:reviewer` in registered project settings. The installed profiles also show explicit selections for GPT 6 Astra, Claude Opus 5, Claude Fable 5.1, and Gemini 3.8 Flash. Use only a supported exact cell; Gemini native coding is unsupported. Do not infer a transport from a model name or silently fall back.

The host checks the observed implementation and review identities for vendor independence. If the implementation uses OpenAI, select a qualified reviewer from another vendor. A policy verdict alone cannot override this check.

Provider commands, credentials, tools, and environments are host-controlled. Pel source names a registered model or role and data artifacts. It does not carry an arbitrary executable command. A provider retry preserves the original reservation's origin and requires matching retry authority; it is not a product correction.

Use the [standard workflow](../../../docs/guides/pel/quickstart.md) and [profile examples](../../../docs/guides/pel/examples.md). Historical adapter defaults and environment knobs are not installed runtime interfaces. Existing unsupported workflows retain their original controller; see [migration](../../../docs/guides/pel/migration.md).
