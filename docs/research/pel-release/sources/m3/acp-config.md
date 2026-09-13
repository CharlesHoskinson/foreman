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

Session Config Options

[Protocol](/get-started/introduction)[RFDs](/rfds/about)[Community](/community/communication)[Publications](/publications)[Updates](/updates)[Brand](/brand)

v1

Session Config Options
======================

Copy page

Flexible configuration selectors for agent sessions

Copy page

Agents can provide an arbitrary list of configuration options for a session, allowing Clients to offer users customizable selectors for things like models, modes, reasoning levels, and more.

Session Config Options are the preferred way to expose session-level
configuration. If an Agent provides `configOptions`, Clients **SHOULD** use
them instead of the [`modes`](/protocol/v1/session-modes) field. Modes will be
removed in a future version of the protocol.

Initial State
-------------

During [Session Setup](/protocol/v1/session-setup) the Agent **MAY** return a list of configuration options and their current values:

configOptions

ConfigOption[]

The list of configuration options available for this session. The order of
this array represents the Agent’s preferred priority. Clients **SHOULD**
respect this ordering when displaying options.

### ConfigOption

id

string

required

Unique identifier for this configuration option. Used when setting values.

name

string

required

Human-readable label for the option

description

string

Optional description providing more details about what this option controls

category

ConfigOptionCategory

Optional [semantic category](#option-categories) to help Clients provide
consistent UX.

type

ConfigOptionType

required

The type of input control. `select` is supported by default. `boolean` is only
supported when the Client advertises `session.configOptions.boolean: {}` in
`clientCapabilities`.

currentValue

string | boolean

required

The current value for this option. For `select` options this is a string value
ID. For `boolean` options this is a boolean.

options

ConfigOptionValue[]

The available values for a `select` option. Required when `type` is `"select"`
and omitted when `type` is `"boolean"`.

### ConfigOptionValue

value

string

required

The value identifier used when setting this option

name

string

required

Human-readable name to display

description

string

Optional description of what this value does

### Boolean Config Options

Agents **MAY** include boolean config options only after the Client advertises
support during initialization:Omitting `session`, `configOptions`, or `boolean` means the Client does not
advertise support.
When support is advertised, a boolean option uses `type: "boolean"` and a
boolean `currentValue`:Agents **MUST NOT** include `type: "boolean"` options in `configOptions`
payloads unless the Client advertised support. Agents that need to support
older Clients should omit the boolean option or provide a `select` fallback.

Option Categories
-----------------

Each config option **MAY** include a `category` field. Categories are semantic metadata intended to help Clients provide consistent UX, such as attaching keyboard shortcuts, choosing icons, or deciding placement.

Categories are for UX purposes only and **MUST NOT** be required for
correctness. Clients **MUST** handle missing or unknown categories gracefully.

Category names beginning with `_` are free for custom use (e.g., `_my_custom_category`). Category names that do not begin with `_` are reserved for the ACP spec.
Clients **SHOULD** render `model_config` options near the `model` selector, such as in the same popover or panel. No capability negotiation is required for category values.
When multiple options share the same category, Clients **SHOULD** use the array ordering to resolve ties, preferring earlier options in the list for prominent placement or keyboard shortcuts.

Option Ordering
---------------

The order of the `configOptions` array is significant. Agents **SHOULD** place higher-priority options first in the list.
Clients **SHOULD**:

* Display options in the order provided by the Agent
* Use ordering to resolve ties when multiple options share the same category
* If displaying a limited number of options, prefer those at the beginning of the list

Default Values and Graceful Degradation
---------------------------------------

Agents **MUST** always provide a default value for every configuration option. This ensures the Agent can operate correctly even if:

* The Client doesn’t support configuration options
* The Client chooses not to display certain options
* The Client receives an option type it doesn’t recognize

If a Client receives an option with an unrecognized `type`, it **SHOULD** ignore that option. The Agent will continue using its default value.

Setting a Config Option
-----------------------

The current value of a config option can be changed at any point during a session, whether the Agent is idle or generating a response.

### From the Client

Clients can change a config option value by calling the `session/set_config_option` method:

sessionId

SessionId

required

The ID of the session

configId

string

required

The `id` of the configuration option to change

value

string | boolean

required

The new value to set. For `select` options, this must be one of the values
listed in the option’s `options` array. For `boolean` options, this must be a
boolean.

For boolean options, Clients send `type: "boolean"` with a boolean `value`:The Agent **MUST** respond with the complete list of all configuration options and their current values:

The response always contains the **complete** configuration state. This allows
Agents to reflect dependent changes. For example, if changing the model
affects available reasoning options, or if an option’s available values change
based on another selection.

### From the Agent

The Agent can also change configuration options and notify the Client by sending a `config_option_update` session notification:This notification also contains the complete configuration state. Common reasons an Agent might update configuration options include:

* Switching modes after completing a planning phase
* Falling back to a different model due to rate limits or errors
* Adjusting available options based on context discovered during execution

Relationship to Session Modes
-----------------------------

Session Config Options supersede the older [Session Modes](/protocol/v1/session-modes) API. However, during the transition period, Agents that provide mode-like configuration **SHOULD** send both:

* `configOptions` with a `category: "mode"` option for Clients that support config options
* `modes` for Clients that only support the older API

If an Agent provides both `configOptions` and `modes` in the session response:

* Clients that support config options **SHOULD** use `configOptions` exclusively and ignore `modes`
* Clients that don’t support config options **SHOULD** fall back to `modes`
* Agents **SHOULD** keep both in sync to ensure consistent behavior regardless of which field the Client uses

Learn about the Session Modes API

Was this page helpful?

YesNo

[Previous](/protocol/v1/session-modes)[Slash Commands

Advertise available slash commands to clients

Next](/protocol/v1/slash-commands)

[github](https://github.com/agentclientprotocol/agent-client-protocol)

[Powered byThis documentation is built and hosted on Mintlify, a developer documentation platform](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=zed-685ed6d6)