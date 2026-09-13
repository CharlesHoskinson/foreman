[Skip to main content](#content-area)

[Claude Code Docs home page![light logo](https://mintcdn.com/claude-code/c5r9_6tjPMzFdDDT/logo/light.svg?fit=max&auto=format&n=c5r9_6tjPMzFdDDT&q=85&s=78fd01ff4f4340295a4f66e2ea54903c)![dark logo](https://mintcdn.com/claude-code/c5r9_6tjPMzFdDDT/logo/dark.svg?fit=max&auto=format&n=c5r9_6tjPMzFdDDT&q=85&s=1298a0c3b3a1da603b190d0de0e31712)](/docs/en/overview)

English

Search...

⌘KAsk Assistant⌘I

* [Claude Developer Platform](https://platform.claude.com/)
* [Claude Code on the Web](https://claude.ai/code)
* [Claude Code on the Web](https://claude.ai/code)

Search...

Navigation

SDK references

Agent SDK reference - TypeScript

[Getting started](/docs/en/overview)[Build with Claude Code](/docs/en/agents)[Administration](/docs/en/admin-setup)[Configuration](/docs/en/settings)[Reference](/docs/en/cli-reference)[Agent SDK](/docs/en/agent-sdk/overview)[What's New](/docs/en/whats-new)[Resources](/docs/en/legal-and-compliance)

SDK references

Agent SDK reference - TypeScript
================================

Copy page

Complete API reference for the TypeScript Agent SDK, including all functions, types, and interfaces.

Copy page

Installation
------------

The SDK bundles a native Claude Code binary for your platform as an optional dependency such as `@anthropic-ai/claude-agent-sdk-darwin-arm64`. Most installs need no separate Claude Code install. The SDK version tracks the bundled Claude Code version. SDK v0.3.191 bundles Claude Code v2.1.191, so a feature on this page that requires a Claude Code version needs the SDK release with the same patch number or later. If your package manager skips optional dependencies, the SDK throws `Native CLI binary for <platform>-<arch> not found`; set [`pathToClaudeCodeExecutable`](#options) to a separately installed `claude` binary instead.If your package manager doesn’t apply npm’s `libc` field, as Yarn 1.x doesn’t, you get both the glibc and musl platform packages on Linux, roughly doubling the install size. On Agent SDK v0.2.141 or later, the SDK still launches the correct variant. To reclaim the space in a container image, delete the platform package that doesn’t match the libc where your app runs; for a glibc runtime on x64, that’s `rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl`. On a development machine the deletion is temporary, since Yarn reinstalls the package on the next dependency change.

### Compile to a single executable

When you compile your application into a single-file executable with `bun build --compile`, the SDK cannot resolve the bundled CLI binary at runtime. `require.resolve` does not work inside the compiled executable’s `$bunfs` virtual filesystem, so the SDK throws `Native CLI binary for <platform>-<arch> not found`.
To work around this, embed the platform binary as a file asset, extract it to a real path at startup with `extractFromBunfs()`, and pass that path to [`pathToClaudeCodeExecutable`](#options).
The `extractFromBunfs()` helper requires `@anthropic-ai/claude-agent-sdk` v0.3.144 or later. The example below builds for macOS on Apple Silicon:`extractFromBunfs()` copies the embedded binary out of the compiled executable’s virtual filesystem to a per-user temp directory and returns the real path. Outside a compiled executable it returns the input path unchanged, so the same code runs in development without modification.
Each compiled executable embeds a single platform’s binary. Match the platform package in the import to your `--target`:

* To cross-compile, install the non-matching platform package, for example `npm install @anthropic-ai/claude-agent-sdk-linux-x64 --force`.
* On Windows, the binary subpath is `claude.exe`, for example `@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`.

Functions
---------

### `query()`

The primary function for interacting with Claude Code. Creates an async generator that streams messages as they arrive.

#### Parameters

#### Returns

Returns a [`Query`](#query-object) object that extends `AsyncGenerator<`[`SDKMessage`](#sdkmessage)`, void>` with additional methods.

### `startup()`

Pre-warms the CLI subprocess by spawning it and completing the initialize handshake before a prompt is available. The returned [`WarmQuery`](#warmquery) handle accepts a prompt later and writes it to an already-ready process, so the first `query()` call resolves without paying subprocess spawn and initialization cost inline.

#### Parameters

#### Returns

Returns a `Promise<`[`WarmQuery`](#warmquery)`>` that resolves once the subprocess has spawned and completed its initialize handshake.

#### Example

Call `startup()` early, for example on application boot, then call `.query()` on the returned handle once a prompt is ready. This moves subprocess spawn and initialization out of the critical path.

### `tool()`

Creates a type-safe MCP tool definition for use with SDK MCP servers.

#### Parameters

#### `ToolAnnotations`

Re-exported from `@modelcontextprotocol/sdk/types.js`. All fields are optional hints; clients should not rely on them for security decisions.

### `createSdkMcpServer()`

Creates an MCP server instance that runs in the same process as your application.

#### Parameters

### `listSessions()`

Discovers and lists past sessions with light metadata. Filter by project directory or list sessions across all projects.

#### Parameters

#### Return type: `SDKSessionInfo`

#### Example

Print the 10 most recent sessions for a project. Results are sorted by `lastModified` descending, so the first item is the newest. Omit `dir` to search across all projects.

### `getSessionMessages()`

Reads user and assistant messages from a past session transcript.

#### Parameters

#### Return type: `SessionMessage`

#### Example

### `getSessionInfo()`

Reads metadata for a single session by ID without scanning the full project directory.

#### Parameters

Returns [`SDKSessionInfo`](#return-type-sdksessioninfo), or `undefined` if the session is not found.

### `renameSession()`

Renames a session by appending a custom-title entry. Repeated calls are safe; the most recent title wins.

#### Parameters

### `tagSession()`

Tags a session. Pass `null` to clear the tag. Repeated calls are safe; the most recent tag wins.

#### Parameters

### `resolveSettings()`

Resolves the effective Claude Code settings for a given directory using the same merge engine as the CLI, without spawning the Claude CLI. Use it to inspect what configuration a `query()` call would see before invoking one.

This function is alpha and its API may change before stabilization.

The snapshot differs from what a live `query()` session applies:

* **`policyHelper`**: `resolveSettings()` reads MDM sources, including macOS plist and Windows HKLM/HKCU, but doesn’t execute the admin-configured `policyHelper` subprocess.
* **Server-managed settings**: `resolveSettings()` doesn’t fetch [server-managed settings](/docs/en/server-managed-settings#fetch-and-caching-behavior). Pass them as `options.serverManagedSettings` to include them.
* **`defaultMode`**: the snapshot returns `permissions.defaultMode` as-is from every tier, so it can include the `'auto'` and `'bypassPermissions'` values from project and local settings, which [a live session ignores](/docs/en/permission-modes#which-mode-a-session-starts-in).

#### Parameters

`resolveSettings()` accepts a single options object. All fields are optional.

#### Return type: `ResolvedSettings`

`resolveSettings()` returns an object describing the merged settings and the source that contributed each key.

#### Example

The example below resolves settings for a project directory and prints the source that controls the cleanup period. On a machine where no settings file sets `cleanupPeriodDays`, both printed lines show `undefined` for the value, which is the expected output rather than an error.

Types
-----

### `Options`

Configuration object for the `query()` function.

#### Handle slow or stalled API responses

The CLI subprocess reads several environment variables that control API timeouts and stall detection. Pass them through the `env` option:

* `API_TIMEOUT_MS`: per-request timeout on the Anthropic client, in milliseconds. Default `600000`. Applies to the main loop and all subagents.
* `CLAUDE_CODE_MAX_RETRIES`: maximum API retries. Default `10`, capped at `15`. Each retry gets its own `API_TIMEOUT_MS` window, so worst-case wall time is roughly `API_TIMEOUT_MS × (CLAUDE_CODE_MAX_RETRIES + 1)` plus backoff. For unattended runs that need to wait through longer outages, set [`CLAUDE_CODE_RETRY_WATCHDOG=1`](/docs/en/errors#tune-retry-behavior): it retries transient capacity errors indefinitely and, on Claude Code v2.1.199 or later, raises the default for other transient errors to `300` and removes the cap on this variable.
* `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`: stall watchdog for subagents. While the stream watchdog is on, the default is `CLAUDE_STREAM_IDLE_TIMEOUT_MS` plus 5 minutes, which comes to `600000` unless you raise that variable. With the stream watchdog off, the default is `600000`. Before v2.1.257, the default was always `600000`.
  The timer resets on each stream event. On a stall, Claude Code aborts the subagent and reports the stall to the parent. For a background subagent, it also marks the task failed and attaches any partial result.
* `CLAUDE_ENABLE_STREAM_WATCHDOG` with `CLAUDE_STREAM_IDLE_TIMEOUT_MS`: stream watchdog that aborts the request when headers have arrived but the response body stops streaming. The watchdog is on by default for all providers; set `CLAUDE_ENABLE_STREAM_WATCHDOG=0` to disable it. `CLAUDE_STREAM_IDLE_TIMEOUT_MS` defaults to `300000` and is clamped to that minimum. After the abort, [Automatic retries](/docs/en/errors#automatic-retries) covers what Claude Code does, based on how far the response had progressed.
  While the watchdog waits out a response that a gateway behind `ANTHROPIC_BASE_URL` holds open with keep-alive pings, a host that sets `includePartialMessages` keeps receiving `ping` [stream events](#sdkpartialassistantmessage), so read those frames as liveness rather than timing the session out on silence. Before v2.1.257, the frames stopped 5 minutes after the last real stream event.

### `Query` object

Interface returned by the `query()` function.

#### Methods

#### `applyFlagSettings()`

Changes [settings](/docs/en/settings) on a running session without restarting the query. Use it when a setting that has no dedicated setter needs to change mid-session, such as tightening `permissions` after the agent reads untrusted input. `setModel()` and `setPermissionMode()` are dedicated setters for those two keys; `applyFlagSettings()` is the general form that accepts any subset of the settings keys, and passing `model` here behaves the same as `setModel()`.
Only some keys take effect mid-session:

* **Applied on the next turn**: `effortLevel`, `ultracode`, `permissions`, `hooks`, `skillOverrides`, `fastMode`, `agent`. Switching `agent` also applies that agent’s model override and hooks on the next turn. Its system prompt applies on the next turn, or, in a session that [reuses a recorded system prompt](/docs/en/agent-sdk/modifying-system-prompts#change-the-prompt-of-an-existing-session), once the session is compacted.
* **Applied during the current turn**: `model`. If you switch `model` while Claude is working on a turn, the response Claude is already generating finishes on the old model, and the rest of the turn, starting with the next call Claude Code makes to the model, uses the new one. Subagents keep their own model. Before v2.1.212, a mid-turn switch waited for the next turn.
* **No effect mid-session**: the system prompt options. These are resolved once at startup, so the running session keeps the original value even though the call succeeds. To change them, start a new session.

`effortLevel` accepts an [effort level](/docs/en/model-config#adjust-effort-level) name. It also accepts `"ultracode"`, which requests `xhigh` effort with [ultracode](/docs/en/workflows#let-claude-decide-with-ultracode) on. `applyFlagSettings()` declares `effortLevel` without that value, so pass the equivalent `{ ultracode: true }` in TypeScript. The `ultracode` value requires Claude Code v2.1.203 or later and is accepted only by `applyFlagSettings()`, not by the `effortLevel` key in a settings file.
The values are written to the flag-settings layer, the same layer the inline `settings` option of `query()` populates at startup. This is the same tier the [on-page precedence section](#settings-precedence) calls programmatic options.
Successive calls shallow-merge top-level keys. A second call with `{ permissions: {...} }` replaces the entire `permissions` object from the prior call rather than deep-merging into it. To clear a key from the flag layer and fall back to lower-precedence sources, pass `null` for that key. Passing `undefined` has no effect because JSON serialization drops it.
Only available in streaming input mode, the same constraint as `setModel()` and `setPermissionMode()`.
The example below switches the active model mid-session, then clears the override so the model falls back to whatever the user or project settings specify.

`applyFlagSettings()` is TypeScript-only. The Python SDK does not expose an equivalent method.

### `WarmQuery`

Handle returned by [`startup()`](#startup). The subprocess is already spawned and initialized, so calling `query()` on this handle writes the prompt directly to a ready process with no startup latency.

#### Methods

`WarmQuery` implements `AsyncDisposable`, so it can be used with `await using` for automatic cleanup.

### `SDKControlInitializeResponse`

Return type of `initializationResult()`. Contains session initialization data.`hooks_applied` reports whether Claude Code registered the `hooks` that the `initialize` request carried. The SDK sends that request once when the session starts and again on each [`reinitialize()`](#query-object) call. The field requires Agent SDK v0.3.238 or later.
Claude Code omits the field when the request carried no hooks. When the request carried hooks, the value depends on whether the request is the session’s first initialize and, for a repeated one, on how it reached the session:

* `true`: Claude Code registered the hooks. A session’s first initialize returns this value. A repeated initialize sent over the CLI’s stdin also returns `true`. In that case the hooks in the new request replace the hooks registered earlier.
* `false`: Claude Code ignored the hooks. A repeated initialize sent to a remote session returns this value, so a second client that joins a session can’t replace the hooks the first client registered.

Before Agent SDK v0.3.238, the response never carried the field, and Claude Code ignored `hooks` on every repeated initialize.
The response always reports `fast_mode_state`, and when something blocks [fast mode](/docs/en/fast-mode), `fast_mode_disabled_reason` carries the reason code alongside it, so you can explain the blocked state instead of re-deriving availability. Both behaviors require Claude Code v2.1.219 or later. Before v2.1.219, the response omitted `fast_mode_state` when fast mode wasn’t available and never carried a reason. For the reason codes and their meanings, see [`fast_mode_disabled_reason`](#sdkresultmessage) on the result message.
The control-response wrapper for a successful `initialize` also carries a `pending_permission_requests` array. The field is on the response wrapper itself, not in the `SDKControlInitializeResponse` payload above. Each entry is a complete `control_request` message with the same `{ type: "control_request", request_id, request }` shape the session streams for permission requests while running.
The array lists the permission requests that this Claude Code process has issued and not yet resolved. The SDK reads the array for you and dispatches each entry to your [`canUseTool`](#canusetool) callback, the same redelivery that [`reinitialize()`](#query-object) triggers after a transport gap. Handle repeated request IDs idempotently, because an entry can repeat a request the callback already received before the connection dropped.
The array is always present on a successful `initialize` response and is empty when this process has no unresolved permission request. Requires Claude Code v2.1.268 or later. Earlier versions could omit the field, so if you parse the wire protocol yourself, treat a missing field as an older CLI rather than as proof that nothing is pending.

### `SDKControlInterruptResponse`

The interrupt receipt: the value [`interrupt()`](#query-object) resolves with on a CLI that advertises the `interrupt_receipt_v1` capability in [`SDKSystemMessage.capabilities`](#sdksystemmessage). Requires Claude Code v2.1.205 or later. Earlier CLIs answer the interrupt with an empty success payload, so `interrupt()` resolves to `undefined`.`still_queued` lists the UUIDs of the user messages that were pending when the interrupt arrived: messages still in the queue, plus any messages Claude Code had already taken off the queue for the next turn. Once the session’s first turn has started, Claude Code processes the listed messages after the interrupt unless you cancel them first, and can merge several into one turn. If you interrupt before the first turn starts, Claude Code aborts that turn as soon as it starts, and the listed messages in that turn get no response.
Use the receipt to decide whether to resend anything. A listed message that you don’t cancel enters the conversation whether or not it gets a response, so resending it delivers it to Claude twice.
Interpret the list with these caveats:

* Only messages that were enqueued with a UUID appear. An empty array doesn’t mean nothing else will run.
* Only main-thread messages are listed. Messages addressed to a subagent are out of scope.
* The list can include UUIDs your client never sent, such as [scheduled task](/docs/en/scheduled-tasks) triggers. Ignore UUIDs you don’t recognize instead of treating them as an error.

A client that drives the CLI’s control protocol directly, rather than through `interrupt()`, can set `cancel_queued: true` on the `interrupt` control request. Claude Code v2.1.219 and later advertises support with the `interrupt_cancel_queued_v1` capability in [`SDKSystemMessage.capabilities`](#sdksystemmessage); older CLIs ignore the field and leave queued messages to run as usual. Such an interrupt also cancels every message that would otherwise be listed under `still_queued`: the receipt lists them under `cancelled` instead, `still_queued` is empty, and none of them run.
The `cancelled` list carries the same caveats as `still_queued`. The `interrupt()` method never sends `cancel_queued`, so receipts it resolves with don’t carry `cancelled`.
The receipt is a snapshot taken at the moment the interrupt is processed, and on a clean interrupt it arrives before the interrupted turn’s [`SDKResultMessage`](#sdkresultmessage). Read the receipt rather than inspecting the queue after that result: the loop starts the next queued turn immediately, so the queue you inspect after the result has already changed.

### `SDKControlGetContextUsageResponse`

Return type of [`getContextUsage()`](#query-object). With the default `detail`, this is the same payload Claude Code renders for the `/context` command in an interactive session, so alongside the token counts it carries display fields such as `color` and `gridRows` that Claude Code uses to draw the `/context` usage grid.
The method’s optional `detail` argument chooses how Claude Code counts each category. With the default, `'full'`, Claude Code counts each category with token-counting API requests. Pass `{ detail: 'summary' }` to get an answer from the last response’s usage and local estimates instead. No token-count requests go out, and the per-category numbers are approximate. The `detail` argument requires Agent SDK v0.3.257 or later.
When you send `/context` as a prompt instead of calling the method, Claude Code attaches an [`SDKContextUsage`](#sdkcontextusage) payload to the `context_usage` field of the assistant message that delivers the result. That field requires Agent SDK v0.3.232 or later.Read token attribution from the collection fields:

* `categories` holds the per-category totals.
* `mcpTools` and `agents` attribute tokens to individual MCP tools and subagents.
* `memoryFiles` lists each loaded memory file with its cost.
* `skills.skillFrontmatter` attributes the skill listing’s tokens to each included skill. The per-skill counts measure each skill’s listing entry as Claude Code actually sends it, which can be shorter than the skill’s full frontmatter. Compare `skills.totalSkills` with `skills.includedSkills` to see whether every discovered skill made it into the listing.

`totalTokens` is the session’s current context usage, and `maxTokens` is the window that usage is measured against. That window is the model’s context window, or the lower auto-compaction window when one applies. `rawMaxTokens` carries the same value as `maxTokens`, and `percentage` is `totalTokens` as a rounded percentage of that window.
Claude Code leaves the optional `deferredBuiltinTools`, `systemTools`, and `systemPromptSections` diagnostics unset, so expect them to be absent even though the type declares them.

### `SDKControlReadFileResponse`

Return type of [`readFile()`](#query-object).`contents` holds the file text, or base64 data when you requested `encoding: 'base64'`; the response’s `encoding` field is set to `'base64'` in that case. `absPath` is the resolved absolute path. `truncated` is set when the file was longer than the `maxBytes` cap and the contents were cut at that limit.

#### What `readFile()` can read

`readFile()` serves a narrower set of files than the Read tool:

* A regular file inside one of the session’s working directories, such as `cwd` and `additionalDirectories`
* A few of Claude Code’s own files for the session, such as tool results

`Read` deny and ask rules still block a matching path, and a broad `Read` allow rule doesn’t open the rest of the filesystem to `readFile()`. For anything else the call resolves with `null`.

### `SDKControlReloadSkillsResponse`

Return type of [`reloadSkills()`](#query-object).`skills` lists the skills available after the reload, in the same [`SlashCommand`](#slashcommand) shape that `supportedCommands()` returns.

### `AgentDefinition`

Configuration for a subagent defined programmatically.

### `AgentMcpServerSpec`

Specifies MCP servers available to a subagent. Can be a server name (string referencing a server from the parent’s `mcpServers` config) or an inline server configuration record mapping server names to configs.Where `McpServerConfigForProcessTransport` is `McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfig`.

### `SettingSource`

Controls which filesystem-based configuration sources the SDK loads settings from.

#### Default behavior

When `settingSources` is omitted or `undefined`, `query()` loads the same filesystem settings as the Claude Code CLI: user, project, and local. See [What settingSources does not control](/docs/en/agent-sdk/claude-code-features#what-settingsources-does-not-control) for inputs that are read regardless of this option, and how to disable them.

#### Why use settingSources

**Disable filesystem settings:****Load only specific setting sources:**To load CLAUDE.md project instructions, include `"project"` in `settingSources`. See [Modify system prompts](/docs/en/agent-sdk/modifying-system-prompts#claude-md-files-for-project-level-instructions) for how CLAUDE.md loading interacts with the system prompt options.

#### Settings precedence

When multiple sources are loaded, settings are merged with this precedence (highest to lowest):

1. Local settings (`.claude/settings.local.json`)
2. Project settings (`.claude/settings.json`)
3. User settings (`~/.claude/settings.json`)

Programmatic options such as `agents`, `allowedTools`, and `settings` override user, project, and local filesystem settings. Managed policy settings take precedence over programmatic options.

### `PermissionMode`

### `CanUseTool`

Custom permission function type for controlling tool usage.
The function is the SDK replacement for the interactive permission prompt: it’s invoked only when the [permission evaluation flow](/docs/en/agent-sdk/permissions#how-permissions-are-evaluated) resolves to a prompt. Tool calls already approved by an `allowedTools` entry, a settings allow rule, or the permission mode, such as `acceptEdits` or `bypassPermissions`, never invoke it. To gate every tool call, use a [`PreToolUse` hook](/docs/en/agent-sdk/hooks) instead.
An allow rule doesn’t pre-approve the [actions no mode auto-approves](/docs/en/permission-modes#actions-no-mode-auto-approves); see [How permissions are evaluated](/docs/en/agent-sdk/permissions#how-permissions-are-evaluated) for which of them reach the callback and what happens in `dontAsk` and `auto` mode.The callback normally resolves the request by returning a [`PermissionResult`](#permissionresult), which the SDK writes back over its transport as the `control_response`. Return `null` only when your application has already sent the `control_response` for this request over its own channel, echoing `requestId`; the SDK then skips writing the response to its transport. Returning `null` in any other case leaves the tool call blocked indefinitely, because no `control_response` is ever sent and permission prompts don’t time out.
The `requestId` option and the `null` return value require Claude Code v2.1.199 or later.

### `PermissionResult`

Result of a permission check.

### `ToolConfig`

Configuration for built-in tool behavior.

### `McpServerConfig`

Configuration for MCP servers.

#### `McpStdioServerConfig`

#### `McpSSEServerConfig`

#### `McpHttpServerConfig`

#### `McpSdkServerConfigWithInstance`

#### `McpClaudeAIProxyServerConfig`

### `SdkPluginConfig`

Configuration for loading plugins in the SDK.**Example:**For complete information on creating and using plugins, see [Plugins](/docs/en/agent-sdk/plugins).

Message Types
-------------

### `SDKMessage`

Union type of all possible messages returned by the query.

### `SDKAssistantMessage`

Assistant response message.The `message` field is a [`BetaMessage`](https://platform.claude.com/docs/en/api/messages/create) from the Anthropic SDK. It includes fields like `id`, `content`, `model`, `stop_reason`, and `usage`.
`SDKAssistantMessageError` is one of: `'authentication_failed'`, `'oauth_org_not_allowed'`, `'account_on_hold'`, `'billing_error'`, `'rate_limit'`, `'overloaded'`, `'invalid_request'`, `'model_not_found'`, `'server_error'`, `'max_output_tokens'`, `'cloud_credential_error'`, or `'unknown'`. Four of these values mean more than their names say:

* `'model_not_found'`: the selected model doesn’t exist or isn’t available to your account or deployment
* `'overloaded'`: the API returned a 529 because the server is at capacity, as opposed to `'rate_limit'`, which is a 429 against your quota
* `'account_on_hold'`: [your account is on hold](/docs/en/errors#your-account-is-on-hold)
* `'cloud_credential_error'`: Claude Code couldn’t obtain usable AWS or Google Cloud credentials on the machine it runs on, so no request reached the cloud provider. The usual cause is a cloud sign-in that expired or was never completed on that machine, though a briefly unreachable credential service reports the same value. See [Could not load AWS or Google Cloud credentials](/docs/en/errors#could-not-load-aws-or-google-cloud-credentials). Requires TypeScript Agent SDK v0.3.267 or later, which bundles Claude Code v2.1.267

`aborted` is `true` when an interrupt or abort truncated the assistant message before the stream completed: the message has no `stop_reason` and the content may end mid-word. The field is absent on normally completed messages. It requires Agent SDK v0.3.214 or later.
Claude Code sets `user_message_uuid` and `user_message_uuids` on the turn’s first assistant message, under the conditions in [`user_message_uuid`](#user_message_uuid).
`timestamp` is the ISO 8601 time when the message’s content finished generating on the process that produced it. The value comes from that machine’s clock, so use it for display only and don’t order messages by it. One API turn can produce several assistant messages that share a `message.id`, each with its own `timestamp`. When the field is absent, fall back to the time you received the message.
`context_usage` is a structured copy of the `/context` report, typed as [`SDKContextUsage`](#sdkcontextusage), and requires Agent SDK v0.3.232 or later. When you send `/context` as a prompt, Claude Code delivers the report as an assistant message whose `message.content` holds the markdown table, and attaches `context_usage` to that same message. Claude Code doesn’t set the field on any other assistant message, and earlier versions deliver the `/context` table without it, so read the breakdown from the field when it’s present and fall back to the markdown text when it isn’t.

### `SDKUserMessage`

User input message.Set `shouldQuery` to `false` to append the message to the transcript without triggering an assistant turn. The message is held and merged into the next user message that does trigger a turn. Use this to inject context, such as the output of a command you ran out of band, without spending a model call on it.
On a message that carries a `tool_result` block, `tool_use_result` is the tool’s structured output object rather than the text sent to the model. Its shape depends on the tool named by the matching `tool_use` block, so the field is typed `unknown`; the built-in shapes are listed under [Tool Output Types](#tool-output-types).
For the `Agent` tool, `tool_use_result` is [`AgentOutput`](#agent-2). On a `completed` result, `content` holds the subagent’s report without the agent ID and usage trailer that Claude Code appends to the `tool_result` text, so render from `tool_use_result` instead of parsing that text.
For an MCP tool whose result contains `resource_link` blocks, `tool_use_result` is an object with a `resourceLinks` array of [`SDKMcpResourceLink`](#sdkmcpresourcelink) entries. Claude receives each link as a line of text in the `tool_result` block, so read `resourceLinks` to render the files the server returned instead of parsing that text. Claude Code omits `resourceLinks` when the result has no links and on results from subagents, keeps at most 50 links per result, and stops adding links once the array reaches 64 KiB of serialized JSON. `resourceLinks` requires Agent SDK v0.3.257 or later.

### `SDKUserMessageReplay`

Replayed user message with required UUID.A user turn injected from outside the session, one whose [`origin`](#sdkmessageorigin) kind is `peer` or `channel`, reaches the stream as a replay whether it was delivered during an active turn or started a new turn while the session was idle. Before v2.1.207, an injected turn delivered while the session was idle produced no message on the stream and only appeared when you re-read the transcript.

### `SDKResultMessage`

Final result message.Several fields on the result carry diagnostic detail beyond `subtype`:

* `api_error_status`: the HTTP status code of the API error that terminated the conversation. Absent or `null` when the turn ended without an API error.
* `ttft_ms`: time to first token in milliseconds, measured when the first complete assistant message arrives. Present on the success arm only.
* `ttft_stream_ms`: time in milliseconds until the first `message_start` stream event, when the response stream opens. Lower than `ttft_ms`; the gap between the two is time spent streaming the first message. Present on the success arm only.
* `user_message_uuid`: the `uuid` of the message you sent that this turn answered. See [`user_message_uuid`](#user_message_uuid) for which results carry it.
* `user_message_uuids`: the `uuid`s of every message you sent that Claude Code answered in this turn. See [`user_message_uuids`](#user_message_uuids).
* `request_sent_wall_ms`: epoch milliseconds at which Claude Code dispatched the API request, for joins against server-side timestamps. Present only together with [`user_message_uuid`](#user_message_uuid), on a success result with `is_error` false whose turn sent an API request.
* `first_content_frame_ms`: time in milliseconds until the first `content_block_start` or `content_block_delta` stream event, counting thinking blocks as content. Present on the success arm only, when `is_error` is false. Requires Agent SDK v0.3.260 or later.
* `first_stream_post_ms`, `first_stream_post_ack_ms`, `first_stream_post_wall_ms`: timings for uploading the turn’s first stream event. Claude Code records them only in sessions it streams to claude.ai, such as [cloud sessions](/docs/en/claude-code-on-the-web), and the results `query()` yields don’t carry them. Requires Agent SDK v0.3.260 or later.
* `usage`: main agent loop only. Excludes subagent and auxiliary model calls, and is per-turn in streaming-input sessions. Prefer `modelUsage` for token/cost accounting.
* `modelUsage`: per-model totals for every model call made through the query pipeline during this `query()` call, including the main loop, subagents, and internal calls such as compaction and Workflow agents. Helper calls outside that pipeline, such as the permission classifier and token-counting requests, are excluded. In streaming-input sessions the totals are cumulative across turns, so read the latest result rather than summing across results. See [Track costs in streaming input mode](/docs/en/agent-sdk/cost-tracking#track-costs-in-streaming-input-mode) for resets and [Recover totals after a session crash](/docs/en/agent-sdk/cost-tracking#recover-totals-after-a-session-crash) for zeroed results.
* `total_cost_usd`: cumulative estimated cost in USD for this `query()` call, covering the same calls as `modelUsage` and reset at the same points. It is an estimate, not a billing statement. See [Track cost and usage](/docs/en/agent-sdk/cost-tracking) for accuracy caveats.
* `queued_turn_count`: the number of messages you sent with `origin: { kind: "human" }` that are still waiting when Claude Code produced the result. See [`queued_turn_count`](#queued_turn_count) for what `0` and an absent field tell you.
* `terminal_reason`: why the loop ended. One of `"completed"`, `"max_turns"`, `"tool_deferred"`, `"aborted_streaming"`, `"aborted_tools"`, `"hook_stopped"`, `"stop_hook_prevented"`, `"background_requested"`, `"blocking_limit"`, `"rapid_refill_breaker"`, `"prompt_too_long"`, `"image_error"`, `"model_error"`, `"api_error"`, `"malformed_tool_use_exhausted"`, `"budget_exhausted"`, `"structured_output_retry_exhausted"`, `"tool_deferred_unavailable"`, or `"turn_setup_failed"`.
* `fast_mode_state`: one of `"on"`, `"off"`, or `"cooldown"`.
* `fast_mode_disabled_reason`: why [fast mode](/docs/en/fast-mode) isn’t available right now. Absent when nothing blocks fast mode, though a request may still run at standard speed. During the cooldown after a fast mode rate limit, Claude Code reports `fast_mode_state: "cooldown"` with no reason code and re-enables fast mode when the cooldown expires. Requires Claude Code v2.1.219 or later.

Use the reason code to explain why fast mode is off in your own UI instead of re-deriving availability. Each code names the check that blocked fast mode:
The same pair of fields appears on [`SDKSystemMessage`](#sdksystemmessage) and on the [`SDKControlInitializeResponse`](#sdkcontrolinitializeresponse), so you can read the fast mode state before the first turn.
The `origin` field forwards the [`SDKMessageOrigin`](#sdkmessageorigin) of the user message that triggered this result. When the SDK injects a synthetic follow-up turn, such as for a finished background task, the resulting `SDKResultMessage` carries `origin: { kind: "task-notification" }`. Routines whose trigger fired and server-verified messages from your other sessions arrive with this kind too, each with the `subkind` described in [Task-notification subkinds](#task-notification-subkinds). Check `kind` to distinguish results that answer your prompt from injected follow-ups before routing or suppressing them.
The field is absent for results emitted before any user turn, such as startup errors.
When a `PreToolUse` hook returns `permissionDecision: "defer"`, the result has `stop_reason: "tool_deferred"` and `deferred_tool_use` carries the pending tool’s `id`, `name`, and `input`. Read this field to surface the request in your own UI, then resume with the same `session_id` to continue. See [Defer a tool call for later](/docs/en/hooks#defer-a-tool-call-for-later) for the full round trip.

#### `user_message_uuid`

The `uuid` of the [`SDKUserMessage`](#sdkusermessage) the turn is answering, echoed so you can match Claude Code’s reply to the message you sent. Claude Code echoes a `uuid` only if you set one on the message. The field is optional on `SDKUserMessage`, and a string prompt passed to `query()` carries none.
Which of your messages a turn answers depends on how the turn started:

* **A regular message you sent**, meaning one without `isSynthetic: true`: the turn answers that message for its whole run. When you send several messages close together, Claude Code can merge them into one turn, and the field then carries only the last message’s `uuid`. To match the reply to any of the merged messages, use [`user_message_uuids`](#user_message_uuids).
* **A message you sent with `isSynthetic: true`**: the turn answers that message at first. If Claude Code picks up a regular message of yours between tool calls, the turn answers the picked-up message from then on. Echoing a synthetic message’s `uuid` requires Agent SDK v0.3.265 or later; earlier versions echo nothing on synthetic turns.
* **A prompt Claude Code generated itself**, such as the turn that continues interrupted work after a session restarts: the turn answers no message of yours at first and its frames carry no echo. If Claude Code picks up a regular message of yours between tool calls, the turn answers that message from then on. The pickup echo requires Agent SDK v0.3.265 or later; earlier versions echo nothing on these turns.

Claude Code echoes the answered message’s `uuid` on three kinds of frame:

* **The result**: every result of a turn that answered a message you sent. Every such result carries it on Agent SDK v0.3.265 or later. Before v0.3.265, the success result of a turn that a regular message started lacked it when the turn sent no API request or ended with a deferred tool call. Before v0.3.246, error results lacked it too, and before v0.3.216 every result did.
* **The turn’s first reply**: the first [assistant message](#sdkassistantmessage), or with `includePartialMessages` the first [stream event](#sdkpartialassistantmessage) whose `event.type` isn’t `ping`, so you can bind the reply before the result arrives. When a turn streams nothing, Claude Code sets it on the first assistant message instead. The first-reply echo requires Agent SDK v0.3.246 or later. When the message the turn is answering changes mid-turn, the first reply after the change carries the field too, on Agent SDK v0.3.265 or later; earlier versions set it on one reply frame per turn.
* **Every [`thinking_tokens`](#sdkthinkingtokensmessage) frame of the turn**: so you can attribute thinking progress to the message you sent without waiting for the turn’s first reply. Requires Agent SDK v0.3.260 or later.

Claude Code omits the field in these cases:

* Reply frames other than those first replies
* Subagent frames
* Turns that answer no message with a `uuid`: the turn answered a message you sent without one, or Claude Code started the turn itself and picked up no regular message that has one
* Results that answer no message you sent, such as the zeroed result after a crashed worker process

#### `user_message_uuids`

The `uuid`s of every message you sent that Claude Code answered in this turn. When you send several messages close together, Claude Code can merge them into one turn, and `user_message_uuid` then names only the last of them. To match the reply to any of the merged messages, look for that message’s `uuid` anywhere in this list. Requires Agent SDK v0.3.259 or later.
Claude Code sets the list together with `user_message_uuid` on each reply frame that carries that field and on the result. For the full set of frames that carry `user_message_uuid`, and the version each requires, see [`user_message_uuid`](#user_message_uuid). The list always contains `user_message_uuid` and holds at most 64 entries.
When Claude Code picks up a regular message you sent while a turn was running, it adds that message’s `uuid` to the result’s list.
When a first reply or result carries `user_message_uuid` without the list, it came from an earlier Claude Code version, so fall back to the single field.

#### `queued_turn_count`

The number of messages you sent with [`origin: { kind: "human" }`](#sdkmessageorigin) that are still waiting in the command queue when Claude Code produced the result. Requires Agent SDK v0.3.242 or later.
What `0` and an absent field tell you:

* **`0`**: Claude Code doesn’t count messages you sent without that `origin`, and doesn’t count task notifications, so a turn can still follow.
* **Absent**: the final result that Claude Code emits after a crash or fatal startup error omits the field, and [may carry zeroed totals](/docs/en/agent-sdk/cost-tracking#recover-totals-after-a-session-crash).

### `SDKSystemMessage`

System initialization message.`fast_mode_state` reports the session’s [fast mode](/docs/en/fast-mode) state. When something blocks fast mode, `fast_mode_disabled_reason` names the check that blocked it; the field requires Claude Code v2.1.219 or later. For the reason codes and their meanings, see [`fast_mode_disabled_reason`](#sdkresultmessage) on the result message.
`terminal_slash_commands` names the entries in `slash_commands` whose interface is bound to the local terminal, such as `exit`. You can send them like any other entry in `slash_commands`; the field exists so a remote or mobile client can hide them from its command menus. The field is present only when non-empty, and requires Agent SDK v0.3.229 or later.

* `effort`: the [effort level](/docs/en/model-config#adjust-effort-level) Claude Code sends on the session’s next request, or `null` when it sends none. Claude Code sets the field only on the init message it sends to [Remote Control](/docs/en/remote-control) clients, and omits it from the init message your application reads. Requires Agent SDK v0.3.234 or later.

The `capabilities` array names the protocol behaviors this CLI implements, so you can feature-detect instead of comparing `claude_code_version` strings. It is an open set: ignore values you don’t recognize, and check for the specific capability whose behavior you rely on. The field requires Claude Code v2.1.205 or later and is absent on earlier CLIs.

### `SDKPartialAssistantMessage`

Streaming partial message (only when `includePartialMessages` is true). The `parent_tool_use_id` field is always `null`: stream events are emitted for the main session only. For subagent attribution, use complete messages, which carry `parent_tool_use_id`, or enable [`forwardSubagentText`](#options) to receive subagent text and thinking as complete messages.Claude Code sets `user_message_uuid` and `user_message_uuids` on the turn’s first non-ping stream event, and again when the message the turn is answering changes, under the conditions in [`user_message_uuid`](#user_message_uuid).

### `SDKCompactBoundaryMessage`

Message indicating a conversation compaction boundary.

### `SDKInformationalMessage`

Generic text banner emitted by the loop. Carries non-error status lines, hook feedback such as a `UserPromptSubmit` hook’s block reason, and command output. On Claude Code v2.1.227 or later, a hook’s [`systemMessage`](/docs/en/hooks#json-output) can arrive as this message, with each line prefixed by the hook’s name, such as `PostToolUse:Bash says:`. Whether a hook’s `systemMessage` arrives as this message depends on the event. Each [event’s section](/docs/en/hooks#hook-events) on the hooks page says how output surfaces. Render `content` as plaintext at the given `level`.

### `SDKWorkerShuttingDownMessage`

Emitted on graceful worker teardown so remote clients can show why the worker exited instead of waiting for heartbeat timeout. The `reason` is a short snake\_case string set by the host CLI, such as `"host_exit"` or `"remote_control_disabled"`. Act on this only when streaming live. A resumed session replays past instances of this message, so ignore them in that case.

### `SDKPluginInstallMessage`

Plugin installation progress event. Emitted when [`CLAUDE_CODE_SYNC_PLUGIN_INSTALL`](/docs/en/env-vars) is set, so your Agent SDK application can track marketplace plugin installation before the first turn. The `started` and `completed` statuses bracket the overall install. The `installed` and `failed` statuses report individual marketplaces and include `name`.

### `SDKPermissionDeniedMessage`

Stream event emitted when the permission system denies a tool call without an interactive prompt. Use it to render the denial in your UI as it happens, rather than only observing the `is_error` tool result that follows. Which denials it reports depends on how the run handles permission prompts:

* **With a [`canUseTool`](#canusetool) callback** and the default [`permissionPrompts: 'host'`](#options): permission prompts go to your callback, and this event reports the denials Claude Code decides on its own without calling it.
* **With neither**: a bare `-p` run, or `query()` that sets neither `canUseTool` nor `permissionPromptToolName`, denies any tool call that would have prompted, and this event reports those denials as well as the ones Claude Code decides on its own. Before v2.1.223, Claude Code didn’t emit this event in runs without a callback.
* **With an MCP prompt tool**, set with `permissionPromptToolName` or the [`--permission-prompt-tool`](/docs/en/cli-reference#cli-flags) flag, and the default `permissionPrompts: 'host'`: Claude Code doesn’t emit this event at all, not even for the rule denials it decides on its own.
* **With [`permissionPrompts: 'none'`](#options)**: Claude Code denies the calls that would have prompted, even when `canUseTool` or an MCP prompt tool is also set, and this event reports those denials as well as the ones Claude Code decides on its own. Requires Claude Code v2.1.259 or later.

In every configuration, this event skips any denial decided on the `PreToolUse` hook path, whether the hook denied the call itself or a deny rule overrode the hook’s allow or ask decision. The event is also best-effort: occasionally Claude Code records a denial without emitting this event, so `permission_denials` on the [result message](#sdkresultmessage) is the authoritative record.

### `SDKPermissionDenial`

Information about a denied tool use.

### `SDKContextUsage`

Structured form of the `/context` report, carried as `context_usage` on the [`SDKAssistantMessage`](#sdkassistantmessage) that delivers a `/context` result. Agent SDK v0.3.232 and later export the type. Unlike [`SDKControlGetContextUsageResponse`](#sdkcontrolgetcontextusageresponse), it carries only the data needed to render the usage breakdown, without display fields such as `color` and `gridRows`.The table lists what Claude Code puts in each field. The fields from `model` through `over_limit` describe the session as a whole, and the collection fields attribute tokens to individual items.
`over_limit.kind` records how Claude Code resolved the window, not whether the API accepts the next request:

* `hard_limit`: the window is what Claude Code believes to be the model’s own limit, past which the API refuses requests
* `compaction_window`: the window is a compaction-policy window, which may or may not coincide with the model’s limit

Claude Code evolves the type additively, adding new data as optional fields rather than reshaping existing ones. Read the fields you know and ignore any you don’t recognize.

### `SDKContextUsageCategory`

One row of the `/context` usage-by-category breakdown.The table lists what Claude Code puts in each field of a row.
Each `kind` value says what the row’s tokens are:

* `used`: content that occupies the context window
* `free`: the remaining window
* `buffer`: the compaction reserve
* `deferred`: tool schemas Claude Code holds out of the window and excludes from the usage calculation, listed for awareness

### `SDKMessageOrigin`

Provenance of a user-role message. This appears as `origin` on [`SDKUserMessage`](#sdkusermessage) and is forwarded onto the corresponding [`SDKResultMessage`](#sdkresultmessage) so you can tell what triggered a given turn.

### Task-notification subkinds

When Claude Code delivers a task notification into a session, it sets `subkind` on the notification’s `origin` only if Anthropic servers verified where that notification came from. `subkind` requires Claude Code v2.1.213 or later, and it takes one of two values:

* `scheduled-trigger`: the notification is a [routine](/docs/en/routines)’s stored prompt, delivered because one of the routine’s triggers fired: its schedule, its [API trigger](/docs/en/routines#add-an-api-trigger), its [GitHub trigger](/docs/en/routines#add-a-github-trigger), or **Run now**. Claude Code frames these to the model as the session’s assigned task, with a different notice from the [notice that other task notifications carry](#sdktasknotificationmessage).
* `peer-send-message`: the notification is a message that another of your sessions sent with the server-side `send_message` tool that [Claude Code on the web](/docs/en/claude-code-on-the-web) sessions use to message each other, not the [cross-session `SendMessage` tool](/docs/en/cross-session-messaging), and Anthropic servers verified that both sessions belong to the same private group of sessions. Requires Claude Code v2.1.224 or later. A `send_message` delivery the servers didn’t verify that way gets no subkind.

Every other task notification has no `subkind`. That includes [scheduled tasks](/docs/en/scheduled-tasks) that fire on your own machine, [PR activity](/docs/en/claude-code-on-the-web#how-claude-responds-to-pr-activity) delivered into a session, and background events such as a finished task. Messages from the [cross-session `SendMessage` tool](/docs/en/cross-session-messaging) aren’t task notifications at all: whether they come from a session on the same machine or through Anthropic servers from another machine, Claude Code gives them `kind: "peer"` and the [peer origin fields](#peer-origin-fields).

### Peer origin fields

A `peer` origin identifies which agent sent the message: an in-process [teammate](/docs/en/agent-teams) sending to `main` with `SendMessage`, or a [cross-session peer](/docs/en/cross-session-messaging), another of your Claude Code sessions. Cross-session peers require Claude Code v2.1.224 or later on macOS and Linux; see [cross-session messaging availability](/docs/en/cross-session-messaging#availability) for the native Windows requirement. A cross-session peer can run on the same machine, or on [another of your machines](/docs/en/cross-session-messaging#message-sessions-on-other-machines) or [Claude Code on the web](/docs/en/claude-code-on-the-web) when its message arrives through Remote Control. The two kinds of sender fill the fields differently:

* `from`: the teammate’s name, or the sender address for a cross-session peer. For a [one-way cross-machine message](/docs/en/cross-session-messaging#message-sessions-on-other-machines), the sender has no reply address and `from` is `"unknown"`. The value is sender-authored; `verifiedPeerPid` is the verified identity.
* `fromMode`: the sending session’s permission class, `bypass` or `prompting`, declared by a host that relays a peer message between your sessions, such as the [desktop app](/docs/en/desktop#work-across-sessions). Claude Code reads it in the receiving session when it applies the [inbound controls](/docs/en/cross-session-messaging#control-inbound-messages). Requires Agent SDK v0.3.234 or later.
* `senderTaskId`: the teammate’s task ID. Absent for a cross-session peer.
* `name`: the sender’s display name, normalized by Claude Code: it strips Unicode control, format, surrogate, and line or paragraph separator code points, then trims the result and caps it at 64 code points with an ellipsis. Requires Claude Code v2.1.205 or later.
* `body`: the decoded message body with the peer envelope stripped, byte-exact with what the model sees. Always present for a teammate message; for a cross-session peer, present only when the turn is exactly one peer envelope formed by Claude Code. Render `name` and `body` instead of re-parsing the message text. Requires Claude Code v2.1.205 or later.
* `fromSession`: the sender’s host-openable session ID, set by the sender’s host so your UI can link back to the sending session. Like `from`, it is sender-asserted: use it as a navigation target only, and don’t treat it as proof of the sender’s identity. Requires Claude Code v2.1.216 or later.
* `verifiedPeerPid`: the process ID of the process that connected to this session’s cross-session messaging socket, verified by the kernel and read from the connection itself, never from the payload. Use it, not `from`, to identify the sender: `from` is forgeable by any same-user process. The field is absent when Claude Code can’t verify it, such as on Windows or non-socket ingress, so an absent value means the sender is unverified. For relayed traffic it identifies the relay rather than the message’s author, and process IDs are recyclable, so treat it as provenance rather than an authentication token. Requires Claude Code v2.1.216 or later.

Hook Types
----------

For a comprehensive guide on using hooks with examples and common patterns, see the [Hooks guide](/docs/en/agent-sdk/hooks).

### `HookEvent`

Available hook events.

### `HookCallback`

Hook callback function type.

### `HookCallbackMatcher`

Hook configuration with optional matcher.

### `HookInput`

Union type of all hook input types.

### `BaseHookInput`

Base interface that all hook input types extend.The `prompt_id` field is a UUID identifying the user prompt currently being processed. It matches the [`prompt.id` attribute on OpenTelemetry events](/docs/en/monitoring-usage#event-correlation-attributes) and is absent until the first user input. Requires Claude Code v2.1.196 or later.

#### `PreToolUseHookInput`

#### `PostToolUseHookInput`

#### `PostToolUseFailureHookInput`

#### `PostToolBatchHookInput`

Fires once after every tool call in a batch has resolved, before the next model request. `tool_response` carries the serialized `tool_result` content the model sees; the shape differs from `PostToolUseHookInput`’s structured `Output` object.

#### `PermissionDeniedHookInput`

#### `NotificationHookInput`

#### `UserPromptSubmitHookInput`

#### `UserPromptExpansionHookInput`

#### `SessionStartHookInput`

#### `SessionEndHookInput`

#### `StopHookInput`

#### `StopFailureHookInput`

#### `SubagentStartHookInput`

#### `SubagentStopHookInput`

#### `PreCompactHookInput`

#### `PostCompactHookInput`

#### `PreModelSwitchHookInput`

Fires before a requested model switch takes effect. `context_tokens` and the fields after it estimate what re-sending the conversation to the new model costs. For the full field descriptions and blocking semantics, see [PreModelSwitch](/docs/en/hooks#premodelswitch).

#### `PostModelSwitchHookInput`

Fires after the session’s model changes. It carries the same fields as `PreModelSwitchHookInput`, with two more `source` values. See [PostModelSwitch](/docs/en/hooks#postmodelswitch).

#### `PermissionRequestHookInput`

#### `SetupHookInput`

#### `TeammateIdleHookInput`

#### `TaskCreatedHookInput`

#### `TaskCompletedHookInput`

#### `ElicitationHookInput`

#### `ElicitationResultHookInput`

#### `ConfigChangeHookInput`

#### `InstructionsLoadedHookInput`

#### `DirectoryAddedHookInput`

`directory` is the absolute path of the directory that was added. `source` is `"slash_command"` when `/add-dir` added it and `"register_repo_root"` when the SDK control request did.

#### `WorktreeCreateHookInput`

#### `WorktreeRemoveHookInput`

#### `CwdChangedHookInput`

#### `FileChangedHookInput`

#### `MessageDisplayHookInput`

### `HookJSONOutput`

Hook return value.

#### `AsyncHookJSONOutput`

#### `SyncHookJSONOutput`

Tool Input Types
----------------

Documentation of input schemas for all built-in Claude Code tools. These types are exported from `@anthropic-ai/claude-agent-sdk` and can be used for type-safe tool interactions.

### `ToolInputSchemas`

Union of tool input types exported from `@anthropic-ai/claude-agent-sdk`; members include:

### Agent

**Tool name:** `Agent`. The previous name `Task` is still accepted as an alias, and the `tools` array in the [`SDKSystemMessage`](#sdksystemmessage) init message currently lists this tool as `Task` for backward compatibility.

The `mode` field is deprecated and ignored on Claude Code v2.1.212 or later. A subagent runs in either the parent session’s permission mode or its definition’s [`permissionMode`](#agentdefinition), and the [subagent inheritance rules](/docs/en/agent-sdk/permissions#available-modes) decide which.

Launches a new agent to handle complex, multi-step tasks autonomously.

### AskUserQuestion

**Tool name:** `AskUserQuestion`Asks the user clarifying questions during execution. See [Handle approvals and user input](/docs/en/agent-sdk/user-input#handle-clarifying-questions) for usage details.

### Bash

**Tool name:** `Bash`Executes Bash commands with optional timeout and background execution. The working directory persists between commands, including commands run in later turns of a multi-turn session; shell state such as exported environment variables doesn’t. For the limits on which directory changes carry over, see [What persists between commands](/docs/en/tools-reference#what-persists-between-commands).

### Monitor

**Tool name:** `Monitor`Runs a background source and delivers each event to Claude so it can react without polling: `command` runs a script and emits one event per stdout line, and `ws` opens a WebSocket and emits one event per text frame. Provide exactly one of `command` or `ws`. The `ws` source requires Claude Code v2.1.195 or later.
Set `persistent: true` for session-length watches such as log tails. When Monitor runs a command, it follows the same permission rules as Bash; a WebSocket watch prompts for approval separately. See the [Monitor tool reference](/docs/en/tools-reference#monitor-tool) for behavior and provider availability. The exported type marks `timeout_ms` and `persistent` as required because the schema fills in their defaults, 300000 and `false`; a call that omits them validates.

### TaskOutput

**Tool name:** `TaskOutput`

`TaskOutput` is deprecated; prefer `Read` on the task’s output file path. The schemas below remain valid for hooks and permission handlers that encounter the tool.

Retrieves output from a running or completed background task.

### Edit

**Tool name:** `Edit`Performs exact string replacements in files.

### Read

**Tool name:** `Read`Reads files from the local filesystem, including text, images, PDFs, and Jupyter notebooks. Use `pages` for PDF page ranges (for example, `"1-5"`).
For a PDF, Claude receives the file’s contents inside the Read call’s `tool_result` content. A read that returns the `pdf` [output](#tool-output-types) carries a summary `text` block followed by a `document` block. One that returns the `parts` output carries the summary `text` block followed by one block per extracted page: an `image` block, or a `text` block naming the page when Claude Code couldn’t render it as an image. Before Agent SDK v0.3.242, Claude Code delivered the file’s contents as a separate `user` message after the tool result.

### Write

**Tool name:** `Write`Writes a file to the local filesystem, overwriting if it exists.

### Glob

**Tool name:** `Glob`Fast file pattern matching that works with any codebase size.

### Grep

**Tool name:** `Grep`Powerful search tool built on ripgrep with regex support.

### TaskStop

**Tool name:** `TaskStop`Stops a running background task or shell by ID. As of v2.1.198, `task_id` also accepts an agent-team teammate or a named background agent by agent ID or name.

### NotebookEdit

**Tool name:** `NotebookEdit`Edits cells in Jupyter notebook files.

### WebFetch

**Tool name:** `WebFetch`Fetches content from a URL and processes it with an AI model.

### WebSearch

**Tool name:** `WebSearch`Searches the web and returns formatted results.

### Workflow

**Tool name:** `Workflow`Runs a [dynamic workflow](/docs/en/workflows): a script that orchestrates many subagents in the background and returns one consolidated result. The `Workflow` tool is available in Agent SDK v0.3.149 and later. At least one of `script`, `name`, or `scriptPath` is required.

### TodoWrite

**Tool name:** `TodoWrite`Creates and manages a structured task list for tracking progress.

The following tools are available by default only on Claude 3.x models, Opus 4 through 4.7, Sonnet 4 through 4.6, and Haiku 4.5. On every other model, including model IDs Claude Code doesn’t recognize, they aren’t available unless you opt in:

* `TodoWrite`
* `TaskCreate`
* `TaskGet`
* `TaskUpdate`
* `TaskList`

Wherever the tools are available, Claude Code provides the four Task tools, or `TodoWrite` instead when you set `CLAUDE_CODE_ENABLE_TASKS=0`.This default set applies in Claude Code v2.1.268 and later, which the TypeScript Agent SDK bundles from v0.3.268.See [Model availability](/docs/en/agent-sdk/todo-tracking#model-availability) to opt in.

### TaskCreate

**Tool name:** `TaskCreate`Creates a single task and returns its assigned ID.

### TaskUpdate

**Tool name:** `TaskUpdate`Patches one task by ID. Set `status` to `"deleted"` to remove it.

### TaskGet

**Tool name:** `TaskGet`Returns full details for one task, or `null` when the ID is not found.

### TaskList

**Tool name:** `TaskList`Returns a snapshot of all tasks in the current list.

### ExitPlanMode

**Tool name:** `ExitPlanMode`Exits plan mode. The `allowedPrompts` field is deprecated and ignored; Claude Code still accepts it so existing callers and transcripts validate. Before v2.1.205, it requested prompt-based Bash permissions for implementing the plan.

### ListMcpResources

**Tool name:** `ListMcpResourcesTool`Lists available MCP resources from connected servers.

### ReadMcpResource

**Tool name:** `ReadMcpResourceTool`Reads a specific MCP resource from a server.

### EnterWorktree

**Tool name:** `EnterWorktree`Creates and enters a temporary git worktree for isolated work. Pass `path` to switch into an existing worktree instead of creating a new one. On first entry the target must be a registered worktree of the current repository or, in a multi-repo workspace, of a repository nested inside it; from within a worktree session it must be under `.claude/worktrees/` of the session’s repository. `name` and `path` are mutually exclusive.

### ExitWorktree

**Tool name:** `ExitWorktree`Exits the current git worktree and returns to the original working directory. The `keep` action leaves the worktree and branch on disk, while `remove` deletes both. `discard_changes` must be `true` when removing a worktree that has uncommitted files or unmerged commits.

### EnterPlanMode

**Tool name:** `EnterPlanMode`Enters plan mode, where Claude researches and presents a plan before making changes.

### CronCreate

**Tool name:** `CronCreate`Schedules a prompt to run on a 5-field cron schedule in local time. Set `recurring` to `false` to fire once at the next match. Jobs are session-scoped by default: starting a fresh conversation clears them, and resuming with `--resume` or `--continue` restores jobs that haven’t expired. See [Scheduled tasks](/docs/en/scheduled-tasks).
Setting `durable` to `true` requests persistence to `.claude/scheduled_tasks.json` so the job survives restarts. Durable scheduling isn’t available in every session: when it isn’t, Claude Code accepts `durable: true` but creates the job session-only. Read the output’s `durable` field to see whether the job persisted.

### CronDelete

**Tool name:** `CronDelete`Deletes a scheduled cron job by the ID returned from `CronCreate`.

### CronList

**Tool name:** `CronList`Lists the scheduled cron jobs: durable jobs from `.claude/scheduled_tasks.json` and session-only jobs from the current session.

### ScheduleWakeup

**Tool name:** `ScheduleWakeup`Schedules a one-shot wake-up that fires the given prompt after a delay. This tool backs the self-paced `/loop` command. The runtime clamps `delaySeconds` to between 60 and 3600 seconds. The `delaySeconds`, `reason`, `prompt`, and `noop` fields are required unless `stop` is true. `noop: true` reports a wake-up where nothing changed. Setting `stop: true` cancels the pending wakeup and ends the self-paced `/loop`. The `stop` field requires Claude Code v2.1.202 or later. See the [ScheduleWakeup row in the tools reference](/docs/en/tools-reference).

### RemoteTrigger

**Tool name:** `RemoteTrigger`Manages [Routines](/docs/en/routines), the scheduled and triggered Claude Code runs hosted in the cloud. This tool backs the `/schedule` command. `trigger_id` is required for the `get`, `update`, `run`, and `list_runs` actions. `body` is required for `create`, `update`, and `create_webhook_trigger`, and optional for `run`.
`create_webhook_trigger` attaches an event source to an existing routine, such as a [GitHub event](/docs/en/routines#add-a-github-trigger) that fires it. The `body` names the source, the events, and the routine to fire. Requires Claude Code v2.1.225 or later.
`list_runs` lists a routine’s recent runs, and `get_run_log` reads one run’s log. `session_id` names the run to read, from a `list_runs` result, and `cursor` pages through either action’s results. Both actions require Claude Code v2.1.227 or later.
This tool is available only when the session is authenticated with a claude.ai account on a plan with Routines enabled, and is absent when your organization’s policy disables [Claude Code on the web](/docs/en/claude-code-on-the-web). On Claude Code v2.1.227 or later, the tool is also absent when an Owner has [turned off routines for the organization](/docs/en/routines#routines-are-disabled-by-your-organizations-policy). Before v2.1.227, a session with only the routines toggle turned off still showed the tool, and the server denied its calls.

### PushNotification

**Tool name:** `PushNotification`Sends a proactive push notification to the user. Keep `message` under 200 characters because mobile operating systems truncate longer text. See the [PushNotification row in the tools reference](/docs/en/tools-reference) for provider availability; push delivery runs through Anthropic-hosted infrastructure that isn’t accessible from Amazon Bedrock, Claude Platform on AWS, Google Cloud’s Agent Platform, or Microsoft Foundry.

### REPL

**Tool name:** `REPL`Executes JavaScript code in a persistent REPL. State persists across calls and top-level await is supported. `timeout` is in milliseconds, with a default of 30000 and a maximum of 600000.
The types are exported, but the tool is off in SDK sessions unless you set `CLAUDE_CODE_REPL=1` in the [`env` option](#options). It also requires the Bun-based `claude` executable that the native installer provides.

### ReportFindings

**Tool name:** `ReportFindings`Reports code-review findings as a structured list so Claude Code can render them instead of printing them as text. `level` is the effort level the review ran at. Findings are ordered most-severe first, with at most 32 per call, and the array is empty when none survived. Requires Claude Code v2.1.196 or later.
Each finding carries these fields:

* `file`: repo-relative path the finding is in. The optional `line` is the 1-indexed line it anchors to.
* `summary`: one-sentence statement of the defect. `failure_scenario` describes the concrete inputs and state that lead to the wrong output or crash.
* `short_summary`: optional compressed label of at most 60 characters for compact display. Requires Claude Code v2.1.212 or later.
* `category`: optional short kebab-case slug of the finding type, such as `correctness` or `test-coverage`. Requires Claude Code v2.1.199 or later.
* `verdict`: set when a verify pass ran; absent on inline-only reviews.
* `outcome`: set only when re-reporting after applying fixes.

### Artifact

**Tool name:** `Artifact`Publishes a local `.html` or `.md` file as a hosted artifact page, or lists the user’s published artifacts. Omit `action` or pass `"publish"` to publish `file_path`, which is required for the publish action along with `favicon`, one or two emoji that mark the artifact in the user’s gallery. `title` names the published page in the browser tab and gallery when the HTML file has no `<title>` tag. `url` targets an existing artifact to update in place instead of minting a new one.
`force` is a last-resort overwrite that discards a newer version another session published. On a conflict, the failed publish returns the newer content; Claude merges its changes onto that content, or re-reads the artifact, and publishes again. Pass `force` only when the user explicitly asks to discard that version.
Pass `"list"` to enumerate the user’s published artifacts; only `limit` and `scope` may accompany it. `scope` defaults to `"mine"`, which lists artifacts the user owns; `"shared"` lists artifacts other people shared with the user, and `"all"` lists both.

* `capabilities`: the runtime capabilities the published page uses, keyed by capability name, such as the [connectors the page may call](/docs/en/artifacts#pull-live-data-with-mcp-connectors). The artifact service validates the declaration and rejects a publish that names a capability the account can’t use or gives one an invalid config. Pass `{}` to clear a stored declaration, and omit the field on a redeploy to keep it. Requires Agent SDK v0.3.235 or later.
* `contract`: the runtime version the published page runs against. Omit it to keep the artifact’s current version, pass `"latest"` to upgrade, or pass a specific version to pin or roll back. Requires Agent SDK v0.3.235 or later.

The types are exported, but the tool is off by default in Agent SDK sessions. Publishing also requires every condition in the [artifacts availability table](/docs/en/artifacts#availability), which sessions authenticated with an API key don’t meet.

### Projects

**Tool name:** `Projects`Reads and writes the claude.ai Project attached to the session. Dispatches on `method`:

* `project_info`: returns project metadata and the doc list.
* `project_read`: reads one doc by `path`.
* `project_search`: queries the project’s knowledge base with `query`. `n` caps the hits and defaults to 5.
* `project_write`: creates or replaces a doc at `path` from exactly one of `content`, which carries inline text, or `local_path`, which names a file inside the working directory. `present_to_user: true` marks the written doc as the deliverable the user needs to see.
* `project_delete`: deletes a doc by `path`.

### ReadMcpResourceDir

**Tool name:** `ReadMcpResourceDirTool`Lists the direct children of a directory resource on an MCP server. Only usable against a server that has declared support for directory listing; the listing isn’t recursive. Directory listing isn’t enabled in every session: when it’s off, the call returns an empty `resources` list and the `error` field reports that directory listing isn’t enabled.

### RefreshMcpTools

**Tool name:** `RefreshMcpTools`Re-queries the tool list of connected MCP servers and applies any changes. The types are exported, but Claude Code registers the tool only when you set `CLAUDE_CODE_ENABLE_REFRESH_MCP_TOOLS=1` in the [`env` option](#options), and only in sessions with at least one MCP server. Requires Claude Code v2.1.211 or later.

### ShowOnboardingRolePicker

**Tool name:** `ShowOnboardingRolePicker`Renders a clickable role-picker chip row during Cowork onboarding so the user can pick their role and get a matching plugin installed. Takes no arguments; the role list is defined by the client. The call blocks until the user responds.

### McpInput

**Tool name:** dynamic MCP tool names of the form `mcp__<server>__<tool>`MCP tool arguments are an open object: each server defines its own parameters, so the type places no constraints on field names or values. Consult the server’s own tool schema for the fields a specific tool accepts.

Tool Output Types
-----------------

Documentation of output schemas for all built-in Claude Code tools. These types are exported from `@anthropic-ai/claude-agent-sdk` and represent the actual response data returned by each tool.

### `ToolOutputSchemas`

Union of tool output types exported from `@anthropic-ai/claude-agent-sdk`; members include:

### Agent

**Tool name:** `Agent`. The previous name `Task` is still accepted as an alias, and the `tools` array in the [`SDKSystemMessage`](#sdksystemmessage) init message currently lists this tool as `Task` for backward compatibility.Returns the result from the subagent. Discriminated on the `status` field: `"completed"` for finished tasks, `"async_launched"` for background tasks, and `"remote_launched"` for tasks Claude Code dispatched to a remote cloud session, where `sessionUrl` links to that session and `taskId` identifies it.
On the `completed` variant, `resolvedModel` names the model the subagent started on, which can differ from the requested `model` input when [`availableModels`](/docs/en/model-config#restrict-model-selection) or another override applies. This field requires Claude Code v2.1.174 or later. On `async_launched`, it names the model in use when the task moved to the background.
`modelsUsed` lists the models the subagent used, in order. The field is present only when a mid-run swap happened, and a model appears again when the run swapped back to it. On `async_launched`, the list covers the models used before backgrounding. Both `modelsUsed` and the backgrounding behavior of `resolvedModel` require Claude Code v2.1.212 or later.
If Claude Code [kept the subagent’s isolated worktree](/docs/en/worktrees#isolate-subagents-with-worktrees), `worktreePath` on the `completed` result is where to find it. `worktreeBranch` is its branch, present when Claude Code created the worktree with git.
Claude Code fills `usage` and `totalTokens` from the subagent’s final API request, not from the whole run, so `usage.service_tier` is the service tier string the API reported on that request. When present, `usage.output_tokens_details.thinking_tokens` is the number of that request’s output tokens that were thinking tokens. The `output_tokens_details` field requires TypeScript SDK v0.3.228 or later, which bundles Claude Code v2.1.228.
`usage.output_tokens_details` matches [`Usage.output_tokens_details`](#usage) in meaning, scoped to that final request, but every level of it is optional here. Guard both the object and the field, for example `usage.output_tokens_details?.thinking_tokens ?? 0`, rather than reading it directly.
Before v2.1.207, the published type was narrower. It omitted `worktreePath`, `worktreeBranch`, `citations`, `toolStats.frameCount`, and the `inference_geo`, `speed`, and `iterations` usage fields, and it typed `service_tier` as `"standard" | "priority" | "batch"`. Fields the type marks optional can be absent on results recorded by earlier versions.

### AskUserQuestion

**Tool name:** `AskUserQuestion`Returns the questions asked and the user’s answers. `response` is set when the user typed a freeform reply instead of answering the structured questions; when present, Claude receives “The user responded: …” instead of the per-question answer list.

### Bash

**Tool name:** `Bash`The `stdout`, `stderr`, and `backgroundTaskId` fields carry:
`timedOutAfterMs` is the timeout in milliseconds, set when the command reached its timeout and moved to the background rather than starting there explicitly. `backgroundCwdHint` is set when the backgrounded command contained a directory-change builtin such as `cd`, `pushd`, `popd`, or `chdir`, and notes that the session working directory didn’t change. Both fields require Claude Code v2.1.210 or later.
When a subagent running in the foreground owns a backgrounded command, Claude Code terminates the command when that subagent gives its final response. Claude Code sets `backgroundEndsWithFinalResponse` to `true` on such commands, and omits the field when the command survives the turn, as commands started by the main conversation or by background subagents do. The field requires Claude Code v2.1.227 or later.
Claude Code sets `gitOperation.commit.branch` to the branch named in git’s commit summary line, and omits it for a commit made on a detached HEAD. The field requires Agent SDK v0.3.227 or later. Claude Code reports a `gh pr reopen` command as the `reopened` PR action, which requires Agent SDK v0.3.234 or later.

### Monitor

**Tool name:** `Monitor`Returns the background task ID for the running monitor. Use this ID with `TaskStop` to cancel the watch early.

### Edit

**Tool name:** `Edit`Returns the structured diff of the edit operation.

### Read

**Tool name:** `Read`Returns file contents in a format appropriate to the file type. Discriminated on the `type` field.

### Write

**Tool name:** `Write`Returns the write result with structured diff information. What `originalFile` and `structuredPatch` hold depends on the write:

* For a newly created file, `originalFile` is null and `structuredPatch` is empty
* On an overwrite, `originalFile` carries the previous content, except when that content is larger than about 10 MB: Claude Code then skips the diff and returns `originalFile` null and `structuredPatch` empty
* `structuredPatch` is also empty when the write changed nothing or the diff timed out

### Glob

**Tool name:** `Glob`Returns file paths matching the glob pattern, sorted by modification time.
`totalMatches` and `countIsComplete` require Claude Code v2.1.191 or later. `totalMatches` reports the number of matching files before truncation. When `countIsComplete` is false, `totalMatches` is a lower bound because the underlying search truncated its own output.

### Grep

**Tool name:** `Grep`Returns search results. The shape varies by `mode`: file list, content with matches, or match counts. In `count` mode, `numFiles` and `numMatches` are totals over the full result set, not the paginated slice. Before v2.1.208, a `head_limit` or `offset` that truncated the listed entries also truncated those totals.
`totalFiles` requires Claude Code v2.1.208 or later and reports the total number of results before `head_limit` and `offset` pagination in `files_with_matches` mode. `totalLines` requires Claude Code v2.1.210 or later and reports the total number of lines before pagination in `content` mode.

### TaskStop

**Tool name:** `TaskStop`Returns confirmation after stopping the background task.

### NotebookEdit

**Tool name:** `NotebookEdit`Returns the result of the notebook edit with original and updated file contents.

### WebFetch

**Tool name:** `WebFetch`Returns the fetched content with HTTP status and metadata.
`artifactRead` is Claude Code’s own record of an artifact read, present only when Claude fetched an artifact the session can publish to. Claude Code reads it back when a session resumes so a later publish builds on the right version; your code doesn’t need to act on it. `slug` names the artifact, `ver` is the version the read put on record and is absent when it recorded none, and `seeded: false` marks a read whose full source didn’t reach Claude. The `seeded` field requires Agent SDK v0.3.239 or later.

### WebSearch

**Tool name:** `WebSearch`Returns search results from the web.

### Workflow

**Tool name:** `Workflow`Returns immediately after the tool accepts the invocation. The final result arrives later as a task completion. Check `error` before treating the run as started: a script that fails its syntax check returns `status: "async_launched"` with `error` set, and never runs.

### TodoWrite

**Tool name:** `TodoWrite`Returns the previous and updated task lists.

The following tools are available by default only on Claude 3.x models, Opus 4 through 4.7, Sonnet 4 through 4.6, and Haiku 4.5. On every other model, including model IDs Claude Code doesn’t recognize, they aren’t available unless you opt in:

* `TodoWrite`
* `TaskCreate`
* `TaskGet`
* `TaskUpdate`
* `TaskList`

Wherever the tools are available, Claude Code provides the four Task tools, or `TodoWrite` instead when you set `CLAUDE_CODE_ENABLE_TASKS=0`.This default set applies in Claude Code v2.1.268 and later, which the TypeScript Agent SDK bundles from v0.3.268.See [Model availability](/docs/en/agent-sdk/todo-tracking#model-availability) to opt in.

### TaskCreate

**Tool name:** `TaskCreate`Returns the created task with its assigned ID.

### TaskUpdate

**Tool name:** `TaskUpdate`Returns the update result, including which fields changed.

### TaskGet

**Tool name:** `TaskGet`Returns the full task record, or `null` when the ID is not found.

### TaskList

**Tool name:** `TaskList`Returns a snapshot of all tasks in the current list.

### ExitPlanMode

**Tool name:** `ExitPlanMode`Returns the plan state after exiting plan mode.

### ListMcpResources

**Tool name:** `ListMcpResourcesTool`Returns an array of available MCP resources.

### ReadMcpResource

**Tool name:** `ReadMcpResourceTool`Returns the contents of the requested MCP resource.

### EnterWorktree

**Tool name:** `EnterWorktree`Returns information about the git worktree.

### ExitWorktree

**Tool name:** `ExitWorktree`Returns the action taken and details about the worktree that was exited.

### EnterPlanMode

**Tool name:** `EnterPlanMode`Returns a confirmation that plan mode was entered.

### CronCreate

**Tool name:** `CronCreate`Returns the job ID and a human-readable description of the schedule.

### CronDelete

**Tool name:** `CronDelete`Returns the ID of the deleted job.

### CronList

**Tool name:** `CronList`Returns the scheduled cron jobs: durable jobs from `.claude/scheduled_tasks.json` and session-only jobs from the current session. A session-only job carries `durable: false`; jobs read from disk omit the field.

### ScheduleWakeup

**Tool name:** `ScheduleWakeup`Returns when the wake-up will fire as an epoch millisecond timestamp, the delay actually used, and whether the requested delay was clamped. The `stopped` field is `true` when the call ended the loop with `stop: true`. It requires Claude Code v2.1.202 or later. The `cancelledWakeups` field counts how many pending wakeups a `stop: true` call cancelled. A value of 0 means nothing was pending, and a recurring `/loop` cron isn’t cancelled by `stop: true`. It requires Claude Code v2.1.206 or later.

### RemoteTrigger

**Tool name:** `RemoteTrigger`Returns the API response status and body for the trigger operation.

### PushNotification

**Tool name:** `PushNotification`Returns delivery details, including whether a push or local notification was sent and why delivery was skipped.

### REPL

**Tool name:** `REPL`Returns the execution result, captured console output, and any images or documents surfaced by inner `Read` calls.

### ReportFindings

**Tool name:** `ReportFindings`Returns the number of findings reported, the effort level the review ran at, and the findings echoed back for the result body. Requires Claude Code v2.1.196 or later. The echoed `short_summary` field requires Claude Code v2.1.212 or later.

### Artifact

**Tool name:** `Artifact`Returns the published page’s `url` and the local `path` that was published for the publish action, with `updated` set to true when the publish redeployed an existing artifact, and `warnings` carrying any publish-time advisories. The list action returns the `artifacts` rows instead, with `truncated` set when more artifacts exist than the requested limit. On listings whose scope isn’t `"mine"`, each row carries `rel` marking whether the user owns the artifact or it was shared with them, and the output’s `scope` records which non-default scope produced the listing; both are absent on default listings.

### Projects

**Tool name:** `Projects`Discriminated on the `method` field, mirroring the input. `project_read` returns small text docs inline in `content` and writes larger docs to a `local_file` path instead; `project_search` returns RAG `hits` with `rag: true` when the project’s index is available and falls back to a `docs` path list otherwise.

### ReadMcpResourceDir

**Tool name:** `ReadMcpResourceDirTool`Returns the direct children of the directory resource. Subdirectories appear with mimeType `"inode/directory"`; `error` carries a human-readable message when the server couldn’t list the directory.

### RefreshMcpTools

**Tool name:** `RefreshMcpTools`Returns one entry per server: `refreshed` means the re-queried tool list was applied, `error` means the re-query failed and the previous tool set was kept, and `not_connected` means the server has no live connection to query.

### ShowOnboardingRolePicker

**Tool name:** `ShowOnboardingRolePicker`Returns the user’s selection: `role` when they picked a role chip or typed one, and `dismissed: true` when they closed the picker. An empty object means the user approved the call without picking a role.

### McpOutput

**Tool name:** dynamic MCP tool names of the form `mcp__<server>__<tool>`MCP tool results are returned as a string or an array of content blocks, depending on the server. The trailing plain-object branch in the exported type is a schema-generation artifact: the SDK doesn’t return a bare object, because a server’s structured output is serialized to a JSON string before being returned. At runtime the value may also be `undefined`, although the exported type doesn’t model this.

Permission Types
----------------

### `PermissionUpdate`

Operations for updating permissions.

### `PermissionBehavior`

### `PermissionUpdateDestination`

### `PermissionRuleValue`

Other Types
-----------

### `ApiKeySource`

Where the API key for the session’s requests came from, reported as `apiKeySource` on the [`SDKSystemMessage`](#sdksystemmessage) init message.Claude Code reports one of four values:
Agent SDK v0.3.234 and later list these four values in the type. The type also keeps `user`, `project`, `org`, `temporary`, and `oauth` so older code still compiles, and Claude Code doesn’t report them.

### `SdkBeta`

Available beta features that can be enabled via the `betas` option. See [Beta headers](https://platform.claude.com/docs/en/api/beta-headers) for more information.

The `context-1m-2025-08-07` beta is retired as of April 30, 2026. Passing this value with Claude Sonnet 4.5 or Sonnet 4 has no effect, and requests that exceed the standard 200k-token context window return an error. To use a 1M-token context window, migrate to [Claude Opus 5, Claude Sonnet 5, Claude Sonnet 4.6, Claude Opus 4.6, Claude Opus 4.7, or Claude Opus 4.8](https://platform.claude.com/docs/en/about-claude/models/overview), which include 1M context at standard pricing with no beta header required.

### `SlashCommand`

Information about an available command.

### `ModelInfo`

Information about an available model.

### `AgentInfo`

Information about an available subagent that can be invoked via the Agent tool.

### `McpServerStatus`

Status of a connected MCP server.

### `McpServerStatusConfig`

The configuration of an MCP server as reported by `mcpServerStatus()`. This is the union of all MCP server transport types.See [`McpServerConfig`](#mcpserverconfig) for details on each transport type.

### `AccountInfo`

Account information for the authenticated user.

### `ModelUsage`

Per-model usage statistics returned in result messages. The `costUSD` value is a client-side estimate. See [Track cost and usage](/docs/en/agent-sdk/cost-tracking) for billing caveats.`thinkingTokens` counts the thinking tokens this model generated. `outputTokens` already includes them, so don’t add the two together. The field is absent until a turn runs on a Claude Code version that records it, so a resumed session that began on an earlier version reports a partial count. `thinkingTokens` requires Agent SDK v0.3.257 or later.
The `canonicalModel` and `provider` fields require Claude Code v2.1.218 or later. `canonicalModel` is the canonical model ID that the pricing lookup uses; it can differ from the raw model string that keys the entry, for example when that string is a provider-specific ID or an alias.
`provider` names the API backend that served the model, such as `firstParty`, `bedrock`, `vertex`, `foundry`, `anthropicAws`, `mantle`, or `gateway`.
`costBasis` names the price table that priced the model’s latest request: `list` for list price, `managed` for a [`modelPricing`](/docs/en/settings-reference#modelpricing) table, or `unknown` when neither matched the model ID. The field requires Claude Code v2.1.246 or later.

### `ConfigScope`

### `NonNullableUsage`

A version of [`Usage`](#usage) with all nullable fields made non-nullable.

### `Usage`

Token usage statistics. This is the `BetaUsage` type from `@anthropic-ai/sdk`.`BetaServerToolUsage`, `BetaIterationsUsage`, and `BetaOutputTokensDetails` are defined in `@anthropic-ai/sdk`.
`output_tokens_details` breaks the billed output down by category. It currently carries one field, `thinking_tokens: number`, counting the output tokens the model generated as internal reasoning, including the thinking-block delimiters. The `output_tokens_details` field requires TypeScript SDK v0.3.228 or later, which bundles Claude Code v2.1.228.

* **Billing**: read the breakdown for observability, not for billing. `output_tokens` stays the authoritative total, and `output_tokens - thinking_tokens` approximates the non-reasoning output.
* **What the count covers**: the raw reasoning the model produced, which can be longer than the thinking text returned in the response body. The API computes it by re-tokenizing that raw text, so it can differ from the model’s exact generation count by a few tokens.
* **Streaming**: on streamed assistant messages this breakdown, like `output_tokens`, is a `message_start` placeholder and carries no real count, so read it from the result message’s `usage` as [Read output tokens from the result message](/docs/en/agent-sdk/cost-tracking#read-output-tokens-from-the-result-message) describes. On the result message, `thinking_tokens` reads `0` when the model or provider reports no breakdown.
* **`null` cases**: `output_tokens_details` itself is `null` on assistant messages Claude Code synthesizes, such as API-error messages.

### `CallToolResult`

MCP tool result type (from `@modelcontextprotocol/sdk/types.js`). `structuredContent` is a JSON object that can be returned alongside `content`, including image blocks. See [Return structured data](/docs/en/agent-sdk/custom-tools#return-structured-data).

### `SDKMcpResourceLink`

One file an MCP tool returned by reference. Claude Code builds each entry from a `resource_link` block in the tool’s result and delivers the list as `resourceLinks` on [`SDKUserMessage.tool_use_result`](#sdkusermessage), or as `resource_links` on [`SDKTaskNotificationMessage`](#sdktasknotificationmessage) when the call finished in the background. Requires Agent SDK v0.3.257 or later.Claude Code drops a block whose `uri` or `name` isn’t a string, and leaves out an optional field whose value isn’t of the listed type.

### `ThinkingConfig`

Controls Claude’s thinking/reasoning behavior. Takes precedence over the deprecated `maxThinkingTokens`.The optional `display` field controls whether thinking text is returned `"summarized"` or `"omitted"`. On Claude Opus 4.7 and later, the API default is `"omitted"`, so set `"summarized"` to receive thinking content in `thinking` blocks. Claude Code doesn’t send `display` to Amazon Bedrock or Google Cloud’s Agent Platform, so on those providers Opus 4.7 and later return empty `thinking` blocks even when you set `display` to `"summarized"`.

### `SpawnedProcess`

Interface for custom process spawning (used with `spawnClaudeCodeProcess` option). `ChildProcess` already satisfies this interface.

### `SpawnOptions`

Options passed to the custom spawn function.

The `signal` field tells your spawn function when to tear down the process. Pass it as the `signal` option to Node’s `spawn()`, or pass it to your VM or container teardown handler.This signal does not fire the instant [`Options.abortController`](#options) aborts. The SDK first closes the process’s stdin and waits about two seconds so the CLI can shut down cleanly, then aborts this signal. To react the moment the caller aborts instead, listen on your own `Options.abortController.signal`, which your spawn function can reference from its enclosing scope.

### `McpSetServersResult`

Result of a `setMcpServers()` operation.When you call `setMcpServers()`, Claude Code applies these rules:

* **Servers the call doesn’t name**: Claude Code keeps plugin-provided servers running. Requires Agent SDK v0.3.210 or later.
* **Servers the call names**: except for built-in servers the CLI started at startup, Claude Code replaces a running server only when its config differs from the one you passed.
* **Built-in servers the CLI started at startup**: if the call names one, Claude Code drops that entry and reports it in `errors`.

The promise resolves after newly added stdio, HTTP, and SSE servers connect or fail, so tools from servers that connected are available on the next turn.
`added` lists the servers Claude Code added or replaced, whether or not they connected. A server that failed to connect appears in both `added` and `errors`, with the failure text under `errors` and a `failed` row in [`mcpServerStatus()`](#methods). Before Claude Code v2.1.257, a server whose connection attempt threw was reported only under `errors`.

### `RewindFilesResult`

Result of a `rewindFiles()` operation.`skippedLinks` counts the tracked paths the rewind refused to restore or delete for link safety: a symlink, hard link, or other non-regular file at the tracked path, a parent directory that no longer resolves to where it pointed when the checkpoint was taken, or a backup that couldn’t be read safely. The field requires Claude Code v2.1.216 or later. A preview call with `rewindFiles(userMessageId, { dryRun: true })` never sets it.

### `SDKStatusMessage`

Status update message (e.g., compacting).

### `SDKTaskNotificationMessage`

Notification when a background task completes, fails, or is stopped. Background tasks include `run_in_background` Bash commands, [Monitor](#monitor) watches, and background subagents. For the `ambient` field, see [`SDKTaskStartedMessage`](#sdktaskstartedmessage), which defines it and its version requirement.When Claude Code [moves a long MCP tool call to the background](/docs/en/mcp#automatic-backgrounding-of-long-tool-calls), the `tool_result` block for that call holds only a placeholder and the call’s real result arrives in this notification. Match the notification to the call with `tool_use_id`. On a `completed` notification, `resource_links` lists the files the tool returned by reference as [`SDKMcpResourceLink`](#sdkmcpresourcelink) entries, with the same 50-link and 64 KiB limits as [`tool_use_result.resourceLinks`](#sdkusermessage). Claude Code omits `resource_links` when the result had no links and on notifications for tasks that aren’t MCP tool calls. `resource_links` requires Agent SDK v0.3.257 or later.
Claude Code prepends a notice to every task notification it sends to the model, except deliveries stamped with the [`scheduled-trigger` subkind](#task-notification-subkinds), which carry an assigned-task framing instead. The notice states that no human input has occurred, so the model doesn’t treat the notification as a user instruction or approval.
To detect a task-notification turn, check `origin.kind === "task-notification"` on the [`SDKUserMessage`](#sdkusermessage) or [`SDKResultMessage`](#sdkresultmessage) rather than matching on the notice text. Read `subkind` from the same field if you need to know what raised it. Before v2.1.205, Claude Code left the notice off notifications that arrived while the session was idle.

### `SDKToolUseSummaryMessage`

Summary of tool usage in a conversation.

### `SDKHookStartedMessage`

Emitted when a hook begins executing.
Claude Code delivers this message, [`SDKHookProgressMessage`](#sdkhookprogressmessage), and [`SDKHookResponseMessage`](#sdkhookresponsemessage) to the message stream immediately, including while a `SessionStart` or `Setup` hook is still running during session startup. Claude Code v2.1.169 through v2.1.203 delivered these messages in one batch after a `SessionStart` or `Setup` hook completed; v2.1.204 restored live delivery.

### `SDKHookProgressMessage`

Emitted while a hook is running, with stdout/stderr output.

### `SDKHookResponseMessage`

Emitted when a hook finishes executing.

### `SDKToolProgressMessage`

Emitted periodically while a tool is executing to indicate progress.While a tool call runs in the main conversation, Claude Code emits a `tool_progress` message every 30 seconds with `heartbeat: true`. Each heartbeat carries the tool name and elapsed seconds, so you can distinguish a long-running call from a stalled session. Claude Code doesn’t emit heartbeats for tool calls inside a subagent. The `heartbeat` field requires Agent SDK v0.3.214 or later. Before v2.1.257, Claude Code didn’t emit heartbeats for a foreground Agent tool call either.
On `tool_progress` messages for the Agent tool other than heartbeats, `subagent_type` names the running subagent type, such as `general-purpose`. `subagent_retry` is present while that subagent waits out an API error backoff, such as a rate limit or overload, with one message per retry attempt. Both fields require Agent SDK v0.3.214 or later.
To render a retry indicator from `subagent_retry`:

* Track the indicator by `parent_tool_use_id`, which is unique per subagent. `tool_use_id` is shared by parallel subagents from one assistant turn, so tracking by it would let one subagent’s update clear another’s indicator.
* Clear the indicator when a later `tool_progress` for the same `parent_tool_use_id` arrives with neither `subagent_retry` nor `heartbeat: true`, or when the tool’s result message arrives. Frames with `heartbeat: true` report liveness only, so keep the indicator when one arrives. `attempt` can exceed `max_retries` under persistent retry, so don’t derive clearing from the counters.
* Treat `error_category` as a token for choosing your own message text, not as display text. The values are `rate_limit`, `overloaded`, `authentication_failed`, `server_error`, `cloud_credential_error`, and `unknown`. Handle a value you don’t recognize the way you handle `unknown`, because later releases can add values.

### `SDKAuthStatusMessage`

Emitted during authentication flows.

### `SDKTaskStartedMessage`

Emitted when a task begins. The `task_type` field is `"local_bash"` for Bash commands and [Monitor](#monitor) watches, `"local_agent"` for subagents, or `"remote_agent"`.`ambient` is `true` for tasks that aren’t part of the session’s work, such as tasks Claude Code runs for its own operation. Live-update watchers are also ambient, including watchers the user asked for. Exclude ambient tasks from activity indicators. The field requires Agent SDK v0.3.247 or later.
`ambient` also appears on [`SDKTaskNotificationMessage`](#sdktasknotificationmessage) and on [`SDKBackgroundTasksChangedMessage`](#sdkbackgroundtaskschangedmessage) entries.
`is_backgrounded` and `spawn_depth` describe how Claude Code started the task. Both fields require Agent SDK v0.3.238 or later.

* `is_backgrounded`: Claude Code sets it on `"local_agent"` and `"local_bash"` tasks. `true` means the task runs in the background. `false` means the task runs in the foreground, and the tool call that started it stays blocked until the task finishes or moves to the background.
* `spawn_depth`: Claude Code sets it on `"local_agent"` tasks only. A subagent that the main thread spawned has depth `1`. A subagent that a depth `1` subagent spawned has depth `2`, and so on.

A [resumed subagent](/docs/en/agent-sdk/subagents#resume-subagents) always reports `is_backgrounded: true`, because Claude Code runs every resumed subagent in the background. When a foreground task moves to the background later, Claude Code reports the new `is_backgrounded` value in a [`task_updated`](#sdktaskupdatedmessage) message rather than sending a second `task_started`.

### `SDKTaskProgressMessage`

Emitted periodically while a subagent or background task is running. The `summary` field is populated only when [`agentProgressSummaries`](#options) is enabled.

### `SDKTaskUpdatedMessage`

Emitted when a background task’s state changes, such as when it transitions from `running` to `completed`. Merge `patch` into your local task map keyed by `task_id`. The `end_time` field is a Unix epoch timestamp in milliseconds, comparable with `Date.now()`.

### `SDKBackgroundTasksChangedMessage`

Emitted whenever the set of live background tasks changes: a task starts, completes, is killed, a foreground agent is backgrounded, or a task’s `description` or `ambient` field changes.
The `tasks` array is the full live set. Replace any cached set with each payload instead of pairing `task_started` and `task_notification` events, so the next membership change corrects any event you missed.
Ordering relative to those per-task events is unspecified, so don’t correlate the two streams.
Nothing is emitted at startup. Reset to an empty set whenever the session’s CLI process starts or restarts and let the next membership change repopulate it.
When you send a repeated `initialize` control request to a running session, such as with [`reinitialize()`](#query-object) after a transport gap, Claude Code follows the response with a snapshot of the current live set, even when it is empty. A reconnecting host therefore learns what is running without waiting for the next membership change. Before Agent SDK v0.3.239, Claude Code sent no snapshot after a repeated `initialize`.
Requires Claude Code v2.1.203 or later.

### `SDKThinkingTokensMessage`

Emitted while Claude is producing a thinking block, including a redacted one. `estimated_tokens` is a running estimate of the thinking tokens generated so far in the current block, and `estimated_tokens_delta` is the increment carried by this frame. Use these estimates for progress display.
When the model or provider reports a breakdown, the final count for the top-level agent loop is the result message’s [`usage.output_tokens_details.thinking_tokens`](#usage), which [doesn’t include subagent tokens](/docs/en/agent-sdk/cost-tracking#get-the-total-cost-of-a-query).
Requires Claude Code v2.1.153 or later.

### `SDKFilesPersistedEvent`

Emitted when file checkpoints are persisted to disk.

### `SDKRateLimitEvent`

Emitted when the session encounters a rate limit.When `errorCode` is `"credits_required"`, the rejection is from a claude.ai subscription whose included usage is exhausted, and the session cannot continue until the user buys usage credits. `canUserPurchaseCredits` indicates whether the authenticated user can buy credits for the account, and `hasChargeableSavedPaymentMethod` indicates whether a saved payment method is on file. All three fields are absent on rate-limit events that are not credits-required rejections. Requires Claude Code v2.1.181 or later.

### `SDKLocalCommandOutputMessage`

Claude Code doesn’t emit this message type. When you send a command such as `/context` or `/usage` as a prompt, its output arrives as an [`SDKAssistantMessage`](#sdkassistantmessage).

### `SDKCommandsChangedMessage`

Emitted when the set of available commands changes mid-session, such as when Claude Code discovers skills as the agent enters a subdirectory. The `commands` array is the full updated list, so replace any cached command list with this payload. Calling [`supportedCommands()`](#query-object) after this message returns the same updated list, because the method tracks the latest push; this requires Agent SDK v0.3.216 or later. In earlier SDK versions, `supportedCommands()` returns the snapshot captured at initialization and never reflects mid-session changes.

### `SDKPromptSuggestionMessage`

Emitted after a turn when [`promptSuggestions`](#options) is enabled and Claude Code generated a suggestion for that turn. Contains the predicted next user prompt. For the turns that get none, see [When Claude Code skips suggestions](/docs/en/interactive-mode#when-claude-code-skips-suggestions).

### `SDKConversationResetMessage`

Emitted when the session’s conversation is replaced without ending the session. In a `query()` call, only `/clear` and its aliases produce this message. Mount an empty transcript under `new_conversation_id` and discard any cached session title.The SDK’s published typings declare `SDKConversationResetMessage` in Claude Code v2.1.203 and later. Before v2.1.203, `SDKMessage` referenced the type without declaring it, so narrowing on `type === "conversation_reset"` failed to typecheck when `skipLibCheck` was disabled.

### `AbortError`

Custom error class for abort operations.`AbortError` is the only error class in the SDK’s typed API. Other failures, such as the Claude Code process exiting or failing to launch, reject the message iteration with errors that carry no SDK class to match on. [Troubleshooting](/docs/en/agent-sdk/troubleshooting) keys those errors by message, with the cause and fix for each.

Sandbox Configuration
---------------------

### `SandboxSettings`

Configuration for sandbox behavior. Use this to enable command sandboxing and configure network restrictions programmatically.

The sandbox depends on platform support and, on Linux, tools like `bubblewrap` and `socat`. When `enabled` is `true` and the sandbox can’t start, `query()` reports a `result` message with `subtype: "error_during_execution"` and the reason in `errors`. For a single message `query()` call, the SDK throws after yielding that error result, so wrap the loop in a try block to continue past it. See [Handle the result](/docs/en/agent-sdk/agent-loop#handle-the-result) for the error contract.To run unsandboxed instead, set `failIfUnavailable: false`.

#### Example usage

**Unix socket security:** The `allowUnixSockets` option can grant access to system services that reach outside the sandbox. For example, allowing `/var/run/docker.sock` effectively grants full host system access through the Docker API, bypassing sandbox isolation. Only allow Unix sockets that are strictly necessary and understand the security implications of each.

### `SandboxNetworkConfig`

Network-specific configuration for sandbox mode. These settings apply to sandboxed Bash commands when `enabled` is `true` in the parent [`SandboxSettings`](#sandboxsettings). They do not restrict the WebFetch tool, which uses [permission rules](/docs/en/permissions#webfetch) instead.

The built-in sandbox proxy enforces `allowedDomains` based on the requested hostname and does not terminate or inspect TLS traffic, so techniques such as [domain fronting](https://en.wikipedia.org/wiki/Domain_fronting) can potentially bypass it. See [Sandboxing security limitations](/docs/en/sandboxing#security-limitations) for details and [Secure deployment](/docs/en/agent-sdk/secure-deployment#traffic-forwarding) for configuring a TLS-terminating proxy.

### `SandboxFilesystemConfig`

Filesystem-specific configuration for sandbox mode.

### Permissions Fallback for Unsandboxed Commands

When `allowUnsandboxedCommands` is enabled, the model can request to run commands outside the sandbox by setting `dangerouslyDisableSandbox: true` in the tool input. These requests fall back to the existing permissions system, meaning your `canUseTool` handler is invoked, allowing you to implement custom authorization logic. Commands listed in `excludedCommands` instead bypass the sandbox automatically, with no model involvement; see [`SandboxSettings`](#sandboxsettings).
In the example below, `isCommandAuthorized` stands in for an authorization check you define.

Commands running with `dangerouslyDisableSandbox: true` have full system access. Ensure your `canUseTool` handler validates these requests carefully.If `permissionMode` is set to `bypassPermissions` and `allowUnsandboxedCommands` is enabled, the model can autonomously execute commands outside the sandbox without approval prompts, apart from the [actions no mode auto-approves](/docs/en/permission-modes#actions-no-mode-auto-approves). This combination effectively allows the model to escape sandbox isolation silently.

See also
--------

* [SDK overview](/docs/en/agent-sdk/overview) - General SDK concepts
* [Python SDK reference](/docs/en/agent-sdk/python) - Python SDK documentation
* [CLI reference](/docs/en/cli-reference) - Command-line interface
* [Common workflows](/docs/en/common-workflows) - Step-by-step guides

Was this page helpful?

YesNo

[Securely deploying AI agents](/docs/en/agent-sdk/secure-deployment)[TypeScript V2 (removed)](/docs/en/agent-sdk/typescript-v2-preview)

[Claude Code Docs home page![light logo](https://mintcdn.com/claude-code/c5r9_6tjPMzFdDDT/logo/light.svg?fit=max&auto=format&n=c5r9_6tjPMzFdDDT&q=85&s=78fd01ff4f4340295a4f66e2ea54903c)![dark logo](https://mintcdn.com/claude-code/c5r9_6tjPMzFdDDT/logo/dark.svg?fit=max&auto=format&n=c5r9_6tjPMzFdDDT&q=85&s=1298a0c3b3a1da603b190d0de0e31712)](/docs/en/overview)

[x](https://x.com/AnthropicAI)[linkedin](https://www.linkedin.com/company/anthropicresearch)

Company

[Anthropic](https://www.anthropic.com/company)[Careers](https://www.anthropic.com/careers)[Economic Futures](https://www.anthropic.com/economic-futures)[Research](https://www.anthropic.com/research)[News](https://www.anthropic.com/news)[Trust center](https://trust.anthropic.com/)[Transparency](https://www.anthropic.com/transparency)

Help and security

[Availability](https://www.anthropic.com/supported-countries)[Status](https://status.anthropic.com/)[Support center](https://support.claude.com/)

Learn

[Courses](https://www.anthropic.com/learn)[MCP connectors](https://claude.com/partners/mcp)[Customer stories](https://www.claude.com/customers)[Engineering blog](https://www.anthropic.com/engineering)[Events](https://www.anthropic.com/events)[Powered by Claude](https://claude.com/partners/powered-by-claude)[Service partners](https://claude.com/partners/services)[Startups program](https://claude.com/programs/startups)

Terms and policies

[Privacy choices](https://www.anthropic.com/legal/privacy)[Privacy policy](https://www.anthropic.com/legal/privacy)[Disclosure policy](https://www.anthropic.com/responsible-disclosure-policy)[Usage policy](https://www.anthropic.com/legal/aup)[Commercial terms](https://www.anthropic.com/legal/commercial-terms)[Consumer terms](https://www.anthropic.com/legal/consumer-terms)