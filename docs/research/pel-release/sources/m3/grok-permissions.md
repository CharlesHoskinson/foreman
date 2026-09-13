[API](/overview)

[Grok Build](/build/overview)[Grok Bot](/grok-bot/overview)[Grok](/grok/overview)

Search

⌘K

[API Console](https://console.x.ai?utm_source=docs&utm_medium=referral&utm_campaign=build-features-permissions&utm_content=header-api-console)

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

[Permissions](#permissions)
===========================

Copy for LLM[View as Markdown](/build/features/permissions.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=build-features-permissions&utm_content=article-api-key)[Meet grok-4.6](https://x.ai/news/grok-4-6)

Permissions decide which tool calls may run. The [sandbox](/build/features/sandbox) is separate: it limits what an approved call can do on the filesystem and network.

[Modes](#modes)
---------------

| Mode | Behavior | Enter via |
| --- | --- | --- |
| Ask (default) | Prompt for anything not already allowed | — |
| Auto | Classifier auto-approves safe tools; dangerous ones may still prompt (`deny` rules and hooks still apply) | `/auto`, `Shift+Tab` when the feature is on |
| Always-approve | Auto-approve tool calls (`deny` rules and PreToolUse hooks still apply) | `/always-approve`, `Ctrl+O`, `Shift+Tab`, `grok --always-approve` |

`Shift+Tab` cycles Normal → Plan → Auto (when available) → Always-approve. `/auto` only appears when the auto permission-mode feature is enabled. Running `/auto` while always-approve is on (or the reverse) switches modes rather than stacking them. Status shows `auto` when auto is active and plan mode is not.

Default in user config only (`~/.grok/config.toml` or managed/requirements — not project `.grok/config.toml`):

Text

```
[ui]
permission_mode = "auto" # or "ask" | "always-approve"
```

Legacy keys `approval_mode` and `yolo = true` still work; `permission_mode` wins when more than one is set.

[Plan mode](/build/features/plan-mode) is independent: edit tools stay limited while planning, and the plan review UI is not skipped under auto or always-approve.

Headless modes such as `dontAsk` and locking always-approve off: [Enterprise Deployments](/build/enterprise#permissions).

[Allow and deny rules](#allow-and-deny-rules)
---------------------------------------------

Text

```
[permission]
rules = [
  { action = "allow", tool = "bash", pattern = "git *" },
  { action = "allow", tool = "read" },
  { action = "deny",  tool = "bash", pattern = "rm -rf *" },
]
```

`--allow` / `--deny` take the same patterns per invocation. Supported filters include `Bash`, `Edit`, `Read`, `Grep`, `MCPTool`, `WebFetch`, and `WebSearch`. `deny` always wins over `allow`.

A remembered “always allow” grant still prompts for dangerous patterns such as `rm` and `git push`. An explicit config or CLI allow rule auto-approves them. Under always-approve they run unless you add a deny.

---

Last updated: July 21, 2026