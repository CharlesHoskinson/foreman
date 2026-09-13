---
source_url: "https://docs.x.ai/developers/grok-4-6"
captured_at: "2026-09-13T03:01:23.869451+00:00"
contributor: "Foreman release research; Scrapling"
---

#### [Get Started](#get-started)

# [Grok 4.6](#grok-46)

Copy for LLM[View as Markdown](/developers/grok-4-6.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-grok-4-6&utm_content=article-api-key)[Meet grok-4.6](https://x.ai/news/grok-4-6)

Grok 4.6 is SpaceXAI's frontier model built for coding, agentic tasks, and knowledge work.

## [Using the API](#using-the-api)

If you already have an [API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-grok-4-6&utm_content=api-keys), set the model name to `grok-4.6`:

Python JavaScriptJavaScript (OpenAI)Bash

```
import os
from xai_sdk import Client
from xai_sdk.chat import user

client = Client(api_key=os.getenv("XAI_API_KEY"))

chat = client.chat.create(model="grok-4.6")
chat.append(user("Find and fix the bug, then explain it: function median(a){a.sort();return a[a.length/2]}"))

response = chat.sample()
print(response.content)
```

```
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const { text } = await generateText({
  model: xai.responses('grok-4.6'),
  prompt:
    'Find and fix the bug, then explain it: function median(a){a.sort();return a[a.length/2]}',
});

console.log(text);
```

```
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

const response = await client.responses.create({
  model: 'grok-4.6',
  input: [
    {
      role: 'user',
      content:
        'Find and fix the bug, then explain it: function median(a){a.sort();return a[a.length/2]}',
    },
  ],
});

console.log(response.output_text);
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4.6",
    "input": "Find and fix the bug, then explain it: function median(a){a.sort();return a[a.length/2]}"
  }'
```

New to the xAI API? Follow the [Quickstart](/developers/quickstart) to create an account and make your first request.

## [At a glance](#at-a-glance)

| Property | Value |
| --- | --- |
| Model name | `grok-4.6` |
| Context window | 500,000 tokens |
| Knowledge cutoff | February 1, 2026 |
| Modalities | Text and image input; text output |
| Output limit | No text output limit |
| Input price | $2.00 / 1M tokens |
| Output price | $6.00 / 1M tokens |
| Reasoning | Low, medium, high (default), or xhigh |
| APIs | [Responses API](/developers/rest-api-reference/inference/responses#create-new-response), [Chat Completions](/developers/rest-api-reference/inference/chat-completions#chat-completions) |
| Tools | [Function calling](/developers/tools/function-calling), [web search](/developers/tools/web-search), [X search](/developers/tools/x-search), [code execution](/developers/tools/code-execution) |

Rate limits and live pricing for your team are on the [model detail page](/developers/models/grok-4.6) and [Pricing](/developers/pricing).

For benchmark results and demos, see the [announcement](https://x.ai/news/grok-4-6).

## [Important details](#important-details)

* **We highly recommend setting a [`prompt_cache_key`](/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits)** (Responses API; `x-grok-conv-id` header on Chat Completions). It routes a conversation's requests to the same server, making cache hits reliable; without it you often pay full input price on a cache-cold server. See [What Breaks Caching](/developers/advanced-api-usage/prompt-caching/multi-turn) for common mistakes.
* **Long agent loops** additionally benefit from [context compaction](/developers/advanced-api-usage/context-compaction); for tool-heavy workloads see [function calling](/developers/tools/function-calling).

## [Where it runs](#where-it-runs)

* **xAI API**: get a key from the [console](https://console.x.ai/?utm_source=docs&utm_medium=referral&utm_campaign=developers-grok-4-6&utm_content=console-home)
* **Grok Build**: the default model of the [coding agent](/build/overview), on the API and CLI
* **Cursor**: available on all plans
* **Model gateways**: OpenRouter, Vercel, and Cloudflare

## [Learn more](#learn-more)

* [Reasoning](/developers/model-capabilities/text/reasoning#the-reasoning_effort-parameter) - controlling `reasoning_effort`, including `"xhigh"`
* [Announcement](https://x.ai/news/grok-4-6) - launch post with demos and full benchmark figures
* [Models](/developers/models) - compare available models and their capabilities
* [Pricing](/developers/pricing) - token pricing for all models

---

Last updated: September 2, 2026
