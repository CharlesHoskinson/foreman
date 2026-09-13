---
source_url: "https://ai.google.dev/gemini-api/docs/caching"
captured_at: "2026-09-13T03:01:42.028545+00:00"
contributor: "Foreman release research; Scrapling"
---

Gemini 3.8 Flash is now available. [Try it out](https://aistudio.google.com/prompts/new_chat?model=gemini-3.8-flash).

* [Home](https://ai.google.dev/)
* [Gemini API](https://ai.google.dev/gemini-api)
* [Docs](https://ai.google.dev/gemini-api/docs)

Send feedback

# Context caching


In a typical AI workflow, you might pass the same input tokens over and over to
a model. The Gemini API offers implicit caching to optimize performance and costs.

**Note:** The **Interactions API** only supports implicit caching. Explicit caching
(manually creating and managing cache objects) is not supported in the
Interactions API. To use explicit caching, switch to the
[generateContent API](/gemini-api/docs/generate-content/caching).

## Implicit caching

Implicit caching is enabled by default for all Gemini 2.5 and newer models. It is
supported for both [stateful](/gemini-api/docs/text-generation#multi-turn-conversations) (using `previous_interaction_id`)
and [stateless](/gemini-api/docs/text-generation#stateless-conversations) conversation modes.
We automatically pass on cost savings if your request hits caches. There is nothing you need to do
in order to enable this. The minimum input
token count for context caching is listed in the following table for each model:

| Model | Min token limit |
| --- | --- |
| Gemini 3.8 Flash | 4,096 |
| Gemini 3.7 Flash | 4,096 |
| Gemini 3.6 Flash | 4,096 |
| Gemini 3.5 Flash | 4,096 |
| Gemini 3.1 Pro Preview | 4,096 |
| Gemini 2.5 Flash | 2,048 |
| Gemini 2.5 Pro | 2,048 |

To increase the chance of an implicit cache hit:

* Try putting large and common contents at the beginning of your prompt
* Try to send requests with similar prefix in a short amount of time

You can see the number of tokens which were cache hits in the response object's
`usage.total_cached_tokens` (Python and JavaScript) field.


Send feedback

Except as otherwise noted, the content of this page is licensed under the [Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/), and code samples are licensed under the [Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0). For details, see the [Google Developers Site Policies](https://developers.google.com/site-policies). Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2026-09-02 UTC.


Need to tell us more?

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2026-09-02 UTC."],[],[]]
