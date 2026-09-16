# ForeDi final candidate and inherited release closure

Status: Draft for review. New requirements do not establish implemented behavior.

## Architecture

Keep the existing release program as the sole acceptance and publication authority. Add a closure register that references inherited requirements without changing their identifiers, commands, hosts, thresholds, or historical results. Preserve the September 13 production-code deferral. Keep M7 K implementation planned, as the existing scope explicitly excludes it from acceptance.

Use an immutable candidate for final evidence. Bind command, environment, host, executed/skipped counts, output digest, and artifact digest to that candidate. Run designated Windows tests on Windows, not WSL substitutes. Do not rerun benchmarks merely to select favorable samples. Rebuild matching package, graph, and support artifacts only after source changes stop. Obtain numerical-version reconciliation through the existing program before publication.

## Verification mapping

| Requirement | Planned test target |
| --- | --- |
| RC01 | `release-closure.test.ts` |
| RC02 | `release-closure.test.ts` |
| RC03 | `pel-simplification.test.ts` |
| RC04 | `pel-package.test.ts` |
| RC05 | `release-closure.test.ts` |
| RC06 | `release-closure.test.ts` |
| RC07 | `release-closure.test.ts` |
| RC08 | `release-closure.test.ts` |

Test filenames without a prefix are proposed targets under the owning providers or orchestration package.
The implementation brief must resolve each target before dispatch.

## Authority

Keep changes uncommitted until host integration is explicitly authorized.
Do not change installed runtimes or existing accounts during synthetic development.
