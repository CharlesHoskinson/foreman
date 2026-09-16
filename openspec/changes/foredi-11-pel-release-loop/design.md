# ForeDi bounded Pel release completion loop

Status: Draft for review. New requirements do not establish implemented behavior.

## Architecture

Use the existing Pel evaluator, fm/task, fm/verify, fm/review, Endstop contract, queue, and durable journal. Do not create a shell while-loop, second scheduler, or fabricated host operations such as fm/credentials. The draft program at examples/pel/foredi-release-completion.pel operates on one approved package artifact at a time. Advance to dependent packages only after exact-candidate checks and independent review pass.

Default package budget: one initial implementation, at most two correction rounds, one verification and one review per distinct candidate, two provider retries, two resume attempts, sixteen total actions, two hours wall time, and thirty minutes without product change. Host authority may impose lower limits. A retry cannot reset any counter. Release-wide progress belongs to the existing release contract or family. Do not create replacement contracts to escape a terminal limit.

Readiness and configured authority must pass before an actionful dispatch. The current observed setup disagreement is a preparation blocker, not a reason to bypass setup. The program contains no publication action. Live migration requires separately bound account-specific authority.

## Verification mapping

| Requirement | Planned test target |
| --- | --- |
| PL01 | `pel-release-loop.test.ts` |
| PL02 | `pel-release-loop.test.ts` |
| PL03 | `pel-release-loop.test.ts` |
| PL04 | `pel-release-loop.test.ts` |
| PL05 | `pel-release-loop.test.ts` |
| PL06 | `pel-release-loop.test.ts` |
| PL07 | `pel-release-loop.test.ts` |
| PL08 | `pel-release-loop.test.ts` |

Test filenames without a prefix are proposed targets under the owning providers or orchestration package.
The implementation brief must resolve each target before dispatch.

## Authority

Keep changes uncommitted until host integration is explicitly authorized.
Do not change installed runtimes or existing accounts during synthetic development.
