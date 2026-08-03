## Why

Root `gates-linux` and `gates-windows` already provision Node 24 on pull
requests, but they never install or test `components/council`. A green root
gate therefore does not prove that Council TypeScript, architecture rules, or
strict OpenSpec validation still pass. Hosted CI must enforce the complete
deterministic Council gate under Node 24 without provider credentials or paid
calls.

## What Changes

- Add one gating step named `Run Council Node 24 gate` to the existing root
  Linux and Windows pull-request workflows.
- Run the step from `components/council` after Node 24 setup with
  `CI=true` and the frozen-lockfile install, `pnpm check`, and strict
  OpenSpec-all validation sequence.
- Keep the step fail-closed: no `continue-on-error` and no conditional that
  weakens pull-request enforcement.
- Add a TypeScript/Vitest regression that reads both workflow files and proves
  Node version, step name, working directory, command order, strict
  validation, gating behavior, and absence of provider credentials or live
  provider calls.
- Record concise README and roadmap status that hosted root gates now validate
  Council under Node 24.

## Capabilities

### New Capabilities

- `ci-gating`: Hosted root Linux and Windows gates run the deterministic
  Council Node 24 quality suite without provider credentials or live calls.

### Modified Capabilities

- none

## Impact

- Touches only the two existing root gate workflows, one architecture
  regression, this OpenSpec change, and concise status text.
- Does not add a third workflow, provider secrets, network canaries, runtime
  code, adapters, domain, schema, or process code.
- Does not call Codex, Claude, Grok, Gemini, or any provider API or CLI.
