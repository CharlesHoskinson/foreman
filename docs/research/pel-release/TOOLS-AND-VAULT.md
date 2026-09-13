# Research tools and Foreman vault

Checked on 2026-09-12 America/Denver. Machine timestamps use 2026-09-13 UTC.

## Tool updates

| Tool | Before | Verified after | Update evidence |
| --- | --- | --- | --- |
| Graphify executable | 0.9.53 | 0.9.61 | `uv tool upgrade graphifyy`, PyPI and GitHub release metadata. |
| Graphify agent skills | 0.9.48 | Bundled with 0.9.61 | `graphify install --platform agents` and `--platform claude`. |
| Scrapling | 0.4.15 | 0.4.15, current | `uv tool upgrade scrapling` refreshed dependencies. `scrapling install` reports dependencies installed. |
| uv | 0.12.5 | 0.12.13 | `uv self update`. |
| claude-obsidian transaction core | 2.1.1 | 2.2.0 | Clean installed checkout fast-forwarded to release tag `v2.2.0`, commit `32ac5a0`. Vault doctor passed. |
| OpenSpec npm installation | 1.7.0 | 1.13.0 | Updated global package and corrected the older PATH shim, which resolved 1.10.0. |
| Gemini CLI | Windows PATH installation | Linux 0.59.0 | Installed current `@google/gemini-cli`. Version smoke passed. |
| Codex CLI | 0.154.0 | 0.154.0, current | Installed version matches npm current release. |
| Grok Build | 1.0.30 | 1.0.30, current | Installed version matches npm current release. |
| Claude Code | 2.1.270 | 2.1.270, current | Installed version matches npm current release. |
| markdownlint-cli2 | 0.23.2 | 0.23.2, current | Installed version matches npm current release. |
| Obsidian | 1.13.7 | 1.13.7, current | App update check and rendered vault title. |
| Obsidian LLM Integration | Absent from new vault | 1.0.0 | Pinned release assets match published SHA-256 digests. Plugin loaded in Obsidian. |

Node remains at 24.18.1, within Foreman's required Node 24 line.
No repository dependency lockfiles or runtime packages changed during planning.
Unrelated tools and the existing Windows Gemini installation were not changed.

The Gemini npm installation reported unapproved install scripts for optional native packages `@github/keytar` and `node-pty`.
The CLI version smoke passed. Native credential-store and PTY behavior were not tested or claimed ready.
No provider inference or authentication operation was performed.

Graphify's 0.9.61 advisory output does not satisfy the current Foreman graph qualifier, which pins 0.9.48.
The qualified graph files remain unchanged. The release plan assigns a tested qualifier update separately.

The claude-obsidian 2.2.0 release adds scoped linting, a consistent page-type vocabulary, and explicit vault-relative links.
Existing vault transaction schemas remain readable. The updated core passed `doctor` against the new vault.
Relevant upstream releases: [Graphify](https://github.com/Graphify-Labs/graphify/releases/tag/v0.9.61), [Scrapling](https://github.com/D4Vinci/Scrapling/releases/tag/v0.4.15), [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian/releases/tag/v2.2.0).

## Vault installation

Vault: `/home/charl/vaults/Foreman`.
Repository worktree: `/home/charl/fm-wt/foreman-dsl-release`.
Branch: `plan/dsl-orchestration-release`.

The vault foundation was created by transaction `foreman-vault-init-20260912`.
Initialization added the workspace configuration, Obsidian settings, immutable source manifest, inbox, index, log, hot cache, overview, and evidence ledgers.
Research ingestion uses a separate inspected transaction with create-only captures.

The plugin comes from [hardbyte/obsidian-llm-plugin v1.0.0](https://github.com/hardbyte/obsidian-llm-plugin/releases/tag/v1.0.0).
The release tag resolves to `f504039838b6273b039563cd8c35ca7f79d353f8`.
The publisher's manifest identifies Brian as author. The repository and release provenance are recorded separately from that display name.
Installation uses the publisher's documented manual procedure with pinned, verified assets.

| Asset | Verified SHA-256 |
| --- | --- |
| `main.js` | `1947dbb3819e2b64acb77ab5fb43e0c0f6f7d7072ed594dd30d3ef4c30d001ab` |
| `manifest.json` | `a597e30e67d52ac7d61f5c2ee91724d4fbbb37439bc3cd74b9fc4d48f5bc1d2e` |
| `styles.css` | `03bf771cc9fa5204922e81c8392c06f8b59d63b23e1ec61bc74971e5eb852ddb` |

`node --check` accepted the plugin bundle.
Obsidian's live app state reported vault `Foreman`, enabled plugin `obsidian-llm`, and loaded plugin `obsidian-llm`.
The chat interface displayed `Claude (claude-opus-5)`.
This proves installation and loading, not a successful model conversation.

The plugin starts with an explicit Opus 5 profile in Claude Code plan mode.
Its system prompt file is `wiki/meta/LLM-WIKI-GUIDE.md`.
ACP is disabled so opening the panel does not automatically install bridge packages through `npx`.
Codex and Gemini profiles are available for manual selection. Grok has no native provider entry in this plugin release.
The plugin's write-permission switch remains disabled. Canonical notes were written through the transaction core.

## Source handling

Scrapling captured the selected public provider documentation, system cards, Pel paper, Karpathy gist, and plugin metadata.
Raw bytes, clean text, source URLs, capture times, HTTP status, and digests are recorded in each source manifest.
Failed metadata attempts remain failure records. They are not evidence for the corresponding page contents.
No cookies or credentials were saved.

The current site patterns cover the encountered static documents, raw GitHub files, JSON endpoints, and PDF extraction.
No new cookie or private-site pattern needed storage.
Provider documentation with a Markdown endpoint gave smaller extracts than navigation-heavy HTML.
Scrapling preserved PDF bytes before text extraction, avoiding false success from an empty selector result.
