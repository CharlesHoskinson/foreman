[API](/overview)

[Grok Build](/build/overview)[Grok Bot](/grok-bot/overview)[Grok](/grok/overview)

Search

⌘K

[API Console](https://console.x.ai?utm_source=docs&utm_medium=referral&utm_campaign=developers-rest-api-reference-inference-responses&utm_content=header-api-console)

Inference API

* [Overview](/developers/rest-api-reference/inference)

* Responses

  + [Create new response](/developers/rest-api-reference/inference/responses#create-new-response)
  + [Retrieve previous response](/developers/rest-api-reference/inference/responses#retrieve-previous-response)
  + [List input items](/developers/rest-api-reference/inference/responses#list-input-items)
  + [Delete previous response](/developers/rest-api-reference/inference/responses#delete-previous-response)
  + [Compact a conversation](/developers/rest-api-reference/inference/responses#compact-a-conversation)

* Chat Completions

* Embeddings

* Images

* Videos

* Voice

* Files

* Batches

* Models

* Account

* Legacy & Deprecated

Collections API

* [Overview](/developers/rest-api-reference/collections)

* Collection Management

* Search in Collections

Management API

* [Overview](/developers/rest-api-reference/management)
* [Using Management API](/developers/management-api-guide)

* Accounts and Authorization

* Billing Management

* Audit Logs

gRPC API

* [Overview](/developers/grpc-api-reference)
* [Chat](/developers/grpc-api-reference/chat)
* [Image](/developers/grpc-api-reference/image)
* [Video](/developers/grpc-api-reference/video)
* [Batch Management](/developers/grpc-api-reference/batches)
* [Models](/developers/grpc-api-reference/models)
* [Auth](/developers/grpc-api-reference/auth)
* [Tokenize](/developers/grpc-api-reference/tokenize)
* [Raw Sampling](/developers/grpc-api-reference/sample)

* [API](/overview)
  + [Docs](/overview)
  + [REST Reference](/developers/rest-api-reference/inference)
* [Grok Build](/build/overview)
* [Grok Bot](/grok-bot/overview)
* [Grok](/grok/overview)

Inference API

* [Overview](/developers/rest-api-reference/inference)

* Responses

  + [Create new response](/developers/rest-api-reference/inference/responses#create-new-response)
  + [Retrieve previous response](/developers/rest-api-reference/inference/responses#retrieve-previous-response)
  + [List input items](/developers/rest-api-reference/inference/responses#list-input-items)
  + [Delete previous response](/developers/rest-api-reference/inference/responses#delete-previous-response)
  + [Compact a conversation](/developers/rest-api-reference/inference/responses#compact-a-conversation)

* Chat Completions

* Embeddings

* Images

* Videos

* Voice

* Files

* Batches

* Models

* Account

* Legacy & Deprecated

Collections API

* [Overview](/developers/rest-api-reference/collections)

* Collection Management

* Search in Collections

Management API

* [Overview](/developers/rest-api-reference/management)
* [Using Management API](/developers/management-api-guide)

* Accounts and Authorization

* Billing Management

* Audit Logs

gRPC API

* [Overview](/developers/grpc-api-reference)
* [Chat](/developers/grpc-api-reference/chat)
* [Image](/developers/grpc-api-reference/image)
* [Video](/developers/grpc-api-reference/video)
* [Batch Management](/developers/grpc-api-reference/batches)
* [Models](/developers/grpc-api-reference/models)
* [Auth](/developers/grpc-api-reference/auth)
* [Tokenize](/developers/grpc-api-reference/tokenize)
* [Raw Sampling](/developers/grpc-api-reference/sample)

#### [Inference API](#inference-api)

[Responses](#responses)
=======================

Copy for LLM[View as Markdown](/developers/rest-api-reference/inference/responses.md)Share feedback

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-rest-api-reference-inference-responses&utm_content=article-api-key)[Meet grok-4.6](https://x.ai/news/grok-4-6)

The Responses API is the primary interface for text generation, reasoning, and tool use. See the [Text Generation guide](/developers/model-capabilities/text/generate-text) for usage.

---

[Create new response](#create-new-response)
-------------------------------------------

/v1/responses

Generates a response based on text or image prompts. The response ID can be used to retrieve the response later or to continue the conversation without repeating prior context. New responses will be stored for 30 days and then permanently deleted.

Request Body
------------

Expand All

input

string | array

required

Content of the input passed to a `/v1/response` request.

Show optional fields

Response Body
-------------

Expand All

background

boolean

default: false

OpenResponses compatibility fields.
Not used at the moment. Just for OpenResponses compatibility.
Whether to process the response asynchronously in the background.

created\_at

integer

The Unix timestamp (in seconds) for the response creation time.

error

An error object returned when the model fails to generate a response.

frequency\_penalty

number

(NOT SUPPORTED in Responses API) Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.

id

string

Unique ID of the response.

metadata

Only included for compatibility.

model

string

Model name used to generate the response.

object

string

The object type of this resource. Always set to `response`.

output

array

The response generated by the model.

parallel\_tool\_calls

boolean

Whether to allow the model to run parallel tool calls.

presence\_penalty

number

(NOT SUPPORTED in Responses API) Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.

service\_tier

string

default: default

status

string

Status of the response. One of `completed`, `in_progress` or `incomplete`.

store

boolean

default: true

Whether to store the input message(s) and model response for later retrieval.

text

object

tool\_choice

string | object

Parameter to control how model chooses the tools.

tools

array

A list of tools the model may call in JSON-schema. Currently, only functions and web search are supported as tools. A max of 350 tools are supported.

top\_logprobs

integer

An integer between 0 and 8 specifying the number of most likely tokens to return at each token position.

truncation

string

default: disabled

The truncation strategy to use for the model response.

Show nullable fields

---

[Retrieve previous response](#retrieve-previous-response)
---------------------------------------------------------

/v1/responses/{response\_id}

Retrieve a previously generated response.

Path parameters
---------------

response\_id

string

required

The response id returned by a previous create response request.

Response Body
-------------

Expand All

background

boolean

default: false

OpenResponses compatibility fields.
Not used at the moment. Just for OpenResponses compatibility.
Whether to process the response asynchronously in the background.

created\_at

integer

The Unix timestamp (in seconds) for the response creation time.

error

An error object returned when the model fails to generate a response.

frequency\_penalty

number

(NOT SUPPORTED in Responses API) Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.

id

string

Unique ID of the response.

metadata

Only included for compatibility.

model

string

Model name used to generate the response.

object

string

The object type of this resource. Always set to `response`.

output

array

The response generated by the model.

parallel\_tool\_calls

boolean

Whether to allow the model to run parallel tool calls.

presence\_penalty

number

(NOT SUPPORTED in Responses API) Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.

service\_tier

string

default: default

status

string

Status of the response. One of `completed`, `in_progress` or `incomplete`.

store

boolean

default: true

Whether to store the input message(s) and model response for later retrieval.

text

object

tool\_choice

string | object

Parameter to control how model chooses the tools.

tools

array

A list of tools the model may call in JSON-schema. Currently, only functions and web search are supported as tools. A max of 350 tools are supported.

top\_logprobs

integer

An integer between 0 and 8 specifying the number of most likely tokens to return at each token position.

truncation

string

default: disabled

The truncation strategy to use for the model response.

Show nullable fields

---

[List input items](#list-input-items)
-------------------------------------

/v1/responses/{response\_id}/input\_items

List input items for a previously generated response.

Path parameters
---------------

response\_id

string

required

The response id returned by a previous create response request.

Query parameters
----------------

limit

integer

Maximum number of items to return (1-100, default 20).

order

string

Sort order: asc or desc. Default asc.

after

string

Cursor for pagination. Returns items after this item ID.

Response Body
-------------

Expand All

data

array

The list of input items.

has\_more

boolean

Whether there are more items beyond this page.

object

string

The object type, always `list`.

Show nullable fields

---

[Delete previous response](#delete-previous-response)
-----------------------------------------------------

/v1/responses/{response\_id}

Delete a previously generated response.

Path parameters
---------------

response\_id

string

required

The response id returned by a previous create response request.

Response Body
-------------

Expand All

deleted

boolean

Whether the response was successfully deleted.

id

string

The response\_id to be deleted.

object

string

The deleted object type, which is always `response`.

---

[Compact a conversation](#compact-a-conversation)
-------------------------------------------------

/v1/responses/compact

Shrink a full context window into a compacted window that can be reused in follow-up `/v1/responses` calls. See [Context Compaction](/developers/advanced-api-usage/context-compaction) for the full guide.

Compacts a full Responses API input window into a shorter canonical window.

Request Body
------------

Expand All

input

string | array

required

Content of the input passed to a `/v1/response` request.

model

string

required

Model to use for compaction summarization (required).

Response Body
-------------

Expand All

created\_at

integer

Unix timestamp (in seconds) when the compacted conversation was created.

id

string

Unique ID for this compaction (e.g. `cmp_<uuid>`).

model

string

Model used for the compaction summary.

object

string

Always `"response.compaction"`.

output

array

Compacted output containing a single compaction item.
Pass this verbatim as input to the next `/v1/responses` call.

Show nullable fields

---

Last updated: September 2, 2026

POST

/v1/responses

Bash

Example

```
curl -s https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4.6",
    "input": "What is the meaning of life?"
  }'
```

```
import { xai } from "@ai-sdk/xai";
import { generateText } from "ai";

const result = await generateText({
  model: xai.responses("grok-4.6"),
  prompt: "What is the meaning of life?",
});

console.log(JSON.stringify(result, null, 2));
```

```
import os

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["XAI_API_KEY"],
    base_url="https://api.x.ai/v1",
)

response = client.responses.create(
    model="grok-4.6",
    input="What is the meaning of life?",
)

print(response.model_dump_json(indent=2))
```

```
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

const response = await client.responses.create({
  model: "grok-4.6",
  input: "What is the meaning of life?",
});

console.log(JSON.stringify(response, null, 2));
```

```
{
  "input": [
    {
      "role": "system",
      "content": "You are a helpful assistant that can answer questions and help with tasks."
    },
    {
      "role": "user",
      "content": "What is 101*3?"
    }
  ],
  "model": "latest"
}
```

Output

JSON

```
{
  "created_at": 1774274151,
  "completed_at": 1774274155,
  "id": "e7fd6e3f-0a77-9948-99a9-b40ba7c1c6f1",
  "max_output_tokens": null,
  "model": "grok-4.20-0309-reasoning",
  "object": "response",
  "output": [
    {
      "content": [
        {
          "type": "output_text",
          "text": "**42.**",
          "logprobs": [],
          "annotations": []
        }
      ],
      "id": "msg_e7fd6e3f-0a77-9948-99a9-b40ba7c1c6f1",
      "role": "assistant",
      "type": "message",
      "status": "completed"
    }
  ],
  "parallel_tool_calls": true,
  "previous_response_id": null,
  "reasoning": {
    "effort": null,
    "summary": null
  },
  "temperature": 0.7,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "usage": {
    "input_tokens": 131,
    "input_tokens_details": {
      "cached_tokens": 128
    },
    "output_tokens": 624,
    "output_tokens_details": {
      "reasoning_tokens": 246
    },
    "total_tokens": 755,
    "num_sources_used": 0,
    "num_server_side_tools_used": 0,
    "cost_in_usd_ticks": 37756000
  },
  "user": null,
  "incomplete_details": null,
  "status": "completed",
  "store": true,
  "metadata": {},
  "background": false,
  "service_tier": "default",
  "truncation": "disabled",
  "top_logprobs": 0,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "prompt_cache_key": null,
  "max_tool_calls": null,
  "safety_identifier": null,
  "error": null,
  "instructions": null
}
```

GET

/v1/responses/{response\_id}

JSON

Example

```
No parameters.
```

200

Response

JSON

200

```
{
  "created_at": 1754475266,
  "id": "ad5663da-63e6-86c6-e0be-ff15effa8357",
  "max_output_tokens": null,
  "model": "latest",
  "object": "response",
  "output": [
    {
      "content": [
        {
          "type": "output_text",
          "text": "101 multiplied by 3 is 303.",
          "logprobs": null,
          "annotations": []
        }
      ],
      "id": "msg_ad5663da-63e6-86c6-e0be-ff15effa8357",
      "role": "assistant",
      "type": "message",
      "status": "completed"
    },
    {
      "id": "",
      "summary": [
        {
          "text": "First, the user asked: \"What is 101*3?\"\n\nThis is a simple multiplication: 101 multiplied by 3.\n\nCalculating: 100 * 3 = 300, and 1 * 3 = 3, so 300 + 3 = 303.\n\nI should respond helpfully and directly, as per my system prompt: \"You are a helpful assistant that can answer questions and help with tasks.\"\n\nKeep the response concise and accurate. No need for extra fluff unless it adds value.\n\nFinal answer: 303.",
          "type": "summary_text"
        }
      ],
      "type": "reasoning",
      "status": "completed"
    }
  ],
  "parallel_tool_calls": true,
  "previous_response_id": null,
  "reasoning": null,
  "temperature": null,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": null,
  "usage": {
    "prompt_tokens": 32,
    "completion_tokens": 9,
    "total_tokens": 151,
    "prompt_tokens_details": {
      "text_tokens": 32,
      "audio_tokens": 0,
      "image_tokens": 0,
      "cached_tokens": 8
    },
    "completion_tokens_details": {
      "reasoning_tokens": 110,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    },
    "num_sources_used": 0
  },
  "user": null,
  "incomplete_details": null,
  "status": "completed",
  "store": true
}
```

GET

/v1/responses/{response\_id}/input\_items

JSON

Example

```
No parameters.
```

200

Response

JSON

200

```
{}
```

DELETE

/v1/responses/{response\_id}

JSON

Example

```
No parameters.
```

200

Response

JSON

200

```
{
  "id": "ad5663da-63e6-86c6-e0be-ff15effa8357",
  "object": "response",
  "deleted": true
}
```

POST

/v1/responses/compact

Bash

Example

```
curl -s https://api.x.ai/v1/responses/compact \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4.6",
    "input": [
      {"role": "system", "content": "You are a concise and knowledgeable science tutor."},
      {"role": "user", "content": "What is the Higgs boson and why is it important?"},
      {"role": "assistant", "content": "The Higgs boson is an elementary particle in the Standard Model, predicted by Peter Higgs in 1964 and confirmed at CERN in 2012. It is the quantum excitation of the Higgs field, which gives mass to fundamental particles via the Higgs mechanism."},
      {"role": "user", "content": "How does the Higgs mechanism actually work?"},
      {"role": "assistant", "content": "Through spontaneous symmetry breaking. The Higgs field has a nonzero vacuum value, and particles acquire mass in proportion to how strongly they couple to it. Photons do not couple, which is why they remain massless."}
    ]
  }'
```

```
import os

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["XAI_API_KEY"],
    base_url="https://api.x.ai/v1",
)

compacted = client.responses.compact(
    model="grok-4.6",
    input=[
        {"role": "system", "content": "You are a concise and knowledgeable science tutor."},
        {"role": "user", "content": "What is the Higgs boson and why is it important?"},
        {
            "role": "assistant",
            "content": (
                "The Higgs boson is an elementary particle in the Standard Model, predicted by "
                "Peter Higgs in 1964 and confirmed at CERN in 2012. It is the quantum excitation "
                "of the Higgs field, which gives mass to fundamental particles via the Higgs mechanism."
            ),
        },
        {"role": "user", "content": "How does the Higgs mechanism actually work?"},
        {
            "role": "assistant",
            "content": (
                "Through spontaneous symmetry breaking. The Higgs field has a nonzero vacuum value, "
                "and particles acquire mass in proportion to how strongly they couple to it. Photons "
                "do not couple, which is why they remain massless."
            ),
        },
    ],
)

print(compacted.model_dump_json(indent=2))
```

```
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

const compacted = await client.responses.compact({
  model: "grok-4.6",
  input: [
    { role: "system", content: "You are a concise and knowledgeable science tutor." },
    { role: "user", content: "What is the Higgs boson and why is it important?" },
    {
      role: "assistant",
      content:
        "The Higgs boson is an elementary particle in the Standard Model, predicted by Peter Higgs in 1964 and confirmed at CERN in 2012. It is the quantum excitation of the Higgs field, which gives mass to fundamental particles via the Higgs mechanism.",
    },
    { role: "user", content: "How does the Higgs mechanism actually work?" },
    {
      role: "assistant",
      content:
        "Through spontaneous symmetry breaking. The Higgs field has a nonzero vacuum value, and particles acquire mass in proportion to how strongly they couple to it. Photons do not couple, which is why they remain massless.",
    },
  ],
});

console.log(JSON.stringify(compacted, null, 2));
```

```
{
  "model": "latest",
  "input": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Tell me about Rust."
    },
    {
      "role": "assistant",
      "content": "Rust is a systems programming language..."
    },
    {
      "role": "user",
      "content": "How does ownership work?"
    },
    {
      "role": "assistant",
      "content": "Ownership in Rust is..."
    }
  ]
}
```

Output

JSON

```
{}
```