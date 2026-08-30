# source: https://docs.claude.com/en/docs/about-claude/models/overview
# status: 200

Models overview - Claude Platform Docs
Claude Platform Docs
Messages
Managed Agents
Admin
Resources

Best practices
Models & pricing

CLI, SDKs, and libraries
Claude API skill
Release notes

API reference
English


Console
Log in



Search
⌘K
Models
Models overview
Model IDs and versioning
Choosing a model
Introducing Claude Fable 5 and Claude Mythos 5
What's new in Claude Sonnet 5
What's new in Claude Opus 5
Upgrade between model versions
Model deprecations
Model cards
System prompts
Pricing

Log in

Models & pricing

Models overview
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Loading
Claude Platform Docs
Solutions
AI agents
Code modernization
Coding
Customer support
Financial services
Government
Higher education
K-12 teachers
Life sciences
Partners
Claude on AWS
Claude on Google Cloud
Learn
Blog
Courses
Use cases
Connectors
Customer stories
Engineering at Anthropic
Events
Powered by Claude
Service partners
Startups program
Company
Anthropic
Careers
Economic Futures
Research
News
Responsible Scaling Policy
Security and compliance
Transparency
Learn
Blog
Courses
Use cases
Connectors
Customer stories
Engineering at Anthropic
Events
Powered by Claude
Service partners
Startups program
Help and security
Availability
Status
Support
Discord
Terms and policies
Privacy policy
Responsible disclosure policy
Terms of service: Commercial
Terms of service: Consumer
Usage policy
Models & pricing
/
Models
Models overview
Copy page

Claude is a family of state-of-the-art large language models developed by Anthropic. This guide introduces the available models and compares their performance.
Copy page


Choosing a model
If you're unsure which model to use, start with 
Claude Opus 5
 for complex agentic coding and enterprise work. For workloads that need the highest available capability, use 
Claude Fable 5
.
All current Claude models support text and image input, text output, multilingual capabilities, and vision. Models are available through the Claude API, 
Amazon Bedrock
, 
Claude Platform on AWS
, 
Google Cloud
, and 
Microsoft Foundry
.
Once you've picked a model, 
learn how to make your first API call
.

Claude Fable 5 and Claude Mythos 5
Claude Fable 5 (
claude-fable-5
) is Anthropic's most capable widely released model. Claude Mythos 5 (
claude-mythos-5
) shares Claude Fable 5's specs and pricing and joins the invitation-only Claude Mythos Preview (
claude-mythos-preview
) within 
Project Glasswing
. See 
Introducing Claude Fable 5 and Claude Mythos 5
 for launch details and API changes.
Claude Fable 5 is generally available on the Claude API, Amazon Bedrock, Claude Platform on AWS, Google Cloud, and Microsoft Foundry beginning June 9, 2026. Claude Mythos 5 is not generally available: it is offered in limited availability to approved customers in 
Project Glasswing
, beginning the same day. For access, contact your Anthropic, AWS, or Google Cloud account team.

Latest models comparison
Feature
Claude Fable 5
Claude Opus 5
Claude Sonnet 5
Claude Haiku 4.5
Description
Next-generation intelligence for long-running agents
For complex agentic coding and enterprise work
The best combination of speed and intelligence
The fastest model with near-frontier intelligence
Claude API ID
claude-fable-5
claude-opus-5
claude-sonnet-5
claude-haiku-4-5-20251001
Claude API alias
claude-fable-5
claude-opus-5
claude-sonnet-5
claude-haiku-4-5
AWS Bedrock ID
anthropic.claude-fable-5
3
anthropic.claude-opus-5
3
anthropic.claude-sonnet-5
3
anthropic.claude-haiku-4-5-20251001-v1:0
Google Cloud ID
claude-fable-5
claude-opus-5
claude-sonnet-5
claude-haiku-4-5@20251001
Pricing
1
$10 / input MTok
$50 / output MTok
$5 / input MTok
$25 / output MTok
$3 / input MTok
$15 / output MTok
4
$1 / input MTok
$5 / output MTok
Extended thinking (
thinking.type: "enabled"
)
No
No
No
Yes
Adaptive thinking
Yes (always on)
Yes
Yes
No
Comparative latency
Slower
Moderate
Fast
Fastest
Context window
1M tokens
1M tokens
1M tokens
200k tokens
Max output
128k tokens
128k tokens
128k tokens
64k tokens
Reliable knowledge cutoff
Jan 2026
2
May 2026
2
Jan 2026
2
Feb 2025
Training data cutoff
Jan 2026
May 2026
Jan 2026
Jul 2025
1 See 
Pricing
 for complete pricing information including Batch API discounts and prompt caching rates.
2 
Reliable knowledge cutoff
 indicates the date through which a model's knowledge is most extensive and reliable. 
Training data cutoff
 is the broader date range of training data used. For more information, see 
Anthropic's Transparency Hub
.
3 Claude Fable 5, Claude Opus 5, and Claude Sonnet 5 are available on Bedrock through 
Claude in Amazon Bedrock
 (the Messages-API Bedrock endpoint).
4 Introductory pricing of $2 / $10 per MTok applies to Claude Sonnet 5 through August 31, 2026. See 
Pricing
.

Claude Mythos 5 and Claude Mythos Preview are offered separately for defensive cybersecurity workflows as part of 
Project Glasswing
. Access is invitation-only and there is no self-serve sign-up.

Every Claude model ID is a pinned snapshot. Models with a date in the ID (for example, 
20250929
) are fixed to that specific release. Starting with the Claude 4.6 generation, model IDs use a dateless format that is also a pinned snapshot, not an evergreen pointer. For models before the 4.6 generation, entries in the Claude API alias column are convenience pointers that resolve to a dated model ID. For details on the naming convention and how versioning works, see 
Model IDs and versioning
.

Starting with 
Claude Sonnet 4.5 and all subsequent models
 (including Claude Sonnet 4.6), Bedrock offers two endpoint types: 
global endpoints
 (dynamic routing for maximum availability) and 
regional endpoints
 (guaranteed data routing through specific geographic regions). Google Cloud offers three endpoint types: global endpoints, 
multi-region endpoints
 (dynamic routing within a geographic area), and regional endpoints. For more information, see 
Cloud platform pricing
.

Claude Platform on AWS
 uses the same model IDs as the Claude API (for example, 
claude-opus-4-6
), not Bedrock-style IDs. Model lifecycle on Claude Platform on AWS follows Anthropic's first-party 
Model deprecations
, not Bedrock's. See 
Available models
 for the model list.

You can query model capabilities and token limits programmatically with the 
Models API
. The response includes 
max_input_tokens
, 
max_tokens
, and a 
capabilities
 object for every available model.

On Claude Opus 4.8, the 
effort
 parameter defaults to 
high
 on all surfaces, including the Claude API, Claude Code, and claude.ai. On Claude Opus 5 and Claude Sonnet 5, it defaults to 
high
 on the Claude API and Claude Code. Set 
effort
 explicitly to use a different level. See 
Effort
 for guidance on choosing a level.

The Max output values in the table apply to the synchronous Messages API. On the 
Message Batches API
, Claude Opus 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 5, and Sonnet 4.6 support up to 300k output tokens by using the 
output-300k-2026-03-24
 beta header.
Legacy models


Prompt and output performance
Current Claude models excel in:
Performance:
 Top-tier results in reasoning, coding, multilingual tasks, long-context handling, honesty, and image processing. See 
Prompting best practices
 for general and model-specific prompting guidance.
Engaging responses:
 Claude models are ideal for applications that require rich, human-like interactions.
If you prefer more concise responses, you can adjust your prompts to guide the model toward the desired output length. Refer to the 
prompt engineering guides
 for details.
For prompting best practices, see 
Prompting best practices
.
Output quality:
 When migrating from a previous model generation, you may notice larger improvements in overall performance.

Migrating to Claude Opus 5
If you're currently using Claude Opus 4.8 or earlier Claude models, see 
Migrating to Claude Opus 5
.

Get started with Claude
If you're ready to start exploring what Claude can do for you, dive in! Whether you're a developer looking to integrate Claude into your applications or a user wanting to experience the power of AI firsthand, the following resources can help.

Looking to chat with Claude? Visit 
claude.ai
!

Intro to Claude
Explore Claude's capabilities and development flow.

Quickstart
Learn how to make your first API call in minutes.

Claude Console
Craft and test powerful prompts directly in your browser.
If you have any questions or need assistance, don't hesitate to reach out to the 
support team
 or consult the 
Discord community
.
Was this page helpful?


Choosing a model
Claude Fable 5 and Claude Mythos 5
Latest models comparison
Prompt and output performance
Migrating to Claude Opus 5
Get started with Claude
