# EARS method

The release uses the Easy Approach to Requirements Syntax, or EARS. The method separates the condition that activates a requirement from the observable system response. The pattern definitions come from [Alistair Mavin's official guide](https://alistairmavin.com/ears/), read on 2026-09-13.

Scrapling captured the guide as [source text](../../research/pel-release/sources/ears/official-guide.txt) and [original HTML](../../research/pel-release/sources/ears/official-guide.html). The [capture manifest](../../research/pel-release/sources/ears/manifest.json) records the URL, time, fetcher, and hashes.

| Pattern | Use in this release |
| --- | --- |
| Ubiquitous | State an invariant that always applies to the named system. |
| Event | Start with When and identify one triggering event. |
| State | Start with While and identify the active condition. |
| Unwanted behavior | Start with If, name the failure condition, then require its response. |
| Optional feature | Start with Where and identify a feature available in that configuration. |
| Complex | Combine conditions in temporal order, then specify the response. |

Each requirement names the system and uses SHALL for its required response. A requirement states observable behavior. Design sections define the types, limits, algorithms, and source decisions needed to implement that behavior. Tasks identify the code and test work.

## Stable identifiers

`F-M1-01` identifies a feature. `R-M1-001` identifies a requirement. `T-M1-001` identifies a test scenario. The milestone prefix assigns ownership. Do not reuse an identifier for unrelated behavior. A test can cover more than one requirement when the same fixture demonstrates each response.

Every feature has at least one requirement. Every requirement has at least one planned test. Every test states a concrete fixture, action, expected result, level, and target file. The reverse requirement links in test records agree with the forward links. Each test ID appears in an OpenSpec scenario.

`catalog.json` in each change is the structured source for the release catalog. The EARS text matches the OpenSpec body after whitespace normalization. The combined catalog retains the source change and milestone for each record.

## Verification boundaries

OpenSpec strict validation checks the change format and required scenario structure. Catalog verification checks identifier uniqueness, requirement text, complete feature coverage, complete test coverage, and reciprocal links. Three independent Opus audits examine semantics, provider behavior, implementation detail, and release coverage.

These checks validate a specification. Runtime unit tests, provider contract tests, crash tests, live qualification, packaging tests, and simplification measurements remain implementation work. A passing specification check does not mark a planned acceptance test as passed.
