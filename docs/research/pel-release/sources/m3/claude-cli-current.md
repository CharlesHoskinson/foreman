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

Reference

CLI reference

[Getting started](/docs/en/overview)[Build with Claude Code](/docs/en/agents)[Administration](/docs/en/admin-setup)[Configuration](/docs/en/settings)[Reference](/docs/en/cli-reference)[Agent SDK](/docs/en/agent-sdk/overview)[What's New](/docs/en/whats-new)[Resources](/docs/en/legal-and-compliance)

Reference

CLI reference
=============

Copy page

Complete reference for Claude Code command-line interface, including commands and flags.

Copy page

CLI commands
------------

You can start sessions, pipe content, resume conversations, and manage updates with these commands:
If you mistype a subcommand, Claude Code suggests the closest match and exits without starting a session. For example, `claude udpate` prints `Did you mean claude update?`.
As of v2.1.199, `claude --dangerously-skip-permissions daemon <subcommand>` runs the `daemon` subcommand. Earlier versions treated `daemon <subcommand>` as the prompt for a new interactive session, so the subcommand never ran when the flag came first, a common setup when `claude` is aliased to include the flag. Only a leading `--dangerously-skip-permissions` or `--allow-dangerously-skip-permissions` routes to `daemon` this way; any other leading flag still starts an interactive session.

CLI flags
---------

Customize Claude Code’s behavior with these command-line flags. `claude --help` does not list every flag, so a flag’s absence from `--help` does not mean it is unavailable.

### System prompt flags

Claude Code provides five flags for customizing the system prompt. Four set its text, and with `--system-prompt-snapshot` you control whether a conversation keeps the text it started with. All five work in both interactive and non-interactive modes.
`--system-prompt` and `--system-prompt-file` are mutually exclusive. The append flags can be combined with either replacement flag.
Choose based on whether Claude Code’s default identity still fits your task. Use an append flag when Claude should remain a coding assistant that also follows your extra rules: per-invocation instructions, output formatting, or domain context for a `-p` script. Appending preserves the default tool guidance, safety instructions, and coding conventions, so you only supply what differs. Use a replacement flag when the surface, identity, or permission model differs from Claude Code’s, like a non-coding agent in a pipeline that no human watches. Replacing drops all of the default prompt, including tool guidance and safety instructions, so you take responsibility for whatever your task still needs.
For persistent personas you can switch between and share across a project, use [output styles](/docs/en/output-styles). For project conventions Claude should always follow, use [CLAUDE.md](/docs/en/memory). The [Agent SDK guide on system prompts](/docs/en/agent-sdk/modifying-system-prompts#decide-on-a-starting-point) covers the same decision in more depth.

#### System prompt flags in resumed conversations

By default, Claude Code builds the system prompt once, on a conversation’s first request, with the text from any system prompt flags applied, and records it in the session. Until the conversation is compacted, every later request uses that recorded prompt, including after you return to the conversation with `--resume` or `--continue`. If you pass different system prompt flag text, or none, on that later launch, it takes effect once the conversation is compacted or when you start a new conversation.
If you start Claude Code in [bare mode](/docs/en/headless#start-faster-with-bare-mode), by passing `--bare` or setting `CLAUDE_CODE_SIMPLE=1`, recording stays off unless you pass `--system-prompt-snapshot on`. Before v2.1.268, sessions that don’t [fetch feature flags](/docs/en/env-vars#features-that-need-feature-flag-fetching), including sessions on Amazon Bedrock, Google Cloud’s Agent Platform, and Microsoft Foundry, rebuilt the prompt on every request and `--system-prompt-snapshot` had no effect.
To rebuild the prompt on every request instead, for example while you iterate on its wording across `--continue` runs, pass `--system-prompt-snapshot off`. Before v2.1.265, passing any of the system prompt flags also turned recording off unless you passed `--system-prompt-snapshot on`.

See also
--------

* [Chrome extension](/docs/en/chrome) - Browser automation and web testing
* [Interactive mode](/docs/en/interactive-mode) - Shortcuts, input modes, and interactive features
* [Quickstart guide](/docs/en/quickstart) - Getting started with Claude Code
* [Common workflows](/docs/en/common-workflows) - Advanced workflows and patterns
* [Settings](/docs/en/settings) - Configuration options
* [Agent SDK documentation](/docs/en/agent-sdk/overview) - Programmatic usage and integrations

Was this page helpful?

YesNo

[Commands](/docs/en/commands)

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