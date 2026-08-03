# Council v0.2.9.0 preflight release

## Purpose

Foreman needs one installable Council boundary before it expands the Council runtime.

This change activates v0.2.9.0 with a narrow provider-preflight scope.

## Scope

- Ship the Node.js 24 TypeScript `council-preflight` executable.
- Support bounded canaries for Grok, Claude, and Codex.
- Prove one external Foreman workflow with an independent audit.
- Publish current release records and an exact-candidate knowledge graph.

## Non-goals

- Do not ship Gemini support.
- Do not claim a complete Council review runtime.
- Do not complete the repository-wide Python migration.
- Do not publish an npm package.
- Do not add formal or Tier 2 release scope.

## Result

The release gives Foreman one provider-neutral preflight result before review dispatch.
