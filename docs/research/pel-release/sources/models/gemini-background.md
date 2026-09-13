---
source_url: "https://ai.google.dev/gemini-api/docs/background-execution"
captured_at: "2026-09-13T03:04:21.984412+00:00"
contributor: "Foreman release research; Scrapling"
---

Gemini 3.8 Flash is now available. [Try it out](https://aistudio.google.com/prompts/new_chat?model=gemini-3.8-flash).

* [Home](https://ai.google.dev/)
* [Gemini API](https://ai.google.dev/gemini-api)
* [Docs](https://ai.google.dev/gemini-api/docs)

Send feedback

# Background execution


For long-running tasks like deep research, complex reasoning, or multi-step agent executions, connection timeouts can interrupt standard HTTP requests (which typically close after 60 seconds). The [Interactions API](/gemini-api/docs/interactions-overview) provides **background execution** to run these tasks asynchronously.

To let the interaction run until it completes the task on the server, set `"background": true` when creating the interaction. The API immediately returns an interaction ID, which client applications can use to poll for status, stream progress, or reconnect to a disconnected stream.

Background execution is supported for standard Gemini models (such as `gemini-3.8-flash` and `gemini-3.1-pro-preview`) and Managed Agents (such as `antigravity-preview-05-2026`).

## Create a background interaction

To start a background interaction, set the `background` parameter to `true` when creating the resource.

### Python

```
from google import genai

client = genai.Client()

interaction = client.interactions.create(
    model="gemini-3.8-flash",
    input="Write a guide on space exploration.",
    background=True,
)
print(f"Created background interaction ID: {interaction.id}")
```

### JavaScript

```
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({});

const interaction = await client.interactions.create({
    model: "gemini-3.8-flash",
    input: "Write a guide on space exploration.",
    background: true,
});
console.log(`Created background interaction ID: ${interaction.id}`);
```

### Java

```
import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.CreateModelInteractionEnvironment;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.interactions.Model;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.GetInteractionByIdRequest;
import com.google.genai.gaos.models.operations.GetInteractionByIdResponse;

Client client = new Client();

CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model(Model.of("gemini-3.8-flash"))
        .input(InteractionsInput.of("Execute this background task."))
        .background(true)
        .environment(CreateModelInteractionEnvironment.of("remote"))
        .build();

Interaction interaction =
    client.interactions.create(CreateInteractionRequestBody.of(params)).interaction().get();
String interactionId = interaction.id().orElse("");

// Poll status using GetInteractionByIdRequest
GetInteractionByIdResponse getResponse =
    client.interactions.get(new GetInteractionByIdRequest(interactionId));
Interaction polled = getResponse.interaction().get();
System.out.println("Status: " + polled.status().orElse(null));
```

### REST

```
curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Api-Revision: 2026-05-20" \
  -d '{
    "model": "gemini-3.8-flash",
    "input": "Write a guide on space exploration.",
    "background": true
  }'
```

## How background execution works

When you create a background interaction, the task runs asynchronously on the server. The interaction transitions through various execution states:

* `in_progress`: The server is actively executing the interaction (such as running code or researching).
* `requires_action`: The interaction has paused and is waiting for client input (such as confirming a tool execution or answering a question).
* `completed`: The interaction finished successfully and the output is available.
* `failed`: An error occurred during execution (such as tool failure or rate limits).
* `cancelled`: A client request stopped the execution.

**Note:** For the complete list of interaction states, see the
[Interactions API Reference](https://ai.google.dev/api/interactions-api#Resource:Interaction).

### Use cases

Use background execution for:

* **Agent executions:** Tasks requiring code execution, web browsing, or sub-agent orchestration (such as `antigravity-preview-05-2026`).
* **Deep research:** Runs using `deep-research-preview-04-2026` or `deep-research-max-preview-04-2026` which take several minutes.
* **Long reasoning:** Tasks where model thinking steps exceed standard HTTP connection limits.

## Retrieve results

Obtain background interaction results using either **polling** or **streaming**.

### Polling pattern (non-blocking)

Polling checks the interaction status periodically using non-blocking GET requests until it reaches a terminal state.

### Python

```
import time
from google import genai

client = genai.Client()

interaction = client.interactions.get(id="YOUR_INTERACTION_ID")

while interaction.status == "in_progress":
    time.sleep(5)
    interaction = client.interactions.get(id=interaction.id)

if interaction.status == "completed":
    print(interaction.output_text)
else:
    print(f"Finished with status: {interaction.status}")
```

### JavaScript

```
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({});

let interaction = await client.interactions.get("YOUR_INTERACTION_ID");

while (interaction.status === "in_progress") {
    await new Promise(resolve => setTimeout(resolve, 5000));
    interaction = await client.interactions.get(interaction.id);
}

if (interaction.status === "completed") {
    console.log(interaction.output_text);
} else {
    console.log(`Finished with status: ${interaction.status}`);
}
```

### Java

```
import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.CreateModelInteractionEnvironment;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.interactions.Model;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.GetInteractionByIdRequest;
import com.google.genai.gaos.models.operations.GetInteractionByIdResponse;

Client client = new Client();

CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model(Model.of("gemini-3.8-flash"))
        .input(InteractionsInput.of("Execute this background task."))
        .background(true)
        .environment(CreateModelInteractionEnvironment.of("remote"))
        .build();

Interaction interaction =
    client.interactions.create(CreateInteractionRequestBody.of(params)).interaction().get();
String interactionId = interaction.id().orElse("");

// Poll status using GetInteractionByIdRequest
GetInteractionByIdResponse getResponse =
    client.interactions.get(new GetInteractionByIdRequest(interactionId));
Interaction polled = getResponse.interaction().get();
System.out.println("Status: " + polled.status().orElse(null));
```

### REST

```
curl -X GET "https://generativelanguage.googleapis.com/v1beta/interactions/YOUR_INTERACTION_ID" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Api-Revision: 2026-05-20"
```

### Streaming pattern

If a network interruption disconnects a stream, streaming can resume from the last received event. Each delta contains a unique `event_id` in its payload. Passing this ID as `last_event_id` resumes the stream from that event.

### Python

```
import time
from google import genai

client = genai.Client()
interaction_id = "YOUR_INTERACTION_ID"

def stream_with_reconnect(interaction_id: str):
    last_event_id = None
    while True:
        try:
            # Retrieve the stream. If resuming, pass last_event_id
            stream = client.interactions.get(
                id=interaction_id,
                stream=True,
                last_event_id=last_event_id
            )

            for event in stream:
                # Log event updates and capture event_id if present
                if event.event_id:
                    last_event_id = event.event_id

                if event.event_type == "step.delta" and event.delta.type == "text":
                    print(event.delta.text, end="", flush=True)

                if event.event_type == "interaction.completed":
                    return

        except Exception as e:
            print(f"\n[Connection lost: {e}. Reconnecting in 3s...]")
            time.sleep(3)

stream_with_reconnect(interaction_id)
```

### JavaScript

```
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({});
const interactionId = "YOUR_INTERACTION_ID";

async function streamWithReconnect(id) {
    let lastEventId = undefined;
    while (true) {
        try {
            // Retrieve the stream. If resuming, pass last_event_id in options
            const stream = await client.interactions.get(id, {
                stream: true,
                last_event_id: lastEventId
            });

            for await (const event of stream) {
                // Capture event_id if present
                const idVal = event.event_id || event.id;
                if (idVal) {
                    lastEventId = idVal;
                }

                if (event.event_type === "step.delta" && event.delta?.type === "text") {
                    process.stdout.write(event.delta.text);
                }

                if (event.event_type === "interaction.completed") {
                    return;
                }
            }
        } catch (error) {
            console.log(`\n[Connection lost: ${error.message}. Reconnecting in 3s...]`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
}

await streamWithReconnect(interactionId);
```

### Java

```
import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.CreateModelInteractionEnvironment;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.interactions.Model;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.GetInteractionByIdRequest;
import com.google.genai.gaos.models.operations.GetInteractionByIdResponse;

Client client = new Client();

CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model(Model.of("gemini-3.8-flash"))
        .input(InteractionsInput.of("Execute this background task."))
        .background(true)
        .environment(CreateModelInteractionEnvironment.of("remote"))
        .build();

Interaction interaction =
    client.interactions.create(CreateInteractionRequestBody.of(params)).interaction().get();
String interactionId = interaction.id().orElse("");

// Poll status using GetInteractionByIdRequest
GetInteractionByIdResponse getResponse =
    client.interactions.get(new GetInteractionByIdRequest(interactionId));
Interaction polled = getResponse.interaction().get();
System.out.println("Status: " + polled.status().orElse(null));
```

### REST

```
curl -N -X GET "https://generativelanguage.googleapis.com/v1beta/interactions/YOUR_INTERACTION_ID?stream=true&last_event_id=YOUR_LAST_EVENT_ID" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Api-Revision: 2026-05-20"
```

## Multi-turn conversations

Subsequent interactions can chain to a background conversation using `previous_interaction_id`, subject to these constraints:

1. **Active executions are blocked:** Chaining a subsequent interaction to one with `in_progress` status returns a `400 Bad Request` error. Wait for the interaction to reach the `completed` state before starting the next one.
2. **Environment Parameter for Managed Agents:** When chaining interactions for Managed Agents (such as `antigravity-preview-05-2026`), requests must include both `previous_interaction_id` and `environment`.

The following examples show how to chain interactions:

### Python

```
import time
from google import genai

client = genai.Client()
agent_model = "antigravity-preview-05-2026"

# First interaction: Provision sandbox environment and execute first instruction
interaction1 = client.interactions.create(
    model=agent_model,
    input="Create a folder named project/ and write hello.py inside.",
    environment="remote",
    background=True
)

# Wait for completion
while True:
    check = client.interactions.get(id=interaction1.id)
    if check.status != "in_progress":
        break
    time.sleep(2)

# Second interaction: Chain using previous_interaction_id and environment
interaction2 = client.interactions.create(
    model=agent_model,
    input="List all files in the project/ directory.",
    previous_interaction_id=interaction1.id,
    environment="remote",
    background=True
)
```

### JavaScript

```
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({});
const agentModel = "antigravity-preview-05-2026";

// First interaction: Provision sandbox environment and execute first instruction
const interaction1 = await client.interactions.create({
    model: agentModel,
    input: "Create a folder named project/ and write hello.py inside.",
    environment: "remote",
    background: true
});

// Wait for completion
while (true) {
    const check = await client.interactions.get(interaction1.id);
    if (check.status !== "in_progress") {
        break;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
}

// Second interaction: Chain using previous_interaction_id and environment
const interaction2 = await client.interactions.create({
    model: agentModel,
    input: "List all files in the project/ directory.",
    previous_interaction_id: interaction1.id,
    environment: "remote",
    background: true
});
```

### Java

```
import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.CreateModelInteractionEnvironment;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.interactions.Model;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.GetInteractionByIdRequest;
import com.google.genai.gaos.models.operations.GetInteractionByIdResponse;

Client client = new Client();

CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model(Model.of("gemini-3.8-flash"))
        .input(InteractionsInput.of("Execute this background task."))
        .background(true)
        .environment(CreateModelInteractionEnvironment.of("remote"))
        .build();

Interaction interaction =
    client.interactions.create(CreateInteractionRequestBody.of(params)).interaction().get();
String interactionId = interaction.id().orElse("");

// Poll status using GetInteractionByIdRequest
GetInteractionByIdResponse getResponse =
    client.interactions.get(new GetInteractionByIdRequest(interactionId));
Interaction polled = getResponse.interaction().get();
System.out.println("Status: " + polled.status().orElse(null));
```

### REST

```
# Chain second interaction (Make sure FIRST_INTERACTION_ID has status 'completed')
curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Api-Revision: 2026-05-20" \
  -d '{
    "model": "antigravity-preview-05-2026",
    "input": "List all files in the project/ directory.",
    "previous_interaction_id": "FIRST_INTERACTION_ID",
    "environment": "remote",
    "background": true
  }'
```

## Cancellation and deletion

Control running executions and manage storage using cancel and delete requests:

* **Cancel (`POST /interactions/{id}/cancel`):** Stops the running task. The status transitions to `cancelled`. Clean-up actions on the server can cause a slight delay before the status updates in GET requests.
* **Delete (`DELETE /interactions/{id}`):** Removes the interaction records from the server. Subsequent GET requests return a `404 Not Found` error.

### Python

```
from google import genai

client = genai.Client()

# Cancel a running interaction
client.interactions.cancel(id="YOUR_INTERACTION_ID")

# Delete the interaction record entirely
client.interactions.delete(id="YOUR_INTERACTION_ID")
```

### JavaScript

```
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({});

// Cancel a running interaction
await client.interactions.cancel("YOUR_INTERACTION_ID");

// Delete the interaction record entirely
await client.interactions.delete("YOUR_INTERACTION_ID");
```

### Java

```
import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.CreateModelInteractionEnvironment;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.interactions.Model;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.GetInteractionByIdRequest;
import com.google.genai.gaos.models.operations.GetInteractionByIdResponse;

Client client = new Client();

CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model(Model.of("gemini-3.8-flash"))
        .input(InteractionsInput.of("Execute this background task."))
        .background(true)
        .environment(CreateModelInteractionEnvironment.of("remote"))
        .build();

Interaction interaction =
    client.interactions.create(CreateInteractionRequestBody.of(params)).interaction().get();
String interactionId = interaction.id().orElse("");

// Poll status using GetInteractionByIdRequest
GetInteractionByIdResponse getResponse =
    client.interactions.get(new GetInteractionByIdRequest(interactionId));
Interaction polled = getResponse.interaction().get();
System.out.println("Status: " + polled.status().orElse(null));
```

### REST

```
# Cancel the interaction
curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions/YOUR_INTERACTION_ID/cancel" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Api-Revision: 2026-05-20"

# Delete the interaction
curl -X DELETE "https://generativelanguage.googleapis.com/v1beta/interactions/YOUR_INTERACTION_ID" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Api-Revision: 2026-05-20"
```

## Next steps

* Read the [Interactions API overview](/gemini-api/docs/interactions-overview) to understand session and state management.
* See the [Streaming interactions](/gemini-api/docs/streaming) guide for details on real-time event updates.
* Explore the [Managed agents quickstart](/gemini-api/docs/managed-agents-quickstart) to build stateful multi-turn agents.


Send feedback

Except as otherwise noted, the content of this page is licensed under the [Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/), and code samples are licensed under the [Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0). For details, see the [Google Developers Site Policies](https://developers.google.com/site-policies). Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2026-09-04 UTC.


Need to tell us more?

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2026-09-04 UTC."],[],[]]
