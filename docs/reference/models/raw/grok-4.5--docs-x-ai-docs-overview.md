# source: https://docs.x.ai/docs/overview
# status: 200

Overview | SpaceXAI Docs
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
Get started 
with SpaceXAI
Intelligent, fast, and cost-effective models across code, text, voice, image, and video.
Create API key
Get Started
cURL
Python
Python (OpenAI)
JavaScript
curl
 https://api.x.ai/v1/responses
 \
  -H
 "Authorization: Bearer 
$XAI_API_KEY
"
 \
  -H
 "Content-Type: application/json"
 \
  -d
 '{
    "model": "grok-4.5",
    "input": "Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}"
  }'
import
 os
from
 xai_sdk 
import
 Client
from
 xai_sdk.chat 
import
 user
client 
=
 Client(
api_key
=
os.getenv(
"XAI_API_KEY"
))
chat 
=
 client.chat.create(
model
=
"grok-4.5"
)
chat.append(user(
"Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}"
))
print
(chat.sample().content)
from
 openai 
import
 OpenAI
client 
=
 OpenAI(
    api_key
=
"<YOUR_XAI_API_KEY_HERE>"
,
    base_url
=
"https://api.x.ai/v1"
,
)
response 
=
 client.responses.create(
    model
=
"grok-4.5"
,
    input
=
"Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}"
,
)
print
(response.output_text)
import
 { xai } 
from
 "@ai-sdk/xai"
;
import
 { generateText } 
from
 "ai"
;
const
 { 
text
 } 
=
 await
 generateText
({
  model: xai.
responses
(
"grok-4.5"
),
  prompt: 
"Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}"
,
});
console.
log
(text);
Models
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
Jump straight in
Try code, text, voice, image, and video models below
Code
Text
Voice
Image
Video
Bash
 Python
Python (OpenAI)
 JavaScript
curl
 https://api.x.ai/v1/responses
 \
  -H
 "Authorization: Bearer 
$XAI_API_KEY
"
 \
  -H
 "Content-Type: application/json"
 \
  -d
 '{
    "model": "grok-4.5",
    "input": "Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}"
  }'
import
 os
from
 xai_sdk 
import
 Client
from
 xai_sdk.chat 
import
 user
client 
=
 Client(
api_key
=
os.getenv(
"XAI_API_KEY"
))
chat 
=
 client.chat.create(
model
=
"grok-4.5"
)
chat.append(user(
"Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}"
))
print
(chat.sample().content)
from
 openai 
import
 OpenAI
client 
=
 OpenAI(
    api_key
=
"<YOUR_XAI_API_KEY_HERE>"
,
    base_url
=
"https://api.x.ai/v1"
,
)
response 
=
 client.responses.create(
    model
=
"grok-4.5"
,
    input
=
"Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}"
,
)
print
(response.output_text)
import
 { xai } 
from
 "@ai-sdk/xai"
;
import
 { generateText } 
from
 "ai"
;
const
 { 
text
 } 
=
 await
 generateText
({
  model: xai.
responses
(
"grok-4.5"
),
  prompt: 
"Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}"
,
});
console.
log
(text);
Responses API
Agentic coding with Grok Build on the API—refactor, debug, and build in your own tools.
Agentic coding
IDE & tool integrations
Early access
$2.00 / 1M input tokens
$6.00 / 1M output tokens
Read docs
Get started
Create an API key
Purchase credits
Quickstart guide
Models
Pricing
Grok Build
Function calling
Web search
Structured outputs
Batch API
Resources
API reference
Community integrations
Release notes
