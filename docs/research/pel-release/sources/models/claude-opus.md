---
source_url: "https://platform.claude.com/docs/en/models/opus-5/overview"
captured_at: "2026-09-13T03:01:13.985875+00:00"
contributor: "Foreman release research; Scrapling"
---

[Models & pricing](/docs/en/models/overview)Models

![](/images/dashboard-discovery/cursor.svg)

# Claude Opus 5Latest

For complex agentic coding and enterprise work

Copy page



claude-opus-5[Try in playground](/playground?model=claude-opus-5)

Copy page



Context window
:   1Mtokens

Max output
:   128Ktokens

Input pricing
:   $5/ MTok

Output pricing
:   $25/ MTok

## Overview

Claude Opus 5 is a step-change improvement over Claude Opus 4.8, with the largest gains in deep reasoning, agentic and long-horizon tasks, and test-time compute scaling. This page summarizes everything new in Claude Opus 5, including mid-conversation tool changes and two breaking changes for code running on Claude Opus 4.8: thinking is on by default, and thinking can be disabled only at effort `high` or below.

[What's new in Claude Opus 5](/docs/en/models/opus-5/whats-new-opus-5)

## How it compares

| Model | Context | Max output | Price / MTok | Latency | Thinking | Default effort | Knowledge cutoff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Claude Fable 5.1](/docs/en/models/fable-5-1/overview) | 1M | 128K | $10 / $50 | Slower | Adaptive (always on) | `high` | Jun 2026 |
| Claude Opus 5This model | 1M | 128K | $5 / $25 | Moderate | Adaptive | `high` | May 2026 |
| [Claude Sonnet 5](/docs/en/models/sonnet-5/overview) | 1M | 128K | $2 / $10 | Fast | Adaptive | `high` | Jan 2026 |
| [Claude Haiku 4.5](/docs/en/models/haiku-4-5/overview) | 200K | 64K | $1 / $5 | Fastest | Extended | — | Feb 2025 |

## Specifications

### Model IDs

Claude API
:   claude-opus-5

[Amazon Bedrock](/docs/en/build-with-claude/claude-in-amazon-bedrock)
:   anthropic.claude-opus-5

[Google Cloud](/docs/en/build-with-claude/claude-on-vertex-ai)
:   claude-opus-5

[Microsoft Foundry](/docs/en/build-with-claude/claude-in-microsoft-foundry)
:   claude-opus-5

### Pricing

Input
:   $5 / MTok

Output
:   $25 / MTok

[5m cache write](/docs/en/build-with-claude/prompt-caching)
:   $6.25 / MTok

[1h cache write](/docs/en/build-with-claude/prompt-caching)
:   $10 / MTok

[Cache read](/docs/en/build-with-claude/prompt-caching)
:   $0.50 / MTok

[Batch API](/docs/en/build-with-claude/batch-processing)
:   50% discount on input and output

Full price list
:   [Pricing](/docs/en/about-claude/pricing)

### Capabilities

[Context window](/docs/en/build-with-claude/context-windows)
:   1M tokens

Max output
:   128K tokens

[Max output (Batch API, beta)](/docs/en/build-with-claude/batch-processing#extended-output-beta)
:   300K tokens

[Thinking](/docs/en/build-with-claude/thinking)
:   Adaptive

[Default effort](/docs/en/build-with-claude/effort)
:   `high`

Comparative latency
:   Moderate

Input → output
:   Text and images → text

Reliable knowledge cutoff
:   May 2026

Training data cutoff
:   May 2026

### Availability

[Status](/docs/en/about-claude/model-deprecations)
:   Active (latest)

Released
:   July 24, 2026

Retirement
:   Not sooner than July 24, 2027

Platforms
:   Claude API[Amazon Bedrock](/docs/en/build-with-claude/claude-in-amazon-bedrock)[Google Cloud](/docs/en/build-with-claude/claude-on-vertex-ai)[Microsoft Foundry](/docs/en/build-with-claude/claude-in-microsoft-foundry)

## Good to know

* On the [Message Batches API](/docs/en/build-with-claude/batch-processing#extended-output-beta), Claude Opus 5 supports up to 300k output tokens with the `output-300k-2026-03-24` beta header.
* The minimum cacheable prompt length is 512 tokens. See [Prompt caching](/docs/en/build-with-claude/prompt-caching#cache-limitations).
* Query limits and capabilities programmatically with the [Models API](/docs/en/api/models/list).

## Resources



[Prompting Claude Opus 5](/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)

Model-specific prompting guidance.



[Effort](/docs/en/build-with-claude/effort)

Effort defaults to `high` on Claude Opus 5 and matters more than on earlier models. Choose a level per workload.



[Adaptive thinking](/docs/en/build-with-claude/thinking)

On by default. Disabling thinking requires effort `high` or below.



[Fast mode](/docs/en/build-with-claude/fast-mode)

Lower-latency Claude Opus 5 on the Claude API (research preview), priced separately.

## Reference



[System prompt](/docs/en/release-notes/system-prompts#claude-opus-5)

The system prompt Claude Opus 5 uses on claude.ai and the Claude apps.



[System card](https://www.anthropic.com/claude-opus-5-system-card)

Safety evaluations and deployment decisions for Claude Opus 5.

[Pricing](/docs/en/about-claude/pricing)

Full price list, including batch discounts and prompt caching rates.

[Model IDs and versioning](/docs/en/about-claude/models/model-ids-and-versions)

How model IDs, aliases, and pinned snapshots work.



[Model deprecations](/docs/en/about-claude/model-deprecations)

Lifecycle status and retirement commitments for every Claude model.

Was this page helpful?


