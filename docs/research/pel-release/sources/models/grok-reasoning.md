---
source_url: "https://docs.x.ai/developers/model-capabilities/text/reasoning"
captured_at: "2026-09-13T03:01:25.121725+00:00"
contributor: "Foreman release research; Scrapling"
---

#### [Model Capabilities](#model-capabilities)

# [Reasoning](#reasoning)

Copy for LLM[View as Markdown](/developers/model-capabilities/text/reasoning.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-model-capabilities-text-reasoning&utm_content=article-api-key)[Try Playground](https://console.x.ai/team/default/chat?utm_source=docs&utm_medium=referral&utm_campaign=developers-model-capabilities-text-reasoning&utm_content=playground-cta)[Meet grok-4.6](https://x.ai/news/grok-4-6)

## [Key Features](#key-features)

* **Think Before Responding**: Reasoning models think through problems step-by-step before delivering an answer.
* **Math & Quantitative Strength**: Excels at numerical challenges, logic puzzles, and complex analytical tasks.
* **Reasoning Trace**: Usage metrics expose `reasoning_tokens`. Some models can also return encrypted reasoning via `include: ["reasoning.encrypted_content"]` (see below).

---

### [Encrypted Reasoning Content](#encrypted-reasoning-content)

The reasoning content is encrypted by us and can be returned if you pass `include: ["reasoning.encrypted_content"]` to the Responses API. You can send the encrypted content back to provide more context to a previous conversation. See [Adding encrypted thinking content](/developers/model-capabilities/text/generate-text#adding-encrypted-thinking-content) for more details on how to use the content.

When using the Vercel AI SDK, encrypted reasoning content is automatically included under the hood as long as `store: false` is not specified. No additional configuration is needed.

---

## [The `reasoning_effort` parameter](#the-reasoning_effort-parameter)

`grok-4.6` and `grok-4.5` support the `reasoning_effort` parameter, which controls how much effort the model spends thinking before responding.

If not specified, `reasoning_effort` defaults to `"high"`. Reasoning cannot be disabled.

`presencePenalty`, `frequencyPenalty`, and `stop` cannot be used with reasoning models. Requests that include them return an error.

### [Effort levels](#effort-levels)

| Setting | Description | Best For |
| --- | --- | --- |
| `"low"` | Uses some reasoning tokens, but still fast | Latency-sensitive agentic use and simple tool calling. |
| `"medium"` | More thinking for less-latency sensitive applications | Complex data analysis and long-context reasoning. |
| `"high"` (default) | Uses more reasoning tokens for deeper thinking | Very challenging problems, complex math, multi-step logic, competition-level tasks |
| `"xhigh"` | Maximum reasoning depth, with correspondingly higher latency | The hardest problems, where answer quality matters more than response time |

`"xhigh"` is available on `grok-4.6` and later. On models that do not support it, such as `grok-4.5`, requests with `"xhigh"` are treated as `"high"`.

### [Setting reasoning effort](#setting-reasoning-effort)

The following example sets `reasoning_effort` to `"high"` for a challenging math proof. You can substitute `"low"`, `"medium"`, or (on supported models) `"xhigh"` as needed.

PythonPython (OpenAI) JavaScriptBash

```
import os

from xai_sdk import Client
from xai_sdk.chat import system, user

client = Client(
    api_key=os.getenv("XAI_API_KEY"),
    timeout=3600,
)

chat = client.chat.create(
    model="grok-4.6",
    reasoning_effort="high",
    messages=[system("You are a highly intelligent AI assistant.")],
)
chat.append(user("Find all prime numbers p such that p^2 + 2 is also prime. Prove your answer."))

response = chat.sample()

print("Final Response:")
print(response.content)
```

```
import os
import httpx
from openai import OpenAI

client = OpenAI(
    base_url="https://api.x.ai/v1",
    api_key=os.getenv("XAI_API_KEY"),
    timeout=httpx.Timeout(3600.0),
)

response = client.responses.create(
    model="grok-4.6",
    reasoning={"effort": "high"},
    input=[
        {"role": "system", "content": "You are a highly intelligent AI assistant."},
        {"role": "user", "content": "Find all prime numbers p such that p^2 + 2 is also prime. Prove your answer."},
    ],
)

message = next(item for item in response.output if item.type == "message")
text = next(c.text for c in message.content if c.type == "output_text")

print("Final Response:")
print(text)
```

```
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const result = await generateText({
  model: xai.responses('grok-4.6'),
  system: 'You are a highly intelligent AI assistant.',
  prompt: 'Find all prime numbers p such that p^2 + 2 is also prime. Prove your answer.',
  providerOptions: {
    xai: { reasoningEffort: 'high' },
  },
});

console.log('Final Response:', result.text);
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600 \
  -d '{
    "model": "grok-4.6",
    "reasoning": {"effort": "high"},
    "input": [
        {
            "role": "system",
            "content": "You are a highly intelligent AI assistant."
        },
        {
            "role": "user",
            "content": "Find all prime numbers p such that p^2 + 2 is also prime. Prove your answer."
        }
    ]
}'
```

### [Multi-agent model](#multi-agent-model)

For `grok-4.20-multi-agent`, the `reasoning.effort` parameter controls **how many agents** collaborate on a request rather than reasoning depth. See the [Multi Agent](/developers/model-capabilities/text/multi-agent) documentation for details.

### [Summary table](#summary-table)

| Model | `reasoning` parameter | Behavior |
| --- | --- | --- |
| `grok-4.6` | `reasoning.effort`: `"low"` / `"medium"` / `"high"` (default) / `"xhigh"` | Controls reasoning depth (cannot be disabled) |
| `grok-4.5` | `reasoning.effort`: `"low"` / `"medium"` / `"high"` (default) | Controls reasoning depth (cannot be disabled) |
| `grok-4.20-multi-agent` | `reasoning.effort`: `"low"` / `"medium"` / `"high"` / `"xhigh"` | Controls agent count (4 or 16) |

---

## [Summarized Reasoning Content](#summarized-reasoning-content)

For `grok-4.6`, we expose summarizations of the model's internal reasoning. Here's an example of how to stream the reasoning summary deltas alongside the final response:

PythonPython (OpenAI) JavaScriptBash

```
import os

from xai_sdk import Client
from xai_sdk.chat import system, user

client = Client(
    api_key=os.getenv("XAI_API_KEY"),
    timeout=3600, # Override default timeout with longer timeout for reasoning models
)

chat = client.chat.create(
    model="grok-4.6",
    messages=[system("You are a highly intelligent AI assistant.")],
)
chat.append(user("A projectile is launched at 30 m/s at 37° above horizontal from a 45 m cliff. Find its speed on impact. (g=10 m/s²)"))

content_started = False

print("\n\n--------- Reasoning ---------", flush=True)

latest_response = None
for response, chunk in chat.stream():
    if chunk.reasoning_content:
        print(chunk.reasoning_content, end="", flush=True)
```

```
import os
import httpx
from openai import OpenAI

client = OpenAI(
    base_url="https://api.x.ai/v1",
    api_key=os.getenv("XAI_API_KEY"),
    timeout=httpx.Timeout(3600.0),
)

stream = client.responses.create(
    model="grok-4.6",
    input=[
        {"role": "system", "content": "You are a highly intelligent AI assistant."},
        {"role": "user", "content": "A projectile is launched at 30 m/s at 37° above horizontal from a 45 m cliff. Find its speed on impact. (g=10 m/s²)"},
    ],
    stream=True,
)

print("\n\n--------- Reasoning ---------", flush=True)
for event in stream:
    if event.type in ("response.reasoning_text.delta", "response.reasoning_summary_text.delta"):
        print(event.delta, end="", flush=True)
```

```
import { xai } from '@ai-sdk/xai';
import { streamText } from 'ai';

const result = streamText({
  model: xai.responses('grok-4.6'),
  system: 'You are a highly intelligent AI assistant.',
  prompt: 'A projectile is launched at 30 m/s at 37° above horizontal from a 45 m cliff. Find its speed on impact. (g=10 m/s²)'
});

console.log("\n\n--------- Reasoning ---------")

for await (const part of result.fullStream) {
  if (part.type === 'reasoning-delta') {
    process.stdout.write(part.text);
  } 
}
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600 \
  -d '{
    "input": [
        {
            "role": "system",
            "content": "You are a highly intelligent AI assistant."
        },
        {
            "role": "user",
            "content": "A ball is thrown upward at 25 m/s from the top of a 60 m building. Find the maximum height above the ground. (g=10 m/s²)"
        }
    ],
    "model": "grok-4.6",
    "stream": true
}'
```

### [Sample Output](#sample-output)

Output

```
--------- Reasoning ---------
The problem is: A projectile is launched at 30 m/s at 37° above horizontal from a 45 m cliff. Find its speed on impact. (g=10 m/s²)
I need to find the speed when the projectile hits the ground. It's launched at 30 m/s at 37° from a 45 m cliff, with g=10 m/s².

Conservation of energy is a good approach. The initial kinetic energy is (1/2)mv² with v=30 m/s, and initial potential energy is mgh with h=45 m, taking ground as zero.

At impact, potential energy is zero, so initial KE + initial PE = final KE.

Thus, (1/2)m(30)² + mg(45) = (1/2)m v_f²

v_f² = 900 + 2*10*45 = 900 + 900 = 1800

v_f = sqrt(1800) = 30√2 m/s ≈ 42.4 m/s

The angle doesn't affect the final speed because the initial kinetic energy and potential energy change are the same regardless of direction, as long as the speed and height are the same.

Yes, that makes sense. The final speed is sqrt(v0² + 2gh), independent of the launch angle.
```

When you use a reasoning model, the reasoning tokens are billed as part of your total consumption.

---

Last updated: August 12, 2026
