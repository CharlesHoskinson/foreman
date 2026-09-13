# R-M3-029 nested output content fail-closed gap

Model: claude-opus-5. Worktree: `/home/charl/fm-wt/foreman-dsl-release`.
Scope owned and touched: `packages/providers/src/transports/api-protocol.ts`,
`google-interactions.ts`, `anthropic-messages.ts`, `api-transports.test.ts`.
Nothing else was edited. No commit, push, build, docs or spec edit was made.

## Reproduced gap

Both root repros decoded as terminal, `status: "completed"`, with valid JSON
text, while unknown nested content was silently dropped:

- `responseComplete(initialState(), { ... output: [{ type: "message", content:
  [{ type: "output_text", text: '{"ok":true}' }, { type: "future_action_part" }]
  }] })`
- `googleInteractionsDialect.complete(initialState(), { ... steps: [{ type:
  "model_output", content: [{ type: "text", text: '{"ok":true}' },
  { type: "future_action_part" }] }] })`

Cause: the item/step/block classifier ran only at the top level. Every dialect
then walked nested content with an allow-by-omission loop (`if (part.type ===
"output_text")`, `if (c.type === "text")`, `if (d.type === "text_delta" &&
...)`), so any other nested part was ignored instead of failing closed.

The same silent drop existed on the streaming content-part and delta paths,
including Anthropic: `content_block_delta` with an unrecognized `delta.type`
(and with the tool-input `input_json_delta`) was dropped and the stream still
completed. So yes, Anthropic deltas had the issue and are now covered.

## Changes

### `api-protocol.ts`

- Added `inertResponseParts` = `output_text`, `refusal`, `summary_text`,
  `reasoning_text`, and exported `classifyResponsePart`, built on the existing
  `classifyOutputItem` with the existing `responseToolItems` as the tool set.
  A known tool name nested as a part yields `UnsupportedCapability` via
  `noTool()`; anything unrecognized yields `MalformedEvent` via
  `unknownOutput()`. One part set is used at every part boundary because a
  streaming `response.content_part.*` event does not name its owning item.
- Added `scanResponseItem(item): ItemScan` (`text`, `refused`, optional
  `failure`). It classifies every element of the item's `content` and `summary`
  arrays, accumulates `output_text` and flags `refusal` only for `message`
  items, and returns the classifier's `WireDelta` as `failure` otherwise.
- `responseComplete` now runs `scanResponseItem` per recognized item and
  returns any nested failure. Refusal is now reported after all items are
  validated, so a refusal no longer short-circuits past an unknown part in a
  later item. Refusal still returns terminal without setting `state.text`.
- `consumeResponse` now also handles `response.output_item.done` with the same
  item classification plus nested scan, and handles
  `response.content_part.added` / `.done` by classifying `event.part.type`.
  Unhandled event types still fall through to `{}`.

### `google-interactions.ts`

- Added `inertContent` = `text`, `thought`, `thought_signature`, and
  `toolContent` = `toolSteps` plus `executable_code`; `classifyContent` reuses
  `classifyOutputItem`.
- `complete` classifies every `step.content` part of each recognized step
  (thought steps included) and accumulates text only for `model_output` `text`.
- `consume` classifies `step.delta`'s `delta.type` before the existing
  model_output/text accumulation.

### `anthropic-messages.ts`

- Added `inertDeltas` = `text_delta`, `thinking_delta`, `signature_delta`,
  `citations_delta` and `toolDeltas` = `input_json_delta`; `classifyDelta`
  reuses `classifyOutputItem`.
- `content_block_delta` classifies the delta type before accumulating text.
  Full-response content blocks are already leaves, so `complete` is unchanged.

No identity, capability, usage, request-surface or `noToolRequestSurface`
control was loosened; no new endpoint, model or event family was admitted.
All failures are terminal `ProviderFailure`s, so no partial text can qualify.

## Tests (`api-transports.test.ts`, all new)

- `nestedFull` / `nestedStream` tables drive, per admitted dialect cell, four
  generated tests each: nested tool content and nested unknown content beside
  valid output text, on the complete-response decoder and the streaming
  decoder. Expect `UnsupportedCapability` for tool, `MalformedEvent` for
  unknown. Anthropic declares no nested full-response boundary (its blocks are
  leaves), so only its streaming delta cases are generated.
- `nested unknown content never decodes as completed no-tool output`: root's
  two exact repro payloads against `responseComplete` and
  `googleInteractionsDialect.complete`, asserting no `terminal`, a
  `MalformedEvent` failure, and a state that never reaches `completed`.
- `unknown nested content in a reasoning item or a done output item fails
  closed`: unknown part in a `reasoning` item's `summary`, and unknown part in
  a `response.output_item.done` message.
- Negative controls that must keep passing: `recognized inert nested content
  still completes a no-tool response` (reasoning `summary_text` /
  `reasoning_text` plus message `output_text`; Google `thought` step content
  plus `model_output` text), `a refusal part beside output text stays terminal
  without completed text`, and a per-dialect
  `still completes with inert nested content and non-text lifecycle frames`
  test that splices `ping` / `response.in_progress` /
  `interaction.in_progress` / `response.output_text.done` /
  `response.content_part.added` with an `output_text` part /
  `citations_delta` / `thought` delta into the good frames while the content
  boundary is open.

### Evidence

Command (focused file, run via node's test runner because `npx` and
`node_modules/.bin` are blocked in this session):

`node --import ./node_modules/tsx/dist/loader.mjs --test packages/providers/src/transports/api-transports.test.ts`

- Before the fix: 22 failures, exactly the new rejection tests, across all six
  dialect cells plus the two direct-decoder tests. The new negative-control
  tests already passed before the fix, so they do not mask the regression.
- After the fix: `tests 108 / pass 108 / fail 0`.
- `packages/providers/src/transports/api-http.test.ts`,
  `transport-contract.test.ts`, `conformance.test.ts`, `observation.test.ts`:
  62/62 pass.
- `packages/orchestration/src/pel-provider-live.test.ts` (imports these
  transport sources directly, cited by T-M3-029): 34/34 pass.
- `node node_modules/@typescript/old/bin/tsc -p tsconfig.all.json
  --pretty false`: clean.

## Limitations and judgment calls

- One shared inert part set is used for Responses message and reasoning parts.
  Tightening it per item type would reject `reasoning_text` inside a `message`,
  but the streaming `content_part` event carries no owning item type, so a
  split set would behave differently on the two paths. The shared set still
  rejects every tool and unknown part at both boundaries.
- Google content parts that are neither text nor thought (for example
  `inline_data` / `file_data` media parts) now fail closed as `MalformedEvent`.
  That is intended under the pinned JSON-output dialect, but it is stricter
  than the previous silent drop.
- A `step.delta` whose `delta.type` is missing or unrecognized is now
  `MalformedEvent`. Unknown top-level event types
  (`event_type` / `type`) are still ignored, so lifecycle and usage frames are
  unaffected.
- Not changed, deliberately: a `text_delta` arriving on a non-`text` Anthropic
  block is still ignored rather than rejected (inert, text-loss only, and
  rejecting it would go beyond the pinned dialect); Anthropic `citations`
  inside a text block are not walked; `mcp_tool_result`-style nested tool
  payloads are already rejected at the block level.
- Not run here: full build and `fullverify` (root owns those), and any other
  package's suite.
