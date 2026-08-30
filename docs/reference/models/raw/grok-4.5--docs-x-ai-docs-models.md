# source: https://docs.x.ai/docs/models
# status: 200

Models | SpaceXAI Docs
Docs
Search
⌘
K
API Console
Products
Grok
Status
Loading...
Resources
llms.txt
Discord
Email support
Terms and Policies
Get Started
Welcome
Grok 4.5
Latest
Quickstart
Models
New
Pricing
Release Notes
Grok Build
Getting Started
Modes and Commands
Keyboard Shortcuts
Features
Settings
CLI
Enterprise Deployments
Text
Text Generation
Reasoning
Structured Outputs
Streaming
Multi Agent
Completions (Legacy)
Imagine
Overview
Image Generation
Image Editing
Multi-Image Editing
Video Generation
Image-to-Video
Reference-to-Video
New
Video Editing
Video Extension
Files API Integration
Voice
New
Overview
Ephemeral Tokens
Speech to Speech
Text to Speech
Speech to Text
Custom Voices
New
Resources
Rate Limits
Cost Tracking
Debugging Errors
Docs MCP
Files & Collections
Files Overview
Managing Files
Public URLs
New
Chat with Files
Collections
Collections via API
Collection Metadata
Tools
Overview
Function Calling
Web Search
X Search
Code Execution
Image Generation
Collections Search (RAG)
Remote MCP Tools
Deep Dive
Advanced API Usage
Batch API
Deferred Completions
Prompt Caching
Context Compaction
New
Priority Processing
New
mTLS Authentication
Async Requests
WebSocket Mode
New
Migration Guides
Model Retirement on May 15
New
Migrating to Responses API
Community
Community Integrations
Google Cloud Vertex AI
Microsoft Foundry
FAQ
Data & Privacy
General
Docs
Grok & Console
REST API
gRPC
Get Started
Welcome
Grok 4.5
Latest
Quickstart
Models
New
Pricing
Release Notes
Grok Build
Getting Started
Modes and Commands
Keyboard Shortcuts
Features
Settings
CLI
Enterprise Deployments
Text
Text Generation
Reasoning
Structured Outputs
Streaming
Multi Agent
Completions (Legacy)
Imagine
Overview
Image Generation
Image Editing
Multi-Image Editing
Video Generation
Image-to-Video
Reference-to-Video
New
Video Editing
Video Extension
Files API Integration
Voice
New
Overview
Ephemeral Tokens
Speech to Speech
Text to Speech
Speech to Text
Custom Voices
New
Resources
Rate Limits
Cost Tracking
Debugging Errors
Docs MCP
Files & Collections
Files Overview
Managing Files
Public URLs
New
Chat with Files
Collections
Collections via API
Collection Metadata
Tools
Overview
Function Calling
Web Search
X Search
Code Execution
Image Generation
Collections Search (RAG)
Remote MCP Tools
Deep Dive
Advanced API Usage
Batch API
Deferred Completions
Prompt Caching
Context Compaction
New
Priority Processing
New
mTLS Authentication
Async Requests
WebSocket Mode
New
Migration Guides
Model Retirement on May 15
New
Migrating to Responses API
Community
Community Integrations
Google Cloud Vertex AI
Microsoft Foundry
FAQ
Data & Privacy
General
Key Information
Models
Copy for LLM
View as Markdown
Create API key
Meet grok-4.5
Grok 4.5
New
grok-4.5
Our flagship model for code and everything else: agentic tool calling, minimal hallucinations, configurable reasoning.
View model
Try in playground
Context
500k tokens
Input
$2.00 / 1M tokens
Output
$6.00 / 1M tokens
Reasoning
Configurable
Voice API
Real-time conversations, speech-to-text, and text-to-speech.
Agent
Starting at $0.05 / min
TTS
$15.00 / 1M chars
STT (Batch)
$0.10 / hour
STT (Streaming)
$0.20 / hour
Read docs
Try in playground
Imagine API
Turn ideas into reality with image and video generation.
Modes
Generation & editing
Speed
Industry-leading
Image · 1K / 2K
Starting at 
$0.02 / image
Video · 480p / 720p / 1080p
Starting at 
$0.05 / sec
Read docs
Try in playground
Which model should I choose?
Your choice depends on your use case. We have dedicated models and APIs for audio, image, and video capabilities. For everything else, including code, use Grok 4.5. It is the most intelligent and fastest model we’ve built.
Use case
Model
Code
Grok 4.5
Chat
Grok 4.5
Images
Grok Imagine API
Videos
Grok Imagine API
Voice
Grok Voice API
Additional Information Regarding Models
No access to realtime events without search tools enabled
Grok has no knowledge of current events or data beyond what was present in its training data.
To incorporate realtime data with your request, enable server-side search tools (Web Search / X Search). See 
Web Search
 and 
X Search
.
Chat models
No role order limitation: You can mix 
system
, 
user
, or 
assistant
 roles in any sequence for your conversation context.
logprobs
 and 
top_logprobs
 are not supported by models 
grok-4.20
 and newer. These fields will be silently ignored if set.
Image input models
Maximum image size: 
20MiB
Maximum number of images: No limit
Supported image file types: 
jpg/jpeg
 or 
png
.
Any image/text input order is accepted (e.g. text prompt can precede image prompt)
The knowledge cut-off date of Grok 4.5 is February 1, 2026.
Model Aliases
Some models have aliases to help users automatically migrate to the next version of the same model. In general:
<modelname>
 is aliased to the latest stable version.
<modelname>-latest
 is aliased to the latest version. This is suitable for users who want to access the latest features.
<modelname>-<date>
 refers directly to a specific model release. This will not be updated and is for workflows that demand consistency.
For most users, the aliased 
<modelname>
 or 
<modelname>-latest
 are recommended, as you would receive the latest features automatically.
Last updated: July 9, 2026
