# Roles

| Role | Responsibility |
| --- | --- |
| Orchestrator | Define the objective, scope, acceptance checks, and existing authority. Select exact qualified profiles and inspect host evidence. |
| Implementer | Execute the approved task inside admitted paths. Report gaps and return the required candidate report without expanding scope. |
| Reviewer | Inspect the immutable candidate, acceptance criteria, and host verification with read-only tools. Return a schema-valid verdict and grounded findings. |
| Advisor | Provide optional research or design judgment. Advice cannot approve execution, suppress dissent, or replace independent review. |

Bind implementation and review roles in project settings. The defaults are Grok 4.6 through `grok-acp` and GPT 5.6 Sol through `codex-app-server`. The host requires different observed vendors for independent review. Select another qualified reviewer if the implementer uses OpenAI. No model substitution is implicit.

Give providers the approved artifacts and relevant constraints. Do not supply credentials, unrelated conversation history, or authority beyond the registered scope. Keep review independent of implementation discussion. The host verifies that review did not change the candidate.

Search and planning are read-only unless separately authorized. They can run concurrently when their inputs are independent. Writing tasks use the admitted worktrees described in [parallel worktrees](parallel-worktrees.md).

Worker claims, advisor recommendations, and review verdicts are evidence inputs. The host captures candidate identity, runs the registered verification, and enforces publication authority. The orchestrator makes the release decision from that evidence. Retained Council workflows keep their own quorum and dissent rules.
