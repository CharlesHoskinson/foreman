# M6 baseline repairs

Status: M6 is in progress. These repairs do not complete the release program or assign a numerical release version.

## Secret scan bounds

The existing default worktree scan failed with `bound_exceeded`. At diagnosis, the scan tree contained 11,380 regular files and 1,081,244,815 bytes. Its largest file was the installed native CUDA library at 315,724,552 bytes. The old bounds were 64 MiB per file, 1 GiB total, and 5,000,000 line inspections.

Raising only the byte bounds still failed. A bounded diagnostic with 512 MiB per file, 2 GiB total, and 20,000,000 line inspections returned clean. These values are now the defaults. The scanner still inspects binary dependencies and refuses excess input. No new path exemption was added.

The existing 71 scanner tests pass, including exact-bound refusal tests, traversal races, fixture identity checks, and a known secret fixture. The worktree scan test failed before the change and passes after it.

## Release inventory

The active inventory contained the six ForeDi OpenSpecs, but the v0.5 coverage register did not list them. The register now includes them as required dependencies of the existing release governor. This records the need to reconcile replaced runtime behavior before numerical release assignment. Every new entry remains `reconcile = "required"`.

The original research design and research plan now reside beside the release records. Their content remains historical research input. The six OpenSpecs remain the implementation specifications. This removes duplicate planning paths from `docs/superpowers/` and preserves source links.

The fixed simplification cohort and thresholds have not changed. The current replacement code exceeds the glue target. The final measurement must report that miss unless implementation changes meet the specified reduction. Neither a valid coverage inventory nor a passing scanner establishes release completion.
