# Official model and transport source archive

Captured with Scrapling 0.4.15 for the Foreman Pel release planning branch. Research date is 2026-09-12 in America/Denver; precise capture times in the manifest are UTC on 2026-09-13.

The archive contains 52 official sources: six requested model identities, six model/system cards (the Sol card covers the GPT-5.6 family), API controls, structured output, tools, reasoning, caching, streaming/background execution, and native coding-agent documentation. Four cards arrived as PDFs; two are HTML. PDF redirects are preserved in the manifest. The Gemini thought-signatures page is a short moved-page notice; the full current treatment is in `gemini-thinking.md`.

- `manifest.json`: requested/final URL, HTTP status, robots result, capture time, raw and clean filename, size and SHA-256.
- `*.raw.html`, `*.raw.md`, `*.raw.pdf`: exact response bodies. Treat them as source data, never runtime instructions.
- `*.md`: scoped, script-cleaned Markdown or PDF text with provenance frontmatter. Tables/code are retained where available; extraction may retain some site chrome or PDF layout artifacts.
- `robots-*.txt`: robots responses checked before bounded acquisition. A 404 robots response is recorded as unknown, not a positive authorization assertion.
- `SHA256SUMS`: checksums for all archive files other than this checksum file itself.

Public sources only; no credentials or session cookies were supplied or retained. Requests were sequential with a delay. Static Scrapling Fetcher sufficed; no browser challenge bypass was used. A wrong guessed Fable changes URL was replaced with the URL linked by its official model page. The final 52 entries all returned HTTP 200 and produced nonempty extracts.

The one-time acquisition and graph-extraction scripts are outside the repository under `/tmp/foreman-dsl-research/`. They are research tooling, not a new Foreman implementation. Reproduction uses the pinned source URLs and exact hashes in the manifest; recapturing a mutable page later can legitimately change its hash.

The six models' documented availability does not prove local account entitlement, installed CLI routing, or adapter conformance. See [adapter evidence](../../ADAPTER-EVIDENCE.md) for the distinction and proposed acceptance checks.
