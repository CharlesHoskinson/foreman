---
source_url: "https://docs.x.ai/build/cli/reference"
captured_at: "2026-09-13T03:03:11.626128+00:00"
contributor: "Foreman release research; Scrapling"
---

#### [CLI](#cli)

# [CLI Reference](#cli-reference)

Copy for LLM[View as Markdown](/build/cli/reference.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=build-cli-reference&utm_content=article-api-key)[Meet grok-4.6](https://x.ai/news/grok-4-6)

Running `grok` with no arguments starts the interactive TUI. This page lists the subcommands and the flags you are most likely to use; run `grok --help` or `grok <subcommand> --help` for the complete set.

## [Subcommands](#subcommands)

| Command | What it does |
| --- | --- |
| `grok login` | Sign in. `--device-auth` uses device-code authentication for headless or remote environments |
| `grok logout` | Sign out and clear cached credentials |
| `grok inspect [--json]` | Show the configuration Grok discovers for this directory: rules, skills, plugins, hooks, and MCP servers |
| `grok models` | List available models |
| `grok mcp <list|add|remove|doctor>` | Manage MCP servers — see [MCP Servers](/build/features/mcp-servers) |
| `grok plugin <list|install|uninstall|update|enable|disable|details|validate>` | Manage plugins |
| `grok plugin marketplace <list|add|remove|update>` | Manage marketplace sources |
| `grok sessions <list|search|delete>` | List, search, or delete sessions — see [Sessions](/build/features/sessions) |
| `grok export <session-id> [output]` | Export a session transcript as Markdown |
| `grok import [targets...]` | Import sessions from Claude Code |
| `grok memory clear [--workspace|--global|--all]` | Clear cross-session memory files |
| `grok worktree <list|show|rm|gc>` | Manage git worktrees created for sessions — see [Worktrees](/build/features/worktrees) |
| `grok dashboard` | Open the [Agent Dashboard](/build/features/dashboard) |
| `grok agent stdio` | Run as an ACP agent over stdin/stdout — see [Headless & Scripting](/build/cli/headless-scripting#acp) |
| `grok wrap <command...>` | Run a command in a local PTY that forwards OSC 52 clipboard writes — see [Terminal Support](/build/cli/terminal-support) |
| `grok update` | Check for updates or install a specific version (`--check`, `--version <V>`, `--alpha`, `--stable`) |
| `grok version` | Print version information |
| `grok completions <shell>` | Generate shell completion scripts |
| `grok setup` | Fetch and install managed configuration |

## [Common flags](#common-flags)

Flags for headless runs (`-p`, `--output-format`, and related) are covered in [Headless & Scripting](/build/cli/headless-scripting).

| Flag | What it does |
| --- | --- |
| `--cwd <PATH>` | Working directory |
| `-r, --resume [<ID>]` | Resume a session by ID, or the most recent if omitted |
| `-c, --continue` | Continue the most recent session for the current directory |
| `-s, --session-id <UUID>` | Use a specific UUID for a new session |
| `--fork-session` | When resuming, fork into a new session ID |
| `-w, --worktree [<NAME>]` | Start the session in a new git worktree |
| `--ref <REF>` | Branch, tag, or commit to base the worktree on |
| `-m, --model <MODEL>` | Model ID to use |
| `--effort <LEVEL>` | Reasoning effort |
| `--always-approve` | Auto-approve all tool executions (alias `--yolo`) |
| `--allow <RULE>`, `--deny <RULE>` | Permission rules — see [Permissions](/build/features/permissions) |
| `--sandbox <PROFILE>` | Sandbox profile — see [Sandbox](/build/features/sandbox) |
| `--rules <TEXT>` | Extra rules appended to the system prompt |
| `--system-prompt-override <TEXT>` | Replace the system prompt entirely |
| `--tools <LIST>`, `--disallowed-tools <LIST>` | Allow or remove built-in tools |
| `--max-turns <N>` | Maximum number of agent turns |
| `--no-plan`, `--no-subagents`, `--no-memory`, `--disable-web-search` | Disable a feature for this session |
| `--experimental-memory` | Enable cross-session memory |
| `--oauth` | Use OAuth when the welcome screen starts authentication |

Claude Code flag names are accepted as aliases where they overlap: `--allowedTools`, `--disallowedTools`, `--append-system-prompt`, `--system-prompt`, and `--dangerously-skip-permissions`.

---

Last updated: July 21, 2026
