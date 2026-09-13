# Advisory graph of M6 source candidate

Commit: `f734d99caf17c3ac5e958a161627eecdc6e43494`. Graphify 0.9.61. This candidate is not an accepted final release.

Inventoried 2639 tracked entries (176919945 source bytes). All staged blob bytes were checked against immutable Git objects and rechecked after extraction. Four PowerShell files required restoration from their Git blobs after archive eol conversion; original archive hashes remain recorded.

The final directed graph has 27375 nodes, 57075 edges, and 1984 communities. The HTML is an aggregated community view (1,984 nodes, 1,172 cross-community edges). The raw combined extraction retains 27571 nodes and 58964 edges before Graphify deduplication.

Coverage: 931 files were offered to the AST extractor; 832 source paths produced entities, including 783 code paths and 49 metadata/configuration paths. Another 218 code paths have no observed AST entities. All 964 Markdown files have structural extraction (12,180 headings, 4,667 inline links); this is not complete Markdown syntax or semantic coverage.

The extractor reported four syntax-warning files: pel-provider-tools.ts, evaluator.ts, providers/contract.ts, and the intentionally invalid launcher-build-bad.ts fixture. The first three have partial symbol extraction. The invalid fixture has no extracted symbols. Exact paths, lines and symbol counts are in coverage.json. Unsupported/excluded/unparsed paths remain in source-files.json.

Historical semantic fragments retained 83 nodes and 125 edges; 23 nodes, 35 edges, and 2 unvalidated hyperedges were omitted. Retention requires matching original raw and clean source hashes. Fragment provenance remains historical (source 441c3fb9); token usage remains null. No provider or labeling calls were made, and no token savings are claimed.

Limits: 327 unresolved AST endpoints are explicit reference nodes; 3,079 missing/external document references are not declarations or checked destinations. Final dangling edges: 0. Raw diagnostics identify 1,693 same-endpoint collapses and 88 exact duplicate edge records. The final DiGraph has no remaining same-endpoint groups, but a read-only rebuild simulation further normalizes it to 27,291 nodes and 56,991 edges; do not claim normalization idempotence. Raw records and both diagnostics are retained. Producer confidence labels are {"EXTRACTED":56829,"INFERRED":246}, not independent semantic validation.

Hashes (SHA-256):

- Candidate archive: `77fc0477168b83644c5fa3fe07ce528706bf59c4701c7bd6b82627f331efdacc`
- Source inventory: `d38a306a0383122704656d56e9a9bc56350c990a47882ad29746be4b0591c755`
- Raw combined extraction: `1b83eed6eef7d66ad1701ad8d7d025f4cf5204a42e352671e46d3b94322ec4ed`
- Clustered graph: `92aca127de80aad5df5f55fd6ffc46ca436bed51540f07d044adbe0c4b170dfb`
- Aggregated HTML: `94cc94e1e05202a217cd092c62a45c8f0cb8f4e07d4bf5ce25372ca93470396c`

Canonical graph and metadata hashes match before/after: `4bb79ce1662263945e332a5ba346177d353646f55bd59bc9dc00adc68eb7c429` and `68f98b775a71a724903eb2158a927f5eb6bfaaa54705b0be8547cc8db0896e3e`. The graph operation changed no repository source, build output, commit, or vault.

Paths are relative to the companion advisory archive root: combined/graphify-out/graph.json, graph.html and GRAPH_REPORT.md; combined/raw-extraction.json; source-files.json; coverage.json; artifact-manifest.json. Raw tool report prose is preserved separately because its zero-token summary applies only to the no-label stage, not historical semantic usage.

A later source candidate requires a new explicit refresh.
