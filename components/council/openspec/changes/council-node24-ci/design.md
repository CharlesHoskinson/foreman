## Context

Council ships a deterministic local quality gate (`corepack pnpm check` plus
strict OpenSpec validation) under Node 24. Root GitHub Actions workflows
`gates-linux` and `gates-windows` already install Node 24, but they only run
Foreman shell gates. Pull requests that break Council TypeScript can still pass
hosted CI.

## Goals / Non-Goals

**Goals:**

- Make both existing root gate workflows fail pull requests when the Council
  TypeScript gate fails under Node 24.
- Keep the gate fully deterministic: install, format/lint/typecheck/architecture
  tests, and strict OpenSpec validation of all changes.
- Prove the workflow contract with a TypeScript regression, not a Bash or
  Python test.

**Non-Goals:**

- A third workflow file.
- Provider credentials, secrets, live canaries, health checks, or paid calls.
- Changes to runtime, adapters, domain, schema, or process ownership code.
- Merging Council PRs or modifying release branches.

## Decisions

1. **Reuse existing workflows** — Add one step to `gates-linux.yml` and
   `gates-windows.yml` instead of a dedicated Council workflow so pull-request
   enforcement stays centralized.
2. **Placement after Node 24 setup** — The step follows `actions/setup-node@v4`
   with `node-version: "24"` so Corepack and Node match Council engines.
3. **Exact command sequence** — From `components/council` with `CI=true`:
   `corepack pnpm install --frozen-lockfile`, then `corepack pnpm check`, then
   `corepack pnpm exec openspec validate --all --strict --no-interactive`.
4. **Shell portability** — Use `shell: bash` so the same script runs on
   `ubuntu-latest` and native Windows runners that already use Git Bash for
   other gate steps.
5. **Fail closed** — Omit `continue-on-error` and any `if:` that would skip or
   soft-fail the step on pull requests.
6. **No provider configuration** — The step environment carries only `CI=true`.
   No API keys, tokens, or live provider CLI invocations.
7. **Architecture regression** — A Vitest suite reads both workflow YAML files
   and asserts the contract so future edits cannot silently drop the gate.

## Risks / Trade-offs

- Hosted runners spend more time on every PR while Council installs and checks.
  Accepted so green CI means Council still builds.
- Windows Git Bash plus Corepack pnpm must remain available after Node setup.
  Mitigated by using the same Node 24 action already present.
- Strict OpenSpec validation of all changes fails the job when any open change
  is invalid. Desired: incomplete planning artifacts must not land green.

## Migration Plan

No data migration. After merge, the next pull request against the root gates
runs the Council step. Local developers continue to use
`corepack pnpm check` and `corepack pnpm verify` from `components/council`.
