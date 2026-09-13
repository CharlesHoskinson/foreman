# M3 live qualification

The compiled product command checked all twelve declared model/transport cells on 2026-09-13. Eight checks stopped before a model workload. Four native cells also had bounded workload attempts. Exact identity and capability success are separate observations.

| Exact profile | Transport | Recorded result |
| --- | --- | --- |
| grok-4.6 | xai-responses | Selected API credential unavailable; exit 2 before dispatch. |
| grok-4.6 | grok-acp | Exact model observed. The 55-second attempt ended with an unknown remote outcome. ACP did not enforce the global no-tools flags. The product now rejects standalone no-tools use before dispatch. |
| claude-opus-5 | anthropic-messages | Selected API credential unavailable; exit 2 before dispatch. |
| claude-opus-5 | claude-code | Passed generation, structured output, and observed no-tools qualification. Exact model and CLI 2.1.270. Low effort, adaptive thinking, foreground execution. |
| claude-fable-5-1 | anthropic-messages | Selected API credential unavailable; exit 2 before dispatch. |
| claude-fable-5-1 | claude-code | Exact initialization identity observed, then a typed rate-limit failure. No usable capability evidence. |
| gpt-6-astra | openai-responses | Selected API credential unavailable; exit 2 before dispatch. |
| gpt-6-astra | codex-app-server | Standalone no-tools boundary unavailable; exit 2 before model dispatch. Native coding requires the M4 host. |
| gpt-5.6-sol | openai-responses | Selected API credential unavailable; exit 2 before dispatch. |
| gpt-5.6-sol | codex-app-server | Standalone no-tools boundary unavailable; exit 2 before model dispatch. Native coding requires the M4 host. |
| gemini-3.8-flash | google-interactions | Selected API credential unavailable; exit 2 before dispatch. |
| gemini-3.8-flash | gemini-cli | No model identity observed. A bounded diagnostic returned exit 41 because the selected native account had no authentication selection. No usable capability evidence. |

The [evidence manifest](evidence/m3/manifest.json) binds the archived reports and selected controls. Reports contain public protocol identities and accounting. They contain no credential material, prompts, hidden reasoning, or opaque checkpoint bytes.

The successful Opus observation expires at the timestamp in its report. Admission also requires the exact profile hash, source hash, controls hash, account reference, transport version, and protocol revision. The portable [evidence file](evidence/m3/provider-evidence.json) contains only those successful capability records. It does not change the default account configuration.

A separate [authoring smoke check](evidence/m3/opus-authoring.report.json) used this evidence with the real `foreman plan` command. Opus produced `42` in one attempt. Foreman's checker accepted it and the preview reported a known final value of 42 with no effects or diagnostics. The admitted request had a 30-second deadline, zero repairs, and a USD 0.15 ceiling. Reported total usage was USD 0.062217. The archived snapshot explicitly selects the allowed native account; it grants no execution authority.

The first native attempts exposed formatter, auxiliary-accounting, and error-classification defects. Regression tests now cover the corrections. Earlier failures remain in the archive as diagnostic history; they are not current qualification successes. Grok's local cleanup does not prove that remote work stopped. Gemini's generated policy was corrected to a valid wildcard deny rule and checked with the installed policy parser without another model call.

All twelve cells have deterministic contract fixtures. Live coding, independent review, workspace effects, and final release qualification remain open. No model was substituted to make a cell pass.
