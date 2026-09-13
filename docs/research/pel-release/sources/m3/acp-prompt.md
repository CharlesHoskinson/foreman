[Skip to main content](#content-area)

* [GitHub](https://github.com/agentclientprotocol/agent-client-protocol)
* [Zed Industries](https://zed.dev)
* [JetBrains](https://jetbrains.com)

[Protocol](/get-started/introduction)[RFDs](/rfds/about)[Community](/community/communication)[Publications](/publications)[Updates](/updates)[Brand](/brand)

[Agent Client Protocol home page![light logo](https://mintcdn.com/zed-685ed6d6/ZwvtxaoaZwBJrK5s/logo/light.svg?fit=max&auto=format&n=ZwvtxaoaZwBJrK5s&q=85&s=0c3a91b5b58329f66ffe53c9d5b300a2)![dark logo](https://mintcdn.com/zed-685ed6d6/ZwvtxaoaZwBJrK5s/logo/dark.svg?fit=max&auto=format&n=ZwvtxaoaZwBJrK5s&q=85&s=99cc8d69910f89294f950a22e9dfc988)](/)

Search...

⌘K

* [GitHub](https://github.com/agentclientprotocol/agent-client-protocol)
* [Zed Industries](https://zed.dev)
* [JetBrains](https://jetbrains.com)

Search...

Navigation

v1

Prompt Turn

[Protocol](/get-started/introduction)[RFDs](/rfds/about)[Community](/community/communication)[Publications](/publications)[Updates](/updates)[Brand](/brand)

v1

Prompt Turn
===========

Copy page

Understanding the core conversation flow

Copy page

A prompt turn represents a complete interaction cycle between the [Client](/protocol/v1/overview#client) and [Agent](/protocol/v1/overview#agent), starting with a user message and continuing until the Agent completes its response. This may involve multiple exchanges with the language model and tool invocations.
Before sending prompts, Clients **MUST** first complete the [initialization](/protocol/v1/initialization) phase and [session setup](/protocol/v1/session-setup).

The Prompt Turn Lifecycle
-------------------------

A prompt turn follows a structured flow that enables rich interactions between the user, Agent, and any connected tools.
  

### 1. User Message

The turn begins when the Client sends a `session/prompt`:

sessionId

SessionId

The [ID](/protocol/v1/session-setup#session-id) of the session to send this message to.

prompt

ContentBlock[]

The contents of the user message, e.g. text, images, files, etc.Clients **MUST** restrict types of content according to the [Prompt Capabilities](/protocol/v1/initialization#prompt-capabilities) established during [initialization](/protocol/v1/initialization).

Learn more about Content

### 2. Agent Processing

Upon receiving the prompt request, the Agent processes the user’s message and sends it to the language model, which **MAY** respond with text content, tool calls, or both.

### 3. Agent Reports Output

The Agent reports the model’s output to the Client via `session/update` notifications. This may include the Agent’s plan for accomplishing the task:

See all 32 lines

Learn more about Agent Plans

The Agent then reports text responses from the model:

#### Message IDs

The Agent **MAY** include an opaque, unique `messageId` on message chunks. Chunks with the same `messageId` belong to the same message; a changed `messageId` indicates a new message.
If the model requested tool calls, these are also reported immediately:

#### Session Usage Updates

The Agent **MAY** also report current session context and cumulative cost state with a `usage_update`:`used` and `size` are required and non-null token counts for the current session context. `cost` is optional and, if present, `amount` and `currency` are required. `currency` is an ISO 4217 currency code like `"USD"`.

### 4. Check for Completion

If there are no pending tool calls, the turn ends and the Agent **MUST** respond to the original `session/prompt` request with a `StopReason`:Agents **MAY** stop the turn at any point by returning the corresponding [`StopReason`](#stop-reasons).

### 5. Tool Invocation and Status Reporting

Before proceeding with execution, the Agent **MAY** request permission from the Client via the `session/request_permission` method.
Once permission is granted (if required), the Agent **SHOULD** invoke the tool and report a status update marking the tool as `in_progress`:As the tool runs, the Agent **MAY** send additional updates, providing real-time feedback about tool execution progress.
While tools execute on the Agent, they **MAY** leverage Client capabilities such as the file system (`fs`) methods to access resources within the Client’s environment.
When the tool completes, the Agent sends another update with the final status and any content:

Learn more about Tool Calls

### 6. Continue Conversation

The Agent sends the tool results back to the language model as another request.
The cycle returns to [step 2](#2-agent-processing), continuing until the language model completes its response without requesting additional tool calls or the turn gets stopped by the Agent or cancelled by the Client.

Stop Reasons
------------

When an Agent stops a turn, it must specify the corresponding `StopReason`:

end\_turn

The language model finishes responding without requesting more tools

max\_tokens

The maximum token limit is reached

max\_turn\_requests

The maximum number of model requests in a single turn is exceeded

refusal

The Agent refuses to continue

cancelled

The Client cancels the turn

Cancellation
------------

Clients **MAY** cancel an ongoing prompt turn at any time by sending a `session/cancel` notification:The Client **SHOULD** preemptively mark all non-finished tool calls pertaining to the current turn as `cancelled` as soon as it sends the `session/cancel` notification.
The Client **MUST** respond to all pending `session/request_permission` requests with the `cancelled` outcome.
When the Agent receives this notification, it **SHOULD** stop all language model requests and all tool call invocations as soon as possible.
After all ongoing operations have been successfully aborted and pending updates have been sent, the Agent **MUST** respond to the original `session/prompt` request with the `cancelled` [stop reason](#stop-reasons).

API client libraries and tools often throw an exception when their operation is aborted, which may propagate as an error response to `session/prompt`.Clients often display unrecognized errors from the Agent to the user, which would be undesirable for cancellations as they aren’t considered errors.Agents **MUST** catch these errors and return the semantically meaningful `cancelled` stop reason, so that Clients can reliably confirm the cancellation.

The Agent **MAY** send `session/update` notifications with content or tool call updates after receiving the `session/cancel` notification, but it **MUST** ensure that it does so before responding to the `session/prompt` request.
The Client **SHOULD** still accept tool call updates received after sending `session/cancel`.


---

Once a prompt turn completes, the Client may send another `session/prompt` to continue the conversation, building on the context established in previous turns.

Was this page helpful?

YesNo

[Previous](/protocol/v1/session-delete)[Content

Understanding content blocks in the Agent Client Protocol

Next](/protocol/v1/content)

[github](https://github.com/agentclientprotocol/agent-client-protocol)

[Powered byThis documentation is built and hosted on Mintlify, a developer documentation platform](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=zed-685ed6d6)