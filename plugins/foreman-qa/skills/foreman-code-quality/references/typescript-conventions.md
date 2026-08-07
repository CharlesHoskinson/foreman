# TypeScript / Effect conventions (Iron Rule)

Canonical sources at repo root:

- [CLAUDE.md](../../../../../CLAUDE.md)
- [AGENTS.md](../../../../../AGENTS.md)
- [openspec/changes/node-typescript-runtime/design.md](../../../../../openspec/changes/node-typescript-runtime/design.md)

Short versions live in the parent [SKILL.md](../SKILL.md).

## Language and runtime

All new executable code SHALL target **Node.js 24** and SHALL be
**TypeScript**.

Do not add new implementation files in:

- Python
- Bash
- PowerShell
- CMD
- JavaScript
- MJS
- CJS

Put tests for new behavior in TypeScript.

Compile with strict type checking. Run the compiled product with **Node.js**,
not Bun, Deno, or a TypeScript-only runtime.

## Compatibility adapters

Existing non-TypeScript entry points may change only to:

1. Delete behavior, or
2. Become thin compatibility adapters that:
   - locate Node.js
   - forward the exact argument vector and environment unchanged
   - execute one compiled TypeScript entry point
   - preserve its exit status and byte streams (stdout, stderr, signals)
     exactly

A compatibility adapter must NOT:

- parse domain data
- implement business rules
- own durable state
- schedule work
- retry work
- supervise processes

The moment an adapter branches on parsed content it has crossed into being an
implementation, not a forwarder.

## Effect ownership

Use **Effect** for:

- typed failures
- scoped resources
- cancellation
- retries
- timeouts
- concurrency

Concrete cases:

- filesystem handles
- atomic publication
- locks and temp resources
- subprocess ownership
- output bounds
- timeouts, cancellation, and signals
- bounded retry and concurrency
- schema decoding and typed configuration failures
- dependency injection for filesystem, clock, process, and git test doubles

Keep pure, deterministic transforms as ordinary TypeScript functions:

- identifiers
- graph algorithms
- serialization

Do not wrap a pure function in Effect merely to satisfy a style rule.

## Failures at API boundaries

Fallible operations return **typed failures** rather than throwing across an
API boundary.

Throwing internally within a small local scope and converting to a typed
failure at the Effect boundary via `Effect.try` or `Effect.either` is
idiomatic and correct. The rule is about the boundary a caller depends on,
not about banning `throw` everywhere in the codebase.

## Generated bundles and manifest

Per `openspec/changes/node-typescript-runtime/design.md`, the build emits:

- self-contained Node.js ESM bundles under `skills/foreman/runtime/dist/`
- a digest manifest at `skills/foreman/runtime/manifest.json`

Both are **GENERATED**. Never hand-edit a file under
`skills/foreman/runtime/dist/` or the manifest.

After changing a TypeScript source file that feeds a bundle:

1. Rebuild it (current build entry point:
   `components/council/scripts/build-runtime.ts`, invoked via the package
   build script; this may evolve as the migration lands more packages per
   `openspec/changes/node-typescript-runtime/sprints.md` — treat "run the
   package build script, then diff dist" as the durable instruction)
2. Commit the regenerated bundle and manifest together in the same change as
   the source edit
3. Confirm reproducibility:

```bash
git diff --exit-code -- skills/foreman/runtime/dist/
```

- Exit 0 after a fresh rebuild: the build is deterministic
- Nonzero exit: either the source change was not rebuilt, or the build is
  non-deterministic — raise that bug; do not hand-fix dist

## Package layout

Product packages for this migration live under
`components/council/packages/`. Currently:

- `schema`
- `domain`
- `application`
- `platform-node`
- `runtime-node`
- `adapter-codex`
- `adapter-grok`
- `adapter-claude`

See `components/council/package.json` and
`components/council/pnpm-workspace.yaml`.

New TypeScript work under this migration goes in the appropriate package
`src/` directory, not loose at the repo root.

The controlling change is `openspec/changes/node-typescript-runtime/`.
