# Foreman model routing update

Date: September 4, 2026

## Scope

Update Foreman model-routing instructions for GPT-6 Astra, Grok 4.6, and
Claude Fable 5.1. Preserve GPT-5.6 Sol audit and fallback roles. Do not change
runtime code, authentication, user configuration, or Moriarty files.

## Plan recorded before edits

1. Run retrieval and routing checks against the current Foreman skill.
2. Acquire first-party API documents and system or model cards with Scrapling.
3. Record exact model IDs, source hashes, and documented limitations.
4. Update only Foreman routing instructions and references.
5. Run reference-skill tests, validation, and scoped repository checks.
6. Commit only the owned files.

## RED evidence

The deterministic checks found these gaps before the edit:

- `Grok 4.5` remained in the active routine route.
- `GPT-6 Astra` was absent from the routing table.
- No configurable Astra, Grok, and Fable Council profile existed.

An independent no-skill test also routed the costly architecture decision to
Fable instead of Astra. It used display names instead of exact model IDs. It
did not distinguish infrastructure failure from a completed abstention. It
also omitted the exact base, head, and diff-hash identity.

## Research method

Scrapling 0.4.15 fetched all first-party pages. AI-targeted Markdown files had
nonempty bodies before use. Scrapling `Fetcher` downloaded each PDF body. A
`%PDF-` check ran before `pdftotext -layout`.

The OpenAI static launch-page request returned HTTP 403 with an empty body.
The browser fetch returned only 95 bytes. Neither result counted as evidence.
The Deployment Safety system card returned a substantive HTML body and PDF.

See `skills/foreman/references/model-routing-evidence.md` for the source URLs,
artifact hashes, routing reasons, and practical limitations.

### Local acquisition artifacts

The acquired artifacts remain available for independent inspection in
`/tmp/foreman-model-cards.Mbx8CV/`:

| Card | PDF | Extracted text |
|---|---|---|
| GPT-6 Astra | `/tmp/foreman-model-cards.Mbx8CV/openai-gpt-6-astra-system-card.pdf` | `/tmp/foreman-model-cards.Mbx8CV/openai-gpt-6-astra-system-card.txt` |
| Claude Fable 5.1 and Mythos 5.1 | `/tmp/foreman-model-cards.Mbx8CV/anthropic-fable-5-1-system-card.pdf` | `/tmp/foreman-model-cards.Mbx8CV/anthropic-fable-5-1-system-card.txt` |
| Grok 4.6 | `/tmp/foreman-model-cards.Mbx8CV/xai-grok-4-6-model-card.pdf` | `/tmp/foreman-model-cards.Mbx8CV/xai-grok-4-6-model-card.txt` |

The acquired page bodies remain in the same directory. The Scrapling PDF
helper is
`/tmp/foreman-model-cards.Mbx8CV/fetch_pdf.py`. The helper checks `%PDF-`
before it writes a response body.

## Changes

- Route fully specified routine implementation to `grok-4.6`.
- Set `WC_GROK_MODEL=grok-4.6` for adapter-based implementation. The current
  adapter fallback still requests `grok-4.5`.
- Route costly architecture and release judgment to `gpt-6-astra`.
- Keep `gpt-5.6-sol` as the independent audit and fallback lane.
- Keep `claude-fable-5-1` as a read-only advisory lane.
- Add the optional `astra-grok-fable` Council profile.
- Select that Council profile for Moriarty release gates only when requested.
- Preserve exact-model canaries, non-author review, terminal-first admission,
  hash-bound evidence, dissent, Endstop, and Foreman gate authority.
- Permit an explicitly requested same-family Council member as labeled,
  non-independent advice. Do not count that response as independent audit or
  quorum evidence.
- Record requested model IDs separately from provider-observed IDs. Keep the
  observed value `unknown` when the transport does not prove it.
- Remove `--no-auto-update` from new Grok 1.0.13 examples because current help
  does not list it. Preserve the old `acceptEdits` finding as historical
  evidence that needs a current behavioral probe.

## Local inventory boundary

The observed local tools were Grok 1.0.13, Codex CLI 0.153.3, and Claude Code
2.1.260. This inventory does not prove exact-model dispatch. No live
GPT-6 Astra, Grok 4.6, or Fable 5.1 canary ran during this documentation task.
The skill update does not migrate runtime defaults or user configuration.

## Validation record

- Foreman `quick_validate.py`: pass.
- Installed runtime `verify-install`: pass. Manifest digest:
  `d7960570a7bcbe86c0c69cde222d2464fcf0d68429b98b7f69e906c533446fbd`.
- Scoped Markdown lint: pass for all five owned Markdown files.
- Scoped codespell: pass.
- Scoped link check: nine links passed. One redirected to its first-party PDF.
- Routing retrieval checks: pass.
- Source hashes and cited card statements: reproduced from local artifacts.
- Current CLI flag compatibility checks: pass for the documented flags.
- Independent reference-skill test: pass after the update. The result selected
  the exact routes and preserved identity, quorum, dissent, and gate rules.

The repository-wide documentation check remains red on pre-existing files. Its
Markdown failures are in
`docs/reference/models/raw/grok-4.5--docs-x-ai-docs-overview.md`. Its spelling
failures are in `formal/specs/foreman_lifecycle.qnt`. This update does not own
those files.

## Remaining limitations

- No live exact-model canary ran. Provider-observed identities remain unknown.
- Adapter-based Grok 4.6 work requires `WC_GROK_MODEL=grok-4.6` because the
  unchanged runtime fallback still requests Grok 4.5.
- This documentation update does not prove Grok 4.6 concurrency behavior.
- Council remains advisory. A requested same-family response is not an
  independent verdict, audit, quorum domain, or gate approval.
