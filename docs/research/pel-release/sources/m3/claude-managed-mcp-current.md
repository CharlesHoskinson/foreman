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

Setup and access

Control MCP server access for your organization

[Getting started](/docs/en/overview)[Build with Claude Code](/docs/en/agents)[Administration](/docs/en/admin-setup)[Configuration](/docs/en/settings)[Reference](/docs/en/cli-reference)[Agent SDK](/docs/en/agent-sdk/overview)[What's New](/docs/en/whats-new)[Resources](/docs/en/legal-and-compliance)

Setup and access

Control MCP server access for your organization
===============================================

Copy page

Restrict which MCP servers users can add or connect to, or provide servers to every user, with managed configuration files, managed settings, allowlists, and denylists.

Copy page

By default, anyone running Claude Code can connect any [MCP server](/docs/en/mcp) they choose. Anthropic reviews connectors against its [listing criteria](https://claude.com/docs/connectors/building/review-criteria) before adding them to the [Anthropic Directory](https://claude.ai/directory), but doesn’t security-audit or manage any MCP server. As an administrator, you can restrict which servers run in your organization, from deploying a fixed approved set to disabling MCP entirely, and you can provide servers to every user.
These restrictions cover the servers Claude Code loads itself, including the connectors it fetches from claude.ai. Connectors the desktop app delivers to its local and SSH sessions arrive in-process and are governed from your claude.ai organization settings instead; [How connectors reach Claude Code](/docs/en/mcp#how-connectors-reach-claude-code) shows which controls apply to connectors in each kind of session, including cloud sessions.
This page covers how to:

* [Choose a pattern](#choose-a-pattern) that matches how much control you need
* [Deploy a fixed server set with `managed-mcp.json`](#exclusive-control-with-managed-mcp-json), including how to [disable MCP entirely](#disable-mcp-entirely)
* [Provide servers through managed settings](#provide-servers-through-managed-settings) while users keep their own
* [Control servers with allowlists and denylists](#policy-based-control-with-allowlists-and-denylists)
* [Tell users what to expect](#how-restrictions-appear-to-users) when a restriction blocks a server
* [Monitor which servers your organization actually uses](#monitor-mcp-usage)

The [Security](/docs/en/security) page covers the MCP threat model and how to evaluate a server before approving it. [Decide what to enforce](/docs/en/admin-setup#decide-what-to-enforce) covers MCP restrictions alongside the other administrative controls.

Choose a pattern
----------------

Claude Code supports a range of restriction levels. Each pattern uses one or more of the mechanisms covered below: `managed-mcp.json` for deploying a fixed set, the `managedMcpServers` managed setting for providing servers alongside the ones users add, and `allowedMcpServers`/`deniedMcpServers` for filtering what users configure.

Claude Code doesn’t have a built-in MCP server registry that users can browse and install from. For the approved-catalog pattern, share the approved list and its `claude mcp add` commands somewhere your users will find them, such as an internal wiki, or distribute the servers as plugins through a [managed plugin marketplace](/docs/en/plugin-marketplaces#managed-marketplace-restrictions) so users can browse and install them from `/plugin`.

Exclusive control with managed-mcp.json
---------------------------------------

If you deploy a `managed-mcp.json` file, Claude Code loads only the servers that file defines, the servers you [provide through `managedMcpServers`](#provide-servers-through-managed-settings), plus any in-process servers the app that started the session registers, such as the VS Code extension’s own server or the [connectors the desktop app delivers](/docs/en/mcp#how-connectors-reach-claude-code). Users can’t add, modify, or use any other MCP servers, including plugin-provided servers and servers passed with the [`--mcp-config` CLI flag](/docs/en/cli-reference#cli-flags). The file also suppresses the claude.ai connectors Claude Code fetches itself unless you [allow them alongside the managed set](#allow-claude-ai-connectors-alongside-the-managed-set).

### Deploy managed-mcp.json

`managed-mcp.json` is a standalone file, so it cannot be delivered through [server-managed settings](/docs/en/server-managed-settings). To deliver servers through managed settings instead, without exclusive control, use [`managedMcpServers`](#provide-servers-through-managed-settings).
Any process that can write to a system path with administrator privileges can deploy the file. Across a fleet, that’s usually through device management tooling, such as Jamf or a configuration profile on macOS, Group Policy or Intune on Windows, or your fleet management of choice on Linux. Claude Code looks for the file at one of these paths:
The file uses the same format as a project [`.mcp.json`](/docs/en/mcp#project-scope) file:

### Authenticate with per-user credentials

Any user on the machine can read this file, so don’t store API keys or other credentials in `env` blocks. Pass per-user credentials with one of these instead:

* [`${VAR}` expansion](/docs/en/mcp#environment-variable-expansion-in-mcp-json) to read secrets from each user’s environment.
* [OAuth or per-user headers](/docs/en/mcp#authenticate-with-remote-mcp-servers) so each user authenticates as themselves.
* [`headersHelper`](/docs/en/mcp#use-dynamic-headers-for-custom-authentication) to generate credentials at connection time.

### Servers passed with `--mcp-config` or `--strict-mcp-config`

When a session receives servers through `--mcp-config` while `managed-mcp.json` is deployed, what the user sees differs between a workstation and a cloud session:

* On a workstation, Claude Code exits at startup with `You cannot dynamically configure MCP servers when an enterprise MCP config is present`.
* In [cloud sessions](/docs/en/claude-code-on-the-web) on a host where the file is deployed, such as a [self-hosted runner](/docs/en/self-hosted-environments-configuration#mcp-servers), Claude Code starts with the managed servers only and skips the claude.ai connectors and other servers the cloud host delivers through `--mcp-config`. Nothing in the session tells the user which servers were left out. Claude Code names them in a warning on its stderr, which a self-hosted runner records at the `debug` log level.

If a user passes `--strict-mcp-config`, Claude Code exits at startup on a workstation and in a cloud session alike, because that flag asks to replace the managed set.

### How allowlists and denylists apply to the managed set

The denylist can further filter the servers in `managed-mcp.json`:

* `deniedMcpServers` applies to managed servers too, so a managed server that matches an entry won’t load.
* A user’s own `deniedMcpServers` merges in from their settings, so users can block a managed server for themselves.

`allowedMcpServers` doesn’t apply to the servers in `managed-mcp.json`, with one exception: Claude Code still checks a server whose definition uses [`${VAR}` expansion](/docs/en/mcp#environment-variable-expansion-in-mcp-json) against the allowlist, because that server’s effective configuration comes from each user’s environment rather than from the file alone. Before v2.1.259, every managed server had to pass the allowlist whenever one was set. See [How a server is evaluated](#how-a-server-is-evaluated) for which fields trigger the `${VAR}` check and the full order of checks.
If you used `allowedMcpServers` to keep some of your own `managed-mcp.json` servers from loading, those servers start loading on each user’s first launch of v2.1.259 or later unless they use `${VAR}` expansion, with no prompt or notice: only `deniedMcpServers` still subtracts from those servers. Add denylist entries for them, or deploy a separate `managed-mcp.json` per group, before your users upgrade.

### Validate the configuration

To confirm the file is in effect, run two checks on a managed machine:

1. `claude mcp list` shows only the servers in `managed-mcp.json`, plus any you provide through `managedMcpServers`. If a user’s own servers still appear, the file isn’t being read; check the path and permissions.
2. `claude mcp add --transport http test https://example.com/mcp` fails with `Cannot add MCP server: enterprise MCP configuration is active and has exclusive control over MCP servers`. The URL doesn’t need to be a real server, since the policy check rejects the command before anything is contacted.

### Disable MCP entirely

Deploy a `managed-mcp.json` containing an empty server map to block every MCP server apart from [in-process servers the app that started the session registers](#exclusive-control-with-managed-mcp-json):`claude mcp add` fails with the enterprise-policy error above. Servers users had previously configured stop loading the next time they start a session, with no warning that policy is the reason. Servers you provide through `managedMcpServers` still load under an empty map, so leave that key unset as well to disable MCP completely.

### Allow claude.ai connectors alongside the managed set

By default, deploying `managed-mcp.json` suppresses the [claude.ai connectors](/docs/en/mcp#use-mcp-servers-from-claude-ai) Claude Code fetches itself, including connectors an administrator configured for the organization in the claude.ai admin console. To load those connectors alongside the servers in `managed-mcp.json`, set `"allowAllClaudeAiMcps": true` in a [managed settings source](/docs/en/admin-setup#decide-how-settings-reach-devices).
With the setting enabled, Claude Code loads the same claude.ai connectors it would load if `managed-mcp.json` weren’t deployed. [Allowlists and denylists](#policy-based-control-with-allowlists-and-denylists) still apply to those connectors, so you can block specific ones with `deniedMcpServers`. The setting affects only the claude.ai connectors Claude Code fetches itself; plugin-provided servers stay suppressed.
Cloud sessions and the desktop app’s local and SSH sessions receive connectors another way, described in [How connectors reach Claude Code](/docs/en/mcp#how-connectors-reach-claude-code). A `managed-mcp.json` on the host that runs a cloud session, such as a [self-hosted runner host](/docs/en/self-hosted-environments-configuration#mcp-servers), suppresses that session’s connectors whether or not you set `allowAllClaudeAiMcps`. No `managed-mcp.json` reaches the connectors the desktop app delivers to its local and SSH sessions.
Claude Code reads `allowAllClaudeAiMcps` only from admin-controlled policy tiers: server-managed settings, an MDM-deployed plist or HKLM registry key, or a system `managed-settings.json` file. Placing it in user or project settings has no effect, so users cannot re-enable connectors that exclusive control suppressed.

Provide servers through managed settings
----------------------------------------

To give every user a set of remote MCP servers without taking exclusive control of MCP, list them under `managedMcpServers` in a [managed settings source](/docs/en/admin-setup#decide-how-settings-reach-devices): server-managed settings, a [Claude apps gateway](/docs/en/claude-apps-gateway-config#what-goes-in-cli) policy, an MDM profile or registry policy, or `managed-settings.json`. Users keep the servers they add themselves and receive yours in addition. Requires Claude Code v2.1.259 or later. Earlier clients ignore the key.
The value is an object keyed by server name. Each entry has the same shape as an HTTP or SSE server in a project [`.mcp.json`](/docs/en/mcp#project-scope) file, including the optional `headers` and `oauth` members described in [Authenticate with remote MCP servers](/docs/en/mcp#authenticate-with-remote-mcp-servers). This example provides a search server that each user signs in to with OAuth, and a records server that sends a header your organization issues:Anyone who can read the managed settings on a machine, including the user, can read a header value you set here. Use a credential issued for that whole audience, or leave `headers` out and let each user sign in with OAuth.

### What an entry can contain

Claude Code loads an entry only when it passes every check below. It drops an entry that fails one, records a notice you can read with `/status`, and still loads the other entries:

* `type` is `http` or `sse`. As in `.mcp.json`, `streamable-http` is accepted as an alias for `http`.
* `url` is an `https://` URL. Claude Code refuses a plain `http://` URL, including one that points at `localhost`.
* The entry has no `command`, `args`, `env`, or `headersHelper` member, so a managed settings document never names a program to run on a user’s machine.
* No value contains a `${VAR}` reference. Claude Code doesn’t expand environment variables in these entries, so write literal values.
* The server name contains only letters, numbers, hyphens, and underscores, and no key or value contains control or invisible formatting characters.

Claude Desktop has a managed setting with the same name whose value is an array of a different entry shape, so don’t copy one into the other. Claude Code doesn’t accept the array form and records a notice instead of loading it.
A Claude apps gateway runs the same checks when it boots; see [MCP servers in a policy](/docs/en/claude-apps-gateway-config#mcp-servers-in-a-policy).

### How provided servers load

These rules decide what loads when a provided server overlaps with another server definition or with another setting on this page:

* A provided server takes precedence over a server with the same name in local, project, or user scope, and over a plugin server or claude.ai connector that points at the same URL.
* If you also deploy `managed-mcp.json`, Claude Code loads its servers and the provided servers together, and the file’s entry takes precedence when both define a name.
* Provided servers keep loading when [`strictPluginOnlyCustomization`](/docs/en/settings-reference#strictpluginonlycustomization) locks the `mcp` surface.
* `deniedMcpServers` applies to provided servers, including entries from a user’s own settings, so a user can block one for themselves. Provided servers need no `allowedMcpServers` entry.

When you haven’t also deployed `managed-mcp.json`, the per-run flags keep their meaning:

* A server a user passes with `--mcp-config` under the same name replaces the provided one for that run and is checked against `allowedMcpServers`.
* `--strict-mcp-config` leaves provided servers out along with every other configured server.

With `managed-mcp.json` deployed, both flags behave as [Exclusive control with managed-mcp.json](#exclusive-control-with-managed-mcp-json) describes.

### What users can see and change

Users can’t edit or remove a provided server:

* `claude mcp remove` reports that the server is provided by the organization.
* When you haven’t also deployed `managed-mcp.json`, an entry a user adds under the same name is saved but not used while yours is present.
* Users can still turn a provided server off for themselves in [`/mcp`](/docs/en/mcp#disable-a-server-without-removing-it), which lists provided servers under **Managed MCPs**.

`claude mcp get` and `/mcp` show a provided server’s URL as its host only, for example `https://mcp.example.com/…`, and `claude mcp get` shows its header names without their values.

### Where `managedMcpServers` applies

Claude Code reads `managedMcpServers` from the managed source it selects under [How Claude Code combines managed sources](/docs/en/managed-settings#how-claude-code-combines-managed-sources). When that source sets [`managedSourcesBehavior`](/docs/en/settings-reference#managedsourcesbehavior) to `"merge"`, Claude Code provides the servers from every admin source instead, and when two sources define the same name, the higher-ranked source’s entry applies whole. It never reads the key from the user-writable HKCU registry, from [parent settings an embedding host supplies](/docs/en/managed-settings#parent-settings-from-embedding-hosts), or from user, project, or local settings files, where it drops the key with a warning.
Claude Code doesn’t read the key in the Claude Desktop app’s Code tab on a third-party deployment or in the app’s Cowork sessions, because Claude Desktop supplies and locks those sessions’ MCP servers itself. `/status` and `claude doctor` say so when your managed settings carry the key there.

### When provided servers connect

When `managedMcpServers` arrives through server-managed settings, its timing follows [Fetch and caching behavior](/docs/en/server-managed-settings#fetch-and-caching-behavior):

* On a machine with cached settings, Claude Code withholds the cached copy of this key until the server confirms the settings for the session, and waits for that confirmation before it loads MCP servers. If the confirmation fails, the session continues without the provided servers and `/status` says they are withheld.
* On a machine’s first launch, with nothing cached yet, an interactive session that starts before the settings arrive connects the provided servers as soon as they do, and a `claude -p` run that has already started can finish without them.

With [gateway sign-in](/docs/en/claude-apps-gateway-config#precedence-with-other-managed-sources), Claude Code loads the policy before the session starts, so neither case delays or skips the provided servers.
Interactive sessions that are already running apply your edits to the key:

* **Add a server**: Claude Code connects it when the updated settings arrive, without a restart.
* **Change a server’s entry**: those sessions reconnect to it with the new definition.
* **Remove a server**: a running interactive session disconnects it once it reads the changed settings. A non-interactive (`-p`) run keeps it until it ends.

Policy-based control with allowlists and denylists
--------------------------------------------------

Allowlists and denylists filter which configured servers are allowed to load. They aren’t a registry: a server still has to be added by a user, a plugin, or your organization before either list applies to it.
Servers your organization delivers through `managedMcpServers` load without an allowlist entry, and [How a server is evaluated](#how-a-server-is-evaluated) covers `managed-mcp.json` servers. The denylist applies to every server regardless of where it came from, other than in-process `type: "sdk"` entries.
To deploy servers to users, use [`managed-mcp.json`](#exclusive-control-with-managed-mcp-json) or [`managedMcpServers`](#provide-servers-through-managed-settings). Both lists also filter servers passed with the [`--mcp-config` CLI flag](/docs/en/cli-reference#cli-flags), other than in-process `type: "sdk"` entries; `--strict-mcp-config` limits which configuration files load and doesn’t bypass either list.
To make the allowlist authoritative, set `allowedMcpServers` and `allowManagedMcpServersOnly: true` together in a [managed settings source](/docs/en/admin-setup#decide-how-settings-reach-devices), such as server-managed settings or a deployed `managed-settings.json` file. [Restrict the allowlist to managed settings only](#restrict-the-allowlist-to-managed-settings-only) shows the configuration. Without `allowManagedMcpServersOnly`, allowlists from every settings scope merge, including a user’s own `~/.claude/settings.json`, so a user can broaden what your allowlist permits. Denylists merge from every scope regardless.

`allowManagedMcpServersOnly` is separate from `allowManagedPermissionRulesOnly`, which locks down [permission rules](/docs/en/permissions#managed-settings) only. Setting that flag does not enforce the MCP allowlist.

### Match servers by URL, command, or name

`allowedMcpServers` and `deniedMcpServers` are lists of entries. Each entry is an object with a single key that identifies servers by their URL, their command, or their name:
Leaving `allowedMcpServers` unset is different from setting it to an empty array:
See [Invalid entries in managed settings](/docs/en/managed-settings#invalid-entries-in-managed-settings) for what happens when an entry fails schema validation.

A `serverName` entry, in either list, is not a security control. The name is the label a user assigns when running `claude mcp add` or editing a config file, not the underlying server, so a user can call any server `github`. For claude.ai connectors the name is the display name returned by claude.ai, which can change. To enforce which servers actually run, add `serverCommand` or `serverUrl` entries.

The `serverName` validation differs between the two lists:

* In `deniedMcpServers`, `serverName` accepts any non-empty string, so you can block [claude.ai connectors](/docs/en/mcp#use-mcp-servers-from-claude-ai) by their display name. For example, `{ "serverName": "claude.ai Slack" }` blocks the Slack connector. Prefer a `serverUrl` entry when you need the deny to be robust to renames, or when a connector name collides and gains a  `(N)` suffix.
* In `allowedMcpServers`, `serverName` is limited to letters, numbers, hyphens, and underscores. Use `serverUrl` to allowlist a claude.ai connector Claude Code fetches itself; for connectors a cloud host delivers to self-hosted sessions, use the entries listed under [Connector traffic leaves your network](/docs/en/self-hosted-environments-deploy#connector-traffic-leaves-your-network) instead.

To turn off all the claude.ai connectors Claude Code fetches itself, see [`disableClaudeAiConnectors`](/docs/en/mcp#disable-claude-ai-connectors).

### How a server is evaluated

Before loading a server, including one from `managed-mcp.json`, Claude Code runs the three checks below in order. It runs them again when a user reconnects a server or turns a disabled one back on in `/mcp`. In-process `type: "sdk"` servers, which the [app that started the session registers](/docs/en/mcp#how-connectors-reach-claude-code), skip all three.

1. **Merge the lists.** Allowlist and denylist entries from every settings scope combine into one allowlist and one denylist, with the managed scope’s lists coming from the [managed source or sources Claude Code applies](/docs/en/managed-settings#how-claude-code-combines-managed-sources). When `allowManagedMcpServersOnly` is `true`, only the managed allowlist is kept; the denylist always merges from every scope.
2. **Check the denylist.** A server that matches any denylist entry, by URL, command, or name, is blocked. Nothing overrides a denylist match.
3. **Check the allowlist.** If `allowedMcpServers` isn’t set anywhere, every server that passed the denylist loads. If it is set, what the server must match depends on its type, shown in the table below.
   The organization’s own servers skip this check: every `managedMcpServers` entry, and any `managed-mcp.json` entry whose values use no `${VAR}` expansion. Built-in servers skip it too, such as Claude in Chrome, the `ide` server Claude Code connects to in a running VS Code or JetBrains IDE, and servers the CLI itself configures.
   A `managed-mcp.json` server that uses `${VAR}` expansion in its command, arguments, `env`, URL, or headers is still checked, as is every server a user, a plugin, `--mcp-config`, or claude.ai adds.

Three matching rules apply inside those checks:

* **Commands match exactly.** Every argument, in order. `["npx", "-y", "server"]` does not match `["npx", "server"]` or `["npx", "-y", "server", "--flag"]`.
* **`serverCommand` and `serverUrl` values expand before matching.** Both the policy entry and the server’s configured value go through [`${VAR}` and `${VAR:-default}` expansion](/docs/en/mcp#environment-variable-expansion-in-mcp-json), so an entry written as `["${HOME}/bin/server"]` matches a server config that uses either the same reference or the expanded path. On Windows, reference an environment variable that is set there, such as `${USERPROFILE}` instead of `${HOME}`. `serverName` values match literally and never expand. The two sides read different environments; [How policy entries expand](#how-policy-entries-expand) covers which, and how allowlist and denylist entries differ.
* **URLs support `*` wildcards** anywhere in the pattern, including the scheme. Hostname matching is case-insensitive and ignores a trailing FQDN dot, so `https://Mcp.Example.com/*` matches `https://mcp.example.com/api`. Paths stay case-sensitive.

#### How policy entries expand

The server’s configured value expands from the live process environment, like the rest of `.mcp.json`. A policy entry expands from a pinned environment instead, so a variable set by a project or user settings file can’t change what an allowlist entry means. Because a policy entry still depends on the launching shell’s value for any variable it references, use literal URLs and commands for entries you rely on for enforcement.
Requires Claude Code v2.1.219 or later.

### Example configuration

The configuration below sets up a hard allowlist with a denylist. The highlighted lines change how the rest of the list is evaluated, and the callouts after the block explain each one:

* **Line 3**: the first `serverUrl` entry. Once one exists, every remote server must match a URL pattern, so a user can’t get an unlisted remote server through by giving it an allowed name.
* **Line 5**: the first `serverCommand` entry. Same effect for stdio servers, so every local server must match a listed command exactly.
* **Line 11**: a `serverName` entry in the denylist. Denylist entries always apply, so any server named `dangerous-server` is blocked regardless of its URL or command.

A `serverName` entry in this allowlist would never match anything, since both transport types already have stricter entries.
The accordions below walk through how a server is evaluated against other allowlist and denylist combinations.


URL-only allowlist

Command-only allowlist

Mixed name and command allowlist

Name-only allowlist

Allowlist with denylist override

### Restrict the allowlist to managed settings only

To make the managed allowlist the only one that applies, set `allowManagedMcpServersOnly` in the managed settings file:When `allowManagedMcpServersOnly` is `true`, allowlists from user, project, and local settings are ignored. The denylist still merges from every settings scope, so users can always block servers for themselves.

How restrictions appear to users
--------------------------------

For what users see at startup when `managed-mcp.json` is deployed and the session also has `--mcp-config` servers, see [Exclusive control with managed-mcp.json](#exclusive-control-with-managed-mcp-json). Use this table to recognize the other reports and to tell users what to expect before you roll out a change:
When a server silently disappears, the user gets no signal that policy is the reason, so tell affected users which servers are blocked when you roll out a new restriction.

Monitor MCP usage
-----------------

When [OpenTelemetry export](/docs/en/monitoring-usage) is configured, Claude Code can record which MCP servers and tools users invoke. Set `OTEL_LOG_TOOL_DETAILS=1` to include MCP server and tool names in tool events, then aggregate them in your collector to see which servers your users actually connect to. See [Monitoring](/docs/en/monitoring-usage) to set up the exporter and for the full event schema.

Configuration summary
---------------------

Every file and setting this page covers, what it controls, and how to deliver it:

Related resources
-----------------

* [Decide what to enforce](/docs/en/admin-setup#decide-what-to-enforce): MCP restrictions alongside permission rules, sandboxing, and the other admin controls
* [Connect Claude Code to tools via MCP](/docs/en/mcp): the full MCP reference, including transports, scopes, and authentication
* [Settings](/docs/en/settings): the settings hierarchy and how managed settings take precedence
* [Server-managed settings](/docs/en/server-managed-settings): deliver `allowedMcpServers` and `deniedMcpServers` from the Claude.ai admin console
* [Security](/docs/en/security): the threat model these controls defend against
* [Claude Enterprise Administrator Guide](https://claude.com/resources/tutorials/claude-enterprise-administrator-guide): SSO, SCIM, seat management, and rollout playbook

Was this page helpful?

YesNo

[Server-managed settings](/docs/en/server-managed-settings)[Auto mode](/docs/en/auto-mode-config)

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