# Model routing evidence

Read this reference when model identity, routing, or Council membership is in
scope. The API pages describe interfaces. The system and model cards describe
evaluations and deployment risks. Do not use one class as a substitute for the
other.

## Current route

| Role | Exact model | Evidence-based reason |
|---|---|---|
| Routine implementation | `grok-4.6` | xAI describes this model for coding, agentic tasks, and knowledge work. Its lower token price supports the routine lane. |
| High judgment | `gpt-6-astra` | OpenAI describes this model for its hardest end-to-end work. Its higher token price supports selective use. |
| Independent audit | `gpt-5.6-sol` | Keep the existing cheaper, read-only Codex audit role. Cross-vendor review remains mandatory when Grok implements. |
| Advisory judgment | `claude-fable-5-1` | Anthropic describes strong coding and knowledge-work capability. Foreman keeps this model read-only and advisory. |

Do not infer CLI availability from an API model page. Run an exact-model,
tool-free canary before dispatch. Record `requested_model_id` separately from
`provider_observed_model_id`. Also record the provider family, CLI version,
terminal state, prompt hash, and response hash.

A CLI argument proves only the requested ID. Keep the observed ID `unknown`
unless a trusted provider field proves it. An alias, model self-report, or
successful authentication is not exact-identity evidence.

## Configurable Council profile

Use the `astra-grok-fable` profile only when the user or release program
selects it. Do not require it for unrelated Foreman tasks.

| Provider family | Exact model | Council role |
|---|---|---|
| OpenAI | `gpt-6-astra` | High-judgment risk and architecture review |
| xAI | `grok-4.6` | Independent implementation and operational review |
| Anthropic | `claude-fable-5-1` | Advisory scope and assumption review |

Apply this profile to Moriarty release gates when requested. Apply the Council
protocol in `skills/council/SKILL.md`. Prove each identity with a bounded,
tool-free canary before dispatch.

Bind each response to the exact base commit, head commit, and diff hash. Blind
reviewers to author identity. By default, a same-family author is not an
admissible reviewer for that candidate.

An explicit user request can retain a named same-family member. Label that
response as a policy exception and non-independent advice. Do not count it as
an independent verdict, audit, or quorum domain. If the remaining members do
not satisfy the selected policy, report `quorum_not_met`. Do not manufacture
quorum from the three requested names.

Classify terminal transport before advice. Missing, cancelled, timed-out, and
incomplete terminals are infrastructure failures. A successful terminal with
malformed designated output is a completed invalid response such as
`schema_invalid`, not an infrastructure failure. Neither class is approval.
A completed abstention is also non-approval and non-quorum. Preserve each
admissible dissent. Council advice cannot write audit or gate verdicts.
Foreman checks and gates retain release authority.

## Practical limitations

- GPT-6 Astra costs more per token than the retained audit lane. OpenAI also
  reports lower chain-of-thought monitorability under adversarial tests.
  OpenAI guidance notes possible clarification stops, skill sensitivity, low
  delegation, and broad verification. Keep its work selective and hash-bound.
- Grok 4.6 is suited to agentic coding. Its model card reports a 1.7 percent
  factual hallucination rate at high thinking effort, versus 0.98 percent for
  Grok 4.5 in section 6.1, page 26. Treat worker claims as unverified.
- Fable 5.1 supports only thinking-enabled operation. Its card reports rare
  authorization distortion, safeguard workarounds, and sandbox-boundary use.
  Keep it read-only. Verify exact identity because some product safeguards can
  route flagged requests to a different Claude model.
- All three cards describe residual failures or evaluation limits. No member
  is a gate authority. Preserve independent checks and admissible dissent.

## First-party source ledger

Acquired on September 4, 2026 with Scrapling 0.4.15. Markdown fetches used
`scrapling extract ... --ai-targeted`. PDF fetches used Scrapling `Fetcher`
and verified a `%PDF-` response before `pdftotext -layout`.

| Provider | First-party source | Acquired artifact SHA-256 |
|---|---|---|
| OpenAI | [API model page](https://developers.openai.com/api/docs/models/gpt-6-astra) | `22ba8b68af6bf7d3ba7f675fda686d17307851d2f46960d1316d6a2447425b12` |
| OpenAI | [Model and migration guide](https://developers.openai.com/api/docs/guides/latest-model) | `b3ebc3af4fac899a64b981fa3253871d1c16752f21b147c4dbd34e190d708b3f` |
| OpenAI | [System card, PDF](https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf) | `c1ab528adf616b76080c971900b10748d1de5e6fdc986835df800d9461ee4b5a` |
| Anthropic | [System-card index](https://www.anthropic.com/system-cards) | `157ac173cb6aa9fd971cc0ffe27ca3a418fdc1eafd34487735b0495d9c7f7f68` |
| Anthropic | [Fable product page](https://www.anthropic.com/claude/fable) | `37349776775fe3bd7b0124af8e85032953a610579b06cf4d123083f6c3ec117a` |
| Anthropic | [Fable 5.1 and Mythos 5.1 system card, PDF](https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card) | `b0d59edc7a60eef32a879c13d713cce60c3fefd7e6b5183afdc8b835af3c8c39` |
| xAI | [API model page](https://docs.x.ai/developers/models/grok-4.6) | `7fc5b4ad31627c35121c0cb302b2aa94564e2a13e7ce086b2f9dd3dbe39296ce` |
| xAI | [Launch article](https://x.ai/news/grok-4-6) | `dbd15fdcccf23bc84439d411d41754276c1631f4e7ce574d868988cb26ccc5da` |
| xAI | [Grok 4.6 model card, PDF](https://media.x.ai/v1/website/card-4p6-4cd2dc57.pdf) | `1fbb3ab6d7c572720e05d501eab8f11052b32db8d5936e66802c5c49b2261f4f` |

## Evidence boundary

These sources verify published IDs and documented behavior. They do not verify
account access, CLI support, local authentication, exact-model dispatch, or
current provider health. Record those items as unknown until a current canary
proves them.
