---
source_url: "https://docs.x.ai/developers/model-capabilities/text/generate-text"
captured_at: "2026-09-13T03:01:31.146399+00:00"
contributor: "Foreman release research; Scrapling"
---

#### [Model Capabilities](#model-capabilities)

# [Generate Text](#generate-text)

Copy for LLM[View as Markdown](/developers/model-capabilities/text/generate-text.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-model-capabilities-text-generate-text&utm_content=article-api-key)[Try Playground](https://console.x.ai/team/default/chat?utm_source=docs&utm_medium=referral&utm_campaign=developers-model-capabilities-text-generate-text&utm_content=playground-cta)[Meet grok-4.6](https://x.ai/news/grok-4-6)

The Responses API is the preferred way of interacting with our models via API. It allows optional **stateful interactions** with our models,
where **previous input prompts, reasoning content, and model responses are saved and stored on xAI's servers**. You can continue the interaction by appending new
prompt messages instead of resending the full conversation. This behavior is on by default. If you would like to store your request/response locally, please see [Disable storing previous request/response on server](#disable-storing-previous-requestresponse-on-server).

**The responses will be stored for 30 days, after which they will be removed. This means you can use the response ID to retrieve or continue a conversation within 30 days of sending the request.**
If you want to continue a conversation after 30 days, please store your responses history and the encrypted thinking content locally, and pass them in a new request body.

For Python, we also offer our [xAI SDK](https://github.com/xai-org/xai-sdk-python) which covers all of our features and uses gRPC for optimal performance. It's fine to mix both. The xAI SDK allows you to interact with all our products such as Collections, Voice API, API key management, and more, while the Responses API is more suited for chatbots and usage in RESTful APIs.

---

## [Prerequisites](#prerequisites)

Create an API key on the [xAI Console API Keys Page](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-model-capabilities-text-generate-text&utm_content=api-keys). Set your API key in your environment:

Bash

```
export XAI_API_KEY="your_api_key"
```

---

## [Creating a new model response](#creating-a-new-model-response)

Start by creating a response:

PythonPython (OpenAI)JavaScript (OpenAI) JavaScriptBash

```
import os
from xai_sdk import Client
from xai_sdk.chat import user, system

client = Client(
    api_key=os.getenv("XAI_API_KEY"),
    management_api_key=os.getenv("XAI_MANAGEMENT_API_KEY"),
    timeout=3600,
)

chat = client.chat.create(model="grok-4.6")
chat.append(system("You are Grok, an AI agent built to answer helpful questions."))
chat.append(user("How big is the universe?"))
response = chat.sample()

print(response)

# The response ID that can be used to continue the conversation later

print(response.id)
```

```
import os
import httpx
from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
    timeout=httpx.Timeout(3600.0), # Override default timeout with longer timeout for reasoning models
)

response = client.responses.create(
    model="grok-4.6",
    input=[
        {"role": "system", "content": "You are Grok, an AI agent built to answer helpful questions."},
        {"role": "user", "content": "How big is the universe?"},
    ],
)

print(response)

# The response ID that can be used to continue the conversation later

print(response.id)
```

```
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
    timeout: 360000, // Override default timeout with longer timeout for reasoning models
});

const response = await client.responses.create({
    model: "grok-4.6",
    input: [
        {
            role: "system",
            content: "You are Grok, an AI agent built to answer helpful questions."
        },
        {
            role: "user",
            content: "How big is the universe?"
        },
    ],
});

console.log(response);

// The response ID that can be used to recall the conversation later
console.log(response.id);
```

```
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const { text, response } = await generateText({
  model: xai.responses('grok-4.6'),
  system: "You are Grok, an AI agent built to answer helpful questions.",
  prompt: "How big is the universe?",
});

console.log(text);

// The response ID can be used to continue the conversation
console.log(response.id);
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600 \
  -d '{
    "model": "grok-4.6",
    "input": [
        {
            "role": "system",
            "content": "You are Grok, an AI agent built to answer helpful questions."
        },
        {
            "role": "user",
            "content": "How big is the universe?"
        }
    ]
}'
```

### [Disable storing previous request/response on server](#disable-storing-previous-requestresponse-on-server)

If you do not want to store your previous request/response on the server, you can set `store: false` on the request.

PythonPython (OpenAI)JavaScript (OpenAI)Bash

```
import os
from xai_sdk import Client
from xai_sdk.chat import user, system

client = Client(
    api_key=os.getenv("XAI_API_KEY"),
    management_api_key=os.getenv("XAI_MANAGEMENT_API_KEY"),
    timeout=3600,
)

chat = client.chat.create(model="grok-4.6", store_messages=False)
chat.append(system("You are Grok, an AI agent built to answer helpful questions."))
chat.append(user("How big is the universe?"))
response = chat.sample()

print(response)
```

```
import os
import httpx
from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
    timeout=httpx.Timeout(3600.0), # Override default timeout with longer timeout for reasoning models
)

response = client.responses.create(
    model="grok-4.6",
    input=[
        {"role": "system", "content": "You are Grok, an AI agent built to answer helpful questions."},
        {"role": "user", "content": "How big is the universe?"},
    ],
    store=False
)

print(response)
```

```
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
    timeout: 360000, // Override default timeout with longer timeout for reasoning models
});

const response = await client.responses.create({
    model: "grok-4.6",
    input: [
        {
            role: "system",
            content: "You are Grok, an AI agent built to answer helpful questions."
        },
        {
            role: "user",
            content: "How big is the universe?"
        },
    ],
    store: false
});

console.log(response);
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600 \
  -d '{
    "model": "grok-4.6",
    "input": [
        {
            "role": "system",
            "content": "You are Grok, an AI agent built to answer helpful questions."
        },
        {
            "role": "user",
            "content": "How big is the universe?"
        }
    ],
    "store": false
}'
```

### [Returning encrypted thinking content](#returning-encrypted-thinking-content)

If you want to return the encrypted thinking traces, you need to specify `use_encrypted_content=True` in xAI SDK or gRPC request message, or `include: ["reasoning.encrypted_content"]` in the request body.

Make sure to use a reasoning model when working with encrypted thinking content.

Modify the steps to create a chat client (xAI SDK) or change the request body as following:

PythonPython (OpenAI)JavaScript JavaScriptBash

```
chat = client.chat.create(model="grok-4.6",
        use_encrypted_content=True)
```

```
response = client.responses.create(
    model="grok-4.6",
    input=[
        {"role": "system", "content": "You are Grok, an AI agent built to answer helpful questions."},
        {"role": "user", "content": "How big is the universe?"},
    ],
    include=["reasoning.encrypted_content"]
)
```

```
const response = await client.responses.create({
    model: "grok-4.6",
    input: [
        {"role": "system", "content": "You are Grok, an AI agent built to answer helpful questions."},
        {"role": "user", "content": "How big is the universe?"},
    ],
    include: ["reasoning.encrypted_content"],
});
```

```
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

// Encrypted reasoning content is included automatically by the AI SDK
// as long as `store: false` is not set. No extra configuration is needed.
const { text, reasoning } = await generateText({
  model: xai.responses('grok-4.6'),
  system: "You are Grok, an AI agent built to answer helpful questions.",
  prompt: "How big is the universe?",
});

console.log(text);
console.log(reasoning); // Contains encrypted reasoning content
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600 \
  -d '{
    "model": "grok-4.6",
    "input": [
        {
            "role": "system",
            "content": "You are Grok, an AI agent built to answer helpful questions."
        },
        {
            "role": "user",
            "content": "How big is the universe?"
        }
    ],
    "include": ["reasoning.encrypted_content"]
}'
```

See [Adding encrypted thinking content](#adding-encrypted-thinking-content) on how to use the returned encrypted thinking content when making a new request.

---

## [Chaining the conversation](#chaining-the-conversation)

We now have the `id` of the first response. With Chat Completions API, we typically send a stateless new request with all the previous messages.

With Responses API, we can send the `id` of the previous response, and the new messages to append to it.

PythonPython (OpenAI)JavaScript JavaScriptBash

```
import os
from xai_sdk import Client
from xai_sdk.chat import user, system

client = Client(
    api_key=os.getenv("XAI_API_KEY"),
    management_api_key=os.getenv("XAI_MANAGEMENT_API_KEY"),
    timeout=3600,
)

chat = client.chat.create(model="grok-4.6", store_messages=True)
chat.append(system("You are Grok, an AI agent built to answer helpful questions."))
chat.append(user("How big is the universe?"))
response = chat.sample()

print(response)

# The response ID that can be used to continue the conversation later

print(response.id)

# New steps

chat = client.chat.create(
    model="grok-4.6",
    previous_response_id=response.id,
    store_messages=True,
)
chat.append(user("How do stars form?"))
second_response = chat.sample()

print(second_response)

# The response ID that can be used to continue the conversation later

print(second_response.id)
```

```
# Previous steps
import os
import httpx
from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
    timeout=httpx.Timeout(3600.0), # Override default timeout with longer timeout for reasoning models
)

response = client.responses.create(
    model="grok-4.6",
    input=[
        {"role": "system", "content": "You are Grok, an AI agent built to answer helpful questions."},
        {"role": "user", "content": "How big is the universe?"},
    ],
)

print(response)

# The response ID that can be used to continue the conversation later

print(response.id)

# New steps

second_response = client.responses.create(
    model="grok-4.6",
    previous_response_id=response.id,
    input=[
        {"role": "user", "content": "How do stars form?"},
    ],
)

print(second_response)

# The response ID that can be used to continue the conversation later

print(second_response.id)
```

```
// Previous steps
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
    timeout: 360000, // Override default timeout with longer timeout for reasoning models
});

const response = await client.responses.create({
    model: "grok-4.6",
    input: [
        {
            role: "system",
            content: "You are Grok, an AI agent built to answer helpful questions."
        },
        {
            role: "user",
            content: "How big is the universe?"
        },
    ],
});

console.log(response);

// The response ID that can be used to recall the conversation later
console.log(response.id);

const secondResponse = await client.responses.create({
    model: "grok-4.6",
    previous_response_id: response.id,
    input: [
        {"role": "user", "content": "How do stars form?"},
    ],
});

console.log(secondResponse);

// The response ID that can be used to recall the conversation later
console.log(secondResponse.id);
```

```
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

// First request
const result = await generateText({
  model: xai.responses('grok-4.6'),
  system: "You are Grok, an AI agent built to answer helpful questions.",
  prompt: "How big is the universe?",
});

console.log(result.text);

// Get the response ID from the response object
const responseId = result.response.id;

// Continue the conversation using previousResponseId
const { text: secondResponse } = await generateText({
  model: xai.responses('grok-4.6'),
  prompt: "How do stars form?",
  providerOptions: {
    xai: {
      previousResponseId: responseId,
    },
  },
});

console.log(secondResponse);
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600 \
  -d '{
    "model": "grok-4.6",
    "previous_response_id": "The previous response ID",
    "input": [
        {
            "role": "user",
            "content": "How do stars form?"
        }
    ]
}'
```

### [Adding encrypted thinking content](#adding-encrypted-thinking-content)

After returning the encrypted thinking content, you can also add it to a new response's input.

Make sure to use a reasoning model when working with encrypted thinking content.

PythonPython (OpenAI)JavaScript JavaScriptBash

```
import os
from xai_sdk import Client
from xai_sdk.chat import user, system

client = Client(
    api_key=os.getenv("XAI_API_KEY"),
    management_api_key=os.getenv("XAI_MANAGEMENT_API_KEY"),
    timeout=3600,
)

chat = client.chat.create(model="grok-4.6", store_messages=True, use_encrypted_content=True)
chat.append(system("You are Grok, an AI agent built to answer helpful questions."))
chat.append(user("How big is the universe?"))
response = chat.sample()

print(response)

# The response ID that can be used to continue the conversation later

print(response.id)

# New steps

chat.append(response)  ## Append the response and the SDK will automatically add the outputs from response to message history

chat.append(user("How do stars form?"))
second_response = chat.sample()

print(second_response)

# The response ID that can be used to continue the conversation later

print(second_response.id)
```

```
# Previous steps
import os
import httpx
from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
    timeout=httpx.Timeout(3600.0), # Override default timeout with longer timeout for reasoning models
)

response = client.responses.create(
    model="grok-4.6",
    input=[
        {"role": "system", "content": "You are Grok, an AI agent built to answer helpful questions."},
        {"role": "user", "content": "How big is the universe?"},
    ],
    include=["reasoning.encrypted_content"]
)

print(response)

# The response ID that can be used to continue the conversation later

print(response.id)

# New steps

second_response = client.responses.create(
    model="grok-4.6",
    input=[
        *response.output,  # Use response.output instead of the stored response
        {"role": "user", "content": "How do stars form?"},
    ],
)

print(second_response)

# The response ID that can be used to continue the conversation later

print(second_response.id)
```

```
// Previous steps
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
    timeout: 360000, // Override default timeout with longer timeout for reasoning models
});

const response = await client.responses.create({
    model: "grok-4.6",
    input: [
        {
            role: "system",
            content: "You are Grok, an AI agent built to answer helpful questions."
        },
        {
            role: "user",
            content: "How big is the universe?"
        },
    ],
    include: ["reasoning.encrypted_content"],
});

console.log(response);

// The response ID that can be used to recall the conversation later
console.log(response.id);

const secondResponse = await client.responses.create({
    model: "grok-4.6",
    input: [
        ...response.output,  // Use response.output instead of the stored response
        {"role": "user", "content": "How do stars form?"},
    ],
});

console.log(secondResponse);

// The response ID that can be used to recall the conversation later
console.log(secondResponse.id);
```

```
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

// First request. Encrypted reasoning content is included automatically
// by the AI SDK as long as `store: false` is not set.
const result = await generateText({
  model: xai.responses('grok-4.6'),
  system: "You are Grok, an AI agent built to answer helpful questions.",
  prompt: "How big is the universe?",
});

console.log(result.text);

// Continue the conversation using previousResponseId
// The encrypted content is automatically included when using previousResponseId
const { text: secondResponse } = await generateText({
  model: xai.responses('grok-4.6'),
  prompt: "How do stars form?",
  providerOptions: {
    xai: {
      previousResponseId: result.response.id,
    },
  },
});

console.log(secondResponse);
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600 \
  -d '{
    "model": "grok-4.6",
    "input": [
        {
            "role": "system",
            "content": "You are Grok, an AI agent built to answer helpful questions."
        },
        {
            "role": "user",
            "content": "How big is the universe?"
        },
        {
            "id": "rs_51abe1aa-599b-80b6-57c8-dddc6263362f_us-east-1",
            "summary": [],
            "type": "reasoning",
            "status": "completed",
            "encrypted_content": "bvV88j99ILvgfHRTHCUSJtw+ISji6txJzPdZNbcSVuDk4OMG2Z9r5wOBBwjd3u3Hhm9XtpCWJO1YgTOlpgbn+g7DZX+pOagYYrCFUpQ19XkWz6Je8bHG9JcSDoGDqNgRbDbAUO8at6RCyqgPupJj5ArBDCt73fGQLTC4G3S0JMK9LsPiWz6GPj6qyzYoRzkj4R6bntRm74E4h8Y+z6u6B7+ixPSv8s1EFs8c+NUAB8TNKZZpXZquj2LXfx1xAie85Syl7qLqxLNtDG1dNBhBnHpYoE4gQzwyXqywf5pF2Q2imzPNzGQhurK+6gaNWgZbxRmjhdsW6TnzO5Kk6pzb5qpfgfcEScQeYHSj5GpD+yDUCNlhdbzhhWnEErH+wuBPpTG6UQhiC7m7yrJ7IY2E8K/BeUPlUvkhMaMwb4dA279pWMJdchNJ+TAxca+JVc80pXMG/PmrQUNJU9qdXRLbNmQbRadBNwV2qkPfgggL3q0yNd7Un9P+atmP3B9keBILif3ufsBDtVUobEniiyGV7YVDvQ/fQRVs7XDxJiOKkogjjQySyHgpjseO8iG5xtb9mrz6B3mDvv2aAuyDL6MHZRM7QDVPjUbgNMzDm5Sm3J7IhtzfR+3eMDws3qeTsxOt1KOslu983Btv1Wx37b5HJqX1pQU1dae/kOSJ7MifFd6wMkQtQBDgVoG3ka9wq5Vxq9Ki8bDOOMcwA2kUXhCcY3TZCXJfDWSKPTcCoNCYIv5LT2NFVdamiSfLIyeOjBNz459BfMvAoOZShFViQyc5YwjnReUQPQ8a18jcz8GoAK1O99e0h91oYxIgDV52EfS+IYrzqvJOEQbKQinB+LJwkPbBEp7ZtgAtiNBzm985hNgLfiBaVFWcRYwI3tNBCT1vkw2YI0NEEG0yOF29x+u64XzqyP1CX1pU6sGXEFn3RPdfYibf6bt/Y1BRqBL5l0CrXWsgDw02SqIFta8OvJ7Iwmq40/4acE/Ew6eWO/z2MHkWgqSpwGNjn7MfeKkTi44foZjfNqN9QOFQt6VG2tY+biKZDo0h9DAftae8Q2Xs2UDvsBYOm7YEahVkput6/uKzxljpXlz269qHk6ckvdN9hKLbaTO3/IZPCCPQ5a/a/sWn/1VOJj72sDk+23RNjBf0FL6bJMXZI5aQdtxbF1zij9mWcP9nJ9FHhj53ytuf1NiKl5xU8ZsaoKmCAJcXUz1n2FZvyWlqvgPYiszc7R8Y5dF6QbW2mlKnXzVy6qRMHNeQqGhCEncyT5nPNSdK5QlUwLokAIg"
        },
        {
            "content": [
                {
                    "type": "output_text",
                    "text": "42\n\nThis is, of course, the iconic answer from Douglas Adams'\'' *The Hitchhiker'\''s Guide to the Galaxy*, where a supercomputer named Deep Thought spends 7.5 million years computing the \"Answer to the Ultimate Question of Life, the Universe, and Everything\"—only to reveal it'\''s 42. (The real challenge, it turns out, is figuring out what the actual *question* was.)\n\nIf you'\''re asking in a more literal or philosophical sense, the universe doesn'\''t have a single tidy answer—it'\''s full of mysteries like quantum mechanics, dark matter, and why cats knock things off tables. But 42? That'\''s as good a starting point as any. What'\''s your take on it?",
                    "logprobs": null,
                    "annotations": []
                }
            ],
            "id": "msg_c2f68a9b-87cd-4f85-a9e9-b6047213a3ce_us-east-1",
            "role": "assistant",
            "type": "message",
            "status": "completed"
        },
        {
            "role": "user",
            "content": "How do stars form?"
        }
    ],
    "include": [
        "reasoning.encrypted_content"
    ]
}'
```

---

## [Retrieving a previous model response](#retrieving-a-previous-model-response)

If you have a previous response's ID, you can retrieve the content of the response.

PythonPython (OpenAI)JavaScript (OpenAI) JavaScriptBash

```
import os
from xai_sdk import Client
from xai_sdk.chat import user, system

client = Client(
    api_key=os.getenv("XAI_API_KEY"),
    management_api_key=os.getenv("XAI_MANAGEMENT_API_KEY"),
    timeout=3600,
)

response = client.chat.get_stored_completion("<The previous response's id>")

print(response)
```

```
import os
import httpx
from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
    timeout=httpx.Timeout(3600.0), # Override default timeout with longer timeout for reasoning models
)

response = client.responses.retrieve("<The previous response's id>")

print(response)
```

```
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
    timeout: 360000, // Override default timeout with longer timeout for reasoning models
});

const response = await client.responses.retrieve("<The previous response's id>");

console.log(response);
```

```
// Note: The Vercel AI SDK does not provide a method to retrieve previous responses.
// Use the OpenAI SDK as shown above for this functionality.

import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
    timeout: 360000,
});

const response = await client.responses.retrieve("<The previous response's id>");

console.log(response);
```

```
curl https://api.x.ai/v1/responses/{response_id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600
```

---

## [Delete a model response](#delete-a-model-response)

If you no longer want to store the previous model response, you can delete it.

PythonPython (OpenAI)JavaScript (OpenAI) JavaScriptBash

```
import os
from xai_sdk import Client
from xai_sdk.chat import user, system

client = Client(
    api_key=os.getenv("XAI_API_KEY"),
    management_api_key=os.getenv("XAI_MANAGEMENT_API_KEY"),
    timeout=3600,
)

response = client.chat.delete_stored_completion("<The previous response's id>")
print(response)
```

```
import os
import httpx
from openai import OpenAI

client = OpenAI(
    api_key="<YOUR_XAI_API_KEY_HERE>",
    base_url="https://api.x.ai/v1",
    timeout=httpx.Timeout(3600.0), # Override default timeout with longer timeout for reasoning models
)

response = client.responses.delete("<The previous response's id>")

print(response)
```

```
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
    timeout: 360000, // Override default timeout with longer timeout for reasoning models
});

const response = await client.responses.delete("<The previous response's id>");

console.log(response);
```

```
// Note: The Vercel AI SDK does not provide a method to delete previous responses.
// Use the OpenAI SDK as shown above for this functionality.

import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "<api key>",
    baseURL: "https://api.x.ai/v1",
    timeout: 360000,
});

const response = await client.responses.delete("<The previous response's id>");

console.log(response);
```

```
curl -X DELETE https://api.x.ai/v1/responses/{response_id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -m 3600
```

---

Last updated: May 29, 2026
