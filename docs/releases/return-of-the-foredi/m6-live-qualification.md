# M6 live qualification observations

The compiled product attempted all twelve exact model and transport cells on September 13, 2026.
The observation interval was 12:42:33–12:42:44 UTC.
The tested bundle SHA-256 was `ea18ff6f6b427ac40b33eb352cbe7729b9105329f1f7f449365ddf37d1ccbefe`.
This is a dated observation, not final package acceptance.

Each attempt had a 60-second deadline and a USD 0.25 ceiling.
Input and output limits were 12,000 and 1,024 tokens.
Native coding attempts allowed two tool calls.
Other attempts allowed no tool calls.

| Exact profile | API result | Native result |
| --- | --- | --- |
| `grok-4.6` | Selected environment credential unavailable, exit 2 | ACP coding credential unavailable, exit 3 |
| `claude-opus-5` | Selected environment credential unavailable, exit 2 | Claude Code generation, structured output, and no-tool policy passed, exit 0 |
| `claude-fable-5-1` | Selected environment credential unavailable, exit 2 | Exact model observed, then rate limited, exit 3 |
| `gpt-6-astra` | Selected environment credential unavailable, exit 2 | Codex coding credential unavailable, exit 3 |
| `gpt-5.6-sol` | Selected environment credential unavailable, exit 2 | Codex coding credential unavailable, exit 3 |
| `gemini-3.8-flash` | Selected environment credential unavailable, exit 2 | Process ended without confirmed provider outcome or model identity, exit 3 |

The Opus result contains three capability evidence records for Claude Code 2.1.270.
It does not establish coding, workspace, permission, or publication capability.
Its reported total cost was USD 0.016272.
The native client separately reported USD 0.000947 of auxiliary Haiku usage.
The qualified main model remained `claude-opus-5`.

The earlier [M3 qualification record](m3-live-qualification.md) retains its original observations.
The current Gemini attempt does not independently establish an authentication failure cause.
No unavailable model was replaced with another model.
No failed or incomplete attempt generated live capability evidence.

The [evidence manifest](evidence/m6/live-qualification/manifest.json) binds sanitized result files and selected credential references.
Credential values, raw prompts, provider session identifiers, and hidden reasoning are excluded from this archive.
Provider evidence retains exact profile, transport, source, control, and version hashes.
