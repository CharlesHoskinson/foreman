# Source capture notes

Captured on September 12, 2026, with Scrapling Fetcher.
Raw responses remain unchanged. The manifest records unsuccessful responses too.
A status of 200 does not prove that a response contains readable source content.

- `arxiv-2505.13453v2.pdf`: version-pinned full paper. All 29 pages were read.
- `arxiv-2505.13453v2.txt`: derived with `pdftotext -layout`. Page boundaries remain as form-feed characters.
- `arxiv-2505.13453v2-abs.html`: metadata, version history, and paper rights link.
- `karpathy-llm-wiki.html`: raw gist page. It contains page navigation and third-party comments. Those comments are not research evidence.
- `karpathy-llm-wiki.md`: exact primary Markdown from revision `ac46de1ad27f92b28ac95459c782c07f6b8c964a`.
- `karpathy-llm-wiki-gist.json` and `karpathy-llm-wiki-gist-retry.json`: HTTP 502 bodies. They are failed metadata attempts, not valid JSON evidence.
- `author-homepage.html`: HTTP 200 Notion application shell. Scrapling did not extract the biography text from this response.
- `github-pel-search.json`: query `pel orchestrating agents`. One unrelated repository, `kaofelix/pi-peline`.
- `github-pel-author-search.json`: query `pel Mohammadi`. Zero repository results.
- `github-pel-language-search.json`: query `"Pel" "language" "LLM"`. Two unrelated repositories, `silicobio/peleke` and `harshitap1305/PeliCap`.

The author homepage text was separately checked through the web retrieval tool:
<https://aplaceofmind.notion.site/Behnam-Mohammadi-6104801661e0448998b58569b25d1d2e>.
Its retrieved line 48 states: “Pel will soon be generally available on Github.”
This note preserves the short relevant observation, not a claim that the Scrapling HTML contains rendered biography content.
No official Pel implementation was verified. No upstream tests were run.

The arXiv abstract links `http://arxiv.org/licenses/nonexclusive-distrib/1.0/` for the paper.
No upstream software license was verified. These research sources retain their original rights.
The gist's Markdown was fetched through a revision-specific URL. No explicit gist license was verified.

No cookies or credentials were retained. Existing static-page, API, and arXiv site patterns covered these fetches.
No new sensitive site pattern was added.
