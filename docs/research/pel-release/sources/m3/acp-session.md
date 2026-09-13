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

Session Setup

[Protocol](/get-started/introduction)[RFDs](/rfds/about)[Community](/community/communication)[Publications](/publications)[Updates](/updates)[Brand](/brand)

v1

Session Setup
=============

Copy page

Creating and loading sessions

Copy page

Sessions represent a specific conversation or thread between the [Client](/protocol/v1/overview#client) and [Agent](/protocol/v1/overview#agent). Each session maintains its own context, conversation history, and state, allowing multiple independent interactions with the same Agent.
Before creating a session, Clients **MUST** first complete the [initialization](/protocol/v1/initialization) phase to establish protocol compatibility and capabilities.
  
  

Creating a Session
------------------

Clients create a new session by calling the `session/new` method with:

* The [working directory](#working-directory) for the session
* A list of [MCP servers](#mcp-servers) the Agent should connect to

The Agent **MUST** respond with a unique [Session ID](#session-id) that identifies this conversation:

Loading Sessions
----------------

Agents that support the `loadSession` capability allow Clients to resume previous conversations. This feature enables persistence across restarts and sharing sessions between different Client instances.

### Checking Support

Before attempting to load a session, Clients **MUST** verify that the Agent supports this capability by checking the `loadSession` field in the `initialize` response:If `loadSession` is `false` or not present, the Agent does not support loading sessions and Clients **MUST NOT** attempt to call `session/load`.

### Loading a Session

To load an existing session, Clients **MUST** call the `session/load` method with:

* The [Session ID](#session-id) to resume
* [MCP servers](#mcp-servers) to connect to
* The [working directory](#working-directory)

The Agent **MUST** replay the entire conversation to the Client in the form of `session/update` notifications (like `session/prompt`).
For example, a user message from the conversation history:Followed by the agent’s response:If the Agent provides message IDs during replay, each `messageId` is an opaque, unique identifier for the replayed message.
When **all** the conversation entries have been streamed to the Client, the Agent **MUST** respond to the original `session/load` request.The Client can then continue sending prompts as if the session was never interrupted.

Resuming Sessions
-----------------

Agents that advertise `sessionCapabilities.resume` allow Clients to reconnect to an existing session without replaying the conversation history.

### Checking Support

Before attempting to resume a session, Clients **MUST** verify that the Agent supports this capability by checking for the `sessionCapabilities.resume` field in the `initialize` response:If `sessionCapabilities.resume` is not present, the Agent does not support resuming sessions and Clients **MUST NOT** attempt to call `session/resume`.

### Resuming a Session

To resume an existing session without replaying prior messages, Clients **MUST** call the `session/resume` method with:

* The [Session ID](#session-id) to resume
* [MCP servers](#mcp-servers) to connect to
* The [working directory](#working-directory)

Unlike `session/load`, the Agent **MUST NOT** replay the conversation history via `session/update` notifications before responding. Instead, it restores the session context, reconnects to the requested MCP servers, and returns once the session is ready to continue.The response **MAY** also include initial mode, model, or session configuration state when those features are supported by the Agent.

Closing Active Sessions
-----------------------

Agents that advertise `sessionCapabilities.close` allow Clients to tell the Agent to cancel any ongoing work for a session and free any resources associated with that active session.

### Checking Support

Before attempting to close a session, Clients **MUST** verify that the Agent supports this capability by checking the `sessionCapabilities.close` field in the `initialize` response:If `sessionCapabilities.close` is not present, the Agent does not support closing sessions and Clients **MUST NOT** attempt to call `session/close`.

### Closing a Session

To close an active session, Clients **MUST** call the `session/close` method with the session ID:

sessionId

SessionId

required

The ID of the active session to close.

The Agent **MUST** cancel any ongoing work for that session as if [`session/cancel`](/protocol/v1/prompt-turn#cancellation) had been called, then free the resources associated with the session.
On success, the Agent responds with an empty result object:Agents MAY return an error if the session does not exist or is not currently active.

Additional Workspace Roots
--------------------------

Agents that advertise `sessionCapabilities.additionalDirectories` allow Clients
to include `additionalDirectories` on supported session lifecycle requests to
expand the session’s effective filesystem root set. Supported stable lifecycle
requests include `session/new`, `session/load`, and `session/resume`.When present, `additionalDirectories` has the following behavior:

* `cwd` remains the primary working directory and the base for relative paths
* each `additionalDirectories` entry **MUST** be an absolute path
* omitting the field or providing an empty array activates no additional roots for the resulting session
* on `session/load` and `session/resume`, Clients must send the full intended additional-root list again; that list may differ from any previous or reported list as long as the request `cwd` matches the session’s `cwd`, and omitting the field or providing an empty array does not restore stored roots implicitly

Clients **MUST** only send `additionalDirectories` when the Agent advertises `sessionCapabilities.additionalDirectories`.

Session ID
----------

The session ID returned by `session/new` is a unique identifier for the conversation context.
Clients use this ID to:

* Send prompt requests via `session/prompt`
* Cancel ongoing operations via `session/cancel`
* Load previous sessions via `session/load` (if the Agent supports the `loadSession` capability)
* Resume previous sessions via `session/resume` (if the Agent supports the `sessionCapabilities.resume` capability)
* Close active sessions via `session/close` (if the Agent supports the `sessionCapabilities.close` capability)

Working Directory
-----------------

The `cwd` (current working directory) parameter establishes the primary file system context for the session. This directory:

* **MUST** be an absolute path
* **MUST** be used for the session regardless of where the Agent subprocess was spawned
* **MUST** remain the base for relative-path resolution
* **MUST** be part of the session’s effective root set

When `sessionCapabilities.additionalDirectories` is in use, the session’s effective root set is `[cwd, ...additionalDirectories]`. This root set **SHOULD** serve as a boundary for tool operations on the file system.

MCP Servers
-----------

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io) allows Agents to access external tools and data sources. When creating a session, Clients **MAY** include connection details for MCP servers that the Agent should connect to.
MCP servers can be connected to using different transports. All Agents **MUST** support the stdio transport, while HTTP and SSE transports are optional capabilities that can be checked during initialization.
While they are not required to by the spec, new Agents **SHOULD** support the HTTP transport to ensure compatibility with modern MCP servers.

### Transport Types

#### Stdio Transport

All Agents **MUST** support connecting to MCP servers via stdio (standard input/output). This is the default transport mechanism.

name

string

required

A human-readable identifier for the server

command

string

required

The absolute path to the MCP server executable

args

array

required

Command-line arguments to pass to the server

env

EnvVariable[]

Environment variables to set when launching the server

Show EnvVariable

name

string

The name of the environment variable.

value

string

The value of the environment variable.

Example stdio transport configuration:

#### HTTP Transport

When the Agent supports `mcpCapabilities.http`, Clients can specify MCP servers configurations using the HTTP transport.

type

string

required

Must be `"http"` to indicate HTTP transport

name

string

required

A human-readable identifier for the server

url

string

required

The URL of the MCP server

headers

HttpHeader[]

required

HTTP headers to include in requests to the server

Show HttpHeader

name

string

The name of the HTTP header.

value

string

The value to set for the HTTP header.

Example HTTP transport configuration:

#### SSE Transport

When the Agent supports `mcpCapabilities.sse`, Clients can specify MCP servers configurations using the SSE transport.

This transport was deprecated by the MCP spec.

type

string

required

Must be `"sse"` to indicate SSE transport

name

string

required

A human-readable identifier for the server

url

string

required

The URL of the SSE endpoint

headers

HttpHeader[]

required

HTTP headers to include when establishing the SSE connection

Show HttpHeader

name

string

The name of the HTTP header.

value

string

The value to set for the HTTP header.

Example SSE transport configuration:

### Checking Transport Support

Before using HTTP or SSE transports, Clients **MUST** verify the Agent’s capabilities during initialization:If `mcpCapabilities.http` is `false` or not present, the Agent does not support HTTP transport.
If `mcpCapabilities.sse` is `false` or not present, the Agent does not support SSE transport.
Agents **SHOULD** connect to all MCP servers specified by the Client.
Clients **MAY** use this ability to provide tools directly to the underlying language model by including their own MCP server.

Was this page helpful?

YesNo

[Previous](/protocol/v1/authentication)[Session List

Discovering existing sessions

Next](/protocol/v1/session-list)

[github](https://github.com/agentclientprotocol/agent-client-protocol)

[Powered byThis documentation is built and hosted on Mintlify, a developer documentation platform](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=zed-685ed6d6)