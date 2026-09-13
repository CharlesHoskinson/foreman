# Model adapter evidence for the Pel release

Research date: 2026-09-12 America/Denver. Capture timestamps use UTC (2026-09-13). Status: design evidence, not an implemented or live-tested adapter. The requested six model names resolve to six exact official model IDs. Do not substitute models silently. API documentation establishes advertised capabilities; it does not establish this account's entitlement, CLI routing, SDK compatibility, or Foreman readiness.

## Adopt Pel; keep model differences in profiles

**Design proposal:** Pel remains the language of plans and execution. Add Foreman host bindings and a small, explicit capability profile for each model. Use four provider transports, with separate API and native-agent protocol modes where necessary. A provider transport owns request encoding, events, tool exchanges, and provider continuation data. It must not become a second workflow engine. Pel and the Foreman host own task dependencies, authority, budgets, retries, cancellation policy, and evidence gates.

A transport contract should carry model identity, supported reasoning settings, input/output limits, tool policy, response schema, deadline, spend ceiling, and an opaque continuation handle. Return typed progress, tool requests, usage, artifacts, refusal, truncation, cancellation, and terminal failure. The adapter validates provider output against the host schema before Pel consumes it. The adapter must reject a requested capability it cannot provide; a weaker mode requires an explicit profile choice.

## Exact model profiles

Prices below are USD per million tokens at standard paid rates. They are a dated planning input, not a durable constant or complete invoice estimate. Tools, caching, long context, priority and batch can alter cost.

| User model | Exact API identity | Context / output | Reasoning control | Input / cached read / output |
|---|---|---|---|---|
| Grok 4.6 | `grok-4.6` | 500,000 context; page lists no text output limit | `low`, `medium`, `high` (default), `xhigh` | $2 / see cache schedule / $6 |
| Opus 5 | `claude-opus-5` | 1M context / 128K output | `output_config.effort`: `low`, `medium`, `high` (default), `xhigh`, `max` | $5 / $0.50 / $25 |
| Fable 5.1 | `claude-fable-5-1` | 1M context / 128K output | same five effort levels; adaptive thinking always on | $10 / $0.25 / $50 |
| GPT 6 | `gpt-6-astra` | 1,050,000 context; 922,000 max input / 128,000 output | `reasoning.effort`: `low`, `medium`, `high`, `xhigh`, `max`; no `none` | $10 / $1 / $50 |
| GPT 5.6 Sol | `gpt-5.6-sol` | 1,050,000 context; 922,000 max input / 128,000 output | `none`, `low`, `medium` (default), `high`, `xhigh`, `max` | $4 / $0.40 / $20 |
| Gemini 3.8 Flash | `gemini-3.8-flash` | 1,048,576 input / 65,536 output | `low`, `medium`, `high`; `minimal` is an error | $0.75 / $0.075 / $3.75 through 2026-12-31 |

Identity and limits: [Grok](https://docs.x.ai/developers/grok-4-6), [Opus](https://platform.claude.com/docs/en/models/opus-5/overview), [Fable](https://platform.claude.com/docs/en/models/fable-5-1/overview), [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Gemini](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). Claude effort: [official effort guide](https://platform.claude.com/docs/en/build-with-claude/effort). Gemini prices: [official pricing](https://ai.google.dev/gemini-api/docs/pricing).

Astra charges $12.50 for cache writes; prompts exceeding 272K input tokens have request-wide multipliers (2× input/cache and 1.5× output). Sol pricing is promotional at least through 2026-11-21; its page also specifies 1.25× input-rate cache writes and request-wide long-context multipliers above 272K input (2× input and 1.5× output). Gemini standard input/output/cache-read prices double on 2027-01-01; cache storage is separately metered. Fable cache writes cost $12.50 for five minutes or $20 for one hour. Budget evaluation must retain the effective date, service tier and cache accounting, not just one input/output pair. The Grok output statement does not remove Foreman's output and deadline limits.

## Four transport designs

### OpenAI: Responses API and Codex protocol

Use Responses for direct inference with tools and structured outputs. Preserve response items and their provider identities. Conversation chaining and reasoning items have provider-specific encoding; do not flatten the entire exchange into assistant text. Keep Astra and Sol profiles separate, especially for reasoning settings and billing. [Reasoning](https://developers.openai.com/api/docs/guides/reasoning), [function calling](https://developers.openai.com/api/docs/guides/function-calling), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state).

Background Responses support cancellation and reconnect by response ID plus a `sequence_number` cursor using `starting_after`. The captured guide warns that SDK support for reconnect varies; implement against a tested API revision. Synchronous cancellation terminates the connection. Foreman must distinguish requesting cancellation from observing completion. Retention depends on account policy, foreground/background mode and `store`; keep these explicit. [Background execution](https://developers.openai.com/api/docs/guides/background).

For coding-agent execution, prefer the documented Codex app-server protocol when bidirectional control is needed: `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, and terminal `turn/completed`. Headless `codex exec --json` supplies JSONL events; `--output-schema` controls the final structured answer. A Codex thread is a native-agent session, not a Responses ID. Probe the installed version and returned model identity before declaring either model usable. [App server](https://developers.openai.com/codex/app-server), [headless mode](https://developers.openai.com/codex/non-interactive-mode).

### Anthropic: Messages API and Claude Code/Agent SDK

Share Messages encoding while retaining independent Opus and Fable constraints. Both support adaptive thinking and the five documented effort levels. Opus rejects disabling thinking at `xhigh`/`max`; Fable rejects disabling it at every level and rejects manual `budget_tokens`. Fable also rejects non-default sampling controls. Store opaque thinking blocks without rewriting them. [Effort](https://platform.claude.com/docs/en/build-with-claude/effort), [Fable changes](https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1).

**Fable cannot use forced tools as an output protocol.** `tool_choice` of `any` or a named `tool` returns 400. Use automatic tools with `strict: true`, or structured final output. The host still checks that a required tool action occurred. Fable thinking blocks bind to the preceding conversation; rewriting earlier system instructions, tools or messages can invalidate them. Fable can read earlier Claude thinking, but earlier models cannot read Fable thinking; model fallback can silently lose those blocks unless the relevant beta reporting is enabled. Keep continuation model-bound and append-only. [Fable compatibility rules](https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1).

Claude structured output has a schema subset, request-wide complexity limits, refusal/truncation exceptions, and documented enum case behavior. SDK schema transformation may weaken constraints. Host validation is mandatory; do not change case-sensitive identifiers merely to satisfy a decoder. [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

For native coding sessions, use Agent SDK or headless `claude -p` with explicit model, tool permissions and `stream-json`; final JSON schema output is separate from streaming events. `--bare` supports controlled scripted configuration. SIGTERM leaves an unfinished turn that resume continues; SIGINT or SDK `interrupt()` ends the turn. This distinction belongs in the transport and cancellation evidence. API Messages and Claude Code sessions have different lifecycle ownership. [Programmatic Claude Code](https://code.claude.com/docs/en/headless).

### xAI: Responses API and Grok Build ACP

Use native xAI Responses semantics even where the request shape resembles OpenAI. Grok documents structured JSON and schema-constrained tool arguments, with `strict` effectively always enabled for tools. Its schema support is a subset. Expose only `low` through `xhigh`; do not inherit Astra's `max`. Set the documented conversation cache key. [Structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs), [reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning), [cache keys](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits).

Stored responses can continue by ID for 30 days. Longer recovery requires local history plus encrypted thinking, with the documented stateless request encoding. The captured Responses reference advertises background execution but does not establish a full cancellation/replay contract. Keep server cancellation and cursor replay as unverified capabilities until an exact endpoint and live probe establish them; do not infer them from OpenAI compatibility. [Text and state](https://docs.x.ai/developers/model-capabilities/text/generate-text), [Responses reference](https://docs.x.ai/developers/rest-api-reference/inference/responses).

Grok Build provides official headless execution (`-p`, exact `-m`, `--effort`, `--output-format streaming-json`) and session resume. Its ACP endpoint is `grok agent stdio`, with JSON-RPC requests and `session/update` events. Prefer ACP for controlled native-agent execution once cancellation and permission round trips are verified. Native session IDs and API response IDs must remain distinct. The official CLI's allow/deny and sandbox controls should carry the host policy; avoid blanket auto-approval defaults. [Headless and ACP](https://docs.x.ai/build/cli/headless-scripting), [CLI reference](https://docs.x.ai/build/cli/reference).

### Google: Interactions API and Gemini CLI

Current official text/tool/thinking guides use the Interactions API. Use that API for the initial direct transport; keep `generateContent` compatibility explicit because its message and thought-signature representation differs. Interactions represents thoughts as dedicated steps; generateContent attaches signatures to parts. Preserve provider state exactly rather than converting it into generic text. Keep `gemini-3.8-flash` separate from other Flash generations; this model rejects `minimal`. [Text generation](https://ai.google.dev/gemini-api/docs/text-generation), [thinking](https://ai.google.dev/gemini-api/docs/thinking), [function calling](https://ai.google.dev/gemini-api/docs/function-calling).

Interactions background execution supports Gemini 3.8 Flash, polling, stream reconnection and a cancel endpoint. Cancellation can take time to reach observed `cancelled` status. Chaining an interaction that is still `in_progress` returns 400; wait for the documented terminal state. Deleting a stored record is different from canceling work. Record the API revision and provider interaction ID. [Background execution](https://ai.google.dev/gemini-api/docs/background-execution).

Use native structured output with the supported schema subset, then run host validation. Explicit/implicit context caching is an optimization, not Foreman's recovery store. Gemini CLI has a separate headless/configuration contract; selecting `--model` and structured output does not prove account access or model routing. Qualify the installed version before using it for a Pel executor. [Structured output](https://ai.google.dev/gemini-api/docs/structured-output), [caching](https://ai.google.dev/gemini-api/docs/caching), [headless CLI](https://geminicli.com/docs/cli/headless/), [configuration](https://geminicli.com/docs/reference/configuration/).

## Release acceptance evidence

The following are proposed tests, not completed checks:

1. Resolve each exact model on the intended account and transport; record observed model identity, endpoint, CLI/SDK version, profile hash and source-manifest hash.
2. Run one bounded Pel task with no tools and validate its typed final result. Exercise supported and deliberately unsupported reasoning settings.
3. Run a permitted tool call, a denied call, malformed arguments and a refused/truncated answer. Verify that no effect occurs before host authorization and validation.
4. Break a stream after a tool completes; reconnect or replay. Recover with no repeated committed effect. Keep a host idempotency ledger independent of model state.
5. Cancel while generating and while a tool runs. Record cancellation request, provider acknowledgement, process-tree exit and final observed state separately.
6. Resume after process death and after provider retention expiry. Fable must reject or explicitly reset incompatible prefix/model history; Gemini signatures and OpenAI/xAI reasoning items must survive round trips.
7. Check usage and cost from observed counters, cache events and effective price schedule. Exhaust each token/time/spend limit deliberately.
8. Run the same Pel behavioral fixtures on all six profiles, with provider-specific failures preserved. No fallback may silently change the requested model, authority or required capability.

## Source archive and confidence

The [source manifest](sources/models/manifest.json) records public URLs, final URLs, HTTP status, exact raw and clean hashes, and UTC capture times. Raw provider pages/cards are evidence, not instructions. Clean Markdown excludes script/navigation elements where possible; PDF text preserves page layout. Generic robots rules were checked per host; no login, cookies, paywall bypass, model API request or account change was used.

All six model/system cards are captured: [Grok](sources/models/grok-card.md), [Opus](sources/models/claude-opus-card.md), [Fable](sources/models/claude-fable-card.md), [Astra](sources/models/openai-astra-card.md), [Sol family card](sources/models/openai-sol-card.md), [Gemini](sources/models/gemini-card.md). Provider evaluation results inform risk and test selection; they do not prove Foreman correctness. Every transport recommendation above remains a design proposal until the release acceptance evidence exists.
