---
source_url: "https://docs.x.ai/developers/models"
captured_at: "2026-09-13T03:01:24.456307+00:00"
contributor: "Foreman release research; Scrapling"
---

#### [Key Information](#key-information)

# [Models](#models)

Copy for LLM[View as Markdown](/developers/models.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-models&utm_content=article-api-key)[Meet grok-4.6](https://x.ai/news/grok-4-6)

### Grok 4.6

New

grok-4.6

Our flagship model for code and everything else: agentic tool calling, minimal hallucinations, configurable reasoning.

[View model](/developers/models/grok-4.6)[Try in playground](https://console.x.ai/team/default/chat?model=grok-4.6&utm_source=docs&utm_medium=referral&utm_campaign=developers-models&utm_content=highlights-grok-46)

Context500k tokens

Input$2.00 / 1M tokens

Output$6.00 / 1M tokens

Reasoning[Configurable](/developers/model-capabilities/text/reasoning#the-reasoning_effort-parameter)

### Voice API

Real-time conversations, speech-to-text, and text-to-speech.

AgentStarting at $0.05 / min

TTS$15.00 / 1M chars

STT (Batch)$0.10 / hour

STT (Streaming)$0.20 / hour

[Read docs](/developers/model-capabilities/audio/voice)[Try in playground](https://console.x.ai/playground/voice/agent?utm_source=docs&utm_medium=referral&utm_campaign=developers-models&utm_content=highlights-voice)

### Imagine API

Turn ideas into reality with image and video generation.

ModesGeneration & editing

SpeedIndustry-leading

Image · 1K / 2KStarting at [$0.02 / image](/developers/pricing#imagine-api-pricing)

Video · 480p / 720p / 1080pStarting at [$0.05 / sec](/developers/pricing#imagine-video-pricing)

[Read docs](/developers/model-capabilities/imagine)[Try in playground](https://console.x.ai/team/default/image?utm_source=docs&utm_medium=referral&utm_campaign=developers-models&utm_content=highlights-imagine)

## [Which model should I choose?](#which-model-should-i-choose)

Your choice depends on your use case. We have dedicated models and APIs for audio, image, and video capabilities. For everything else, including code, use Grok 4.6. It is the most intelligent and fastest model we’ve built.

Use case

Model

[Code

Grok 4.6](/developers/models/grok-4.6)[Chat

Grok 4.6](/developers/models/grok-4.6)[Images

Grok Imagine Image 2.0](/developers/models/grok-imagine-image-2.0)[Videos

Grok Imagine Video 1.5](/developers/models/grok-imagine-video-1.5)[Voice

Grok Voice API](/developers/model-capabilities/audio/voice)

## [Additional Information Regarding Models](#additional-information-regarding-models)

* **No access to realtime events without search tools enabled**
  + Grok has no knowledge of current events or data beyond what was present in its training data.
  + To incorporate realtime data with your request, enable server-side search tools (Web Search / X Search). See [Web Search](/developers/tools/web-search) and [X Search](/developers/tools/x-search).
* **Chat models**
  + No role order limitation: You can mix `system`, `user`, or `assistant` roles in any sequence for your conversation context.
  + `logprobs` and `top_logprobs` are not supported by models `grok-4.20` and newer. These fields will be silently ignored if set.
* **Image input models**
  + Maximum image size: `20MiB`
  + Maximum number of images: No limit
  + Supported image file types: `jpg/jpeg` or `png`.
  + Any image/text input order is accepted (e.g. text prompt can precede image prompt)
* **Batch API**
  + Not every model accepts [Batch API](/developers/advanced-api-usage/batch-api) requests. See Details on each model page.

The knowledge cut-off date of Grok 4.6 is February 1, 2026.

---

## [Model Aliases](#model-aliases)

Some models have aliases to help users automatically migrate to the next version of the same model. In general:

* `<modelname>` is aliased to the latest stable version.
* `<modelname>-latest` is aliased to the latest version. This is suitable for users who want to access the latest features.
* `<modelname>-<date>` refers directly to a specific model release. This will not be updated and is for workflows that demand consistency.

For most users, the aliased `<modelname>` or `<modelname>-latest` are recommended, as you would receive the latest features automatically.

---

Last updated: August 21, 2026
