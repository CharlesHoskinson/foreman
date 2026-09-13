[API](/overview)

[Grok Build](/build/overview)[Grok Bot](/grok-bot/overview)[Grok](/grok/overview)

Search

⌘K

[API Console](https://console.x.ai?utm_source=docs&utm_medium=referral&utm_campaign=build-settings-reference&utm_content=header-api-console)

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

#### [Settings](#settings)

[Reference](#reference)
=======================

Copy for LLM[View as Markdown](/build/settings/reference.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=build-settings-reference&utm_content=article-api-key)[Meet grok-4.6](https://x.ai/news/grok-4-6)

[Environment variables](#environment-variables)
-----------------------------------------------

### [Paths and auth](#paths-and-auth)

| Variable | Default | Description |
| --- | --- | --- |
| `GROK_HOME` | `~/.grok` | Home for config, auth, sessions, skills, plugins, and logs. |
| `XAI_API_KEY` | — | API key when not using browser/session login (CI and headless). |

### [Models and updates](#models-and-updates)

| Variable | Default | Description |
| --- | --- | --- |
| `GROK_DEFAULT_MODEL` | catalog / config | Session default model (same idea as `-m` / `--model`). |
| `GROK_WEB_SEARCH_MODEL` | built-in | Model used by the `web_search` tool. |
| `GROK_MODELS_BASE_URL` | — | Custom inference base URL; model list from `{base}/models`. |
| `GROK_MODELS_LIST_URL` | `{GROK_MODELS_BASE_URL}/models` | Override model-list URL when it differs from the default. |
| `GROK_XAI_API_BASE_URL` | [`https://api.x.ai/v1`](https://api.x.ai/v1) | xAI API base for API-key auth. |
| `GROK_DISABLE_AUTOUPDATER` | unset (updates allowed) | If set, suppress auto-updater for this process (CI/containers). |

### [Tools, sandbox, and features](#tools-sandbox-and-features)

| Variable | Default | Description |
| --- | --- | --- |
| `GROK_SANDBOX` | `off` | Sandbox profile: `off`, `workspace`, `read-only`, `strict` (or a custom profile name). Same as `--sandbox`. |
| `GROK_SANDBOX_AUTO_ALLOW_BASH` | `0` | Auto-allow bash inside an active sandbox (`1`/`0`). |
| `GROK_RESPECT_GITIGNORE` | use config if unset | Force gitignore filtering for search/read tools (`1`/`0`); overrides `[tools] respect_gitignore`. |
| `GROK_WEB_FETCH` | `0` | Enable the `web_fetch` tool (`1`/`0`). Off by default for security. |
| `GROK_WEB_FETCH_PROXY` | — | Egress proxy URL for `web_fetch`. |
| `GROK_MEMORY` | `0` | Enable cross-session memory (`1`/`0`). |
| `GROK_SUBAGENTS` | `0` | Enable subagents / the task tool (`1`/`0`). |
| `GROK_AGENT` | `grok-build` | Built-in agent name, profile, or absolute path to an agent definition. |
| `GROK_WRITE_FILE` | `1` | Disable the `write` tool with `0` (read-only sessions). |
| `GROK_TOOL_SEARCH` | `1` | On-demand MCP tool discovery for large toolsets (`1`/`0`). |
| `GROK_LSP_TOOLS` | `0` | Enable the LSP code-intel tool (`1`/`0`). |

### [UI and appearance](#ui-and-appearance)

| Variable | Default | Description |
| --- | --- | --- |
| `GROK_THEME` | built-in | Color theme. |
| `GROK_SHOW_THINKING_BLOCKS` | `1` | Show thinking/reasoning blocks in the TUI (`1`/`0`). |
| `GROK_GROUP_TOOL_VERBS` | `1` | Fold consecutive read/search/list tool rows (`1`/`0`). |
| `GROK_COLLAPSED_EDIT_BLOCKS` | `0` | Collapse edits to one-line `+N/-M` summaries (`1`/`0`). |
| `GROK_PROMPT_SUGGESTIONS` | `1` | Next-prompt ghost text after each turn (`1`/`0`). |
| `GROK_SCROLL_SPEED` | `50` | Mouse/trackpad scroll speed (`1`–`100`). |
| `GROK_SCROLL_MODE` | `auto` | Scroll input: `auto`, `wheel`, or `trackpad`. |
| `GROK_SCROLL_LINES` | use config if unset | Lines per scroll tick (`1`–`10`). |
| `GROK_INVERT_SCROLL` | `0` | Reverse vertical scroll direction (`1`/`0`). |
| `GROK_DEFAULT_SELECTED_PERMISSION` | `always_allow_all_sessions` | Preselected row on the first permission prompt. |
| `GROK_REMEMBER_TOOL_APPROVALS` | `1` | Show per-tool "Always allow …" options (`1`/`0`). |
| `GROK_MOUSE_REPORTING_TOGGLE` | `0` | `Ctrl+R` in scrollback toggles terminal mouse capture (`1`/`0`). |
| `GROK_DISPLAY_REFRESH_AUTO_CADENCE` | `0` | Match stream/scroll cadence to display refresh rate (`1`/`0`). |

### [MCP, logging, and proxy](#mcp-logging-and-proxy)

| Variable | Default | Description |
| --- | --- | --- |
| `GROK_MCP_STARTUP_TIMEOUT_SECS` | `30` | Global MCP startup handshake timeout in **seconds**. Per-server `startup_timeout_sec` still wins. |
| `MCP_TIMEOUT` | same stack | Claude-compatible MCP startup timeout in **milliseconds** (checked before `GROK_MCP_STARTUP_TIMEOUT_SECS`). |
| `GROK_LOG_FILE` | — | Write logs to this path (useful when the TUI captures stderr). |
| `RUST_LOG` | — | Log filter for `GROK_LOG_FILE` and headless stderr (for example `debug`). |
| `GROK_CRASH_HANDLER` | `0` | On panic, write a report under `$GROK_HOME/crash/` (`1`/`0`). |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | system | Standard HTTP(S) proxy variables for outbound traffic. |

### [Cursor / Claude compatibility scanners](#cursor--claude-compatibility-scanners)

All default **on** (`true` / `1` or `false` / `0`):

| Variable | Description |
| --- | --- |
| `GROK_CURSOR_SKILLS_ENABLED` | Scan Cursor skills directories. |
| `GROK_CURSOR_RULES_ENABLED` | Scan `.cursor/rules/`. |
| `GROK_CURSOR_AGENTS_ENABLED` | Scan Cursor agent definitions. |
| `GROK_CURSOR_MCPS_ENABLED` | Scan Cursor `mcp.json`. |
| `GROK_CURSOR_HOOKS_ENABLED` | Scan Cursor hooks. |
| `GROK_CLAUDE_SKILLS_ENABLED` | Scan Claude skills. |
| `GROK_CLAUDE_RULES_ENABLED` | Scan Claude rules. |
| `GROK_CLAUDE_AGENTS_ENABLED` | Scan `CLAUDE.md` / `CLAUDE.local.md`. |
| `GROK_CLAUDE_MCPS_ENABLED` | Scan Claude MCP config. |
| `GROK_CLAUDE_HOOKS_ENABLED` | Scan Claude hooks. |

[TOML Values](#toml-values)
---------------------------

Project `.grok/config.toml` only contributes **`[mcp_servers]`**, **`[plugins]`**, and **`[permission]`**. Other sections belong in user config (`~/.grok/config.toml` or `$GROK_HOME/config.toml`).

### [`[models]`](#models)

| Setting | Values / default | Description |
| --- | --- | --- |
| `default` | model id (for example `"grok-build"`) | Model used for new sessions. |
| `web_search` | model id | Model used by the client `web_search` tool. |
| `default_reasoning_effort` | effort level if supported | Default reasoning effort for the default model. |
| `session_summary` | model id | Model used for session summaries. |
| `image_description` | model id | Model used for image description. |
| `extra_headers` | map | Headers applied to every model (per-model keys win). |
| `temperature` / `top_p` / `max_completion_tokens` | numbers | Global sampling defaults. |
| `max_retries` | number | Global inference retry default. |
| `stream_tool_calls` | `true` / `false` | Global tool-call streaming request shape (some BYOK endpoints need `false`). |
| `allowed_models` | glob list | Restrict model picker / default / `-m` selection. |
| `hidden_models` | id list | Hide from the picker (still usable via `-m`). |
| `disabled_models` | id list | Remove from the catalog (wins over hidden). |

### [`[model.<id>]`](#modelid)

Custom / BYOK models (OpenAI-compatible or Anthropic Messages). Prefer `env_key` over hardcoding `api_key`.

| Setting | Values / default | Description |
| --- | --- | --- |
| `model` | string | Model id sent to the API. |
| `base_url` | URL | Provider endpoint. |
| `name` | string | Label in the model picker. |
| `description` | string | Optional description. |
| `api_key` | string | Inline API key (prefer `env_key`). |
| `env_key` | env var name | Environment variable holding the API key. |
| `api_backend` | `chat_completions` | `responses` | `messages` | Protocol. |
| `temperature` / `top_p` / `max_completion_tokens` | numbers | Sampling. |
| `context_window` | tokens | Context window size (drives auto-compact timing). |
| `extra_headers` | map | Per-request headers. |
| `supports_backend_search` | `true` / `false` | Whether the endpoint supports Grok-hosted server-side search tools. |
| `supports_reasoning_effort` / `reasoning_effort` | bool / effort | Reasoning controls when supported. |
| `stream_tool_calls` | `true` / `false` | Per-model tool-call streaming. |
| `max_retries` / `inference_idle_timeout_secs` | numbers | Reliability. |

### [`[mcp_servers.<name>]`](#mcp_serversname)

String fields such as `url`, `command`, `args`, `env`, and `headers` support `${VAR}` expansion. Headers may also use `{{session_id}}`.

**stdio**

| Setting | Values / default | Description |
| --- | --- | --- |
| `command` | string | Executable (for example `npx`). |
| `args` | string array | Arguments. |
| `env` | map | Process environment. |
| `cwd` | path | Working directory for the process. |

**HTTP / remote**

| Setting | Values / default | Description |
| --- | --- | --- |
| `url` | URL | HTTP/SSE MCP endpoint. |
| `headers` | map | Request headers. |
| `bearer_token_env_var` | env var name | Inject `Authorization: Bearer` from an environment variable. |

**Common**

| Setting | Values / default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable or disable the server. |
| `startup_timeout_sec` | `30` | Startup handshake timeout (seconds). |
| `tool_timeout_sec` | `6000` | Default per-tool-call timeout (seconds). |
| `tool_timeouts` | map name → seconds | Per-tool timeout overrides. |

### [`[tools]` and `[toolset.*]`](#tools-and-toolset)

| Setting | Section | Values / default | Description |
| --- | --- | --- | --- |
| `respect_gitignore` | `[tools]` | `true` / `false` (default `false`) | When `true`, search and read tools skip gitignored files. |
| `disable_zdr_incompatible_tools` | `[tools]` | `true` / `false` (default `false`) | Restrict tools needing xAI-hosted output (video) under ZDR; without a configured output bucket they return setup guidance instead of generating. |
| `zdr_video_output_s3` | `[tools.zdr_video_output_s3]` | table | User-supplied S3 bucket for ZDR video output — see [Video Output Storage under ZDR](/build/settings/zdr-video-storage). |
| `file_toolset` | `[toolset]` | `standard` (default) | `hashline` | File edit tool scheme. |
| `timeout_secs` | `[toolset.bash]` | seconds (default `120`) | Foreground bash command timeout. |
| `output_byte_limit` | `[toolset.bash]` | bytes (default `20000`) | Max captured bash output. |
| `max_timeout_secs` | `[toolset.bash]` | seconds (default `36000`) | Cap on model-requested foreground timeouts. |
| `auto_background_on_timeout` | `[toolset.bash]` | `true` / `false` (default `true`) | Auto-background the command on timeout. |
| `proxy_endpoint` | `[toolset.web_fetch]` | URL | Egress proxy for `web_fetch`. |
| `allowed_domains` | `[toolset.web_fetch]` | string array | Domain allowlist override for `web_fetch`. |

### [`[sandbox]` (`config.toml`)](#sandbox-configtoml)

| Setting | Values / default | Description |
| --- | --- | --- |
| `profile` | `off` (default) | `workspace` | `read-only` | `strict` (or custom) | Filesystem sandbox profile. Custom profile names are defined in `sandbox.toml`. |
| `auto_allow_bash` | `true` / `false` (default `false`) | Skip bash permission prompts when a sandbox profile is active. |

### [`sandbox.toml` custom profiles](#sandboxtoml-custom-profiles)

Define custom profiles in `~/.grok/sandbox.toml` (user) or `.grok/sandbox.toml` (project). Activate with `[sandbox] profile = "…"` in `config.toml`, `--sandbox`, or `GROK_SANDBOX`. Built-in names (`off`, `workspace`, `read-only`, `strict`, `devbox`) cannot be redefined as custom profiles.

TOML

```
[profiles.project]
extends = "workspace"
restrict_network = false
read_only = ["/data"]
read_write = ["/tmp/scratch"]
# Kernel-enforced deny (read + write/rename). Entries with *, ?, or [ are globs.
deny = ["/data/shared-secrets", "**/.env", "**/*.pem"]
```

| Setting | Values / default | Description |
| --- | --- | --- |
| `extends` | `workspace` (default if omitted) | `devbox` | `read-only` | `strict` | Built-in profile to inherit. |
| `restrict_network` | `true` / `false` | Restrict network access (Linux seccomp when enforced). |
| `read_only` | path list | Additional read-only paths. |
| `read_write` | path list | Additional read-write paths. |
| `deny` | path or **glob** list | Kernel-enforced deny for read and write/rename. An entry is a glob if it contains `*`, `?`, or `[` (for example `**/.env`, `**/*.pem`). |

A non-empty `deny` list is enforced at the kernel level when the sandbox can be applied. On Linux, read-deny requires `bubblewrap`. Operator guide: [Sandbox](/build/features/sandbox). Managed pins: [Enterprise Deployments](/build/enterprise#sandbox).

### [`[session]`, `[cli]`, and `[hints]`](#session-cli-and-hints)

| Setting | Section | Values / default | Description |
| --- | --- | --- | --- |
| `auto_compact_threshold_percent` | `[session]` | `0–100` (default `85`) | Auto-compact when context usage reaches this percent. |
| `load_envrc` | `[session]` | `true` / `false` (default `true`) | Inject `.envrc` variables into bash. |
| `auto_update` | `[cli]` | `true` / `false` (default on when unset) | Check for CLI updates on launch. |
| `channel` | `[cli]` | `stable` | `alpha` | Release channel preference. |
| `show_tips` | `[cli]` | `true` / `false` | Startup tips. |
| `new_session_worktree_mode` | `[hints]` | `ask` | `always` | `never` (default `never`) | Whether `/new` offers a [worktree](/build/features/worktrees). |
| `fork_worktree_mode` | `[hints]` | `ask` | `always` | `never` (default `ask`) | Whether `/fork` offers a worktree. |

### [`[ui]`, `[ui.status_line]`, `[ui.display_refresh]`, and `[ui.contextual_hints]`](#ui-uistatus_line-uidisplay_refresh-and-uicontextual_hints)

| Setting | Section | Values / default | Description |
| --- | --- | --- | --- |
| `compact_mode` | `[ui]` | `true` / `false` (default `false`) | Denser message padding. Also `/compact-mode`. |
| `screen_mode` | `[ui]` | `fullscreen` (default when unset) | `minimal` | Default render mode for plain `grok`. Restart required. |
| `show_timestamps` | `[ui]` | `true` / `false` (default `true`) | Clock time next to messages. Also `/timestamps`. |
| `show_timeline` | `[ui]` | `true` / `false` (default `false`) | Per-turn tick rail instead of the scrollbar. |
| `page_flip_on_send` | `[ui]` | `true` / `false` (default `true`) | Snap the sent prompt to the top of the viewport. |
| `max_thoughts_width` | `[ui]` | `40`–`500` (default `120`) | Column width for the thoughts panel. |
| `combine_queued_prompts` | `[ui]` | `true` / `false` (default `false`) | Merge consecutive plain follow-ups into one turn. |
| `theme` | `[ui]` | theme name or `auto` / `system` (default Grok Night) | Color theme. `auto` follows OS light/dark. Also `/theme`. |
| `auto_dark_theme` | `[ui]` | theme name (default `groknight`) | Theme when `theme = "auto"` and the OS is dark. |
| `auto_light_theme` | `[ui]` | theme name (default `grokday`) | Theme when `theme = "auto"` and the OS is light. |
| `simple_mode` | `[ui]` | `true` / `false` (default `true`) | Readline prompt editing when `true`; experimental vim prompt keys when `false`. |
| `vim_mode` | `[ui]` | `true` / `false` (default `false`) | Vim keys in the scrollback (not the prompt). Also `/vim-mode`. |
| `prompt_suggestions` | `[ui]` | `true` / `false` (default `true`) | Next-prompt ghost text after each turn (Tab to accept). |
| `mouse_reporting_toggle` | `[ui]` | `true` / `false` (default `false`) | `Ctrl+R` in scrollback toggles terminal mouse capture. |
| `keep_text_selection` | `[ui]` | `flash` (default) | `hold` | `word_select` | In-app selection: brief flash, hold, or double-click word / triple-click paragraph select. |
| `cursor_blink` | `[ui]` | `true` / `false` (unset inherits terminal) | Force blinking (`true`) or steady (`false`) block cursor. |
| `show_thinking_blocks` | `[ui]` | `true` / `false` (default `true`) | Show thinking/reasoning blocks while streaming. |
| `group_tool_verbs` | `[ui]` | `true` / `false` (default `true`) | Fold consecutive read/search/list tool rows into one summary. |
| `collapsed_edit_blocks` | `[ui]` | `true` / `false` (default `false`) | Show edits as one-line `+N/-M` summaries. |
| `render_mermaid` | `[ui]` | `auto` (default) | `on` | `off` | Mermaid diagrams: clickable open row (`auto`/`on`) or raw source (`off`). |
| `scroll_speed` | `[ui]` | `1`–`100` (default `50`) | Mouse/trackpad scroll speed multiplier. |
| `scroll_mode` | `[ui]` | `auto` (default) | `wheel` | `trackpad` | Force wheel vs trackpad when auto-detection is wrong. |
| `scroll_lines` | `[ui]` | `1`–`10` (unset uses terminal profile) | Lines per scroll tick for wheel and trackpad. |
| `invert_scroll` | `[ui]` | `true` / `false` (default `false`) | Reverse vertical scroll direction. |
| `permission_mode` | `[ui]` | `default` | `ask` | `auto` | `always-approve` | Default tool-permission behavior. Enterprise locks use `requirements.toml`. |
| `default_selected_permission` | `[ui]` | `always_allow_all_sessions` (default) | `allow_command_always` | `allow_once` | `reject` | Preselected approval row on the first prompt of a session. |
| `remember_tool_approvals` | `[ui]` | `true` / `false` (default `true`) | Show per-tool "Always allow …" options. Restart required. |
| `cancel_subagents_on_turn_cancel` | `[ui]` | `ask` (default when unset) | `always_stop` | `always_continue` | When cancelling a turn with running subagents. |
| `hunk_tracker_mode` | `[ui]` | `agent_only` (default) | `all_dirty` | `off` | File-change hunk tracking. Restart required. |
| `fork_secondary_model` | `[ui]` | model id (default: main default) | Model for the secondary agent when forking. |
| `voice_keybind_enabled` | `[ui]` | `true` / `false` (default `true`) | Enable Ctrl+Space / F8 for voice dictation (`/voice` still works when off). |
| `voice_capture_mode` | `[ui]` | `hold` (default) | `toggle` | Hold-to-talk or press-to-toggle voice capture. |
| `voice_stt_language` | `[ui]` | language code or `auto` (default `en` / `[voice].language`) | Speech-to-text language for dictation. |
| `status_line` | `[ui.status_line]` | `builtin` | `command` | `disabled` (default) | Live session values, or the output of your own script, in a row at the bottom. Sub-keys: `type`, `items`, `command`, `padding`, `refresh_interval`. See [Status line](/build/features/status-line). |
| `auto_cadence_enabled` | `[ui.display_refresh]` | `true` / `false` (default `false`) | Match stream/scroll cadence to display refresh rate. Restart required. |
| `undo` | `[ui.contextual_hints]` | `true` / `false` (default `true`) | Ctrl+Z restores a wiped prompt draft. |
| `plan_mode` | `[ui.contextual_hints]` | `true` / `false` (default `true`) | Suggest plan mode (Shift+Tab) for planning-style prompts. |
| `image_input` | `[ui.contextual_hints]` | `true` / `false` (default `true`) | Clipboard image paste tip when the model accepts images. |
| `send_now` | `[ui.contextual_hints]` | `true` / `false` (default `true`) | After queuing a mid-turn follow-up, Enter on empty prompt sends now. |
| `small_screen` | `[ui.contextual_hints]` | `true` / `false` (default `true`) | Suggest `/compact-mode` on short terminals. |
| `word_select` | `[ui.contextual_hints]` | `true` / `false` (default `true`) | After double-click with fold/nav selection, point at Word select in settings. |
| `ssh_wrap` | `[ui.contextual_hints]` | `true` / `false` (default `true`) | Recommend `grok wrap` when SSH lacks a clipboard sink. |

### [`[permission]`](#permission)

Project-scoped and user-scoped. Evaluation order: **deny > ask > allow**.

| Setting | Values | Description |
| --- | --- | --- |
| `allow` / `deny` / `ask` | rule string arrays | Compact rules, for example `Bash(git *)`, `Read(src/**)`, `Edit(**/*.rs)`, `MCPTool(server__*)`. |
| `rules` | array of `{ action, tool, pattern? }` | Verbose form. `action`: `allow` | `deny` | `ask`. `tool`: `any` | `bash` | `edit` | `read` | `grep` | `mcp` | `webfetch`. |

### [`[features]`, `[subagents]`, and `[memory]`](#features-subagents-and-memory)

| Setting | Section | Values / default | Description |
| --- | --- | --- | --- |
| `web_fetch` | `[features]` | `true` / `false` | Enable the `web_fetch` tool. |
| `lsp_tools` | `[features]` | `true` / `false` (default off) | Expose the LSP tool. |
| `write_file` | `[features]` | `true` / `false` (default on) | Enable the `write` tool. |
| `tool_search` | `[features]` | `true` / `false` (default on) | MCP tool search / discovery. |
| `enabled` | `[subagents]` | `true` / `false` | Subagent / task tool master switch. |
| `toggle` | `[subagents.toggle]` | map of subagent → bool | Enable or disable individual subagent types. |
| `models` | `[subagents.models]` | map of subagent → model id | Per-subagent model routing. |
| `enabled` | `[memory]` | `true` / `false` (default off) | Cross-session memory master switch. |

### [`[skills]`, `[plugins]`, and `[compat.*]`](#skills-plugins-and-compat)

| Setting | Section | Values | Description |
| --- | --- | --- | --- |
| `paths` | `[skills]` / `[plugins]` | path lists | Extra skill or plugin directories. |
| `disabled` | `[skills]` / `[plugins]` | name lists | Discover but do not activate. |
| `enabled` | `[plugins]` | name lists | Explicitly enable plugins (project plugins may default off). |
| `skills` / `rules` / `agents` / `mcps` / `hooks` | `[compat.cursor]` / `[compat.claude]` | `true` / `false` (default `true`) | Scan Cursor or Claude harness directories. |

---

Last updated: September 4, 2026