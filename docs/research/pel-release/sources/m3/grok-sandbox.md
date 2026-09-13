[API](/overview)

[Grok Build](/build/overview)[Grok Bot](/grok-bot/overview)[Grok](/grok/overview)

Search

⌘K

[API Console](https://console.x.ai?utm_source=docs&utm_medium=referral&utm_campaign=build-features-sandbox&utm_content=header-api-console)

Get Started

* [Getting Started](/build/overview)
* [Modes and Commands](/build/modes-and-commands)
* [Keyboard Shortcuts](/build/keyboard-shortcuts)

Features

* [Skills, Plugins, and Marketplaces](/build/features/skills-plugins-marketplaces)
* [AGENTS.md](/build/features/project-rules)
* [MCP Servers](/build/features/mcp-servers)
* [Hooks](/build/features/hooks)
* [Sessions](/build/features/sessions)
* [Plan Mode](/build/features/plan-mode)
* [Permissions](/build/features/permissions)
* [Sandbox](/build/features/sandbox)
* [Subagents](/build/features/subagents)
* [Worktrees](/build/features/worktrees)
* [Background Tasks](/build/features/background-tasks)
* [Agent Dashboard](/build/features/dashboard)
* [Status Line](/build/features/status-line)
* [Theming](/build/features/theming)

Settings

* [Overview](/build/settings)
* [Reference](/build/settings/reference)
* [ZDR Video Storage](/build/settings/zdr-video-storage)

CLI

* [Headless and Scripting](/build/cli/headless-scripting)
* [Reference](/build/cli/reference)
* [Terminal Support](/build/cli/terminal-support)

Enterprise

* [Enterprise Deployments](/build/enterprise)

* [API](/overview)
  + [Docs](/overview)
  + [REST Reference](/developers/rest-api-reference/inference)
* [Grok Build](/build/overview)
* [Grok Bot](/grok-bot/overview)
* [Grok](/grok/overview)

Get Started

* [Getting Started](/build/overview)
* [Modes and Commands](/build/modes-and-commands)
* [Keyboard Shortcuts](/build/keyboard-shortcuts)

Features

* [Skills, Plugins, and Marketplaces](/build/features/skills-plugins-marketplaces)
* [AGENTS.md](/build/features/project-rules)
* [MCP Servers](/build/features/mcp-servers)
* [Hooks](/build/features/hooks)
* [Sessions](/build/features/sessions)
* [Plan Mode](/build/features/plan-mode)
* [Permissions](/build/features/permissions)
* [Sandbox](/build/features/sandbox)
* [Subagents](/build/features/subagents)
* [Worktrees](/build/features/worktrees)
* [Background Tasks](/build/features/background-tasks)
* [Agent Dashboard](/build/features/dashboard)
* [Status Line](/build/features/status-line)
* [Theming](/build/features/theming)

Settings

* [Overview](/build/settings)
* [Reference](/build/settings/reference)
* [ZDR Video Storage](/build/settings/zdr-video-storage)

CLI

* [Headless and Scripting](/build/cli/headless-scripting)
* [Reference](/build/cli/reference)
* [Terminal Support](/build/cli/terminal-support)

Enterprise

* [Enterprise Deployments](/build/enterprise)

#### [Features](#features)

[Sandbox](#sandbox)
===================

Copy for LLM[View as Markdown](/build/features/sandbox.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=build-features-sandbox&utm_content=article-api-key)[Meet grok-4.6](https://x.ai/news/grok-4-6)

The sandbox limits what the agent process and its children can read, write, and reach on the network (Landlock on Linux, Seatbelt on macOS). Off by default. Permissions gate whether a tool call runs; the sandbox limits what an approved call can do — see [Permissions](/build/features/permissions).

[Profiles](#profiles)
---------------------

| Profile | Filesystem read | Filesystem write | Child network | Use case |
| --- | --- | --- | --- | --- |
| `off` | Unrestricted | Unrestricted | Allowed | No sandbox (default) |
| `workspace` | Everywhere | CWD, `~/.grok/`, temp | Allowed | Normal development |
| `devbox` | Everywhere | Top-level dirs except `/data` | Allowed | Cloud devbox environments |
| `read-only` | Everywhere | `~/.grok/` and temp only | Blocked | Code review, auditing |
| `strict` | CWD and system paths | CWD, `~/.grok/`, temp | Blocked | Untrusted repositories |

| Limitation | Detail |
| --- | --- |
| Child network | Enforced on Linux only; no-op on macOS for `read-only` / `strict` |
| Credentials | Built-ins do not permanently protect paths such as `~/.ssh`; use a custom `deny` list |
| `~/.grok/` | Stays writable under sandboxed profiles so sessions can persist |
| In-process network | Model API and web tools are not blocked by child-network settings |

[Enable a profile](#enable-a-profile)
-------------------------------------

| Mechanism | Example |
| --- | --- |
| CLI | `grok --sandbox workspace` |
| Config | `[sandbox] profile = "workspace"` in `~/.grok/config.toml` |
| Env | `GROK_SANDBOX=workspace` |
| Managed pin | `requirements.toml` (can override CLI) — [Enterprise](/build/enterprise#sandbox) |

[Custom profiles](#custom-profiles)
-----------------------------------

Define named profiles in `~/.grok/sandbox.toml` or project `.grok/sandbox.toml`:

Text

```
[profiles.my-profile]
extends = "workspace"
restrict_network = true
deny = ["/secrets", "**/.env", "**/*.pem"]
```

Select with `--sandbox my-profile` or `[sandbox] profile`. Built-in names cannot be redefined for selection. Field details: [Settings Reference](/build/settings/reference).

For untrusted trees, pair a strict profile with narrow [permission](/build/features/permissions) allows (or headless `dontAsk`).

---

Last updated: July 21, 2026