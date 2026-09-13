# Advisory graph of M6 source candidate

Commit: `bb0c1e9f3868d6bf36a91f78ceec55800192fc5c`. Graphify 0.9.61. This candidate is not an accepted final release.

Inventoried 2660 tracked entries (177521000 source bytes). All staged blob bytes were checked against immutable Git objects and rechecked after extraction. 4 PowerShell files required restoration from their Git blobs after archive eol conversion; original archive hashes remain recorded.

The final directed graph has 27398 nodes, 57120 edges, and 1994 communities. The HTML is an aggregated community view (1994 nodes, 1286 cross-community edges). The raw combined extraction retains 27594 nodes and 59009 edges before Graphify deduplication.

Coverage: 933 files were offered to the AST extractor; 834 source paths produced entities, including 785 code paths and 49 metadata/configuration paths. Another 218 code paths have no observed AST entities. All 967 Markdown files have structural extraction (12176 headings, 4673 inline links); this is not complete Markdown syntax or semantic coverage.

The extractor reported four syntax-warning files: pel-provider-tools.ts, evaluator.ts, providers/contract.ts, and the intentionally invalid launcher-build-bad.ts fixture. The first three have partial symbol extraction. The invalid fixture has no extracted symbols. Exact paths, lines and symbol counts are in coverage.json. Unsupported/excluded/unparsed paths remain in source-files.json.

Historical semantic fragments retained 83 nodes and 125 edges; 23 nodes, 35 edges, and 2 unvalidated hyperedges were omitted. Retention requires matching original raw and clean source hashes. Fragment provenance remains historical (source 441c3fb9); token usage remains null. No provider or labeling calls were made, and no token savings are claimed.

Limits: 330 unresolved AST endpoints are explicit reference nodes; 3078 missing/external document references are not declarations or checked destinations. Final dangling edges: 0. Raw diagnostics identify 1693 same-endpoint collapses and 88 exact duplicate edge records. The final DiGraph has no remaining same-endpoint groups, but a read-only rebuild simulation further normalizes it to 27314 nodes and 57036 edges; do not claim normalization idempotence. Raw records and both diagnostics are retained. Producer confidence labels are {"EXTRACTED":56874,"INFERRED":246}, not independent semantic validation.

Hashes (SHA-256):

- Candidate archive: `003e68906fad49a3e01aebd3e8e1ba0f04c6de77b7aa11f054f02557fdd38dc7`
- Source inventory: `160a90a37e714a4cc11f23a1075b5d1b5893a35a778faa0a35f9830acab871d3`
- Raw combined extraction: `4c453c0029d73ac15c5e2dbd1022478055a842f5510aeb34f9485c5904c70043`
- Clustered graph: `3140a2b7cd1ac094301d3bd9bb9e9666c8f323afc87de3fd44908e52b763dc7a`
- Aggregated HTML: `3fc55a11306225c62d140c6f20472fcf1b85016a68cc287d7a044a3712b67ad3`

Canonical graph and metadata hashes match before/after: `4bb79ce1662263945e332a5ba346177d353646f55bd59bc9dc00adc68eb7c429` and `68f98b775a71a724903eb2158a927f5eb6bfaaa54705b0be8547cc8db0896e3e`. No repository source, build output, commit, or vault was changed.

Paths are relative to this directory: combined/graphify-out/graph.json, graph.html and GRAPH_REPORT.md; combined/raw-extraction.json; source-files.json; coverage.json; artifact-manifest.json. Raw tool report prose is preserved separately because its zero-token summary applies only to the no-label stage, not historical semantic usage.

A later source candidate requires a new explicit refresh.
