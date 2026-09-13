# M3 implementation review

Independent agents reviewed the provider contracts, transport implementations, CLI integration, and M3 OpenSpec. The review used actual adapter fixtures and installed protocol definitions. It did not treat a planning scenario as an executed test.

| Finding | Correction and regression evidence |
| --- | --- |
| Qualification could miss terminal usage or a changed provider identity. | Pin the complete identity across the stream and account for terminal usage. `qualification.test.ts` covers both failures. |
| Qualification cancelled a native request after releasing its process scope. | Cancel while the owning scope is active, then record cleanup and remote outcome separately. |
| OpenAI continuation validation could occur after a GET. | Reject expired, changed, malformed, or oversized state before reconnecting. API lifecycle tests assert zero dispatch. |
| API response IDs could change inside an ordinary generation stream. | Pin the established response ID. Six profile fixtures reject a changed ID. |
| API usage above the admitted bounds could still complete. | Check token and observed USD bounds on stream events and remote observation. Preserve unknown cost and separate Messages cache accounting. |
| API metadata probes had no local timeout. | Apply the smaller admitted deadline or a ten-second bound. Never-ending credential and HTTP fixtures return `ProbeUnknown`. |
| Native protocol close could leave an event consumer waiting. | Signal the consumer and interrupt the existing supervisor. The native-process regression observes bounded cleanup. |
| Codex text fragments could share a false deduplication identity. | Use actual protocol event IDs, not a shared message-item ID. Preserve all fragments. |
| Grok could duplicate permission replies during cancellation. | Retain one permission decision and one host receipt per exposed call. Count native tool activity even without permission RPCs. |
| Claude's structured reply formatter looked like a host tool. | Accept only the exact formatter and require the validated terminal structured result. Real and lookalike tools still fail under no-tools policy. |
| Claude auxiliary usage looked like primary-model fallback. | Validate the primary model at protocol identity points and aggregate all reported accounting. Preserve auxiliary model counters. |
| Claude synthetic rate-limit events could appear as model mismatch. | Decode the closed SDK error enum before checking synthetic message identity. |
| Gemini's deny policy omitted its tool selector. | Emit `toolName = "*"`. The installed policy parser accepted one deny rule with zero errors. |
| Native Gemini's home path could be nested twice. | Map the selected `.gemini` directory to the CLI's expected home parent. |
| Product generation and listing did not yet consume stored live evidence. | Add bounded, duplicate-aware evidence reads and exact current admission checks. Fixture evidence cannot admit product generation. |
| Readiness had no adapter for the existing preflight records. | Reuse the existing bounded readers and credential-profile identity wrappers. Unmatched, stale, or unbound facts stay unknown. Stored metadata cannot qualify a workload. |

The live Grok attempt showed that global no-tools flags did not constrain ACP execution. Standalone no-tools admission now fails before model dispatch. M4 must provide actual workspace and permission enforcement for native coding.

The review also considered whether missing Gemini settings and OAuth files prove missing authentication. Installed source supports other authentication paths, so that absence alone does not authorize a blanket preflight rejection. The recorded diagnostic remains an unavailable qualification, without a retry or account change.

The [verification record](m3-verification.json) identifies the final commands and source hashes. The [live matrix](m3-live-qualification.md) states the limits of live evidence. M4 supplies durable host tool receipts and execution authority; M3 exposes their typed transport ports.
