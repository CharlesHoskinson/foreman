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

Tool Calls

[Protocol](/get-started/introduction)[RFDs](/rfds/about)[Community](/community/communication)[Publications](/publications)[Updates](/updates)[Brand](/brand)

v1

Tool Calls
==========

Copy page

How Agents report tool call execution

Copy page

Tool calls represent actions that language models request Agents to perform during a [prompt turn](/protocol/v1/prompt-turn). When an LLM determines it needs to interact with external systems—like reading files, running code, or fetching data—it generates tool calls that the Agent executes on its behalf.
Agents report tool calls through [`session/update`](/protocol/v1/prompt-turn#3-agent-reports-output) notifications, allowing Clients to display real-time progress and results to users.
While Agents handle the actual execution, they may leverage Client capabilities like [permission requests](#requesting-permission) or [file system access](/protocol/v1/file-system) to provide a richer, more integrated experience.

Creating
--------

When the language model requests a tool invocation, the Agent **SHOULD** report it to the Client:

toolCallId

ToolCallId

required

A unique identifier for this tool call within the session

title

string

required

A human-readable title describing what the tool is doing

kind

ToolKind

The category of tool being invoked.

Show kinds

* `read` - Reading files or data - `edit` - Modifying files or content -
  `delete` - Removing files or data - `move` - Moving or renaming files -
  `search` - Searching for information - `execute` - Running commands or code -
  `think` - Internal reasoning or planning - `fetch` - Retrieving external data
* `other` - Other tool types (default)

Tool kinds help Clients choose appropriate icons and optimize how they display tool execution progress.

status

ToolCallStatus

The current [execution status](#status) (defaults to `pending`)

content

ToolCallContent[]

[Content produced](#content) by the tool call

locations

ToolCallLocation[]

[File locations](#following-the-agent) affected by this tool call

rawInput

object

The raw input parameters sent to the tool

rawOutput

object

The raw output returned by the tool

Updating
--------

As tools execute, Agents send updates to report progress and results.
Updates use the `session/update` notification with `tool_call_update`:All fields except `toolCallId` are optional in updates. Only the fields being changed need to be included.

Requesting Permission
---------------------

The Agent **MAY** request permission from the user before executing a tool call by calling the `session/request_permission` method:

sessionId

SessionId

required

The session ID for this request

toolCall

ToolCallUpdate

required

The tool call update containing details about the operation

options

PermissionOption[]

required

Available [permission options](#permission-options) for the user to choose
from

The Client responds with the user’s decision:Clients **MAY** automatically allow or reject permission requests according to the user settings.
If the current prompt turn gets [cancelled](/protocol/v1/prompt-turn#cancellation), the Client **MUST** respond with the `"cancelled"` outcome:

outcome

RequestPermissionOutcome

required

The user’s decision, either: - `cancelled` - The [prompt turn was
cancelled](/protocol/v1/prompt-turn#cancellation) - `selected` with an
`optionId` - The ID of the selected permission option

### Permission Options

Each permission option provided to the Client contains:

optionId

string

required

Unique identifier for this option

name

string

required

Human-readable label to display to the user

kind

PermissionOptionKind

required

A hint to help Clients choose appropriate icons and UI treatment for each option.

* `allow_once` - Allow this operation only this time
* `allow_always` - Allow this operation and remember the choice
* `reject_once` - Reject this operation only this time
* `reject_always` - Reject this operation and remember the choice

Status
------

Tool calls progress through different statuses during their lifecycle:

pending

The tool call hasn’t started running yet because the input is either streaming
or awaiting approval

in\_progress

The tool call is currently running

completed

The tool call completed successfully

failed

The tool call failed with an error

Content
-------

Tool calls can produce different types of content:

### Regular Content

Standard [content blocks](/protocol/v1/content) like text, images, or resources:

### Diffs

File modifications shown as diffs:

path

string

required

The absolute file path being modified

oldText

string

The original content (null for new files)

newText

string

required

The new content after modification

### Terminals

Live terminal output from command execution:

terminalId

string

required

The ID of a terminal created with `terminal/create`

When a terminal is embedded in a tool call, the Client displays live output as it’s generated and continues to display it even after the terminal is released.

Learn more about Terminals

Following the Agent
-------------------

Tool calls can report file locations they’re working with, enabling Clients to implement “follow-along” features that track which files the Agent is accessing or modifying in real-time.

path

string

required

The absolute file path being accessed or modified

line

number

Optional line number within the file

Was this page helpful?

YesNo

[Previous](/protocol/v1/content)[Elicitation

Requesting structured information from users

Next](/protocol/v1/elicitation)

[github](https://github.com/agentclientprotocol/agent-client-protocol)

[Powered byThis documentation is built and hosted on Mintlify, a developer documentation platform](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=zed-685ed6d6)